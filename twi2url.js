#!/usr/bin/env node

var
    BufferStream = require('bufferstream')
  , fs = require('fs')
  , $ = require('jquery')
  , URL = require('url')
  , zlib = require('zlib')
  , img_cache = require('memory-cache')
  , qs = require('querystring')
  , request = require('request')
  , jsdom = require('jsdom')
  , SingleUrlExpander = require('url-expander').SingleUrlExpander
  , Iconv = require('iconv').Iconv
  , htmlcompressor = require('./htmlcompressor')
;

var document = jsdom.jsdom(), window = document.createWindow();
var db = null;

var last_item_generation = Date.now();

var url_expander_queue = [];

var consumer = {};

try { consumer = require('./consumer'); }
catch(e) { consumer = {}; }

consumer.CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY || consumer.CONSUMER_KEY;
consumer.CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET || consumer.CONSUMER_SECRET;
consumer.USTREAM_KEY = process.env.USTREAM_KEY || consumer.USTREAM_KEY;

var opt = {
  consumer_key: consumer.CONSUMER_KEY,
  consumer_secret: consumer.CONSUMER_SECRET
};

var twitter_api_left = true;

var config = require('./config');
var DB_FILE = process.cwd() + '/rss_twi2url.db';
config.feed_url = 'http://' + config.hostname
                + (/\.herokuapp.com/.test(config.hostname)? '' : ':' + config.port)
                + '/' + config.pathname;
var JSON_FILE = process.cwd() + '/rss_twi2url.json';
var QUEUE_FILENAME = process.cwd() + '/rss_twi2url_queue.json';

function count_map_element(map) {
  var ret = 0;
  $.each(map, function(k, v) {
    ret++;
  });
  return ret;
}

function match_exclude_filter(str) {
  var result = false;
  $.each(config.exclude_filter, function(k, v) {
    if((new RegExp(v)).test(str)) { result = true; } });
  return result;
}

var rss_twi2url =
  fs.existsSync(JSON_FILE)
  ? JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'))
  : { last_urls: [], queued_urls: [], since: {}, generating_items: {} };
if(fs.existsSync(JSON_FILE + '.gz')) {
  zlib.gunzip(fs.readFileSync(JSON_FILE + '.gz'), function(err, buf) {
    if(err) { throw err; }
    rss_twi2url = JSON.parse(buf.toString());

    if(rss_twi2url.generating_items) {
      console.log(rss_twi2url.generating_items);
      $.each(rss_twi2url.generating_items, function(k, v) {
        rss_twi2url.queued_urls.unshift(v);
      });
    }
    rss_twi2url.generating_items = {};

    var filtered_queue = [];
    $.each(rss_twi2url.queued_urls, function(k, v) {
      if(!match_exclude_filter(v.url)) { filtered_queue.push(v); }
    });
    rss_twi2url.queued_urls = filtered_queue;

    // reduce feed size
    while(rss_twi2url.last_urls.length > config.feed_item_max) {
      rss_twi2url.last_urls.shift(); }
  });
}

var expand_count = 0, expand_cache = {};

function is_queued(url) {
  var result = false;
  $.each(rss_twi2url.queued_urls, function(k, v) {
    if(v.url === url) { result = true; } });
  return result;
}

function remove_utm_param(url) {
  try {
    var url_obj = URL.parse(url, true);
    var removing_param = [];
    $.each(url_obj.query, function(k, v) {
      if(/utm_/i.test(k)) { removing_param.push(k); }
    });
    $.each(removing_param, function(idx, param) {
      delete url_obj.query[param];
    });
    return URL.format(url_obj);
  } catch(e) {
    console.error('remove utm param error:', e);
    console.error(url);
    return url;
  }
}

function expantion_exclude(url) {
  var ret = false;
  $.each(config.url_expantion_exclude, function(k, v) {
    if((new RegExp(v)).test(url)) {
      ret = true;
      return false;
    }
    return undefined;
  });
  return ret;
}

