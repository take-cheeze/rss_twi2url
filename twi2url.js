#!/usr/bin/env node

var
    BufferStream = require('bufferstream')
  , fs = require('fs')
  , $ = require('jquery')
  , URL = require('url')
  , zlib = require('zlib')
  , qs = require('querystring')
  , request = require('request')
  , fork = require('child_process').fork
;

var db = null;
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

var DB_FILE = process.cwd() + '/rss_twi2url.db';
var JSON_FILE = process.cwd() + '/rss_twi2url.json';
var QUEUE_FILE = process.cwd() + '/rss_twi2url_queue.json';

var config = require('./config');
config.feed_url = 'http://' + config.hostname
                + (/\.herokuapp.com/.test(config.hostname)? '' : ':' + config.port)
                + '/' + config.pathname;
if(!config.executer) {
  config.executer = require('os').cpus().length;
  if(config.executer !== 1) { config.executer--; }
}

var url_expander_queue = [];
if(fs.existsSync(QUEUE_FILE + '.gz')) {
  zlib.gunzip(fs.readFileSync(QUEUE_FILE + '.gz'), function(err, buf) {
    if(err) { throw err; }
    url_expander_queue = url_expander_queue.concat(JSON.parse(buf.toString()));
  });
}

function count_map_element(map) {
  var ret = 0;
  $.each(map, function(k, v) { ret++; });
  return ret;
}

function match_exclude_filter(str) {
  var result = false;
  $.each(config.exclude_filter, function(k, v) {
    if((new RegExp(v)).test(str)) {
      result = true;
      return false;
    } else { return undefined; }
  });
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
    if(v.url === url) {
      result = true;
      return false;
    } else { return undefined; }
  });
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
    } else { return undefined; }
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

  request.head({url: tweet.url, followAllRedirects: true }, function(err, res) {
    var result = err? tweet.url : res.request.href;
    expand_cache[tweet.url] = result;
    send_url(result);
  });

  expand_url();
}

function backup() {
  zlib.gzip(new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
    if(err) { throw err; }
    fs.writeFileSync(JSON_FILE + '.gz', buf);
  });

  zlib.gzip(new Buffer(JSON.stringify(url_expander_queue)), function(err, buf) {
    if(err) { throw err; }
    fs.writeFileSync(QUEUE_FILE + '.gz', buf);
  });
}
process.on('exit', function() {
  backup();
});

function in_last_urls(url) {
  var result = false;
  $.each(rss_twi2url.last_urls, function(k, v) {
    if(v === url) {
      result = true;
      return false;
    } else { return undefined; }
  });
  return result;
}

var executer_cb = {};
var executer = [], current_executer = 0;

process.on('exit', function() {
  $.each(executer, function(k,v) { v.kill(); });
});

function create_executer(i) {
  var child = fork(__dirname + '/description.js', [],
                   { env: process.env, cwd: process.cwd() });
  child.on('exit', function(code, signal) {
    console.log('exit of executer:', i);
    if(code) { console.log('code:', code); }
    if(signal) { console.log('signal:', signal); }

    console.log('restarting executer:', i);
    executer[i] = create_executer(i);
  });
  child.on('message', function(m) {
    if(!m.type) { throw 'no message type'; }
    if(!m.data) { throw 'no data'; }

    switch(m.type) {
      case 'got_description':
      if(executer_cb.hasOwnProperty(m.data[0])) {
        executer_cb[m.data[0]](m.data[1], m.data[2], m.data[3]);
        delete executer_cb[m.data[0]];
      }
      break;

      default:
      throw 'unknown message type';
    }
  });

  setTimeout(function() {
    child.send({ type: 'config', data: config });
  }, 30);

  return child;
}

function get_description(url, cb) {
  executer[current_executer++].send({type: 'get_description', data: url});
  executer_cb[url] = cb;

  if(current_executer >= config.executer) {
    current_executer = 0;
  }
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
    if(!desc) {
      desc = title;
      title = v.text;
    }

    url = remove_utm_param(url);

    if(!title) {
      console.error('Invalid title:', url);
      title = v.text;
    }
    if(!desc) {
      console.error('Invalid description:', url);
    }

    title = title.replace(/@(\w)/g, '@ $1');

    db.put(url, JSON.stringify(
      {
        title: title, 'url': url, author: v.author, date: v.date,
        description: 'URL: ' + url + '<br />' +
          'Tweet: ' + v.text +
          (desc? '<br /><br />' + desc : '')
      }));

    if(!in_last_urls(v.url))
    { rss_twi2url.last_urls.push(v.url); }

    delete rss_twi2url.generating_items[v.url];

    if(count_map_element(rss_twi2url.generating_items) < config.executer) {
      generate_item();
    }
  });
  rss_twi2url.generating_items[v.url] = v;
  return;
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
      if(err || !val) { console.error('db.get error:', err); }
      else { feed.item(JSON.parse(val)); }
      if(++count >= len) { cb(feed.xml()); }
    });
  });
}

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

    if(req.url === '/') {
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

      $.each(executer, function(k, v) { v.kill(); });
      executer_cb = {};
      current_executer = 0;
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

    while(count_map_element(rss_twi2url.generating_items) < config.executer) {
      generate_item();
    }
  }, config.check_frequency);

  console.log('executer number:', config.executer);

  var i = 0;
  for(; i < config.executer; ++i) {
    executer.push(create_executer(i));
  }
}

function signed_in(d) {
  console.log('Authorized!');
  $.each(['oauth_token', 'oauth_token_secret', 'user_id', 'screen_name'],
         function(k,v) { rss_twi2url[v] = d[v]; });
  start();
}

function is_signed_in() {
  var check = [
    'oauth_token', 'oauth_token_secret',
    'user_id', 'screen_name'];

  $.each(check, function(k,v) {
    if(process.env[v]) { rss_twi2url[v] = process.env[v] || null; }
  });

  var result = true;
  $.each(check, function(k, v) {
    if(! rss_twi2url[v]) { result = false; }
  });
  return result;
}

function signin(setting) {
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

                console.log('Twitter OAuth result.');
                console.log(result);
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

db = new (require('leveldb').DB)();
db.open(DB_FILE, { create_if_missing: true }, function(err) {
  if(err) { throw err; }
});
