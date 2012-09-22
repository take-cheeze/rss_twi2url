#!/usr/bin/env node

var
    BufferStream = require('bufferstream')
  , fs = require('fs')
  , URL = require('url')
  , zlib = require('zlib')
  , querystring = require('querystring')
  , request = require('request')
  , fork = require('child_process').fork
  , photo_module = require('./photo')
  , RSS = require('rss')
;

var CHILD_PROCESS_WAIT = 30;

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
var is_on_heroku = /\.herokuapp\.com/.test(config.hostname);
config.feed_url = 'http://' + config.hostname
                + (is_on_heroku? '' : (':' + config.port)) + '/';
if(!config.executer) {
  config.executer = require('os').cpus().length;
  if(config.executer !== 1) { config.executer--; }
  config.executer = Math.min(config.executer_max, config.executer);
}

var url_expander_queue = [];
if(fs.existsSync(QUEUE_FILE + '.gz')) {
  zlib.gunzip(fs.readFileSync(QUEUE_FILE + '.gz'), function(err, buf) {
    if(err) { throw err; }
    url_expander_queue = url_expander_queue.concat(JSON.parse(buf.toString()));
  });
}

function object_for_each(obj, cb) {
  var k;
  for(k in obj) {
    if(obj.hasOwnProperty(k) && (cb(k, obj[k]) === false)) { return; }
  }
}

function count_map_element(map) {
  var ret = 0;
  object_for_each(map, function() { ret++; });
  return ret;
}

function match_exclude_filter(str) {
  var result = false;
  config.exclude_filter.forEach(function(v) {
    if((new RegExp(v)).test(str)) { result = true; }
  });
  return result;
}

function match_blog_filter(str) {
  var result = false;
  config.blog_filter.forEach(function(v) {
    if((new RegExp(v)).test(str)) { result = true; }
  });
  return result;
}

function match_media_filter(str) {
  var result = false;
  config.media_filter.forEach(function(v) {
    if((new RegExp(v)).test(str)) { result = true; }
  });
  return result;
}

var rss_twi2url
      = fs.existsSync(JSON_FILE)
      ? JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'))
      : { last_urls: [], media_urls: [], blog_urls: [],
          queued_urls: [], since: {}, generating_items: {}, photos: [] };
if(fs.existsSync(JSON_FILE + '.gz')) {
  zlib.gunzip(fs.readFileSync(JSON_FILE + '.gz'), function(err, buf) {
    if(err) { throw err; }
    rss_twi2url = JSON.parse(buf.toString());

    if(rss_twi2url.generating_items) {
      console.log(rss_twi2url.generating_items);
      object_for_each(rss_twi2url.generating_items, function(k, v) {
        rss_twi2url.queued_urls.unshift(v);
      });
    }
    rss_twi2url.generating_items = {};

    var filtered_queue = [];
    rss_twi2url.queued_urls.forEach(function(v) {
      if(!match_exclude_filter(v.url)) { filtered_queue.push(v); }
    });
    rss_twi2url.queued_urls = filtered_queue;

    // reduce feed size
    ['last_urls', 'media_urls', 'blog_urls'].forEach(function(v) {
      while(rss_twi2url[v].length > config.feed_item_max) {
        rss_twi2url.last_urls[v].shift(); }
    });
    while(rss_twi2url.photos.length > config.photo_feed_item_max) {
      rss_twi2url.photos.shift(); }
  });
}

function is_queued(url) {
  return (rss_twi2url.queued_urls.indexOf(url) !== -1);
}

function in_photo_stack(url) {
  var result = false;
  rss_twi2url.photos.forEach(function(v) {
    if(v.url === url) { result = true; }
  });
  return result;
}