function expand_url() {
  if(expand_count >= config.url_expander_number) {
    return;
  }

  var tweet = false;
  while(!tweet || !tweet.url) {
    if(url_expander_queue.length === 0) { return; }
    tweet = url_expander_queue.shift();
  }

  function send_url(result) {
    tweet.url = result;
    if(!/\/t\.co\//.test(result) && !match_exclude_filter(tweet.url)) {
      tweet.url = remove_utm_param(tweet.url);
      if(!is_queued(tweet.url)) {
        rss_twi2url.queued_urls.push(tweet); }
    }

    expand_count--;
    expand_url();
  }

  expand_count++;

  if(expand_cache.hasOwnProperty(tweet.url)) {
    send_url(expand_cache[tweet.url]);
  }

  if(
    (tweet.url.length > config.long_url_length) ||
      /\?/.test(tweet.url) ||
       /&/.test(tweet.url) ||
      expantion_exclude(tweet.url)
  ) {
    send_url(tweet.url);
    return;
  }

  var expander = new SingleUrlExpander(tweet.url);
  expander.on('expanded', function(orig, exp) {
    exp = decodeURI(exp);
    expand_cache[orig] = exp;
    send_url(exp);
  });
  expander.expand();

  expand_url();
}

process.on('uncaughtException', function (err) {
  if(/URI malformed/.test(err)) {
    console.log('uncaught error:', err);
    return;
  }
  else {
    console.error("Error:", err);
    console.trace();
  }
});

function backup() {
  zlib.gzip(new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
    if(err) { throw err; }
    fs.writeFileSync(JSON_FILE + '.gz', buf);
  });

  zlib.gzip(new Buffer(JSON.stringify(url_expander_queue)), function(err, buf) {
    if(err) { throw err; }
    fs.writeFileSync(QUEUE_FILENAME + '.gz', buf);
  });
}
process.on('exit', function() {
  backup();
});

function in_last_urls(url) {
  var result = false;
  $.each(rss_twi2url.last_urls, function(k, v) {
    if(v === url) { result = true; } });
  return result;
}

function generate_item() {
  if(rss_twi2url.queued_urls.length === 0) { return; }

  var v = rss_twi2url.queued_urls.shift();

  if(match_exclude_filter(v.url) ||
         in_last_urls(v.url) ||
     is_queued(v.url))
  {
    generate_item();
    return;
  }

  // console.log('start:', v.url);
  get_description(v.url,  function(url, title, desc) {
    if(desc === undefined) {
      desc = title;
      title = v.text;
    }

    url = remove_utm_param(url);

    /*
    if(/retry count exceeded/.test(desc)) {
    }
     */

    if(!title) {
      console.error('Invalid title:', url);
      title = v.text;
    }
    if(!desc) {
      console.error('Invalid description:', url);
    }

    title = title.replace(/@(\w)/g, '@ $1');

    htmlcompressor((typeof desc === 'string')? desc : '', function(err, stdout, stderr) {
      if(stderr) {
        console.error('htmlcompressor error:', stderr.toString());
      }
      if(err) { throw err; }

      try {
        var cleaned = $('<div />').html(stdout.toString());

        cleaned.find('img:not([istex])[src]').each(function() {
          $(this).attr('src', confg.feed_url + 'image?' +
                       sq.stringify({ 'url': $(this).attr('src') }));
        });

        $.each(config.removing_tag, function(k,v) {
          cleaned.find(v).each(
            function(k, elm) { elm.parentNode.removeChild(elm); }); });
        $.each(config.removing_attribute, function(k,v) {
          cleaned.find('[' + v + ']').removeAttr(v); });
        cleaned.find('*').removeData();

        if(!v.text) { throw 'invalid tweet text'; }
        db.put(url, JSON.stringify(
          {
            title: title, 'url': url, author: v.author, date: v.date,
            description:
            'URL: ' + url + '<br />' +
              'Tweet: ' + v.text +
              (cleaned.html()? '<br /><br />' + cleaned.html() : '')
          }));
      } catch(e) {
        db.put(url, JSON.stringify(
          {
            title: title, 'url': url, author: v.author, date: v.date,
            description: e + '<br /><br />' +
              'URL: ' + url + '<br />' +
              'Tweet: ' + v.text +
              (stdout? '<br /><br />' + stdout.toString() : '')
          }));
      }
    });

    if(!in_last_urls(v.url))
    { rss_twi2url.last_urls.push(v.url); }

    delete rss_twi2url.generating_items[v.url];

    setTimeout(generate_item, config.item_generation_frequency);
  });
  rss_twi2url.generating_items[v.url] = v;
  last_item_generation = Date.now();
  return;
}

