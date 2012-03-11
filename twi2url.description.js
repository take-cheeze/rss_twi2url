var
$ = require('jquery'),
assert = require('assert'),
consumer = require('./consumer'),
jsdom = require('jsdom'),
XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest,
Iconv = require('iconv').Iconv;

$.support.cors = true;
$.ajaxSettings.xhr = function () {
  return new XMLHttpRequest;
};

var document = jsdom.jsdom(), window = document.createWindow();
var iconv_cache = {}, DEFAULT_ENCODING = 'utf8';

module.exports.get_description = function(url, cback) {
  function unescapeHTML(str) {
    return $('<div />').html(str).text();
  }
  function escapeHTML(str) {
    return $('<div />').text(str).html();
  }
  function image_tag(v) {
    console.error('empty url in image tag: ' + url);
    return v
      ? $('body').empty().append($('<img />').attr('src', v)).html()
      : 'empty url in image tag';
  }

  function oembed_default_callback(data) {
    callback(url, data.title,
             'description' in data? data.description + '<br/>' : '' +
             'html' in data? data.html + '<br/>' : '' +
             'image' in data? image_tag(data.image) + '<br/>' : '' +
             (!('image' in data) && 'thumbnail_url' in data)? image_tag(data.thumbnail_url) + '<br/>' : '' +
             (url != data.url)? image_tag(data.url) + '<br/>' : '');
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

  function error_callback(jqXHR, textStatus, errorThrown) {
    switch(jqXHR.status) {
    case 404:
      return;
    }
    console.error(JSON.stringify([jqXHR, textStatus, errorThrown]));
    console.error(" at " + url);
  }
  var callback = cback;
  function run_jquery(cb, u) {
    jsdom.env(
      u === undefined? url : u, ['http://code.jquery.com/jquery-latest.js'],
      function(errors, window) {
        if(errors) {
          console.error(JSON.stringify(errors));
          console.error(" at " + url);
          return;
        }
        if(window !== undefined) {
          var $ = window.jQuery;
          var enc = $('meta')[0].attr('charset') ||
            $('meta[http-equiv="Content-Type"]').attr('content').match(/charset=([\w\-_]+)/, '$1') ||
            DEFAULT_ENCODING;

          if(!/utf-8/i.test(enc) && !/utf8/i.test(enc)) {
            if(!(enc in iconv_cache)) {
              iconv_cache[enc] = new Iconv(enc, 'UTF-8'); }
            var i = iconv_cache[enc];
            callback = function(url, title, description) {
              cback(url, i.convert(title).toString(DEFAULT_ENCODING),
                    i.convert(description).toString(DEFAULT_ENCODING));
            };
          }
          cb(window.jQuery, window);
        }
      });
  }

  var GALLERY_FILTER = {
    '^http://photozou.jp/photo/\\w+/(\\d+)/(\\d+)$': function() {
      var id = url.match(/^http:\/\/photozou.jp\/photo\/\w+\/(\d+)\/(\d+)/)[2];
      run_jquery(function($) {
                    callback(
                      url.replace('show', 'photo_only'),
                      $('#media_description').text(),
                      image_tag($('img')[1].attr('src')));
                  });
    },

    '^http://twitpic\\.com/(\\w+)(/full)?/?': function() {
      var id = url.match(/^http:\/\/twitpic.com\/(\w+)(\/full)?\/?/)[1];
      $.ajax(
        {
          'url': 'http://api.twitpic.com/2/media/show.json?' +
            $.param({'id': id}),
          dataType: 'json',
          success: function(data) {
            callback(
              'http://twitpic.com/' + id + '/full', data.message,
              image_tag('http://twitpic.com/show/full/' + id)
            );
          }, error: error_callback
        });
    },

    '^http://p.twipple.jp/\\w+/$': function() {
      run_jquery(
        function($) {
          var id = url.match(/^http:\/\/p.twipple.jp\/(\w+)\/?$/)[1];
          callback(
            $('meta[property="og:url"]').attr('content'),
            $('meta[property="og:title"]').attr('content'),
            image_tag('http://p.twpl.jp/show/orig/' + id) +
              unescapeHTML($('meta[property="og:description"]').attr('content')));
        });
    },

    '^http://ameblo.jp/[\\w\\-]+/entry-\\d+\.html': function() {
      run_jquery(function($) {
                   callback(url, $('meta[property="og:title"]').attr('content'),
                            $('.subContents').remove('script').html()); }); },

    '^http://blog.goo.ne.jp/[\\w_-]+/e/\\w+$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), $('.entry-body')[0].html()); }); },

    '^http://[\\w\\-_]+.hatenablog.com/.+': function() {
      run_jquery(function($) {
                   callback(url, $('.bookmark').text(), $('.entry-content')[0].html()); }); },

    '^http://blog.livedoor.jp/[\\w\\-]+/archives/\\d+.html$': function() {
      run_jquery(function($) {
                   var main = '';
                   $('.main').each(function() { main += $(this).html(); });
                   callback(url, $('.title').text(), main + $('#main').html()); }); },

    '^http://[\\w\\-]+.blog\\d+.fc2.com/blog-entry-\\d+.html$': function() {
      run_jquery(function($) {
                   var body = '';
                   $('.entry-body').each(function() { body += $(this).html(); });
                   callback(url, $('.title').text(), body); }); },

    '^http://.+.tumblr.com/post/.+': function() {
      run_jquery(
        function($) { callback(
                        url, $('meta[property="og:title"]').attr('content'),
                        $('.post').html()); }); },

    '^http://www.twitlonger.com/show/\\w+/?$': function() {
      run_jquery(function($) { callback(url, $('title').text(), $('p')[1].html()); }); },

    '^http://www.tweetdeck.com/twitter/\\w+/~\\w+': function() {
      run_jquery(function($) { callback(url, $('title').text(), $('#tweet').html()); }); },

    '^http://theinterviews.jp/[\\w\\-]+/\\d+': function() {
      run_jquery(function($) {
                   callback(url, $('meta[property="og:title"]').text(), $('.note').html()); }); },

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
            callback(url, '', html);
          }, error: error_callback
        }); },

    '^https?://ideone.com/\\w+/?$': function() {
      var id = url.match(/^http:\/\/ideone.com\/(\w+)\/?$/)[1];
      $.ajax(
        {
          'url': 'http://ideone.com/plain/' + id, dataType: 'text',
          success: function(data) {
            callback(url, '', '<pre>' + escapeHTML(data) + '</pre>');
          }, error: error_callback
        }); },

    '^http://tmbox.net/pl/\\d+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('title').text(), unescapeHTML($('#name').html())); });
    },

    '^http://www.youtube.com/watch\\?.*v=[\\w\\-]+': function() {
      oembed('http://www.youtube.com/oembed?' +
             $.param({'url': url, format: 'json'}),
             function(data) {
               callback(url, data.title, image_tag(data.thumbnail_url));
               // data.html.replace(/(src="[^"]+)"/, '$1&autoplay=1"');
             });
    },

    '^http://vimeo.com/\\d+$': function() {
      oembed('http://vimeo.com/api/oembed.json?' +
             $.param({'url': url, autoplay: true, iframe: true})); },
    '^http://soundcloud.com/.+/.+$': function() {
      oembed('http://soundcloud.com/oembed?' +
             $.param({'url': url, format: 'json', auto_play: true})); },
    '^https?://\\w+.wordpress.com/.+$': function() {
      oembed('http://public-api.wordpress.com/oembed/1.0/?' +
             $.param({'for': 'twi2url', format: 'json', 'url': url})); },
    '^http://www.slideshare.net/[^/]+/[^/]+$': function() {
      oembed('http://www.slideshare.net/api/oembed/2?' +
             $.param({'url': url, format: 'json'})); },

    '^http://.+\\.deviantart.com/art/.+$': function() {
      oembed('http://backend.deviantart.com/oembed?' + $.param({'url': url})); },
    '^http://www.flickr.com/photos/[@\\w\\-]+/\\d+/?': function() {
      oembed('http://www.flickr.com/services/oembed?' + $.param({'url': url, format: 'json'})); },
    '^http://www.docodemo.jp/twil/view/': function() {
      oembed('http://www.docodemo.jp/twil/oembed.json?' + $.param({'url': url})); },
    '^http://instagr.am/p/[\\-\\w]+/?$': function() {
      run_jquery(function($) {
                   callback(
                     $('meta[property="og:url"]').attr('content'),
                     $('.caption').text(),
                     image_tag(image_tag($('meta[property="og:image"]').attr('content'))));
                 }); },
    '^http://movapic.com/pic/\\w+$': function() {
      callback(
        url, '', image_tag(
          url.replace(
              /http:\/\/movapic.com\/pic\/(\w+)/,
            'http://image.movapic.com/pic/m_$1.jpeg'))); },
    '^http://gyazo.com/\\w+$': function() { callback(url, '', image_tag(url + '.png')); },
    '^http://\\w+.tuna.be/\\d+.html$': function() {
      run_jquery(function($) {
                   callback(url, $('h2').text(), $('.blog-message').html());
                 });
    },
    '^http://ow.ly/i/\\w+': function() {
      var id = url.match(/^http:\/\/ow.ly\/i\/(\w+)/)[1];
      callback(
        'http://ow.ly/i/' + id + '/original', '',
        image_tag('http://static.ow.ly/photos/normal/' + id + '.jpg'));
    },

    '^http://www.nicovideo.jp/watch/\\w+': function() {
      var id = url.match(/^http:\/\/www.nicovideo.jp\/watch\/(\w+)/)[1];
      run_jquery(function($) {
                   callback(url, $('title').text(), $('body').html());
                 }, 'http://ext.nicovideo.jp/thumb/' + id);
      /*
       document = jsdom.jsdom(),
       window = document.createWindow(),
       navigator = { userAgent: "node-js" };
       $.get('http://ext.nicovideo.jp/thumb_watch/' + id, function(data) {
       eval(data);
       callback(url, url, document.innerHTML);
       }, 'text');
       */
    },

    '^http://lockerz.com/s/\\d+$': function() {
      run_jquery(function($) {
                   callback(url, $('p')[1].text(), image_tag($('#photo').attr('src')));
                 });
    },

    '^http://kokuru.com/\\w+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('h1')[0].text(), image_tag($('#kokuhaku_image_top').attr('src')));
                 });
    },

    '^http://twitvideo.jp/\\w+/?$': function() {
      run_jquery(function($) {
                   callback(url, $('.sf_comment')[0].text(), unescapeHTML($('#vtSource').attr('value')));
                 });
    },

    '^http://twitcasting.tv/\\w+/?$': function() {
      var id = url.match(/^http:\/\/twitcasting.tv\/(\w+)\/?$/)[1];
      callback(url, '',
               '<video src="http://twitcasting.tv/' + id + '/metastream.m3u8/?video=1"' +
               ' autoplay="true" controls="true"' +
               ' poster="http://twitcasting.tv/' + id + '/thumbstream/liveshot" />');
    },

    '^http://www.twitvid.com/\\w+/?$': function() {
      var id = url.match(/^http:\/\/www.twitvid.com\/(\w+)\/?$/)[1];
      callback(url, '',
               '<iframe title="Twitvid video player" class="twitvid-player" type="text/html" ' +
               'src="http://www.twitvid.com/embed.php?' +
               $.param({guid: id, autoplay: 1}) + '" ' +
               'width="480" height="360" frameborder="0" />');
    },

    '^http://www.ustream.tv/recorded/\\d+': function() {
      var id = url.match(/^http:\/\/www.ustream.tv\/recorded\/(\d+)/)[1];
      $.ajax(
        {
          url: 'http://api.ustream.tv/json/video/' + id + '/getCustomEmbedTag?' +
            $.param({key: consumer.USTREAM_KEY, params: 'autoplay:true'}),
          dataType: 'json', success: function(data) {
            callback(url, url, data.results);
          }, error: error_callback
        });
    },
    '^http://www.ustream.tv/channel/.+#?': function() {
      var id = url.match(/^http:\/\/www.ustream.tv\/channel\/(.+)#?/)[1];
      $.ajax(
        {
          url: 'http://api.ustream.tv/json/channel/' + id + '/getCustomEmbedTag?' +
            $.param({key: consumer.USTREAM_KEY, params: 'autoplay:true'}),
          dataType: 'json', success: function(data) {
            callback(url, url, data.results);
          }, error: error_callback
        });
    },

    '^http://layercloud.net/items/detail_top/\\d+/?$': function() {
      var id = url.match(/^http:\/\/layercloud.net\/items\/detail_top\/(\d+)\/?$/)[1];
      run_jquery(function($) {
                   callback(
                     url, $('.ItemDescription')[0].html(),
                     image_tag('http://layercloud.net/img/items/' + id + '.jpg'));
                 });
    },

    '^http://www.drawlr.com/d/\\w+/view/?$': function() {
      $.ajax(
        {
          url: url, dataType: 'html', success: function(data) {
            callback(
              url, '',
              data.match(/var embed_code = '(.+)';/)[1]);
          }, error: error_callback
        });
    },
  };

  function is_image_url(url) {
    var check = ['png', 'jpg', 'jpeg', 'gif'];
    for(i in check) {
      if((new RegExp('^.+\\.' + check[i] + '$', 'i')).test(url)) { return true; }
    }
    return false;
  }
  function is_docs(url) {
    var check = ['docx?', 'xlsx?', 'pptx?', 'pages', 'ttf', 'psd', 'ai', 'tiff', 'dxf', 'svg', 'xps', 'pdf'];
    for(i in check) {
      if((new RegExp('^.+\\.' + check[i] + '$', 'i')).test(url)) { return true; }
    }
    return false;
  }
  function is_open_graph(url) {
    var check = [
        /^https?:\/\/www.lomography.jp\/photos\/\\d+\/?$/i,
        /^https?:\/\/pikubo.jp\/photo\/[\\w\\-]+$/i,
        /^https?:\/\/picplz.com\/user\/\\w+\/pic\/\\w+\/$/i,
        /^https?:\/\/www.mobypicture.com\/user\/\\w+\/view\/\\d+/i,
        /^https?:\/\/yfrog.com\/(\\w*)$/i,
        /^https?:\/\/english.aljazeera.net\/.+/i,
        /^https?:\/\/seiga.nicovideo.jp\/seiga\/im/i,
        /^https?:\/\/www.pixiv.net\/member_illust.php/i,
        /^https?:\/\/soundtracking.com\/tracks\/\\w+$/i,
        /^https?:\/\/fotolog.cc\/\\w+\/?$/i,
        /^https?:\/\/img.ly\/\\w+$/i,
        /^http:\/\/lightbox.com\/photo\/\\w+$/,
     ];
    for(i in check) { if(check[i].test(url)) { return true; } }
    return false;
  }
  function is_hatena_diary(url) {
    var check = [
        /^http:\/\/d.hatena.ne.jp\/[\w\-]+\/[\w_-]+/,
        /^http:\/\/\w+\.g\.hatena.ne.jp\/[\w\-]+\/[\w_-]+/
    ];
    for(i in check) { if(check[i].test(url)) { return true; } }
    return false;
  }

  function get_filename(str) {
    return str.match(/\/([^\/]+)$/)[1];
  }

  for(k in GALLERY_FILTER) {
    if(is_image_url(url)) {
      callback(url, get_filename(url), image_tag(url));
      return;
    }
    if(is_docs(url)) {
      callback(
        url, get_filename(url), $('body').empty().append($('<iframe />').attr(
          { 'title': 'Google Docs Viewer',
            'class': 'google-docs-viewer',
            'type': 'text/html',
            'src': 'https://docs.google.com/viewer?' + $.param({'url': url, 'embedded': true}),
            'width': '100%', 'height': '600'})).html());
      return;
    }
    if(is_open_graph(url)) {
      run_jquery(function($) {
                   var img_url = image_tag($('meta[property="og:image"]').attr('content'));
                   callback(
                     $('meta[property="og:url"]').attr('content'),
                     $('meta[property="og:title"]').attr('content'),
                     image_tag(img_url) + '<br/>' +
                       unescapeHTML($('meta[property="og:description"]').attr('content')));
                 });
      return;
    }

    if(is_hatena_diary(url)) {
      run_jquery(function($) {
                   var section = '';
                   $('.section').each(function() { section += $(this).html(); });
                   callback(url, $('title').text(), section); });
    }

    if((new RegExp(k)).test(url)) {
      GALLERY_FILTER[k]();
      return;
    }
  }

  oembed(
    'http://embeddit.appspot.com/fetch/?' + $.param({'url': url}), function(data) {
      if('url' in data) { oembed_default_callback(data); }
      else {
        run_jquery(function($) {
                     $ && callback(url, $('title').text(), e);
                   }); }
    });
};
