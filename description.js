if(!process.send) { throw 'is not forked'; }

var $ = require('jquery');
var consumer = require('./consumer');
var fs = require('fs');
var jsdom = require('jsdom');
var request = require('request');
var URL = require('url');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

$.support.cors = true;
$.ajaxSettings.xhr = function () {
  return new XMLHttpRequest;
};

var document = jsdom.jsdom(), window = document.createWindow();
DEFAULT_FEATURE = {
  FetchExternalResources: ['frame', 'css'],
  ProcessExternalResources: false,
  MutationEvents: false,
  QuerySelector: false
};
jsdom.defaultDocumentFeatures = DEFAULT_FEATURE;
var DEFAULT_ENCODING = 'utf8';

var iconv_cache = { 'utf8': true, 'utf-8': true };

var jquery_src = '';
request.get({uri: 'http://code.jquery.com/jquery-latest.min.js'},
            function(e, r, body) {
              if(e) throw e;
              jquery_src = body;
            });

$.fn.outerHTML = function(t) {
  return (t)
    ? this.before(t).remove()
    : $("<div />").append(this.eq(0).clone()).html();
};

function unescapeHTML(str) {
  return $('<div />').html(str).text();
}
function escapeHTML(str) {
  return $('<div />').text(str).html();
}

function get_description(url, callback) {
  function image_tag(v) {
    if(!v) {
      console.error('empty url in image tag: ' + url);
      console.trace();
    }
    return v
      ? $('<img />').attr('src', v).outerHTML()
      : 'empty url in image tag';
  }

  function error_callback(jqXHR, textStatus, errorThrown) {
    switch(jqXHR.status) {
    case 404:
      console.error('Error not found: ' + url);
      return;
    }
    console.error("Error in: " + url);
    console.error(JSON.stringify([jqXHR, textStatus, errorThrown]));
  }

  function oembed_default_callback(data) {
    callback(url, data.title || url,
             ('description' in data? data.description + '<br/>' : '') +
             ('image' in data? image_tag(data.image) + '<br/>' :
              'thumbnail' in data? image_tag(data.thumbnail) + '<br/>':
              'thumbnail_url' in data? image_tag(data.thumbnail_url) + '<br/>':
              '') +
             (data.type === 'rich'? data.html + '<br/>' :
              data.type === 'photo'? image_tag(data.url) + '<br/>' :
              ''));
  }
  function oembed(req_url, oembed_callback) {
    $.ajax(
      {
        'url': req_url, dataType: 'json',
        success: function(data) {
          if(oembed_callback === undefined) { oembed_default_callback(data); }
          else { oembed_callback(data); }
        }, error: error_callback
      });
  }

  function run_jquery(cb, u) {
    var target_url = u || url;
    request.get(
      { uri: target_url, encoding: null, followAllRedirects: true, pool: false },
      function(err, res, data) {
        if(err || res.statusCode !== 200) {
          if(res) switch(res.statusCode) {
          case 500: case 502: case 503: case 504:
            setTimeout(run_jquery, 1000 * 10, cb, target_url);
            return;
          }
          console.error('URL: ' + target_url);
          res && console.error('Status Code: ' + res.statusCode);
          console.error(JSON.stringify(err));
          callback(target_url, '', 'error fetching');
          return;
        }

        if(!data) { callback(target_url, '', 'invalid data'); }

        var cont_type = res.headers['content-type'];

        if(!/html/i.test(cont_type)) {
          callback(target_url, '', 'unknown content type');
          return;
        }

        var charset_regex = /charset="?'?([\w_\-]+)"?'?/i, ascii = data.toString('ascii');
        var enc =
          charset_regex.test(ascii)? ascii.match(charset_regex)[1]:
          charset_regex.test(cont_type)? cont_type.match(charset_regex)[1]:
          DEFAULT_ENCODING;
        enc = enc.toLowerCase();
        if(enc in iconv_cache) {
          if(iconv_cache[enc] === 'unsupported') {
            callback(target_url, '', 'unsupported charset: ' + enc);
            return;
          }
        } else {
          try {
            iconv_cache[enc] = new (require('iconv').Iconv)(
              enc, DEFAULT_ENCODING + '//TRANSLIT//IGNORE');
          } catch(e) {
            console.error('iconv open error: ', e, enc);
            iconv_cache[enc] = 'unsupported';
            callback(target_url, '', 'unsupported charset: ' + enc);
            return;
          }
        }

        var html = '';
        try {
          html = /utf-?8/i.test(enc)? data.toString() :
            iconv_cache[enc].convert(data).toString(DEFAULT_ENCODING);
        } catch(e) {
          console.error('iconv error: ', e, enc);
          callback(target_url, '', 'unsupported charset: ' + enc);
          return;
        }

        jsdom.env(
          html, { features: DEFAULT_FEATURE },
          function(err, window) {
            if(err) {
              console.error(err);
              return;
            }

            var document = window.document;

            try {
              eval(jquery_src);
              if(!window.jQuery) { throw 'jQuery not installed'; }
            } catch(e) {
              callback(target_url, '', 'jQuery error:' + e);
              return;
            }

            var $ = window.jQuery;

            $('script').empty();
            $('a').each(
              function(idx,elm) {
                $(elm).attr('href', URL.resolve(target_url, $(elm).attr('href')));
              });
            $('img').each(
              function(idx,elm) {
                $(elm).attr('src', URL.resolve(target_url, $(elm).attr('src')));
              });
            $.fn.outerHTML = function(t) {
              return (t)
                ? this.before(t).remove()
                : $("<div />").append(this.eq(0).clone()).html();
            };

            cb($, window);
          });
      });
  }

  var GALLERY_FILTER = {
    '^https?://photozou.jp/photo/\\w+/(\\d+)/(\\d+)$': function() {
      var id = url.match(/^http:\/\/photozou.jp\/photo\/\w+\/(\d+)\/(\d+)/)[2];
      run_jquery(function($) {
                   callback(
                     url.replace('show', 'photo_only'),
                     $('#media_description').text(),
                     $('#indivi_media').html());
                 });
    },

    '^https?://twitpic\\.com/(\\w+)(/full)?/?': function() {
      var id = url.match(/^http:\/\/twitpic.com\/(\w+)(\/full)?\/?/)[1];
      $.ajax(
        {
          'url': 'http://api.twitpic.com/2/media/show.json?' + $.param({id: id}),
          dataType: 'json', success: function(data) {
            callback(
              'http://twitpic.com/' + id + '/full', data.message || 'Twitpic Content',
              image_tag('http://twitpic.com/show/full/' + id)
            );
          }, error: error_callback
        });
    },

    '^https?://p.twipple.jp/\\w+/?$': function() {
      run_jquery(
        function($) {
          var id = url.match(/^http:\/\/p.twipple.jp\/(\w+)\/?$/)[1];
          callback(
            url, $('meta[property="og:title"]').attr('content'),
            image_tag('http://p.twpl.jp/show/orig/' + id) + '<br />' +
              unescapeHTML($('meta[property="og:description"]').attr('content')));
        });
    },

    '^https?://ameblo.jp/[\\w\\-]+/entry-\\d+\.html': function() {
      run_jquery(function($) {
                   var text = '';
                   $('.articleText').each(function(k,v) { text += $(v).html(); });
                   $('.subContents').each(function(k,v) { text += $(v).html(); });
                   callback(url, $('meta[property="og:title"]').attr('content'), text);
                 }); },
    '^https?://blog.goo.ne.jp/[\\w_-]+/e/\\w+$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), $('.entry-body').html()); }); },
    '^https?://blog.livedoor.jp/[\\w\\-]+/archives/\\d+.html': function() {
      run_jquery(function($) {
                   var main = '';
                   $('.main').each(function(k,v) { main += $(v).html(); });
                   $('.mainmore').each(function(k,v) { main += $(v).html(); });
                   callback(url, $('meta[property="og:title"]').text() || $('title').text(),
                            main + $('#main').html() || ''); }); },
    '^https?://\\w+.exblog.jp/\\d+$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), $('.POST_BODY').html()); }); },

    '^https?://.+.tumblr.com/post/.+': function() {
      run_jquery(
        function($) {
          var text = '';
          $('.post').each(function(k,v) { text += $(v).html(); });
          $('.post_content').each(function(k,v) { text += $(v).html(); });
          if(!text) { $('article').each(function(k,v) { text += $(v).html(); }); }
          text += $('#content').html();
          callback(url, $('meta[property="og:title"]').attr('content'), text);
        }); },

    '^https?://www.twitlonger.com/show/\\w+/?$': function() {
      run_jquery(function($) { callback(url, $('title').text(), $($('p').get(1)).html()); }); },

    '^https?://www.tweetdeck.com/twitter/\\w+/~\\w+': function() {
      run_jquery(function($) { callback(url, $('title').text(), $('#tweet').html()); }); },

    '^https?://theinterviews.jp/[\\w\\-]+/\\d+': function() {
      run_jquery(function($) {
                   callback(url, $('meta[property="og:title"]').attr('content'),
                            $('.note').html()); }); },

    '^https?://gist.github.com/\\w+/?': function() {
      var id = url.match(/^https?:\/\/gist.github.com\/(\w+)\/?/)[1];
      $.ajax(
        {
          'url': 'https://gist.github.com/' + id + '.js', dataType: 'text',
          success: function(data) {
            var html = '';
            $.each(data.match(/document\.write\('(.+)'\)/g), function(k, v) {
                     html += v.match(/document\.write\('(.+)'\)/)[1];
                   });
            eval("html = '" + html + "'");
            $.ajax(
              {
                'url': 'https://api.github.com/gists/' + id, dataType: 'json',
                success: function(data) {
                  callback(url, 'Gist: ' + data.id + ': ' + data.description || '', html);
                }, error: error_callback });
          }, error: error_callback
        }); },

    '^https?://ideone.com/\\w+/?$': function() {
      run_jquery(function($) { callback(url, '', $('#source').html()); }); },

    '^https?://tmbox.net/pl/\\d+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), unescapeHTML($('#name').html())); });
    },

    '^https?://www.youtube.com/watch\\?.*v=[\\w\\-]+': function() {
      oembed('http://www.youtube.com/oembed?' +
             $.param({ 'url': url, format: 'json'}),
             function(data) {
               callback(url, data.title, image_tag(data.thumbnail_url));
               // data.html.replace(/(src="[^"]+)"/, '$1&autoplay=1"');
             });
    },

    '^https?://vimeo.com/\\d+$': function() {
      oembed('http://vimeo.com/api/oembed.json?' +
             $.param({ 'url': url, autoplay: true, iframe: true})); },
    '^https?://soundcloud.com/.+/.+$': function() {
      oembed('http://soundcloud.com/oembed?' +
             $.param({ 'url': url, format: 'json', auto_play: true})); },
    '^https?://\\w+.wordpress.com/.+$': function() {
      oembed('http://public-api.wordpress.com/oembed/1.0/?' +
             $.param({for: 'twi2url', format: 'json', 'url': url})); },
    '^https?://www.slideshare.net/[^/]+/[^/]+': function() {
      oembed('http://www.slideshare.net/api/oembed/2?' +
             $.param({ 'url': url, format: 'json'})); },

    '^https?://twitter.com/.+/status/\\d+': function() {
      oembed('https://api.twitter.com/1/statuses/oembed.json?' +
             $.param({ 'id': url.match(/\/status\/(\d+)/)[1],
                       hide_media: false, hide_thread: false,
                       omit_script: false, align: 'left' })); },

    '^https?://.+\\.deviantart.com/art/.+$': function() {
      oembed('http://backend.deviantart.com/oembed?' + $.param({ 'url': url })); },
    '^https?://www.flickr.com/photos/[@\\w\\-]+/\\d+/?': function() {
      oembed('http://www.flickr.com/services/oembed?' + $.param({ 'url': url, format: 'json' })); },
    '^https?://www.docodemo.jp/twil/view/': function() {
      oembed('http://www.docodemo.jp/twil/oembed.json?' + $.param({ 'url': url })); },
    '^https?://instagr.am/p/[\\-\\w]+/?$': function() {
      run_jquery(function($) {
                   callback(
                     $('meta[property="og:url"]').attr('content'),
                     $('.caption').text(),
                     image_tag($('meta[property="og:image"]').attr('content')));
                 }); },
    '^https?://movapic.com/pic/\\w+$': function() {
      callback(
        url, '', image_tag(
          url.replace(
              /http:\/\/movapic.com\/pic\/(\w+)/,
            'http://image.movapic.com/pic/m_$1.jpeg'))); },
    '^https?://gyazo.com/\\w+$': function() { callback(url, '', image_tag(url + '.png')); },
    '^https?://\\w+.tuna.be/\\d+.html$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(),
                            $('.blog-message').html() || $('.photo').html());
                 });
    },
    '^https?://ow.ly/i/\\w+': function() {
      var id = url.match(/^http:\/\/ow.ly\/i\/(\w+)/)[1];
      callback(
        'http://ow.ly/i/' + id + '/original', '',
        image_tag('http://static.ow.ly/photos/normal/' + id + '.jpg'));
    },

    '^https?://www.nicovideo.jp/watch/\\w+': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), $('body').html());
                 },
                 'http://ext.nicovideo.jp/thumb/'
                 + url.match(/^http:\/\/www.nicovideo.jp\/watch\/(\w+)/)[1]);
    },

    '^https?://lockerz.com/s/\\d+$': function() {
      run_jquery(function($) {
                   callback(url, $($('p').get(1)).text(), image_tag($('#photo').attr('src')));
                 });
    },

    '^https?://kokuru.com/\\w+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('h1').text(), image_tag($('#kokuhaku_image_top').attr('src')));
                 });
    },

    '^https?://twitvideo.jp/\\w+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('.sf_comment').text(), unescapeHTML($('#vtSource').attr('value')));
                 });
    },

    '^https?://twitcasting.tv/\\w+/?$': function() {
      var id = url.match(/^http:\/\/twitcasting.tv\/(\w+)\/?$/)[1];
      callback(url, '',
               '<video src="https?://twitcasting.tv/' + id + '/metastream.m3u8/?video=1"' +
               ' autoplay="true" controls="true"' +
               ' poster="https?://twitcasting.tv/' + id + '/thumbstream/liveshot" />');
    },

    '^https?://www.twitvid.com/\\w+/?$': function() {
      var id = url.match(/^http:\/\/www.twitvid.com\/(\w+)\/?$/)[1];
      callback(url, '',
               '<iframe title="Twitvid video player" class="twitvid-player" type="text/html" ' +
               'src="https?://www.twitvid.com/embed.php?' +
               $.param({guid: id, autoplay: 1}) + '" ' +
               'width="480" height="360" frameborder="0" />');
    },

    '^https?://www.ustream.tv/recorded/\\d+': function() {
      var id = url.match(/^http:\/\/www.ustream.tv\/recorded\/(\d+)/)[1];
      $.ajax(
        {
          'url': 'http://api.ustream.tv/json/video/' + id + '/getCustomEmbedTag?' +
            $.param({key: consumer.USTREAM_KEY, params: 'autoplay:true'}),
          dataType: 'json', success: function(data) {
            callback(url, '', data.results);
          }, error: error_callback
        });
    },
    '^https?://www.ustream.tv/channel/.+#?': function() {
      var id = url.match(/^http:\/\/www.ustream.tv\/channel\/(.+)#?/)[1];
      $.ajax(
        {
          'url': 'http://api.ustream.tv/json/channel/' + id + '/getCustomEmbedTag?' +
            $.param({key: consumer.USTREAM_KEY, params: 'autoplay:true'}),
          dataType: 'json', success: function(data) {
            callback(url, '', data.results);
          }, error: error_callback
        });
    },

    '^https?://layercloud.net/items/detail_top/\\d+/?$': function() {
      var id = url.match(/^http:\/\/layercloud.net\/items\/detail_top\/(\d+)\/?$/)[1];
      run_jquery(function($) {
                   callback(
                     url, $('.ItemDescription').html(),
                     image_tag('http://layercloud.net/img/items/' + id + '.jpg'));
                 });
    },

    '^https?://www.drawlr.com/d/\\w+/view/?$': function() {
      $.ajax(
        {
          'url': url, dataType: 'html', success: function(data) {
            callback(url, '', data.match(/var embed_code = '(.+)';/)[1]);
          }, error: error_callback
        });
    }
  };

  if((function() {
        var check = ['png', 'jpg', 'jpeg', 'gif'];
        for(i in check) {
          if((new RegExp('^.+\\.' + check[i] + '$', 'i')).test(url)) { return true; }
        }
        return false;
      })()) { callback(url, url.match(/\/([^\/]+)$/)[1], image_tag(url)); }

  else if(
    (function() {
       var check = [
         'docx?', 'xlsx?', 'pptx?', 'pages', 'ttf', 'psd', 'ai', 'tiff', 'dxf', 'svg', 'xps', 'pdf'];
       for(i in check) {
         if((new RegExp('^.+\\.' + check[i] + '$', 'i')).test(url)) { return true; }
       }
       return false;
     })()) {
    callback(
      url, url.match(/\/([^\/]+)$/)[1],
        $('<iframe />').attr(
          { title: 'Google Docs Viewer',
            'class': 'google-docs-viewer',
            type: 'text/html',
            src: 'https://docs.google.com/viewer?' + $.param({'url': url, embedded: true}),
            width: '100%', height: '600'}).outerHTML()); }

  else if(
    (function() {
       var check = [
           /^https?:\/\/d.hatena.ne.jp\/[\w\-_]+\/[\w\-_]+/,
           /^https?:\/\/[\w\-_]+.g.hatena.ne.jp\/[\w\-_]+\/[\w\-_]+/,
           /^https?:\/\/anond.hatelabo.jp\/\d+/
       ];
       for(i in check) { if(check[i].test(url)) { return true; } }
       return false;
     })())
  {
    run_jquery(function($) {
                 var section = '';
                 $('.section').each(function(k,v) { section += $(v).html(); });
                 callback(url, $('title').text(), section); }); }

  else {
    (function() {
       for(k in GALLERY_FILTER) {
         if((new RegExp(k, 'i')).test(url)) {
           GALLERY_FILTER[k]();
           return true;
         }
       }
       return false;
     })() ||
      run_jquery(
        function($) {
          var oembed_url = $('link[rel="alternate"][type="text/json+oembed"]').attr('href');
          if(oembed_url) {
            oembed(oembed_url);
            return;
          }

          var html = '';
          $.each(
            ['image', 'video', 'audio'], function(k, tag) {
              $('meta[property="og:' + tag + '"]').each(
                function(idx, elm) {
                  var opt = { src: $(elm).attr('content') };
                  for(var i = $(elm).next();
                      (new RegExp('og:' + tag + ':')).test(i.attr('property')); i = i.next())
                  {
                    var struct_prop = i.attr('property').match(new RegExp('og:' + tag + ':(\\w+)'))[1];
                    switch(struct_prop) {
                    case 'width':
                    case 'height':
                      opt[struct_prop] = i.attr('content');
                      break;
                    }
                  }
                  html += $('<' + (tag === 'image'? 'img' : tag) + ' />').attr(opt).outerHTML() + '<br />';
                });
            });
          if(!html) { $('article').each(function(idx,elm) { html += $(elm).html(); }); }
          if(!html) { $('.entry_body').each(function(k,v) { html += $(v).html(); }); }
          if(!html) { $('.entry-content').each(function(k,v) { html += $(v).html(); }); }
          if(!html) { $('.entry').each(function(k,v) { html += $(v).html(); }); }
          html += unescapeHTML(
            $('meta[property="og:description"]').attr('content')
              || $('meta[name="description"]').attr('content')
              || '');

          callback(
            $('meta[property="og:url"]').attr('content') || url,
            $('meta[property="og:title"]').attr('content') || $('title').text(), html);
        });
  }
}

process.on(
  'message', function(msg) {
    if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

    switch(msg.type) {
    case 'get_description':
      get_description(
        msg.data.url, function(url, title, description) {
          process.send({type: 'got_description', data: [msg.data, url, title, description]});
        });
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
