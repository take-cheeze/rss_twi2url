if(!process.send) { throw 'is not forked'; }

var $ = require('jquery');
var fs = require('fs');
var jsdom = require('jsdom');
var qs = require('querystring');
var request = require('request');
var url_expander = require('url-expander');
var zlib = require('zlib');

var QUEUE_FILENAME = process.cwd() + '/rss_twi2url_queue.json';
var url_expander_queue =
  [];
/*
  require('path').existsSync(QUEUE_FILENAME)
  ? JSON.parse(fs.readFileSync(QUEUE_FILENAME)) : [];
function backup() {
  fs.writeFileSync(QUEUE_FILENAME, JSON.stringify(url_expander_queue));
}
process.on(
  'exit', function() {
    backup();
  });
*/

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
  request.get(
    { 'url': url, 'oauth': opt, encoding: null, timeout: config.timeout,
      headers: { 'accept-encoding': 'gzip,deflate' } },
    function(err, res, data) {
      if(err) {
        if(/timed?out/i.test(err.code)) {
          get_json(url, callback);
          return;
        }
        console.error("Error fetching json from twitter:", err);
        console.error('URL: ' + url);
      } else if(res) {
        switch(res.statusCode) {
        case 500: case 502: case 503: case 504:
          console.log('retrying:', url);
          setTimeout(get_json, config.item_generation_frequency, url, callback);
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
    'https://api.twitter.com/1/account/rate_limit_status.json',
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

function fetch_page(url, name, info) {
  url += (info.page === 1 && info.since_id)
    ? '&' + $.param({since_id: info.since_id}) : '';

  check_left_api(
    function() {
      get_json(
        url + '&' + $.param({page: info.page}), function(data) {
          url_expander_queue = url_expander_queue.concat(data);

          if(info.page === 1) { info.next_since_id = data[0].id_str; }

          if(
            (!info.since_id) ||
            (data.length === 0) ||
              (data[data.length - 1].id_str === info.since_id)
          ) {
            process.send(
              { type: 'set_since_id',
                data: { 'name': name, since_id: info.next_since_id },
                left: url_expander_queue.length });
          } else {
            info.page++;
            fetch_page(url, name, info);
          }
        });
    });
}

function fetch(setting) {
  if(!twitter_api_left) { return; }

  check_left_api(
    function() {
      fetch_page(
        'https://api.twitter.com/1/statuses/home_timeline.json?' +
          $.param(
            { count: config.tweet_max, exclude_replies: false,
              include_entities: true, include_rts: true
            }), 'home_timeline',
        { page: 1, since_id: setting.since.home_timeline });
    });

  check_left_api(
    function() {
      get_json(
        'https://api.twitter.com/1/lists/all.json?' +
          $.param({user_id: setting.user_id}),
        function(data) {
          $.each(
            data, function(k, v) {
              setTimeout(
                fetch_page, config.item_generation_frequency * k,
                'https://api.twitter.com/1/lists/statuses.json?' +
                  $.param(
                    { include_entities: true, include_rts: true,
                      list_id: v.id_str, per_page: config.tweet_max
                    }), v.full_name,
                { page: 1, since_id: setting.since[v.full_name] });
            });
        });
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
          .on('clientError', function(e) { console.error(e); });
      });
  }
}

process.on(
  'message', function(msg) {
    if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

    switch(msg.type) {
    case 'signin':
      if(opt.oauth_token_secret) { throw 'already singed in'; }
      signin(msg.data);
      break;

    case 'fetch':
      zlib.gunzip(new Buffer(msg.data, 'base64'), function(err, buf) {
                    if(err) { throw err; }
                    fetch(JSON.parse(buf.toString()));
                  });
      break;
    case 'config':
      // setInterval(backup, config.backup_frequency);
      config = msg.data;
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });

var expand_count = 0, expand_cache = {};
function expand_url() {
  if(expand_count >= config.url_expander_number) { return; }

  var tweet = false;
  while(!tweet) {
    if(url_expander_queue.length === 0) { return; }
    tweet = url_expander_queue.shift();
  }

  var author_str = tweet.user.name + ' ( @' + tweet.user.screen_name + ' )';
  function send_url(result) {
    expand_count--;
    expand_url();

    process.send(
      { type: 'fetched_url',
        data:{ url: result, author: author_str,
               date: tweet.created_at, text: tweet.text },
        left: url_expander_queue.length });
  }

  $.each(
    tweet.entities.urls, function(k, v) {
      expand_count++;

      v.expanded_url = v.expanded_url || v.url;

      if(expand_cache.hasOwnProperty(v.expanded_url)) {
        send_url(expand_cache[v.expanded_url]);
        return;
      }

      if(
        (v.expanded_url.length > config.long_url_length) ||
        /\?/.test(v.expanded_url) ||
        /&/.test(v.expanded_url) ||
        match_exclude_filter(v.expanded_url) ||
          expantion_exclude(v.expanded_url)
      ) {
        send_url(v.expanded_url);
        return;
      }

      var expander = new (url_expander.SingleUrlExpander)(v.expanded_url);
      expander.on('expanded', function(orig, exp) { send_url(exp); });
      expander.expand();
    });

  expand_url();
}
setInterval(expand_url, config.check_frequency);