function start() {
  require('http').createServer(function(req, res) {
    var accept = req.headers['accept-encoding'] || '';
    var header = {'content-type': 'application/rss+xml'};
    header['content-encoding'] =
      /\bdeflate\b/.test(accept)? 'deflate':
      /\bgzip\b/.test(accept)? 'gzip':
      false;
    if(!header['content-encoding']) {
      delete header['content-encoding']; }

    function send_data(status, buf) {
      console.log('Sending with:', header.hasOwnProperty('content-encoding')
                                 ? header['content-encoding'] : 'plain');
      var buf_stream = new BufferStream();
      switch(header.hasOwnProperty('content-encoding')
            ? header['content-encoding'] : false)
      {
        case 'gzip': buf_stream.pipe(zlib.createGzip()).pipe(res);
        break;
        case 'deflate': buf_stream.pipe(zlib.createDeflateRaw()).pipe(res);
        break;
        default: buf_stream.pipe(res);
        break;
      }
      res.writeHead(status, header);
      buf_stream.end(buf);
    }

    if(/\/image/.test(req.url)) {
      var img_url = qs.parse(req.url).url;
      if(!img_cache.get(img_url)) {
        request.get(
          { 'url': img_url, encoding: null, timeout: config.timeout,
            headers: { 'accept-encoding': 'gzip,deflate' } },
          function(err, res, data) {
            var ret = {};
            if(err) {
              ret.type = 'text/plain';
            }
            img_cache.put(img_url, ret, config.fetch_frequency);
          });
      }
      var c = img_cache.get(img_url);
      header['content-type'] = c.type;
      send_data(c.status, c.data);
    } else if(req.url === '/') {
      var ary = (rss_twi2url.last_urls.length > config.feed_item_max)
              ? rss_twi2url.last_urls.slice(rss_twi2url.last_urls.length - config.feed_item_max)
              : rss_twi2url.last_urls;

      console.log('Request:', req.headers);
      console.log(
        'RSS requested:'
      , 'queued_urls.length:', rss_twi2url.queued_urls.length, ','
      , 'last_urls.length:', rss_twi2url.last_urls.length, ','
      , 'url_expander_queue.length:', url_expander_queue.length, ','
      , 'generating_items.length:', count_map_element(rss_twi2url.generating_items), ','
      );
      console.log('generating_items:');
      console.log(rss_twi2url.generating_items);

      generate_feed(ary, function(data) { send_data(200, data); });

      $.each(rss_twi2url.generating_items, function(k, v) {
        rss_twi2url.queued_urls.unshift(v);
      });
      rss_twi2url.generating_items = {};
    } else {
      console.log('not rss request:', req.url);
      res.writeHead(404, {'content-type': 'plain'});
      res.end(config.title + '(by ' + config.author + ') : ' + config.description);
      return;
    }
  })
  .listen(config.port)
  .on('clientError', function(e) { console.error(e); });

  console.log('twi2url started: ' + config.feed_url);
  console.log('As user: ' + rss_twi2url.screen_name + ' (' + rss_twi2url.user_id + ')');

  backup();
  fetch();
  expand_url();

  setInterval(backup, config.backup_frequency);
  setInterval(fetch, config.fetch_frequency);

  setInterval(function() {
    expand_url();

    if((count_map_element(rss_twi2url.generating_items) < config.executer) {
      generate_item();
    }
  }, config.check_frequency);
}

function signed_in(d) {
  console.log('Authorized!');
  $.each(['oauth_token', 'oauth_token_secret', 'user_id', 'screen_name'],
         function(k,v) {
           rss_twi2url[v] = d[v];
         });
  start();
}

function is_signed_in() {
  var check = [
    'oauth_token', 'oauth_token_secret',
    'user_id', 'screen_name'];
  var result = true;
  $.each(check, function(k, v) {
    if(! rss_twi2url[v]) { result = false; }
  });
  return result;
}

function signin(setting) {
  if(fs.existsSync(QUEUE_FILENAME + '.gz')) {
    fs.readFile(QUEUE_FILENAME + '.gz', function(err, b) {
      zlib.gunzip(b, function(err, buf) {
        if(err) { throw err; }
        url_expander_queue = url_expander_queue.concat(JSON.parse(buf.toString()));
      });
    });
  }

  if(setting) {
    opt.token = setting.oauth_token;
    opt.token_secret = setting.oauth_token_secret;
    signed_in(rss_twi2url);
  } else {
    opt.callback = config.feed_url + 'callback';
    request.post(
      {url:'https://api.twitter.com/oauth/request_token', oauth: opt},
      function (e, r, body) {
        if(e) { throw e; }

        var tok = qs.parse(body);
        opt.token = tok.oauth_token;
        opt.token_secret = tok.oauth_token_secret;
        delete opt.callback;

        var authorize_url = 'https://twitter.com/oauth/authorize?oauth_token=' + opt.token;
        console.log('Visit:', authorize_url);
        console.log('Or:', config.feed_url);

        var server = null;
        server =
          require('http').createServer(function(req, res) {
            if(!/\/callback/.test(req.url)) {
              res.writeHead(302, {location: authorize_url});
              res.end();
              return;
            }

            opt.verifier = qs.parse(req.url).oauth_verifier;
            request.post(
              {url:'https://api.twitter.com/oauth/access_token', 'oauth': opt},
              function (e, r, result) {
                if(e) { throw e; }

                result = qs.parse(result);
                opt.token = result.oauth_token;
                opt.token_secret = result.oauth_token_secret;
                delete opt.verifier;

                res.writeHead(200, {'content-type': 'text/plain'});
                res.end('Twitter OAuth Success!');

                if(server) { server.close(); }
                signed_in(result);
              });
          })
          .listen(config.port)
          .on('clientError', function(e) { console.error(e); });
      });
  }
}

request.get({uri: 'http://code.jquery.com/jquery-latest.min.js'}, function(e, r, body) {
  if(e) { throw e; }
  config.jquery_src = body;

  signin(is_signed_in()? rss_twi2url : null);
});


function get_json(url, callback) {
  function retry() {
    console.log('retrying:', url);
    setTimeout(get_json, config.item_generation_frequency, url, callback);
  }

  request.get(
    { 'url': url, 'oauth': opt, encoding: null,
      timeout: config.timeout,
      headers: { 'accept-encoding': 'gzip,deflate' } },
    function(err, res, data) {
      if(err) {
        if(/timed?out/i.test(err.code)) {
          retry();
          return;
        }
        console.error("Error fetching json from twitter:", err);
        console.error('URL: ' + url);
      } else if(res) {
        switch(res.statusCode) {
          case 500: case 502: case 503: case 504:
          retry();
          break;

          case 200:
          try {
            function uncompress_callback(err, buffer) {
              if(err) { console.error(err); }
              try {
                callback(JSON.parse(buffer.toString('utf8')));
              } catch(json_err) {
                console.error(json_err);
                console.error(buffer);
                console.error(buffer.toString());

                callback([]);
              }
            }
            switch(res.headers['content-encoding']) {
              case 'gzip':
              zlib.gunzip(data, uncompress_callback);
              break;

              case 'deflate':
              zlib.inflate(data, uncompress_callback);
              break;

              default:
              callback(JSON.parse(data.toString('utf8')));
              break;
            }
          } catch(e) {
            console.error(e);
          }
          break;

          default:
          console.error("Error fetching json from twitter:", res.statusCode);
          console.error('URL: ' + url);
          break;
        }
      }
    });
}

function check_left_api(callback) {
  if(!twitter_api_left) { return; }

  get_json(
    'http://api.twitter.com/1/account/rate_limit_status.json',
    function(data) {
      console.log('api left:', data.remaining_hits);

      twitter_api_left = data.remaining_hits;
      if(data.remaining_hits > 0) {
        callback();
      } else {
        var wait_time = data.reset_time_in_seconds - Math.floor((new Date()).getTime() / 1000);
        twitter_api_left = false;
        setTimeout(function() { twitter_api_left = true; }, wait_time * 1000);
        console.log('API not left. Will have reset in:',
                    new Date(data.reset_time).toLocaleString());
      }
    });
}

function fetch_page(url, name, info, cb) {
  url += (info.page === 1 && info.since_id)
       ? '&' + $.param({since_id: info.since_id}) : '';

  get_json(url + '&' + $.param({page: info.page}), function(data) {
    url_expander_queue = url_expander_queue.concat(data);
    data = data.results || data;

    $.each(data, function(tweet_idx, tweet) {
      var user_name = tweet.from_user_name || tweet.user.name;
      var screen_name = tweet.from_user || tweet.user.screen_name;
      var author_str = user_name + ' ( @' + screen_name + ' ) / ' + name;
      $.each(tweet.entities.urls, function(k, v) {
        url_expander_queue.push(
          { 'url': v.expanded_url || v.url, author: author_str,
            date: tweet.created_at, text: tweet.text });
      });
    });

    if(info.page === 1) {
      info.next_since_id = data.length > 0
                         ? data[0].id_str : info.since_id; }

    if(
      (!info.since_id) || (data.length === 0) ||
        (data[data.length - 1].id_str === info.since_id)
    ) {
      console.log('next since id of', name, ':', info.next_since_id);
      rss_twi2url.since[name] = info.next_since_id;
      if(typeof cb === 'function') { cb(); }
    } else {
      info.page++;
      setTimeout(fetch_page, config.item_generation_frequency, url, name, info, cb);
    }
  });
}

function fetch() {
  if(!twitter_api_left) { return; }

  var setting = rss_twi2url;
  function fetch_lists() {
    get_json(
      'http://api.twitter.com/1/lists/all.json?' +
        $.param({user_id: setting.user_id}),
      function(data) {
        function list_fetch() {
          var list_info = data;
          var v = list_info.pop();
          if(!v) {
            fetch_searches();
            return;
          }

          fetch_page(
            'http://api.twitter.com/1/lists/statuses.json?' +
              $.param(
                { include_entities: true, include_rts: true,
                  list_id: v.id_str, per_page: config.tweet_max
                }), v.full_name,
            { page: 1, since_id: setting.since[v.full_name] },
            list_fetch);
        }
        list_fetch();
      });
  }

  function fetch_searches() {
    get_json(
      'http://api.twitter.com/1/saved_searches.json',
      function(data) {
        function search_fetch() {
          var search_info = data;
          var v = search_info.pop();
          if(!v) {
            return;
          }

          fetch_page(
            'http://search.twitter.com/search.json?' +
              $.param(
                { include_entities: true, rpp: config.search_max,
                  q: v.query, result_type: config.search_type
                }), v.name,
            { page: 1, since_id: setting.since[v.name] },
            search_fetch);
        }
        search_fetch();
      });
  }

  check_left_api(
    function() {
      fetch_page(
        'http://api.twitter.com/1/statuses/home_timeline.json?' +
          $.param(
            { count: config.tweet_max, exclude_replies: false,
              include_entities: true, include_rts: true
            }),
        'home_timeline',
        { page: 1, since_id: setting.since.home_timeline },
        fetch_lists);
    });
}

function generate_feed(items, cb) {
  var feed = new (require('rss'))(
    { title: config.title,
      'description': config.description,
      feed_url: config.feed_url,
      site_url: config.feed_url,
      author: config.author });

  if(items.length === 0) { cb(feed.xml()); }

  var len = items.length, count = 0;

  $.each(items, function(idx, key) {
    db.get(key, function(err, val) {
      if(err) { console.error('db.get error:', err); }
      else { feed.item(JSON.parse(val)); }
      if(++count >= len) { cb(feed.xml()); }
    });
  });
}

db = new (require('leveldb').DB)();
db.open(DB_FILE, { create_if_missing: true }, function(err) {
  if(err) { throw err; }
});

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
