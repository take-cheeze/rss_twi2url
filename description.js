if(!process.send) { throw 'is not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments).join(' ') });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments).join(' ') });
};

var consumer = require('./consumer');
var fs = require('fs');
var request = require('request');
var URL = require('url');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var Iconv = require('iconv').Iconv;

var jsdom = require('jsdom');
var document = jsdom.jsdom(), window = document.createWindow();
DEFAULT_FEATURE = {
  FetchExternalResources: ['frame', 'css'],
  ProcessExternalResources: false,
  MutationEvents: false,
  QuerySelector: false
};
jsdom.defaultDocumentFeatures = DEFAULT_FEATURE;
var DEFAULT_ENCODING = 'utf8';
var $ = require('jquery');
$.support.cors = true;
$.ajaxSettings.xhr = function () {
  return new XMLHttpRequest;
};
var jquery_src = '';
request.get({uri: 'http://code.jquery.com/jquery-latest.min.js'},
            function(e, r, body) {
              if(e) throw e;
              jquery_src = body;
            });

var config = null;

var iconv_cache = {
  'utf8': true, 'utf-8': true,
  'x-sjis': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'x-euc-jp': new Iconv('euc-jp', DEFAULT_ENCODING + '//TRANSLIT//IGNORE') };

function unescapeHTML(str) {
  return $('<div />').html(str).text();
}
function escapeHTML(str) {
  return $('<div />').text(str).html();
}