function remove_utm_param(url) {
  try {
    var url_obj = URL.parse(url, true);
    var removing_param = [];
    object_for_each(url_obj.query, function(k) {
      if(/utm_/i.test(k)) { removing_param.push(k); }
    });
    removing_param.forEach(function(param) {
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
  config.url_expantion_exclude.forEach(function(v) {
    if((new RegExp(v)).test(url)) { ret = true; }
  });
  return ret;
}

var url_expander_cb = {}, url_expander_process;

function create_url_expander() {
  var ret = fork(__dirname + '/url_expander.js');
  ret.on('exit', function(code, signal) {
    console.log('exit of url expander');
    if(code) { console.log('code:', code); }
    if(signal) { console.log('signal:', signal); }

    console.log('restarting url expander');
    url_expander_process = create_url_expander();
  });

  ret.on('message', function(m) {
    if(!m.type) { throw 'no message type'; }
    if(!m.data) { throw 'no data'; }

    switch(m.type) {
      case 'expanded':
      if(url_expander_cb.hasOwnProperty(m.data.original)) {
        url_expander_cb[m.data.original](m.data.result);
        delete url_expander_cb[m.data.original];
      }
      break;

      case 'log': console.log(m.data.join(' ')); break;
      case 'error': console.error(m.data.join(' ')); break;

      default:
      throw 'unknown message type';
    }
  });

  setTimeout(function() {
    ret.send({ type: 'config', data: config });
    setTimeout(expand_url, CHILD_PROCESS_WAIT);
  }, CHILD_PROCESS_WAIT);

  return ret;
}

url_expander_process = create_url_expander();

function url_expander(url, cb) {
  url_expander_process.send({type: 'expand_url', data: url});
  url_expander_cb[url] = cb;
}

var expand_cache = {}, expanding_urls = {};

function expand_url() {
  if(count_map_element(expanding_urls) >= config.url_expander_number) {
    return;
  }

  var tweet = false;
  while(!tweet || !tweet.url) {
    if(url_expander_queue.length === 0) { return; }
    tweet = url_expander_queue.shift();
  }

  function send_url(result) {
    delete expanding_urls[tweet.url];

    var cleand_url = remove_utm_param(result);

    tweet.text.replace(tweet.url, cleand_url);
    tweet.url = cleand_url;

    if(!/\/t\.co\//.test(result)
     && !match_exclude_filter(result)
     && !is_queued(result)
     && !in_photo_stack(result)
      )
    {
      if(photo_module.is_photo(result)) { rss_twi2url.photos.push(tweet); }
      else { rss_twi2url.queued_urls.push(tweet); }
    }

    expand_url();
  }

  expanding_urls[tweet.url] = true;

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

  url_expander(tweet.url, function(result) {
    expand_cache[tweet.url] = result;
    send_url(result);
  }, config.timeout);

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
  return(
    (rss_twi2url.last_urls.indexOf(url) !== -1)
        || (rss_twi2url.media_urls.indexOf(url) !== -1)
        || (rss_twi2url.blog_urls.indexOf(url) !== -1)
  );
}

var executer_cb = {};
var executer = [], current_executer = 0;

process.on('exit', function() {
  executer.forEach(function(v) { v.kill(); });
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

      case 'log': console.log(m.data.join(' ')); break;
      case 'error': console.error(m.data.join(' ')); break;

      default:
      throw 'unknown message type';
    }
  });

  setTimeout(function() {
    child.send({ type: 'config', data: config });
    setTimeout(generate_item, CHILD_PROCESS_WAIT);
  }, CHILD_PROCESS_WAIT);

  return child;
}

function get_description(url, cb) {
  try {
    executer[current_executer++].send({type: 'get_description', data: url});
    executer_cb[url] = cb;

    if(current_executer >= config.executer) {
      current_executer = 0;
    }
  } catch(e) {
    console.error(e);
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

    var cleaned_tweet = v.text.replace(url, '');
    if(!title) {
      console.error('Invalid title:', url);
      title = cleaned_tweet;
    }
    if(!desc) {
      console.error('Invalid description:', url);
    }

    db.put(url, JSON.stringify(
      {
        title: title, 'url': url, author: v.author, date: v.date,
        description: 'URL: ' + url + '<br />' +
          'Tweet: ' + cleaned_tweet +
          (desc? '<br /><br />' + desc : '')
      }));

    if(!in_last_urls(v.url)) {
      rss_twi2url[match_blog_filter(v.url)? 'blog_urls':
                  match_media_filter(v.url)? 'media_urls':
                  'last_urls'].push(v.url);
    }

    delete rss_twi2url.generating_items[v.url];

    if(count_map_element(rss_twi2url.generating_items) < config.executer) {
      setTimeout(generate_item, config.item_generation_frequency);
    }
  });

  rss_twi2url.generating_items[v.url] = v;
  return;
}

