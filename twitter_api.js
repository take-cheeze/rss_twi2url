if(!process.send) { throw 'is not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments).join(' ') });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments).join(' ') });
};

var $ = require('jquery');
var jsdom = require('jsdom');
var qs = require('querystring');
var request = require('request');

var config = {};
var consumer = require('./consumer');

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

var LONG_URL_LENGTH = 40, TWEET_MAX = 200;

function timeout_when_api_reset(callback) {
  get_json(
    'https://api.twitter.com/1/account/rate_limit_status.json',
    function(data) {
      console.log('api left: ' + data.remaining_hits);

      twitter_api_left = data.remaining_hits;
      if(data.remaining_hits > 0) {
        callback();
      } else {
        var wait_time = data.reset_time_in_seconds - Math.floor((new Date()).getTime() / 1000);
        setTimeout(
          callback,
          (wait_time + Math.ceil(Math.random() * 10)) * 1000);
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
          $.each(
            data, function(idx, tweet) {
              var author_str = tweet.user.name + '( @' + tweet.user.screen_name + ' ) / ' + name;
              $.each(
                tweet.entities.urls, function(k, v) {
                  if(!v.expanded_url) { v.expanded_url = v.url; }

                  if(v.expanded_url.length > LONG_URL_LENGTH) {
                    process.send(
                      { type: 'fetched_url',
                        data:{ 'url': v.expanded_url,
                               author: author_str,
                               date: tweet.created_at } });
                    return;
                  }

                  function longurl(e, res, data) {
                    if(res !== undefined) {
                      if(e) {
                        console.error('Error at LongURL: ' + e);
                        console.error('URL: ' + v.expanded_url);
                      } else switch(res.statusCode) {
                      case 400:
                        process.send(
                          { type: 'fetched_url',
                            data: { 'url': v.expanded_url,
                                    author: author_str,
                                    date: tweet.created_at } });
                        return;
                      case 500: case 502: case 503: case 504: break;
                      case 200:
                        var result = JSON.parse(data);
                        process.send(
                          { type: 'fetched_url',
                            data: { 'url': result['long-url'] || v.expanded_url,
                                    author: author_str,
                                    date: tweet.created_at } });
                        return;
                      default:
                        console.error('Error at LongURL: ' + res.statusCode);
                        console.error('URL: ' + v.expanded_url);
                        return;
                      }
                    }

                    request.get(
                      { 'url': 'http://api.longurl.org/v2/expand?' +
                        $.param({ 'url': v.expanded_url, 'all-redirects': 1,
                                  format: 'json' }),
                        encoding: 'utf8' },
                      longurl);
                  }
                  longurl();
                });
            });

          if(data.length > 0) {
            if(info.page === 1) {
              process.send(
                {
                  type: 'set_since_id',
                  data: { 'name': name, since_id: data[0].id_str }
                });
            }

            if(info.since_id) {
              info.page++;
              fetch_page(url, name, info);
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
            {
              count: TWEET_MAX, exclude_replies: false,
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
                      list_id: v.id_str, per_page: TWEET_MAX
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
    request.post(
      {url:'https://api.twitter.com/oauth/request_token', oauth: opt},
      function (e, r, body) {
        if(e) { throw JSON.stringify(error); }

        var tok = qs.parse(body);
        opt.token = tok.oauth_token;
        opt.token_secret = tok.oauth_token_secret;

        console.log('Visit: https://twitter.com/oauth/authorize?oauth_token=' + opt.token);
        process.send({ type: 'request_pin' });
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

    case 'return_pin':
      opt.verifier = msg.data;
      request.post(
        {url:'https://api.twitter.com/oauth/access_token', 'oauth': opt},
        function (e, r, body) {
          if(e) { throw JSON.stringify(error); }

          var result = qs.parse(body);
          opt.token = result.oauth_token;
          opt.token_secret = result.oauth_token_secret;
          delete opt.verifier;

          process.send({ type: 'signed_in', data: result });
        });
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
