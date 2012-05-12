if(!process.send) { throw 'is not forked'; }

var $ = require('jquery');
var fs = require('fs');
var jsdom = require('jsdom');
var qs = require('querystring');
var request = require('request');
var SingleUrlExpander = require('url-expander').SingleUrlExpander;
var zlib = require('zlib');

var QUEUE_FILENAME = process.cwd() + '/rss_twi2url_queue.json';
var url_expander_queue = [];
function backup() {
  zlib.gzip(new Buffer(JSON.stringify(url_expander_queue)), function(err, buf) {
    if(err) { throw err; }
    fs.writeFileSync(QUEUE_FILENAME + '.gz', buf);
  });
}
process.on('exit', function() {
  backup();
});

console.log = function() {
  process.send(
    { type: 'log', data: Array.prototype.slice.call(arguments).join(' '),
      left: url_expander_queue.length });
};
console.error = function() {
  process.send(
    { type: 'error', data: Array.prototype.slice.call(arguments).join(' '),
      left: url_expander_queue.length });
};

var config = {}, consumer = {};
try { consumer = require('./consumer'); } catch(e) {}
consumer.CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY || consumer.CONSUMER_KEY;
consumer.CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET || consumer.CONSUMER_SECRET;

var twitter_api_left = true;

var opt = {
  consumer_key: consumer.CONSUMER_KEY,
  consumer_secret: consumer.CONSUMER_SECRET
};
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
          // console.log(JSON.stringify(err));
          retry();
          return;
        }
        console.error("Error fetching json from twitter:", err);
        console.error('URL: ' + url);
      } else if(res) {
        switch(res.statusCode) {
          case 500: case 502: case 503: case 504:
          // console.log(JSON.stringify(res));
          retry();
          break;

          case 200:
          try {
            function uncompress_callback(err, buffer) {
              if(err) { throw err; }
              callback(JSON.parse(buffer.toString('utf8')));
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
            console.error(JSON.stringify(e));
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
      }
    });
}

function match_exclude_filter(str) {
  var result = false;
  $.each(config.exclude_filter, function(k, v) {
    if((new RegExp(v)).test(str)) { result = true; } });
  return result;
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

function fetch_page(url, name, info, cb) {
  url += (info.page === 1 && info.since_id)
       ? '&' + $.param({since_id: info.since_id}) : '';

  // check_left_api(
  // function() {
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
      process.send(
        { type: 'set_since_id',
          data: { 'name': name, since_id: info.next_since_id },
          left: url_expander_queue.length });
      if(typeof cb === 'function') { cb(); }
    } else {
      info.page++;
      setTimeout(fetch_page, config.item_generation_frequency, url, name, info, cb);
    }
  });
  // });
}

function fetch(setting) {
  if(!twitter_api_left) { return; }

  function fetch_lists() {
    get_json(
      'http://api.twitter.com/1/lists/all.json?' +
        $.param({user_id: setting.user_id}),
      function(data) {
        function list_fetch() {
          var list_info = data;
          var v = list_info.pop();
          if(!v) { return; }

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
            fetch_lists();
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
        fetch_searches);
    });
}

function signin(setting) {
  if(setting) {
    opt.token = setting.oauth_token;
    opt.token_secret = setting.oauth_token_secret;
    process.send({ type: 'signed_in', data: setting });
  } else {
    opt.callback = 'http://' + config.hostname + ':' + config.port + '/' + config.pathname + '/callback';
    request.post(
      {url:'https://api.twitter.com/oauth/request_token', oauth: opt},
      function (e, r, body) {
        if(e) { throw JSON.stringify(error); }

        var tok = qs.parse(body);
        opt.token = tok.oauth_token;
        opt.token_secret = tok.oauth_token_secret;
        delete opt.callback;

        console.log('Visit: https://twitter.com/oauth/authorize?oauth_token=' + opt.token);

        var server = null;
        server = require('http').createServer(
          function(req, res) {
            opt.verifier = qs.parse(req.url).oauth_verifier;
            request.post(
              {url:'https://api.twitter.com/oauth/access_token', 'oauth': opt},
              function (e, r, result) {
                if(e) { throw JSON.stringify(error); }

                result = qs.parse(result);
                opt.token = result.oauth_token;
                opt.token_secret = result.oauth_token_secret;
                delete opt.verifier;

                if(server) { server.close(); }
                process.send({ type: 'signed_in', data: result });
              });
          })
                 .listen(config.port)
                 .on('clientError', function(e) { console.error(JSON.stringify(e)); });
      });
  }
}

var expand_count = 0, expand_cache = {};

function expand_url() {
  if(expand_count >= config.url_expander_number) {
    if(url_expander_queue.length >= 1000) { expand_count = 0; }
    else { return; }
  }

  var tweet = false;
  while(!tweet || !tweet.url) {
    if(url_expander_queue.length === 0) { return; }
    tweet = url_expander_queue.shift();
  }


  function send_url(result) {
    tweet.url = result;
    if(!/\/t\.co\//.test(result) && !match_exclude_filter(tweet.url)) {
      process.send({ type: 'fetched_url', data: tweet, left: url_expander_queue.length });
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
    console.error(JSON.stringify(err));
    process.exit(1);
  }
});

process.on(
  'message', function(msg) {
    if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

    switch(msg.type) {
    case 'signin':
      if(opt.oauth_token_secret) { throw 'already singed in'; }
      signin(msg.data);
      if(require('path').existsSync(QUEUE_FILENAME + '.gz')) {
        fs.readFile(QUEUE_FILENAME + '.gz', function(err, b) {
          zlib.gunzip(b, function(err, buf) {
            if(err) { throw err; }
            url_expander_queue = url_expander_queue.concat(JSON.parse(buf.toString()));
          });
        });
      }
      break;

    case 'fetch':
      zlib.inflateRaw(new Buffer(msg.data, 'base64'), function(err, buf) {
        if(err) { throw err; }
        fetch(JSON.parse(buf.toString()));
      });
      break;
    case 'config':
      config = msg.data;
      setInterval(backup, config.backup_frequency);
      setInterval(expand_url, config.check_frequency);
      setInterval(process.send, config.check_frequency, { type: 'dummy' });
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