function generate_feed(items, cb, name) {
  var feed = new RSS(
    { title: config.title || (name? ' : ' + name : ''),
      'description': config.description,
      feed_url: config.feed_url,
      site_url: config.feed_url + (name? name + '.rss' : ''),
      author: config.author });

  if(items.length === 0) { cb(feed.xml()); }

  var len = items.length, count = 0;

  items.forEach(function(key) {
    db.get(key, function(err, val) {
      if(err || !val) { console.error('db.get error:', err); }
      else { feed.item(JSON.parse(val)); }
      if(++count >= len) { cb(feed.xml()); }
    });
  });
}

function get_json(url, q, callback) {
  function retry() {
    console.log('retrying:', url);
    setTimeout(get_json, config.item_generation_frequency, url, q, callback);
  }

  request.get(
    { 'url': url + ((count_map_element(q) > 0)? '?' + querystring.stringify(q) : ''),
      oauth: opt, encoding: null,
      timeout: config.timeout, qs: q,
      headers: { 'accept-encoding': 'gzip,deflate',
                 'user-agent': config.user_agent } },
    function(err, res, data) {
      function uncompress_callback(err, buffer) {
        if(err) {
          console.error('uncompress error:', err);
          callback([]);
          return;
        }
        try {
          if(res.statusCode === 200) {
            callback(JSON.parse(buffer.toString('utf8')));
            return;
          }
        } catch(other_err) {
          console.error('error:', other_err);
          console.error('data:', buffer.toString('utf8'));

          callback([]);
          return;
        }

        console.error("Error fetching json from twitter:", res.statusCode);
        console.error('url:', url);
        console.error('oauth param:', opt);
        console.error('query string:', q);
        console.error('data:', buffer.toString('utf8'));
      }

      if(err) {
        if(/timed?out/i.test(err.code)) {
          retry();
          return;
        }
        console.error("Error fetching json from twitter:", err);
        console.error('URL:', url);
        console.error('Data:', data);
      } else if(res) {
        switch(res.statusCode) {
          case 500: case 502: case 503: case 504:
          retry();
          break;

          default:
          if(data) {
            switch(res.headers['content-encoding']) {
              case 'gzip':
              zlib.gunzip(data, uncompress_callback);
              break;

              case 'deflate':
              zlib.inflate(data, uncompress_callback);
              break;

              default:
              callback(false, data);
              break;
            }
          } else { uncompress_callback("no data sent", undefined); }
          break;
        }
      }
    });
}

