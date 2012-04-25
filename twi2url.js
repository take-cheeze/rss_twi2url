#!/usr/bin/env node

var fs = require('fs');
var $ = require('jquery');
var fork = require('child_process').fork;
var URL = require('url');
var zlib = require('zlib');

var last_item_generation = Date.now();

var config = require(__dirname + '/config.js');
config.port = process.env.PORT || config.port;
config.hostname = process.env.HOST || config.hostname;
config.DB_FILE = process.cwd() + '/rss_twi2url.db';
var JSON_FILE = process.cwd() + '/rss_twi2url.json';

var rss_twi2url =
  require('path').existsSync(JSON_FILE)
  ? JSON.parse(fs.readFileSync(JSON_FILE))
  : { last_urls: [], queued_urls: [], since: {} };
if(require('path').existsSync(JSON_FILE + '.gz')) {
  zlib.gunzip(fs.readFileSync(JSON_FILE + '.gz'), function(err, buf) {
               if(err) { throw err; }
               rss_twi2url = JSON.parse(buf.toString());

                // reduce feed size
                while(rss_twi2url.last_urls.length > config.feed_item_max) {
                  rss_twi2url.last_urls.shift(); }
              });
}

function backup() {
  zlib.gzip(new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
              if(err) { throw err; }
              fs.writeFileSync(JSON_FILE + '.gz', buf);
            });
}
process.on(
  'exit', function() {
    backup();
  });

var twitter_api = fork(__dirname + '/twitter_api.js', [], { env: process.env });
var database = fork(__dirname + '/database.js', [], { env: process.env });
var url_expander_queue_length = 0;

function is_signed_in() {
  var check = ['oauth_token', 'oauth_token_secret',
               'user_id', 'screen_name'];
  var result = true;
  $.each(check, function(k, v) {
           if(! rss_twi2url[v]) { result = false; }
         });
  return result;
}

function in_last_urls(url) {
  var result = false;
  $.each(rss_twi2url.last_urls, function(k, v) {
           if(v === url) { result = true; } });
  return result;
}
function is_queued(url) {
  var result = false;
  $.each(rss_twi2url.queued_urls, function(k, v) {
           if(v.url === url) { result = true; } });
  return result;
}

function generate_item() {
  function match_exclude_filter(str) {
    var result = false;
    $.each(config.exclude_filter, function(k, v) {
             if((new RegExp(v)).test(str)) { result = true; } });
    return result;
  }
  while(rss_twi2url.queued_urls.length > 0) {
    var d = rss_twi2url.queued_urls.shift();
    if(! match_exclude_filter(d.url) &&
       ! in_last_urls(d.url) &&
       ! is_queued(d.url))
    {
      // console.log('start:', d.url);
      setTimeout(database.send, config.item_generation_frequency,
                 { type: 'generate_item', data: d });
      last_item_generation = Date.now();
      return;
    }
  }
}

function start() {
  require('http').createServer(
    function(req, res) {
      var accept = req.headers['accept-encoding'] || '';
      var header = {'Content-Type': 'application/rss+xml'};
      header['content-encoding'] =
        /\bgzip\b/.test(accept)? 'gzip':
        /\bdeflate\b/.test(accept)? 'deflate':
        false;
      if(!header['content-encoding']) {
        delete header['content-encoding']; }

      res.writeHead(200, header);

      var ary = rss_twi2url.last_urls.length > config.feed_item_max
        ? rss_twi2url.last_urls.slice(rss_twi2url.last_urls.length - config.feed_item_max)
        : rss_twi2url.last_urls
      ;

      console.log('RSS requested:',
                  'queued_urls.length:', rss_twi2url.queued_urls.length, ',',
                  'last_urls.length:', rss_twi2url.last_urls.length, ',',
                  'url_expander_queue.length:', url_expander_queue_length);

      database.send({ type: 'get_feed', data: ary });
      function feed_handle(msg) {
        var d = JSON.stringify(msg);
        if(msg.type === 'feed') {
          console.log('Sending feed with:', header['content-encoding']);
          switch(header['content-encoding']) {
          case 'gzip':
            res.end(new Buffer(msg.data, 'base64'));
            break;
          case 'deflate':
            (new Buffer(msg.data, 'base64'))
              .pipe(zlib.createGunzip())
              .pipe(zlib.createDeflate())
              .pipe(res);
            break;
          default:
            (new Buffer(msg.data, 'base64'))
              .pipe(zlib.createGunzip())
              .pipe(res);
            break;
          }
        }
        else { database.once('message', feed_handle); }
      }
      database.once('message', feed_handle);
    })
    .listen(config.port)
    .on('clientError', function(e) { console.error(e); });

  console.log('twi2url started: http://' + config.hostname + ':' + config.port + '/' + config.pathname);
  console.log('As user: ' + rss_twi2url.screen_name + ' (' + rss_twi2url.user_id + ')');

  backup();
  var i = 0;
  for(; i < config.executer; i++) { generate_item(); }

  zlib.gzip(new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
              if(err) { throw err; }
              twitter_api.send({ type: 'fetch', data: buf.toString('base64') });
            });

  setInterval(backup, config.backup_frequency);
  setInterval(
    function() {
      zlib.gzip(
        new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
          if(err) { throw err; }
          twitter_api.send({ type: 'fetch', data: buf.toString('base64') });
        });
    }, config.fetch_frequency);

  setInterval(function() {
                if(Date.now() - last_item_generation > config.check_frequency) {
                  var i;
                  for(i = 0; i < config.executer; ++i) { generate_item(); }
                }
              }, config.check_frequency);
}

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
      // console.log('end  :', msg.data);

      generate_item();
      break;

    case 'feed': // ignore this message
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });

function remove_utm_param(url) {
  var url_obj = URL.parse(msg.data.url, true);
  var removing_param = [];
  $.each(url_obj.query, function(k, v) {
           if(/utm_/i.test(k)) { removing_param.push(k); }
         });
  $.each(removing_param, function(idx, param) {
           delete url_obj.query[param];
         });
  return URL.format(url_obj);
}

twitter_api.on(
  'message', function(msg) {
    switch(msg.type) {
    case 'fetched_url':
      msg.data.url = require(__dirname + '/remove_utm_param')(msg.data.url);
      if(!is_queued(msg.data.url)) {
        rss_twi2url.queued_urls.push(msg.data); }
      url_expander_queue_length = msg.left;
      break;

    case 'log':
      console.log(msg.data);
      url_expander_queue_length = msg.left;
      break;
    case 'error':
      console.error(msg.data);
      url_expander_queue_length = msg.left;
      break;

    case 'set_since_id':
      rss_twi2url.since[msg.data.name] = msg.data.since_id;
      url_expander_queue_length = msg.left;
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


require('request')
  .get({uri: 'http://code.jquery.com/jquery-latest.min.js'},
       function(e, r, body) {
         if(e) { throw e; }
         config.jquery_src = body;

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
       });
