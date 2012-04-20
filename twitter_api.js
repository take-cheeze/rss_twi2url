if(!process.send) { throw 'is not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments).join(' ') });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments).join(' ') });
};

var $ = require('jquery');
var fs = require('fs');
var jsdom = require('jsdom');
var qs = require('querystring');
var request = require('request');

var config = {}, consumer = {};
try { consumer = require('./consumer'); } catch(e) {}
consumer.CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY || consumer.CONSUMER_KEY;
consumer.CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET || consumer.CONSUMER_SECRET;

var QUEUE_FILENAME = process.cwd() + '/rss_twi2url_queue.json';
var url_expander_queue = require('path').existsSync(QUEUE_FILENAME)
  ? JSON.parse(fs.readFileSync(QUEUE_FILENAME)) : [];
function backup() {
  fs.writeFileSync(QUEUE_FILENAME, JSON.stringify(url_expander_queue));
}
process.on(
  'exit', function() {
    backup();
  });
setInterval(backup, config.backup_frequency);

var twitter_api_left = true;

var opt = {
  consumer_key: consumer.CONSUMER_KEY,
  consumer_secret: consumer.CONSUMER_SECRET
};
function get_json(url, callback) {
  request.get(
    { 'url': url, 'oauth': opt, encoding: 'utf8', timeout: config.timeout },
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
          setTimeout(get_json, 1000, url, callback);
          break;
        case 200:
          try {
            callback(JSON.parse(data));
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

function timeout_when_api_reset(callback) {
  get_json(
    'https://api.twitter.com/1/account/rate_limit_status.json',
    function(data) {
      console.log('api left:', data.remaining_hits);

      twitter_api_left = data.remaining_hits;
      if(data.remaining_hits > 0) {
        callback();
      } else {
        var wait_time = data.reset_time_in_seconds - Math.floor((new Date()).getTime() / 1000);
        setTimeout(
          timeout_when_api_reset,
          (wait_time + Math.ceil(Math.random() * 10)) * 1000,
          callback);
        twitter_api_left = false;
        setTimeout(function() { twitter_api_left = true; }, wait_time * 1000);
      }
    });
}

function fetch_page(url, name, info) {
  url += (info.page === 1 && info.since_id)
    ? '&' + $.param({since_id: info.since_id}) : '';

  timeout_when_api_reset(
    function() {
      get_json(
        url + '&' + $.param({page: info.page}), function(data) {
          if(data.length > 0) {
            url_expander_queue = url_expander_queue.concat(data);

            if(info.page === 1) {
              process.send(
                { type: 'set_since_id',
                  data: { 'name': name, since_id: data[0].id_str }
                });
            }

            if(info.since_id) {
              info.page++;
              timeout_when_api_reset(
                function() { fetch_page(url, name, info); });
            }
          }
        });
    });
}

function fetch(setting) {
  if(!twitter_api_left) { return; }

  timeout_when_api_reset(
    function() {
      fetch_page(
        'https://api.twitter.com/1/statuses/home_timeline.json?' +
          $.param(
            { count: config.tweet_max, exclude_replies: false,
              include_entities: true, include_rts: true
            }), 'home_timeline',
        { page: 1, since_id: setting.since.home_timeline });
    });

  timeout_when_api_reset(
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
                    {
                      include_entities: true, include_rts: true,
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

                server.close();
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

    case 'fetch': fetch(msg.data); break;
    case 'config': config = msg.data; break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });

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

var expand_count = 0, expand_cache = {};
setInterval(
  function() {
    if(expand_count >= config.url_expander_number) { return; }

    var tweet = url_expander_queue.shift();
    if(!tweet) { return; }

    var author_str = tweet.user.name + ' ( @' + tweet.user.screen_name + ' )';
    function send(result) {
      process.send(
        { type: 'fetched_url',
          data:{ url: result, author: author_str,
                 date: tweet.created_at, text: tweet.text },
          left: url_expander_queue.length });
      expand_count--;
    }
    $.each(
      tweet.entities.urls, function(k, v) {
        expand_count++;

        v.expanded_url = v.expanded_url || v.url;
        if(expand_cache.hasOwnProperty(v.expanded_url)) {
          send(expand_cache[v.expanded_url]);
          return;
        }
        if(
          (v.expanded_url.length > config.long_url_length) ||
          expantion_exclude(v.expanded_url)
        ) {
          send(v.expanded_url);
          return;
        }

        function longurl(e, res, data) {
          if(res !== undefined) {
            if(e) {
              console.error('Error at LongURL: ' + e);
              console.error('URL: ' + v.expanded_url);
            } else switch(res.statusCode) {
            case 400:
              expand_cache[v.expanded_url] = v.expanded_url;
              send(v.expanded_url);
              return;
            case 500: case 502: case 503: case 504: break;
            case 200:
              var result = JSON.parse(data)['long-url'] || v.expanded_url;
              expand_cache[v.expanded_url] = result;
              send(result);
              return;
            default:
              console.error('Error at LongURL: ' + res.statusCode);
              console.error('URL: ' + v.expanded_url);
              send(v.expanded_url);
              return;
            }
            console.log(res);
            console.log(data);
          }

          request.get(
            { 'url': 'http://api.longurl.org/v2/expand?' +
              $.param({ 'url': v.expanded_url, 'all-redirects': 1, format: 'json' }),
              encoding: 'utf8', timeout: config.timeout }, longurl);
        }
        longurl();
      });
  }, config.item_generation_frequency);
