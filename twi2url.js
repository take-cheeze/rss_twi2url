#!/usr/bin/env node

var
$ = require('jquery'),
assert = require('assert'),
consumer = require('./consumer'),
fs = require('fs'),
jsdom = require('jsdom'),
SingleUrlExpander = require('url-expander').SingleUrlExpander;

var
CONFIG_FILE = __dirname + '/config.js', TWEET_MAX = 200,
DB_FILE = __dirname + '/rss_twi2url.db';

var twi2url_db = require('path').existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  : { last_urls: [], queued_urls: [], since: {}, cache: {} };
function backup() {
  fs.writeFileSync(DB_FILE, JSON.stringify(twi2url_db), 'utf8');
}
process.on('exit', function() { backup(); });

var config = require(CONFIG_FILE);
var twitter_api_left = false;

function is_signed_in() {
  var check = ['access_token', 'access_token_secret', 'user_id', 'screen_name'];
  for(i in check) {
    if(!(check[i] in twi2url_db)) return false;
  }
  return true;
}

function signin(callback) {
  var OAuth = require('oauth').OAuth;
  var oa = new OAuth(
    'https://api.twitter.com/oauth/request_token',
    'https://api.twitter.com/oauth/access_token',
    consumer.CONSUMER_KEY,
    consumer.CONSUMER_SECRET,
    '1.0a', null, "HMAC-SHA1");

  OAuth.prototype.get_json = function(url, callback) {
    this.getProtectedResource(
      url, 'GET', twi2url_db.access_token, twi2url_db.access_token_secret,
      function(error, data, response) {
        if(error) {
          setTimeout(function() { OAuth.prototype.get_json(url, callback); }, 1000);
        }
        else { callback(JSON.parse(data)); }
      });
  };

  if(is_signed_in()) {
    callback(oa);
    return;
  }

  oa.getOAuthRequestToken(
    function(error, oauth_token, oauth_token_secret, results){
      if(error) { throw JSON.stringify(error); }
      else {
        console.log('visit https://twitter.com/oauth/authorize?oauth_token=' + oauth_token);
        var i = require('readline').createInterface(process.stdin, process.stdout, null);
        i.question(
          'Enter pin number:', function(answer) {
            i.close();
            oa.getOAuthAccessToken(
              oauth_token, oauth_token_secret, answer,
              function(error, oauth_access_token, oauth_access_token_secret, result) {
                if(error) { throw JSON.stringify(error); }
                twi2url_db.access_token = oauth_access_token;
                twi2url_db.access_token_secret = oauth_access_token_secret;
                twi2url_db.user_id = result.user_id;
                twi2url_db.screen_name = result.screen_name;
                callback(oa);
              });
          });
      }
    });
}

function timeout_when_api_reset(oauth, callback) {
  oauth.get_json(
    'https://api.twitter.com/1/account/rate_limit_status.json',
    function(data) {
      console.log('api left: ' + data.remaining_hits);
      twitter_api_left = data.remaining_hits;
      if(data.remaining_hits > 0) {
        callback();
      } else {
        var wait_time
          = data.reset_time_in_seconds
          - Math.floor((new Date()).getTime() / 1000)
          + 1;
        setTimeout(
          callback,
          (wait_time + Math.ceil(Math.random() * 10)) * 1000);
        twitter_api_left = false;
        setTimeout(
          function() {
            twitter_api_left = true;
          }, wait_time * 1000);
      }
    });
}

