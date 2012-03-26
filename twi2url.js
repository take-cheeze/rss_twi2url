#!/usr/bin/env node

var fs = require('fs');
var $ = require('jquery');
var fork = require('child_process').fork;
var URL = require('url');

var config = require(__dirname + '/config.js');

config.DB_FILE = process.cwd() + '/rss_twi2url.db';
var JSON_FILE = process.cwd() + '/rss_twi2url.json';

var rss_twi2url = require('path').existsSync(JSON_FILE)
  ? JSON.parse(fs.readFileSync(JSON_FILE))
  : { last_urls: [], queued_urls: [], since: {} };

function backup() {
  fs.writeFileSync(JSON_FILE, JSON.stringify(rss_twi2url));
}
process.on('exit', function() { backup(); });

function is_signed_in() {
  var check = ['oauth_token', 'oauth_token_secret', 'user_id', 'screen_name'];
  for(i in check) {
    if(!(check[i] in rss_twi2url)) return false;
  }
  return true;
}

function in_last_urls(url) {
  for(i in rss_twi2url.last_urls) {
    if(rss_twi2url.last_urls[i] === url) { return true; } }
  return false;
}
function is_queued(url) {
  for(i in rss_twi2url.queued_urls) {
    if(rss_twi2url.queued_urls[i].url === url) { return true; } }
  return false;
}

function start() {
  require('http').createServer(
    function(req, res) {
      res.writeHead(200, {'Content-Type': 'application/rss+xml'});

      // reduce feed size
      while(rss_twi2url.last_urls.length > config.feed_item_max) {
        rss_twi2url.last_urls.shift(); }

      console.log('RSS requested:',
                  'queued_urls.length:', rss_twi2url.queued_urls.length,
                  'last_urls.length:', rss_twi2url.last_urls.length);

      database.send({ type: 'get_feed', data: rss_twi2url.last_urls });
      function feed_handle(msg) {
        var d = JSON.stringify(msg);
        if(msg.type === 'feed') { res.end(msg.data); }
        else { database.once('message', feed_handle); }
      }
      database.once('message', feed_handle);
    })
    .listen(config.port)
    .on('clientError', function(e) { console.error(e); });

  console.log('twi2url started: http://' + config.hostname + ':' + config.port + '/' + config.pathname);
  console.log('As user: ' + rss_twi2url.screen_name + ' (' + rss_twi2url.user_id + ')');

  backup();

  twitter_api.send({ type: 'fetch', data: rss_twi2url });

  setInterval(backup, config.backup_frequency);
  setInterval(
    function() {
      while(rss_twi2url.queued_urls.length > 0) {
        var d = rss_twi2url.queued_urls.shift();
        if(in_last_urls(d.url) || is_queued(d.url)) { continue; }

        database.send({ type: 'generate_item', data: d });
        break;
      }
    }, config.item_generation_frequency);
  setInterval(twitter_api.send, config.fetch_frequency,
              { type: 'fetch', data: rss_twi2url });
}


var database = fork(__dirname + '/database.js', [], { env: process.env });
database.on(
  'message', function(msg) {
    switch(msg.type) {
    case 'log':
      console.log(msg.data);
      break;
    case 'error':
      console.error(msg.data);
      break;

    case 'item_generated':
      if(!in_last_urls(msg.data))
      { rss_twi2url.last_urls.push(msg.data); }
      break;

    case 'feed': // ignore this message
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });

var twitter_api = fork(__dirname + '/twitter_api.js', [], { env: process.env });
twitter_api.on(
  'message', function(msg) {
    switch(msg.type) {
    case 'fetched_url':
      var url_obj = URL.parse(msg.data.url, true);
      var removing_param = [];
      $.each(url_obj.query, function(k, v) {
               /utm_/i.test(k) && removing_param.push(k);
             });
      $.each(removing_param, function(idx, param) {
               delete url_obj.query[param];
             });
      msg.data.url = URL.format(url_obj);
      if(!is_queued(msg.data.url)) {
        rss_twi2url.queued_urls.push(msg.data); }
      break;

    case 'log':
      console.log(msg.data);
      break;
    case 'error':
      console.error(msg.data);
      break;

    case 'request_pin':
      var i = require('readline').createInterface(process.stdin, process.stdout, null);
      i.question(
        'Enter pin number: ', function(pin) {
          i.close();
          twitter_api.send({ type: 'return_pin', data: pin });
        });
      break;

    case 'set_since_id':
      rss_twi2url[msg.data.name] = msg.data.since_id;
      break;

    case 'signed_in':
      console.log('Authorized!');
      $.each(
        ['oauth_token', 'oauth_token_secret', 'user_id', 'screen_name'], function(k,v) {
          rss_twi2url[v] = msg.data[v];
        });
      start();
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });

$.each(
  [twitter_api, database], function(K,v) {
    v.on('exit', function(code, signal) {
           if(code) {
             if(signal) { console.error('with signal:', signal); }
             process.exit(code, signal);
           }
         });
    v.send({ type: 'config', data: config });
  });

twitter_api.send({ type: 'signin', data: is_signed_in()? rss_twi2url : null });