function check_left_api(callback) {
  if(!twitter_api_left) { return; }

  get_json(
    'https://api.twitter.com/1/account/rate_limit_status.json', {},
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

function fetch_page(url, qs, name, cb, next_since_id) {
  rss_twi2url.since[name] = rss_twi2url.since[name] || { count: 0, since_id: false };
  qs.since_id = rss_twi2url.since[name].id;
  if(!qs.since_id) { delete qs.since_id; }

  get_json(url, qs, function(data) {
    url_expander_queue = url_expander_queue.concat(data);
    data = data.results || data;

    rss_twi2url.since[name].count += data.length;

    data.forEach(function(tweet) {
      var user_name = tweet.from_user_name || tweet.user.name;
      var screen_name = tweet.from_user || tweet.user.screen_name;

      if(screen_name === rss_twi2url.screen_name) { return; }

      var author_str = user_name + ' ( @' + screen_name + ' ) / ' + name;
      tweet.entities.urls.forEach(function(v) {
        if(!(v.url && v.expanded_url)) { return; }
        tweet.text = tweet.text.replace(v.url, v.expanded_url);
      });
      tweet.entities.urls.forEach(function(v) {
        url_expander_queue.push(
          { 'url': v.expanded_url || v.url, author: author_str,
            date: tweet.created_at, text: tweet.text.replace(/@(\w)/g, '@ $1') });
      });
    });

    if(!next_since_id) { next_since_id = data.length > 0? data[0].id_str : qs.since_id; }

    if(
      ((!qs.since_id) && (qs.page >= config.first_fetching_page_number)) ||
        (data.length === 0) || (data[data.length - 1].id_str === qs.since_id)
    ) {
      console.log('next since id of', name, '(',
                  rss_twi2url.since[name].count, '):', next_since_id);
      rss_twi2url.since[name].id = next_since_id;
      if(typeof cb === 'function') { cb(); }
    } else {
      qs.page++;
      setTimeout(fetch_page, config.item_generation_frequency,
                 url, qs, name, cb, next_since_id);
    }
  });
}

function fetch() {
  url_expander_process.kill();

  if(!twitter_api_left) { return; }

  object_for_each(expanding_urls, function(k) {
    rss_twi2url.url_expander_queue.push(k);
  });
  expanding_urls = {};

  function fetch_lists() {
    get_json(
      'https://api.twitter.com/1/lists/all.json', { user_id: rss_twi2url.user_id },
      function(data) {
        function list_fetch() {
          var list_info = data;
          var v = list_info.pop();
          if(!v) {
            fetch_searches();
            return;
          }

          fetch_page(
            'https://api.twitter.com/1/lists/statuses.json',
            { include_entities: true, include_rts: true,
              list_id: v.id_str, per_page: config.tweet_max, page: 1
            }, v.full_name,
            list_fetch);
        }
        list_fetch();
      });
  }

  function fetch_searches() {
    get_json(
      'https://api.twitter.com/1/saved_searches.json', {},
      function(data) {
        function search_fetch() {
          var search_info = data;
          var v = search_info.pop();
          if(!v) {
            return;
          }

          fetch_page(
            'http://search.twitter.com/search.json',
            { include_entities: true, rpp: config.search_max,
              q: v.query, result_type: config.search_type, page: 1
            }, v.name,
            search_fetch);
        }
        search_fetch();
      });
  }

  check_left_api(
    function() {
      fetch_page(
        'https://api.twitter.com/1/statuses/home_timeline.json',
        { count: config.tweet_max, exclude_replies: false,
          include_entities: true, include_rts: true, page: 1
        }, 'home_timeline',
        fetch_lists);
    });
}

function start() {
  console.log('twi2url started: ' + config.feed_url);
  console.log('As user: ' + rss_twi2url.screen_name + ' (' + rss_twi2url.user_id + ')');

  backup();
  fetch();

  if(! is_on_heroku) {
    setInterval(backup, config.backup_frequency);
  }
  setInterval(fetch, config.fetch_frequency);

  setInterval(function() {
    expand_url();

    while((rss_twi2url.queued_urls.length > 0)
        && (count_map_element(rss_twi2url.generating_items) < config.executer))
    {
      generate_item();
    }
  }, config.check_frequency);

  console.log('executer number:', config.executer);

  var i = 0;
  for(; i < config.executer; ++i) {
    executer.push(create_executer(i));
  }

  setInterval(function() {
    if(rss_twi2url.queued_urls.length === 0) { return; }

    object_for_each(rss_twi2url.generating_items, function(k, v) {
      rss_twi2url.queued_urls.push(v);
    });
    rss_twi2url.generating_items = {};

    executer.forEach(function(v) { v.kill(); });
    executer_cb = {};
    current_executer = 0;
  }, config.executer_restart_frequency);
}

function signed_in(d) {
  console.log('Authorized!');
  ['oauth_token', 'oauth_token_secret', 'user_id', 'screen_name']
  .forEach(function(v) { rss_twi2url[v] = d[v]; });
  start();
}

function is_signed_in() {
  var check = [
    'oauth_token', 'oauth_token_secret',
    'user_id', 'screen_name'];

  check.forEach(function(v) {
    if(process.env[v]) { rss_twi2url[v] = process.env[v] || null; }
  });

  var result = true;
  check.forEach(function(v) {
    if(! rss_twi2url[v]) { result = false; }
  });
  return result;
}

var authorize_url = false;
function signin() {
  if(is_signed_in()) {
    opt.token = rss_twi2url.oauth_token;
    opt.token_secret = rss_twi2url.oauth_token_secret;
    signed_in(rss_twi2url);
  } else {
    opt.callback = config.feed_url + 'callback';
    request.post(
      {url:'https://api.twitter.com/oauth/request_token', oauth: opt},
      function (e, r, body) {
        if(e) { throw e; }

        var tok = querystring.parse(body);
        opt.token = tok.oauth_token;
        opt.token_secret = tok.oauth_token_secret;
        delete opt.callback;

        authorize_url = 'https://twitter.com/oauth/authorize?oauth_token=' + opt.token;
        console.log('Visit:', authorize_url);
        console.log('Or:', config.feed_url);
      });
  }
}

// load jQuery
request.get({uri: 'http://code.jquery.com/jquery-latest.min.js'}, function(e, r, jquery) {
  if(e) { throw e; }
  config.jquery_src = jquery;

  signin();
});

// prepare database
db = new (require('leveldb').DB)();
db.open(DB_FILE, { create_if_missing: true }, function(err) {
  if(err) { throw err; }
});

// run web server
var express = require('express');
var app = express();
app.use(express.compress({
  filter: function(req, res) {
    return (/json|text|javascript/.test(res.getHeader('Content-Type')))
        || (/application\/rss\+xml/.test(res.getHeader('Content-Type')));
  }

}));

app.get('/callback', function(req, res) {
  if(is_signed_in() && !authorize_url) {
    res.set('content-type', 'text/plain').send('Already signed in.');
    return;
  }

  opt.verifier = req.query.oauth_verifier;
  authorize_url = false;
  request.post(
    { url:'https://api.twitter.com/oauth/access_token', oauth: opt},
    function (e, r, result) {
      if(e) { throw e; }

      result = querystring.parse(result);
      opt.token = result.oauth_token;
      opt.token_secret = result.oauth_token_secret;
      delete opt.verifier;

      res.set('content-type', 'text/plain').send('Twitter OAuth Success!');

      console.log('Twitter OAuth result.');
      console.log(result);
      signed_in(result);
    });
});

function print_current_state(req) {
  console.log('Request:');
  console.log(req.headers);

  console.log('queued_urls.length:', rss_twi2url.queued_urls.length);
  console.log('url_expander_queue.length:', url_expander_queue.length);
  console.log('generating_items.length:', count_map_element(rss_twi2url.generating_items));
  console.log('photos.length:', rss_twi2url.photos.length);
  console.log('last_urls.length:', rss_twi2url.last_urls.length);
  console.log('media_urls.length:', rss_twi2url.media_urls.length);
  console.log('blog_urls.length:', rss_twi2url.blog_urls.length);

  console.log('expanding_urls:');
  console.log(expanding_urls);

  var fetched_tweet = 0;
  object_for_each(rss_twi2url.since, function(k, v) {
    fetched_tweet += v.count;
  });
  console.log('fetched tweet:', fetched_tweet);

  console.log('generating_items:');
  console.log(rss_twi2url.generating_items);
}

function get_feed(req, res, ary, name) {
  if(!is_signed_in() || authorize_url) {
    res.redirect(authorize_url);
    return;
  }

  print_current_state(req);

  ary = (ary.length > config.feed_item_max)
      ? ary.slice(ary.length - config.feed_item_max)
      : ary;

  generate_feed(ary, function(data) {
    res.set('content-type', 'application/rss+xml');
    res.send(data);
  }, name);
}

app.get('/', function(req, res) {
  get_feed(req, res, rss_twi2url.last_urls);
});

app.get('/media.rss', function(req, res) {
  get_feed(req, res, rss_twi2url.media_urls, 'media');
});

app.get('/blog.rss', function(req, res) {
  get_feed(req, res, rss_twi2url.blog_urls, 'blog');
});

app.get('/photo.rss', function(req, res) {
  if(!is_signed_in() || authorize_url) {
    res.redirect(authorize_url);
    return;
  }

  print_current_state(req);

  var photos = (rss_twi2url.photos.length > config.photo_feed_item_max)
             ? rss_twi2url.photos.slice(rss_twi2url.photos.length - config.photo_feed_item_max)
             : rss_twi2url.photos;

  var feed = new RSS(
    { title: config.title + ' : photos',
      'description': config.description,
      feed_url: config.feed_url + 'photo.rss',
      site_url: config.feed_url,
      author: config.author });

  photos.forEach(function(v) {
    feed.item({
      title: v.text.replace(v.url, ''),
      description: photo_module.photo_tag(v.url),
      url: v.url, author: v.author, date: v.date });
  });

  res.set('content-type', 'application/rss+xml');
  res.send(feed.xml());
});

app.listen(config.port);