function fetch_page(oauth, url, name, info) {
  if(info === undefined) {
    info = {};
    info.page = 1;
    info.since_id =
      (name in twi2url_db.since)? twi2url_db.since[name] : null;
    if(info.since_id !== null) {
      url += '&' + $.param({'since_id': info.since_id});
    }
    info.new_since_id = null;
  }

  timeout_when_api_reset(
    oauth, function() {
      oauth.get_json(
        url + '&' + $.param({page: info.page}), function(data) {
          $.each(
            data, function(k, tweet) {
              $.each(
                tweet.entities.urls, function(k, v) {
                  var author = tweet.user.name + ' (@' + tweet.user.screen_name + ')';
                  var date = tweet.created_at;
                  (function(author, date) {
                     var expander = new SingleUrlExpander(require('url').parse(v.url).href);
                     expander.on(
                       'expanded', function (org_url, exp_url) {
                         twi2url_db.queued_urls.push(
                           {
                             'url': exp_url, 'author': author, 'date': date
                           });
                       });
                     expander.expand();
                   })(author, date);
                });
            });

          if(info.new_since_id === null && data.length > 0) {
            info.new_since_id = data[0].id_str;
          }
          if(data.length != 0 && info.since_id !== null) {
            info.page++;
            fetch_page(oauth, url, name, info);
          } else if(info.new_since_id !== null) {
            twi2url_db.since[name] = info.new_since_id;
          }
        });
    });
}
function fetch(oauth) {
  if(!twitter_api_left) { return; }

  timeout_when_api_reset(
    oauth, function() {
      fetch_page(
        oauth, 'https://api.twitter.com/1/statuses/home_timeline.json?' +
          $.param({
                    'count': TWEET_MAX,
                    'exclude_replies': 'false',
                    'include_entities': 'true',
                    'include_rts': 'true'
                  }), 'home_timeline');
    });
  timeout_when_api_reset(
    oauth, function() {
      oauth.get_json(
        'https://api.twitter.com/1/lists/all.json?' +
          $.param({'user_id': twi2url_db.user_id}),
        function(data) {
          $.each(
            data, function(k, v) {
              fetch_page(
                oauth, 'https://api.twitter.com/1/lists/statuses.json?' +
                  $.param({
                            'include_entities': 'true',
                            'include_rts': 'true',
                            'list_id': v.id_str,
                            'per_page': TWEET_MAX
                          }), v.full_name);
            }
          );
        }
      );
    });
};

function in_last_urls(url) {
  for(i in twi2url_db.last_urls) {
    if(twi2url_db.last_urls[i] === url) { return true; } }
  return false;
}
require('./twi2url.description');
function generate_items() {
  function match_exclude_filter(str) {
    for(k in config.exclude_filter) {
      if((new RegExp(config.exclude_filter[k])).test(str)) { return true; } }
    return false;
  }
  while(twi2url_db.queued_urls.length > 0) {
    var v = twi2url_db.queued_urls.pop();
    if(match_exclude_filter(v.url) ||
       (v.url in twi2url_db.cache && in_last_urls(v.url)))
    { continue; }

    require('./twi2url.description').get_description(
      v.url, function(url, title, description) {
        if(!description) {
          console.error('invalid description: ' + description);
          console.error('invalid description (url): ' + url);
          console.error('invalid description (title): ' + title);
        }

        twi2url_db.cache[url] = {
          'title': title,
          'description': description,
          'url': url,
          'author': v.author,
          'date': v.date
        };
        if(!in_last_urls(url)) { twi2url_db.last_urls.push(url); }
      });
  }
}

function create_feed() {
  var feed = new (require('rss'))(
    {
      title: config.title,
      description: config.description,
      feed_url: 'http://' + config.hostname + ':' + config.port + '/',
      site_url: 'http://' + config.hostname + ':' + config.port + '/' + config.pathname,
      author: config.author });

  // reduce feed size
  while(twi2url_db.last_urls.length >= config.feed_item_max) {
    twi2url_db.last_urls.shift();
  }

  $.each(twi2url_db.last_urls, function(k,v) {
           feed.item(twi2url_db.cache[v]); });
  return feed;
}

signin(
  function(oa) {
    require('http').createServer(
      function(req, res) {
        res.writeHead(200, {'Content-Type': 'application/rss+xml'});
        var xml = create_feed().xml();
        console.log('queued_urls.length: ' + twi2url_db.queued_urls.length);
        console.log('last_urls.length: ' + twi2url_db.last_urls.length);
        res.end(xml);
      }).listen(config.port);

    console.log('http://' + config.hostname + ':' + config.port + '/' + config.pathname);

    twitter_api_left = true;
    backup();

    generate_items();
    fetch(oa);

    setInterval(function() { fetch(oa); }, config.fetch_frequency);
    setInterval(generate_items, 1000 * 30);
    setInterval(backup, 1000 * 30);
  });
