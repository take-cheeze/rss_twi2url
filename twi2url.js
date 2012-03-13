#!/usr/bin/env node

var
$ = require('jquery'),
consumer = require('./consumer'),
fs = require('fs'),
jsdom = require('jsdom');

var document = jsdom.jsdom(), window = document.createWindow();

var
CONFIG_FILE = __dirname + '/config.js', TWEET_MAX = 200,
LONG_URL_LENGTH = 40, DB_FILE = __dirname + '/rss_twi2url.db';

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
  var
  qs = require('querystring'),
  request = require('request'),
  opt = {
    consumer_key: consumer.CONSUMER_KEY,
    consumer_secret: consumer.CONSUMER_SECRET
  };

  var oa = {
    get_json: function(url, callback) {
      request.get(
        { 'url': url, oauth: opt, encoding: 'utf8' },
        function(err, res, data) {
          switch(res.statusCode) {
          case 500: case 502: case 503: case 504:
            setTimeout(function() { oa.get_json(url, callback); }, 1000);
            break;
          case 200:
            callback(JSON.parse(data));
            break;
          default:
            console.error("Error fetching json from twitter: " + res.statusCode);
            console.error('URL: ' + url);
            break;
          }
        });
    }, opt: opt
  };

  if(is_signed_in()) {
    opt.token = twi2url_db.access_token;
    opt.token_secret = twi2url_db.access_token_secret;
    callback(oa);
    return;
  }

  request.post(
    {url:'https://api.twitter.com/oauth/request_token', oauth: opt},
    function (e, r, body) {
      if(e) { throw JSON.stringify(error); }

      var tok = qs.parse(body);
      opt.token = tok.oauth_token;
      opt.token_secret = tok.oauth_token_secret;

      console.log('Visit: https://twitter.com/oauth/authorize?oauth_token=' + opt.token);
      var i = require('readline').createInterface(process.stdin, process.stdout, null);
      i.question(
        'Enter pin number: ', function(pin) {
          i.close();
          opt.verifier = pin;
          request.post(
            {url:'https://api.twitter.com/oauth/access_token', oauth: opt},
            function (e, r, body) {
              if(e) { throw JSON.stringify(error); }

              var result = qs.parse(body);
              opt.token = result.oauth_token;
              opt.token_secret = result.oauth_token_secret;
              delete opt.verifier;

              twi2url_db.access_token = result.oauth_token;
              twi2url_db.access_token_secret = result.oauth_token_secret;
              twi2url_db.user_id = result.user_id;
              twi2url_db.screen_name = result.screen_name;

              console.log('Authorized!');
              callback(oa);
            });
        });
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
        var wait_time = data.reset_time_in_seconds - Math.floor((new Date()).getTime() / 1000);
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
      url += '&' + $.param({since_id: info.since_id});
    }
    info.new_since_id = null;
  }

  timeout_when_api_reset(
    oauth, function() {
      oauth.get_json(
        url + '&' + $.param({page: info.page}), function(data) {
          for(idx in data) {
            var tweet = data[idx];
            $.each(
              tweet.entities.urls, function(k, v) {
                if(!v.expanded_url) { v.expanded_url = v.url; }

                if(v.expanded_url.length > LONG_URL_LENGTH) {
                  twi2url_db.queued_urls.push(
                    { 'url': v.expanded_url,
                      author: tweet.user.name + ' (@' + tweet.user.screen_name + ')',
                      date: tweet.created_at });
                  return;
                }

                function longurl(e, res, data) {
                  if(res !== undefined) {
                    if(e) {
                      console.error('Error at LongURL: ' + e);
                      console.error('URL: ' + v.expanded_url);
                    } else switch(res.statusCode) {
                    default:
                      console.error('Error at LongURL: ' + res.statusCode);
                      console.error('URL: ' + v.expanded_url);
                      return;
                    case 400:
                      twi2url_db.queued_urls.push(
                        { 'url': v.expanded_url,
                          author: tweet.user.name + ' (@' + tweet.user.screen_name + ')',
                          date: tweet.created_at });
                      return;
                    case 500: case 502: case 503: case 504: break;
                    case 200:
                      var result = JSON.parse(data);
                      twi2url_db.queued_urls.push(
                        { 'url': 'long-url' in result? result['long-url'] : v.expanded_url,
                          author: tweet.user.name + ' (@' + tweet.user.screen_name + ')',
                          date: tweet.created_at });
                      return;
                    }
                  }

                  require('request').get(
                    { 'url': 'http://api.longurl.org/v2/expand?' +
                      $.param({ 'url': v.expanded_url, 'all-redirects': 1,
                                format: 'json' }),
                      encoding: 'utf8' }, 
                    longurl);
                }
                longurl();
              });
          }

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
                    count: TWEET_MAX,
                    exclude_replies: 'false',
                    include_entities: 'true',
                    include_rts: 'true'
                  }), 'home_timeline');
    });
  timeout_when_api_reset(
    oauth, function() {
      oauth.get_json(
        'https://api.twitter.com/1/lists/all.json?' +
          $.param({user_id: twi2url_db.user_id}),
        function(data) {
          $.each(
            data, function(k, v) {
              fetch_page(
                oauth, 'https://api.twitter.com/1/lists/statuses.json?' +
                  $.param({
                            include_entities: 'true',
                            include_rts: 'true',
                            list_id: v.id_str,
                            per_page: TWEET_MAX
                          }), v.full_name);
            });
        });
    });
};

function in_last_urls(url) {
  for(i in twi2url_db.last_urls) {
    if(twi2url_db.last_urls[i] === url) { return true; } }
  return false;
}

var desc = require('./twi2url.description');
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

    desc.get_description(
      v.url, function(url, title, description) {
        if(!description || !title || !url) {
          console.error('Invalid data (description): ' + description);
          console.error('Invalid data (url): ' + url);
          console.error('Invalid data (title): ' + title);
        }

        var cleaned = $(description);
        $.each(
          [ 'link', 'script', 'dl' ],
          function(k,v) {
            cleaned.find(v).empty();
          });
        $.each(
          [ 'data-hatena-bookmark-layout',
            'data-hatena-bookmark-title', 'data-lang', 'data-count',
            'data-url', 'data-text', 'data-via' ],
          function(k,v) {
            cleaned.find('[' + v + ']').removeAttr(v);
          });

        twi2url_db.cache[url] = {
          title: title, description: cleaned.html(),
          'url': url, author: v.author, date: v.date
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
  while(twi2url_db.last_urls.length > config.feed_item_max) {
    twi2url_db.last_urls.shift(); }

  $.each(twi2url_db.last_urls, function(k,v) { feed.item(twi2url_db.cache[v]); });
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

    console.log('twi2url started: http://' + config.hostname + ':' + config.port + '/' + config.pathname);
    console.log('As user: ' + twi2url_db.screen_name + ' (' + twi2url_db.user_id + ')');

    twitter_api_left = true;
    backup();

    desc.set_oauth(oa);

    generate_items();
    fetch(oa);

    setInterval(function() { fetch(oa); }, config.fetch_frequency);
    setInterval(generate_items, 1000 * 30);
    setInterval(backup, 1000 * 60);
  });