function get_description(url, callback) {
  function image_tag(v, width, height) {
    if(!v) {
      console.error('empty url in image tag:', url);
      console.trace();
      return 'empty url in image tag';
    }
    var ret = $('<img />').attr('src', v);
    width && height && ret.attr({ 'width': width, 'height': height });
    return $('<div />').append(ret).html();
  }

  function retry() { get_description(url, callback); }
  function error_callback(err) { callback(url, '', err); }
  function jquery_error_callback(jqXHR, textStatus, errorThrown) {
    if(/timed?out/i.test(textStatus)) { retry(); }
    else {
      console.error("Error in: " + url);
      console.error(JSON.stringify([jqXHR, textStatus, errorThrown]));
      error_callback(textStatus);
    }
  }

  function oembed_default_callback(data) {
    callback(url, data.title || url,
             ('description' in data? data.description + '<br/>' : '') +
             ('image' in data? image_tag(data.image, data.width, data.height) + '<br/>' :
              'thumbnail' in data? image_tag(data.thumbnail, data.thumbnail_width, data.thumbnail_height) + '<br/>':
              'thumbnail_url' in data? image_tag(data.thumbnail_url, data.thumbnail_width, data.thumbnail_height) + '<br/>':
              '') +
             (data.type === 'rich'? data.html + '<br/>' :
              data.type === 'photo'? image_tag(data.url, data.width, data.height) + '<br/>' :
              ''));
  }
  function oembed(req_url, oembed_callback) {
    $.ajax({ 'url': req_url, dataType: 'json', timeout: config.timeout })
      .fail(jquery_error_callback).done(
        function(data) {
          if(oembed_callback === undefined) { oembed_default_callback(data); }
          else { oembed_callback(data); }
        });
  }

  function open_graph_body($) {
    var body = '';
    $.each(
      ['image', 'video', 'audio'], function(k, tag) {
        $.each(
          ['meta[property="og:' + tag + '"]', 'meta[name="og:' + tag + '"]'], function(k, selector) {
            $(selector).each(
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
                body += $('<div />').append(
                  $('<' + (tag === 'image'? 'img' : tag) + ' />')
                    .attr(opt)).html() + '<br />';
              });
          });
      });
    return body;
  }

  function run_jquery(cb, u) {
    var target_url = u || url;
    request.get(
      { uri: target_url, encoding: null, followAllRedirects: true, pool: false,
        timeout: config.timeout, headers: { 'User-Agent': config.user_agent } },
      function(err, res, data) {
        if(err || res.statusCode !== 200) {
          if(res) switch(res.statusCode) {
          case 500: case 502: case 503: case 504:
            retry();
            return;
          }
          if(err && /timed?out/i.test(err.code)) {
            retry();
            return;
          }
          console.error('URL:', target_url);
          res && console.error('Status Code:', res.statusCode);
          console.error('Error:', JSON.stringify(err));
          error_callback('error fetching');
          return;
        }

        if(!data || !data.toString) { callback(url, '', 'invalid data'); }

        var cont_type = res.headers['content-type'];

        if(!/html/i.test(cont_type)) {
          error_callback('unknown content type');
          return;
        }

        var charset_regex = /charset="?'?([\w_\-]+)"?'?/i;
        var ascii = data.toString('ascii');
        var enc =
          charset_regex.test(ascii)? ascii.match(charset_regex)[1]:
          charset_regex.test(cont_type)? cont_type.match(charset_regex)[1]:
          DEFAULT_ENCODING;
        enc = enc.toLowerCase();
        if(enc in iconv_cache) {
          if(iconv_cache[enc] === 'unsupported') {
            error_callback('unsupported charset: ' + enc);
            return;
          }
        } else {
          try {
            iconv_cache[enc] = new Iconv(
              enc, DEFAULT_ENCODING + '//TRANSLIT//IGNORE');
          } catch(e) {
            console.error('iconv open error:', e, enc);
            iconv_cache[enc] = 'unsupported';
            error_callback('unsupported charset: ' + enc);
            return;
          }
        }

        var html = '';
        try {
          html = /utf-?8/i.test(enc)? data.toString() :
            iconv_cache[enc].convert(data).toString(DEFAULT_ENCODING);
        } catch(e) {
          console.error('iconv error:', e, enc);
          error_callback('unsupported charset: ' + enc);
          return;
        }

        jsdom.env(
          html, { features: DEFAULT_FEATURE },
          function(err, window) {
            if(err) {
              error_callback(err);
              return;
            }

            var document = window.document;

            try { eval(jquery_src); }
            catch(e) { console.error('jQuery error:', e); }

            if(!window.jQuery) {
              error_callback('Cannot load jQuery');
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
                     $('#media_description').text() || $('title').text(),
                     $('#indivi_media').html());
                 });
    },

    '^https?://twitpic\\.com/(\\w+)(/full)?/?': function() {
      var id = url.match(/^http:\/\/twitpic.com\/(\w+)(\/full)?\/?/)[1];
      $.ajax(
        { 'url': 'http://api.twitpic.com/2/media/show.json?' + $.param({id: id}),
          dataType: 'json', timeout: config.timeout })
        .fail(jquery_error_callback).done(
          function(data) {
            callback(
              'http://twitpic.com/' + id + '/full', data.message || 'Twitpic Content',
              image_tag('http://twitpic.com/show/full/' + id, data.width, data.height)
            );
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
                   var body = '';
                   if(!body) $('.articleText').each(function(k,v) { body += $(v).html(); });
                   if(!body) $('.subContents').each(function(k,v) { body += $(v).html(); });
                   callback(url, $('meta[property="og:title"]').attr('content') || $('title').text(), body);
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
          var body = '';
          if(!body) $('.post').each(function(k,v) { body += $(v).html(); });
          if(!body) $('.post_content').each(function(k,v) { body += $(v).html(); });
          if(!body) $('article').each(function(k,v) { body += $(v).html(); });
          if(!body) $('#content').html();
          callback(url, $('meta[property="og:title"]').attr('content'), body);
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
        { 'url': 'https://gist.github.com/' + id + '.js',
          dataType: 'text', timeout: config.timeout })
        .fail(jquery_error_callback).done(
          function(data) {
            var html = '';
            $.each(data.match(/document\.write\('(.+)'\)/g), function(k, v) {
                     html += v.match(/document\.write\('(.+)'\)/)[1];
                   });
            eval("html = '" + html + "'");
            $.ajax(
              { 'url': 'https://api.github.com/gists/' + id,
                dataType: 'json', timeout: config.timeout })
              .fail(jquery_error_callback).done(
                function(data) {
                  callback(url, 'Gist: ' + data.id + ': ' + data.description || '', html);
                });
          });
    },

    '^https?://ideone.com/\\w+/?$': function() {
      run_jquery(function($) { callback(url, '', $('#source').html()); }); },

    '^https?://tmbox.net/pl/\\d+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), unescapeHTML($('#name').html())); });
    },

    '^https?://www.youtube.com/watch\\?.*v=[\\w\\-]+': function() {
      oembed('http://www.youtube.com/oembed?' +
             $.param({ 'url': url, format: 'json'}));
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
                     $('.caption').text(), open_graph_body($));
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
        { 'url': 'http://api.ustream.tv/json/video/' + id + '/getCustomEmbedTag?' +
          $.param({key: consumer.USTREAM_KEY, params: 'autoplay:true'}),
          timeout: config.timeout, dataType: 'json' })
        .fail(jquery_error_callback).done(
          function(data) {
            callback(url, '', data.results);
          });
    },
    '^https?://www.ustream.tv/channel/.+#?': function() {
      var id = url.match(/^http:\/\/www.ustream.tv\/channel\/(.+)#?/)[1];
      $.ajax(
        { 'url': 'http://api.ustream.tv/json/channel/' + id + '/getCustomEmbedTag?' +
          $.param({key: consumer.USTREAM_KEY, params: 'autoplay:true'}),
          timeout: config.timeout, dataType: 'json' })
        .fail(jquery_error_callback).done(
          function(data) {
            callback(url, '', data.results);
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
        { timeout: config.timeout, 'url': url, dataType: 'html' })
        .fail(jquery_error_callback).done(
          function(data) {
            callback(url, '', data.match(/var embed_code = '(.+)';/)[1]);
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
        $('<div />').append($('<iframe />').attr(
          { title: 'Google Docs Viewer',
            'class': 'google-docs-viewer',
            type: 'text/html',
            src: 'https://docs.google.com/viewer?' + $.param({'url': url, embedded: true}),
            width: '100%', height: '800'})).html()); }

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

          var body = open_graph_body($);
          $.each(
            ['article', '.entry_body', '.entry_text', '.entry-content', '.entry'],
            function(k, selector) {
              if(!body) { $(selector).each(function(idx, elm) { body += $(elm).html(); }); }
            });
          body += unescapeHTML(
            $('meta[property="og:description"]').attr('content')
              || $('meta[name="description"]').attr('content')
              || '');

          callback(
            $('meta[property="og:url"]').attr('content') || url,
            $('meta[property="og:title"]').attr('content') || $('title').text(), body);
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

    case 'config':
      config = msg.data;
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
