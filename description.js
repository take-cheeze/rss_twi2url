if(!process.send) { throw 'not forked'; }

var
    $ = require('jquery')
  , URL = require('url')
  , Iconv = require('iconv').Iconv
  , zlib = require('zlib')
  , jsdom = require('jsdom')
  , request = require('request')
  , htmlcompressor = require('./htmlcompressor')
;

var config = null;

console.log = function() {
  process.sned({ type: 'log', data: Array.prototype.slice.call(arguments)});
}

console.error = function() {
  process.sned({ type: 'error', data: Array.prototype.slice.call(arguments)});
}

var document = jsdom.jsdom(), window = document.createWindow();

jsdom.defaultDocumentFeatures = {
  FetchExternalResources: false, // ['frame', 'css'],
  ProcessExternalResources: false,
  MutationEvents: false,
  QuerySelector: false
};
var DEFAULT_ENCODING = 'utf8';
$.support.cors = true;

var retry_count = {};

var iconv_cache = {
  'x-sjis': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'shiftjis': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'x-euc-jp': new Iconv('euc-jp', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'windows-31j': new Iconv('shift_jis', DEFAULT_ENCODING + '//TRANSLIT//IGNORE'),
  'utf8': true, 'utf-8': true
};

function image_tag(v, width, height) {
  if(!v) {
    return 'empty url in image tag';
  }
  var ret = $('<img />').attr('src', v);
  if(width) { ret.attr('width', width); }
  if(height) { ret.attr('height', height); }
  return $('<div />').append(ret).html();
}

function match_docs_filter(mime) {
  var result = false;
  $.each(
      [ 'application/msworddoc', 'application/vnd.ms-excel', 'vnd.ms-powerpoint',
        'application/vnd.apple.pages', 'application/x-font-ttf', 'image/x-photoshop',
        'application/postscript', 'image/tiff', 'application/dxf',
        'image/svg', 'application/vnd.ms-xpsdocument', 'application/pdf'],
    function(k, v) {
      if((new RegExp('^.+\\.' + v + '$', 'i')).test(mime)) {
        result = true;
        return false;
      }
      return undefined;
    });
  return result;
}

function match_image_filter(mime) {
  var result = false;
  $.each(['image/png', 'image/jpeg', 'image/gif'], function(k, v) {
    if((new RegExp('^.+\\.' + v + '$', 'i')).test(mime)) {
      result = true;
      return false;
    }
    return undefined;
  });
  return result;
}

function get_description(url, callback) {
  function error_callback(err) { callback(url, err); }
  var retry_cb = false;
  function retry() {
    retry_count[url] = retry_count[url]? retry_count[url] + 1 : 1;
    if(retry_count[url] > config.retry_max) {
      delete retry_count[url];

      if(retry_cb) {
        retry_cb();
        return;
      }

      console.log('retry count exceeded:', url);
      error_callback(url, 'retry count exceeded');
    } else { setTimeout(get_description,
                        config.item_generation_frequency, url, callback); }
  }
  function jquery_error_callback(jqXHR, textStatus, errorThrown) {
    if(/timed?out/i.test(textStatus)) { retry(); }
    else {
      console.error("Error in: " + url);
      console.error(JSON.stringify([jqXHR, textStatus, errorThrown]));
      error_callback(textStatus);
    }
  }

  var document = jsdom.jsdom(), window = document.createWindow();
  function unescapeHTML(str) {
    try { return $('<div />').html(str).text(); }
    catch(e) { return str; }
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

    '^https?://www.drawlr.com/d/\\w+/view/?$': function() {
      fetch_data(function(buf) {
        callback(url, buf.toString().match(/var embed_code = '(.+)';/)[1]);
      });
    },
  };

  request.head(url, function(e, res, body) {
    e = e || (res.statusCode !== 200);
    var mime = res? res.headers['content-type'] : '';

    if(!e && match_image_filter(mime)) { callback(url, image_tag(url)); }
    else if(!e && match_docs_filter(mime)) { google_docs(); }
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

      // mobilizer
      retry_cb = function() {
        retry_cb = function() {
          retry_cb = false;
          run_jquery(function($) {
            callback(url, $('title').text(), $('body').html());
          }, 'http://www.google.com/gwt/x?u=' + encodeURIComponent(url));
        };
        run_jquery(function($) {
          console.log($('#story'));
          if($('#story').length === 0) { retry_cb(); }
          else  {
            callback(url, $('title').text(), $('#story').html());
            retry_cb = false;
          }
        }, 'http://www.instapaper.com/m?u=' + encodeURIComponent(url));
      };
      run_jquery(function($) {
        onsole.log($('#rdb-article-content'));
        if($('#rdb-article-content').length === 0) { retry_cb(); }
        else {
          callback(url, $('#rdb-article-title').text(), $('#rdb-article-content').html());
          retry_cb = false;
        }
      }, 'http://www.readability.com/m?url=' + encodeURIComponent(url));
    }
  });
}

process.on('message', function(m) {
  if(!m.type) { throw 'no message type'; }
  if(!m.data) { throw 'no data'; }

  switch(m.type) {
    case 'get_description':
    document = jsdom.jsdom();
    window = document.createWindow();

    get_description(m.data, function(a0, a1, a2) {
      var desc = a2 || a1;

      htmlcompressor((typeof desc === 'string')? desc : '', function(err, stdout, stderr) {
        if(stderr) {
          console.error('htmlcompressor error:', stderr.toString());
        }
        if(err) { throw err; }

        var cleaned = $('<div />').html(stdout.toString());
        cleaned.find('*').removeData();

        if(a2) { a2 = cleaned.html(); }
        else { a1 = cleaned.html(); }

        process.send({type: 'got_description', data: [m.data, a0, a1, a2]});
      });
    });
    break;

    case 'config':
    config = m.data;
    break;

    default:
    throw 'unknown message type';
  }
});
