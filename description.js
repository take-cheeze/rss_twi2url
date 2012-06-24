if(!process.send) { throw 'is not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments).join(' ') });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments).join(' ') });
};

var consumer = {};
try { consumer = require('./consumer'); } catch(e) {}
consumer.USTREAM_KEY = process.env.USTREAM_KEY;
var fs = require('fs');
var request = require('request');
var URL = require('url');
var Iconv = require('iconv').Iconv;
var zlib = require('zlib');

var jsdom = require('jsdom');
var document = jsdom.jsdom(), window = document.createWindow();
DEFAULT_FEATURE = {
  FetchExternalResources: false, // ['frame', 'css'],
  ProcessExternalResources: false,
  MutationEvents: false,
  QuerySelector: false
};
jsdom.defaultDocumentFeatures = DEFAULT_FEATURE;
var DEFAULT_ENCODING = 'utf8';
var $ = require('jquery');
$.support.cors = true;

var config = null;
var retry_count = {};

var iconv_cache = {
  'x-sjis': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'shiftjis': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'x-euc-jp': new Iconv('euc-jp', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'windows-31j': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'utf8': true, 'utf-8': true
};

function unescapeHTML(str) {
  try { return $('<div />').html(str).text(); }
  catch(e) { return str; }
}
function escapeHTML(str) {
  return $('<div />').text(str).html();
}

function image_tag(v, width, height) {
  if(!v) {
    return 'empty url in image tag';
  }
  var ret = $('<img />').attr('src', v);
  if(width) { ret.attr('width', width); }
  if(height) { ret.attr('height', height); }
  return $('<div />').append(ret).html();
}

function match_docs_filter(url) {
  var result = false;
  $.each(
    [ 'docx?', 'xlsx?', 'pptx?', 'pages', 'ttf', 'psd', 'ai', 'tiff', 'dxf', 'svg', 'xps', 'pdf'],
    function(k, v) {
      if((new RegExp('^.+\\.' + v + '$', 'i')).test(url)) {
        result = true;
        return false;
      }
      return undefined;
    });
  return result;
}

function match_image_filter(url) {
  var result = false;
  $.each(['png', 'jpg', 'jpeg', 'gif'], function(k, v) {
    if((new RegExp('^.+\\.' + v + '$', 'i')).test(url)) {
      result = true;
      return false;
    }
    return undefined;
  });
  return result;
}

function get_description(url, callback) {
  function retry() {
    retry_count[url] = retry_count[url]? retry_count[url] + 1 : 1;
    if(retry_count[url] > config.retry_max) {
      console.log('retry count exceeded:', url);
      callback(url, 'retry count exceeded');
    } else { get_description(url, callback); }
  }
  function error_callback(err) { callback(url, err); }
  function jquery_error_callback(jqXHR, textStatus, errorThrown) {
    if(/timed?out/i.test(textStatus)) { retry(); }
    else {
      console.error("Error in: " + url);
      console.error(JSON.stringify([jqXHR, textStatus, errorThrown]));
      error_callback(textStatus);
    }
  }

  function fetch_data(cb, u) {
    u = u || url;
    request.get(
      { uri: u, encoding: null, followAllRedirects: true,
        timeout: config.timeout, headers: {
          'accept-encoding': 'gzip,deflate',
          'user-agent': config.user_agent } },
      function(err, res, http_data) {
        if(err || res.statusCode !== 200) {
          if(res) {
            switch(res.statusCode) {
            case 500: case 502: case 503: case 504:
              retry();
              return;
            } }
          if(err && /timed?out/i.test(err.code)) {
            retry();
            return;
          }
          console.error('URL:', u);
          if(res) { console.error('Status Code:', res.statusCode); }
          console.error('Error:', err);
          error_callback('error fetching');
          return;
        }

        if(!http_data || !http_data.toString) {
          error_callback('invalid data');
          return;
        }

        function uncompress_callback(err, buffer) {
          if(err) { error_callback(err); }
          else { cb(buffer, res); }
        }

        switch(res.headers['content-encoding']) {
        case 'gzip':
          zlib.gunzip(http_data, uncompress_callback);
          break;

        case 'deflate':
          zlib.inflate(http_data, uncompress_callback);
          break;

        default:
          uncompress_callback(false, http_data);
          break;
        }
      });
  }

  function oembed_default_callback(data) {
    callback(
      url, data.title || '',
      (data.description? data.description + '<br/>' : '') +
        (data.image? image_tag(data.image, data.width, data.height) + '<br/>' :
         data.thumbnail? image_tag(data.thumbnail, data.thumbnail_width, data.thumbnail_height) + '<br/>':
         data.thumbnail_url? image_tag(data.thumbnail_url, data.thumbnail_width, data.thumbnail_height) + '<br/>':
         '') +
        (data.type === 'rich'? data.html + '<br/>' :
         data.type === 'photo' && data.url? image_tag(data.url, data.width, data.height) + '<br/>' :
         ''));
  }
  function oembed(req_url, oembed_callback) {
    fetch_data(function(buf) {
      var data = null;
      try { data = JSON.parse(buf.toString()); }
      catch(e) {
        error_callback('JSON parse error in oembed: ' + buf.toString());
        return;
      }
      if(oembed_callback === undefined) { oembed_default_callback(data); }
      else { oembed_callback(data); }
    }, req_url);
  }

  function open_graph_body($) {
    var body = '';
    $.each(['image', 'video', 'audio'], function(tag_idx, tag) {
      $.each(['property', 'name'], function(attr_idx, attr) {
        $('meta[' + attr + '="og:' + tag + '"]').each(function(idx, elm) {
          var opt = { src: $(elm).attr('content') }, i = $(elm).next();

          for(; (new RegExp('og:' + tag + ':')).test(i.attr(attr)); i = i.next()) {
            var struct_prop = i.attr(attr).match(new RegExp('og:' + tag + ':(\\w+)'))[1];
            switch(struct_prop) {
              case 'width':
              case 'height':
              opt[struct_prop] = i.attr('content');
              break;
            }
          }

          body += $('<div />').append(
            $('<' + (tag === 'image'? 'img' : tag) + ' />').attr(opt)
          ).html() + '<br />';
        });
      });
    });
    return body;
  }
  function run_selectors($, selectors) {
    var body = '';
    $.each(selectors, function(k, selector) {
      if(!body) { $(selector).each(function(idx, elm) { body += $('<div />').append(elm).html(); }); }
    });
    return body;
  }
  function google_docs() {
    callback(
      url, $('<div />').append($('<iframe />').attr(
        { title: 'Google Docs Viewer',
          'class': 'google-docs-viewer',
          type: 'text/html',
          src: 'https://docs.google.com/viewer?' + $.param({'url': url, embedded: true}),
          width: '100%', height: '800'})).html());
  }

  function run_jquery(cb, u) {
    var target_url = u || url;
    fetch_data(function(data, res) {
      var cont_type = res.headers['content-type'];

      if(!/html/i.test(cont_type)) {
        if(/image\/\w+/.test(cont_type)) {
          callback(url, image_tag(url));
        } else if(/text\/plain/.test(cont_type)) {
          callback(url, $('<div />').append(
            $('<pre></pre>').text(data.toString('utf8'))).html());
        } else if(/application\/pdf/.test(cont_type)) {
          google_docs();
        } else {
          error_callback('unknown content type: ' + cont_type);
        }
        return;
      }

      var charset_regex = /charset="?'?([\w_\-]+)"?'?/i;
      var encoding_regex = /encoding="?'?([\w_\-]+)"?'?\?/i;
      var ascii = data.toString('ascii');
      var enc =
        charset_regex.test(ascii)? ascii.match(charset_regex)[1]:
        encoding_regex.test(ascii)? ascii.match(encoding_regex)[1]:
        charset_regex.test(cont_type)? cont_type.match(charset_regex)[1]:
        DEFAULT_ENCODING;
      enc = enc.toLowerCase();
      if(iconv_cache[enc]) {
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
      } catch(convert_error) {
        console.error('iconv error:', convert_error, enc);
        error_callback('unsupported charset: ' + enc);
        return;
      }

      try {
        jsdom.env(
          { 'html': html || '<html><body></body></html>',
            features: DEFAULT_FEATURE },
          function(err, window) {
            if(err) {
              error_callback(err);
              return;
            }

            var document = window.document;

            Array.prototype.forEach.call(
              document.getElementsByTagName('script'),
              function(elm) { elm.parentNode.removeChild(elm); });

            try { eval(config.jquery_src); }
            catch(e) { console.error('jQuery error:', e); }

            if(!window.jQuery) {
              error_callback('Cannot load jQuery');
              return;
            }
            var $ = window.jQuery;

            $('a').each(
              function(idx,elm) {
                $(elm).attr('href', URL.resolve(target_url, $(elm).attr('href')));
              });
            $('img').each(
              function(idx,elm) {
                $(elm).attr('src', URL.resolve(target_url, $(elm).attr('src')));
              });

            switch(typeof cb) {
              case 'function':
              cb($, window); break;
              case 'object':
              callback(url, $('meta[property="og:title"]').attr('content') ||
                       $('title').text(), run_selectors($, cb));
              break;
              default: throw 'unknown callback type';
            }
          });
      } catch(html_parse_error) { error_callback(html_parse_error); }
    }, u);
  }

  var GALLERY_FILTER = {
    '^https?://photozou.jp/photo/\\w+/(\\d+)/(\\d+)$': function() {
      var id = url.match(/^http:\/\/photozou.jp\/photo\/\w+\/(\d+)\/(\d+)/)[2];
      callback(
        url, $('<div />').append(
          $('<a />').attr('href', url.replace('show', 'photo_only')).append(
            image_tag('http://photozou.jp/p/img/' + id))).html());
    },

    '^https?://yfrog\\.com/(\\w+)/?': function() {
      var id = url.match(/^https?:\/\/yfrog\.com\/(\w+)\/?/)[1];
      callback(
        url, $('<div />').append(
          $('<a />').attr('href', 'http://yfrog.com/z/' + id).append(
            image_tag('http://yfrog.com/' + id + ':medium'))).html());
    },

    '^https?://instagr.am/p/[\\-\\w_]+/?$': function() {
      var id = url.match(/^https?:\/\/instagr.am\/p\/([\-\w_]+)\/?$/)[1];
      callback(url, image_tag('http://instagr.am/p/' + id + '/media/?size=l'));
      /*
      run_jquery(function($) {
        callback(url, $('.caption').text() || '', open_graph_body($));
      });
       */
    },

    '^https?://ow.ly/i/\\w+': function() {
      var id = url.match(/^http:\/\/ow.ly\/i\/(\w+)/)[1];
      callback(url, image_tag('http://static.ow.ly/photos/normal/' + id + '.jpg'));
      /*
      run_jquery(function($) {
        var id = url.match(/^http:\/\/ow.ly\/i\/(\w+)/)[1];
        callback(url, $('title').text(),
                 image_tag('http://static.ow.ly/photos/original/' + id + '.jpg'));
      });
       */
    },

    '^https?://twitpic\\.com/(\\w+)(/full)?/?': function() {
      var id = url.match(/^https?:\/\/twitpic.com\/(\w+)(\/full)?\/?/)[1];
      callback(
        url, $('<div />').append(
          $('<a />').attr('href', 'http://twitpic.com/' + id + '/full').append(
            image_tag('http://twitpic.com/show/large/' + id))).html());
      /*
      fetch_data(
        function(buf) {
          var data = JSON.parse(buf.toString());
          callback(
            url, // 'http://twitpic.com/' + id + '/full',
            data.message || '',
            $('<div />').append(
              $('<a />').attr('href', 'http://twitpic.com/' + id + '/full').append(
                image_tag('http://twitpic.com/show/thumb/' + id, data.width, data.height))).html());
                // image_tag('http://twitpic.com/show/full/' + id, data.width, data.height))).html());
        }, 'http://api.twitpic.com/2/media/show.json?' + $.param({id: id}));
       */
    },

    '^https?://p.twipple.jp/\\w+/?$': function() {
      var id = url.match(/^http:\/\/p.twipple.jp\/(\w+)\/?$/)[1];
      callback(url, image_tag('http://p.twpl.jp/show/orig/' + id));
      /*
      run_jquery(function($) {
          callback(
            url, unescapeHTML($('meta[property="og:description"]').attr('content')) ||
              $('meta[property="og:title"]').attr('content') || $('title').text() || '',
            image_tag('http://p.twpl.jp/show/orig/' + id));
        });
       */
    },

    '^https?://movapic.com/pic/\\w+$': function() {
      callback(url,
               image_tag(url.replace(/http:\/\/movapic.com\/pic\/(\w+)/,
                                     'http://image.movapic.com/pic/m_$1.jpeg'))); },
    '^https?://gyazo.com/\\w+$': function() { callback(url, image_tag(url + '.png')); },

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
      fetch_data(
        function(buf) {
          var html = '';
          var data = buf.toString();
          $.each(data.match(/document\.write\('(.+)'\)/g), function(k, v) {
                   html += v.match(/document\.write\('(.+)'\)/)[1];
                 });
          eval("html = '" + html + "'");
          fetch_data(
            function(info_buf) {
              var info = JSON.parse(info_buf.toString());
              callback(url, 'Gist: ' + info.id + ': ' + info.description || '', html);
            }, 'https://api.github.com/gists/' + id);
        }, 'http://gist.github.com/' + id + '.js');
    },

    '^https?://ideone.com/\\w+/?$': function() {
      run_jquery(function($) { callback(url, 'ideone.com', $('#source').html()); }); },

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
    '^https?://www.slideshare.net/[^/]+/[^/]+': function() {
      oembed('http://www.slideshare.net/api/oembed/2?' +
             $.param({ 'url': url, format: 'json'})); },

    '^https?://twitter.com/.+/status/\\d+': function() {
      if(/\/photo/.test(url)) {
        run_jquery(function($) {
          callback(url, $('.tweet-text').text() || '', $('.main-tweet').html());
        }, url.replace('/twitter.com/', '/mobile.twitter.com/'));
      } else {
        oembed('http://api.twitter.com/1/statuses/oembed.json?' +
               $.param({ 'id': url.match(/\/status\/(\d+)/)[1],
                         hide_media: false, hide_thread: false,
                         omit_script: false, align: 'left' }));
      }
    },

    '^https?://.+\\.deviantart.com/art/.+$': function() {
      oembed('http://backend.deviantart.com/oembed?' + $.param({ 'url': url })); },
    '^https?://www.flickr.com/photos/[@\\w\\-]+/\\d+/?': function() {
      oembed('http://www.flickr.com/services/oembed?' + $.param({ 'url': url, format: 'json' })); },
    '^https?://www.docodemo.jp/twil/view/': function() {
      oembed('http://www.docodemo.jp/twil/oembed.json?' + $.param({ 'url': url })); },
    '^https?://\\w+.tuna.be/\\d+.html$': function() {
      run_jquery(function($) {
        callback(url, $('title').text(),
                 $('.blog-message').html() || $('.photo').html());
      }); },

    '^https?://www.nicovideo.jp/watch/\\w+': function() {
      run_jquery(function($) {
        callback(url, $('title').text(), $('body').html());
      },
                 'http://ext.nicovideo.jp/thumb/'
        + url.match(/^http:\/\/www.nicovideo.jp\/watch\/(\w+)/)[1]); },

    '^https?://lockerz.com/s/\\d+$': function() {
      run_jquery(function($) {
        callback(url, $($('p').get(1)).text(), image_tag($('#photo').attr('src')));
      }); },

    '^https?://kokuru.com/\\w+/?$': function() {
      run_jquery(function($) {
        callback(url, $('h1').text(), image_tag($('#kokuhaku_image_top').attr('src')));
      }); },

    '^https?://twitvideo.jp/\\w+/?$': function() {
      run_jquery(function($) {
        callback(url, $('.sf_comment').text(), unescapeHTML($('#vtSource').attr('value')));
      }); },

    '^https?://twitcasting.tv/\\w+/?$': function() {
      var id = url.match(/^http:\/\/twitcasting.tv\/(\w+)\/?$/)[1];
      callback(url,
               '<video src="http://twitcasting.tv/' + id + '/metastream.m3u8/?video=1"' +
               ' autoplay="true" controls="true"' +
               ' poster="http://twitcasting.tv/' + id + '/thumbstream/liveshot" />');
    },

    '^https?://www.twitvid.com/\\w+/?$': function() {
      var id = url.match(/^http:\/\/www.twitvid.com\/(\w+)\/?$/)[1];
      callback(url,
               '<iframe title="Twitvid video player" class="twitvid-player" type="text/html" ' +
               'src="http://www.twitvid.com/embed.php?' +
               $.param({guid: id, autoplay: 1}) + '" ' +
               'width="480" height="360" frameborder="0" />');
    },

    '^https?://layercloud.net/items/detail_top/\\d+/?$': function() {
      var id = url.match(/^http:\/\/layercloud.net\/items\/detail_top\/(\d+)\/?$/)[1];
      run_jquery(function($) {
        callback(
          url, $('.ItemDescription').html(),
          image_tag('http://layercloud.net/img/items/' + id + '.jpg'));
      });
    },


    '^https?://ameblo.jp/[\\w\\-_]+/entry-\\d+.html': function() {
      run_jquery(function($) {
        callback(url, $('meta[property="og:title"]').attr('content') || $('title').text(),
                 run_selectors($, ['.articleText', '.subContents'])); });
    },

    '^https?://www.drawlr.com/d/\\w+/view/?$': function() {
      fetch_data(function(buf) {
        callback(url, buf.toString().match(/var embed_code = '(.+)';/)[1]);
      });
    },
  };

  if(match_image_filter(url)) {
    callback(url, url.match(/\/([^\/]+)$/)[1], image_tag(url));
  }
  else if(match_docs_filter(url)) { google_docs(); }

  else {
    var match_gallery_filter = false;
    $.each(GALLERY_FILTER, function(k, v) {
      if((new RegExp(k, 'i')).test(url)) {
        v();
        match_gallery_filter = true;
        return false; // break
      }
      return undefined; // continue
    });
    if(match_gallery_filter) { return; }

    run_jquery(function($) {
      var oembed_url = $('link[rel="alternate"][type="text/json+oembed"]').attr('href');
      if(oembed_url) {
        oembed(oembed_url);
        return;
      }

      var body = open_graph_body($);
      if(!body) { body += run_selectors($, config.selectors); }
      body += unescapeHTML(
        $('meta[property="og:description"]').attr('content')
                          || $('meta[name="description"]').attr('content')
                          || '');

      callback(url, $('meta[property="og:title"]').attr('content') || $('title').text(), body);
    });
  }
}

process.on('message', function(msg) {
  if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

  switch(msg.type) {
    case 'get_description':
    if(retry_count.hasOwnProperty(msg.data.url)) { retry_count[msg.data.url] = 0; }
    get_description(msg.data.url, function(url, title, description) {
      if(description === undefined) {
        description = title;
        title = msg.data.text;
      }
      delete retry_count[msg.data.url];
      process.send({type: 'got_description', data: [
        msg.data, require(__dirname + '/remove_utm_param')(url),
        title, description]});
    });
    break;

    case 'config':
    config = msg.data;
    setInterval(process.send, config.check_frequency, { type: 'dummy', data: '' });
    break;

    default:
    throw 'unknown message type: ' + msg.type;
  }
});
