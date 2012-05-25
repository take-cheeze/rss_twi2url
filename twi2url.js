#!/usr/bin/env node

var BufferStream = require('bufferstream');
var fs = require('fs');
var $ = require('jquery');
var fork = require('child_process').fork;
var URL = require('url');
var zlib = require('zlib');

var last_item_generation = Date.now();

var config = require(__dirname + '/config.js');
config.DB_FILE = process.cwd() + '/rss_twi2url.db';
config.feed_url = 'http://' + config.hostname
                + (/\.herokuapp.com/.test(config.hostname)? '' : ':' + config.port)
                + '/' + config.pathname;
var JSON_FILE = process.cwd() + '/rss_twi2url.json';
var url_expander_queue_length = 0;
var start, database, twitter_api;

function match_exclude_filter(str) {
  var result = false;
  $.each(config.exclude_filter, function(k, v) {
    if((new RegExp(v)).test(str)) { result = true; } });
  return result;
}

var rss_twi2url =
  require('path').existsSync(JSON_FILE)
  ? JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'))
  : { last_urls: [], queued_urls: [], since: {}, generating_items: {} };
if(require('path').existsSync(JSON_FILE + '.gz')) {
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

function backup() {
  zlib.gzip(new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
    if(err) { throw err; }
    fs.writeFileSync(JSON_FILE + '.gz', buf);
  });
}
process.on('exit', function() { backup(); });

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
  while(rss_twi2url.queued_urls.length > 0) {
    var d = rss_twi2url.queued_urls.shift();
    if(! match_exclude_filter(d.url) &&
       ! in_last_urls(d.url) &&
       ! is_queued(d.url))
    {
      // console.log('start:', d.url);
      setTimeout(database.send, config.item_generation_frequency,
                 { type: 'generate_item', data: d });
      rss_twi2url.generating_items[d.url] = d;
      last_item_generation = Date.now();
      return;
    }
  }
}

function create_database() {
  var ret = fork(__dirname + '/database.js', [], { env: process.env });

  ret.on('message', function(msg) {
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

      delete rss_twi2url.generating_items[msg.data];

      generate_item();
      break;

      case 'feed': // ignore this message
      break;

      case 'dummy': break;

      default:
      throw 'unknown message type: ' + msg.type;
    }
  });

  return ret;
}

function create_twitter_api() {
  var ret = fork(__dirname + '/twitter_api.js', [], { env: process.env });

  ret.on('message', function(msg) {
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
      $.each(['oauth_token', 'oauth_token_secret', 'user_id', 'screen_name'],
             function(k,v) {
               rss_twi2url[v] = msg.data[v];
             });
      start();

      break;

      case 'dummy': break;

      default:
      throw 'unknown message type: ' + msg.type;
    }
  });

  return ret;
}

function is_signed_in() {
  var check = [
    'oauth_token', 'oauth_token_secret',
    'user_id', 'screen_name'];
  var result = true;
  $.each(check, function(k, v) {
    if(! rss_twi2url[v]) { result = false; }
  });
  return result;
}

function send_config() {
  $.each([twitter_api, database], function(k, v) {
    v.send({ type: 'config', data: config });
  });
}

start = function() {
  require('http').createServer(function(req, res) {
    if(req.url !== '/') {
      console.log('not rss request:', req.url);
      res.writeHead(404, {'content-type': 'plain'});
      res.end(config.title + '(by ' + config.author + ') : ' + config.description);
      return;
    }

    var accept = req.headers['accept-encoding'] || '';
    var header = {'content-type': 'application/rss+xml'};
    header['content-encoding'] =
                /\bdeflate\b/.test(accept)? 'deflate':
                /\bgzip\b/.test(accept)? 'gzip':
      false;
    if(!header['content-encoding']) {
      delete header['content-encoding']; }

    var ary = (rss_twi2url.last_urls.length > config.feed_item_max)
            ? rss_twi2url.last_urls.slice(rss_twi2url.last_urls.length - config.feed_item_max)
            : rss_twi2url.last_urls;

    function count_map_element(map) {
      var ret = 0;
      $.each(map, function(k, v) {
        ret++;
      });
      return ret;
    }
    console.log('Request:', req.headers);
    console.log('RSS requested:'
               , 'queued_urls.length:', rss_twi2url.queued_urls.length, ','
               , 'last_urls.length:', rss_twi2url.last_urls.length, ','
               , 'url_expander_queue.length:', url_expander_queue_length, ','
               , 'generating_items.length:', count_map_element(rss_twi2url.generating_items), ','
               );

    var gen_timeout = false;
    var gen_timeout_handle =
      setTimeout(function() {
        gen_timeout = true;
        console.log('feed generation timed out');
        delete header['content-encoding'];
        header['content-type'] = 'plain';

        res.writeHead(503, header);
        res.end('feed generation timed out');

        console.log('restarting database');
        database.kill();
        if(require('path').existsSync(config.DB_FILE + '/LOCK')) {
          fs.unlinkSync(config.DB_FILE + '/LOCK');
        }
        database = create_database();
        send_config();
      }, config.timeout);

    database.send({ type: 'get_feed', data: ary });
    function feed_handle(msg) {
      if(gen_timeout) {
        return;
      } else {
        clearTimeout(gen_timeout_handle);
      }

      var d = JSON.stringify(msg);
      if(msg.type === 'feed') {
        console.log('Sending feed with:', header.hasOwnProperty('content-encoding')
                                        ? header['content-encoding'] : 'plain');
        var buf_stream = new BufferStream();
        switch(header.hasOwnProperty('content-encoding')
              ? header['content-encoding'] : false)
        {
          case 'gzip':
          buf_stream
          .pipe(zlib.createInflateRaw())
          .pipe(zlib.createGzip())
          .pipe(res);
          break;

          case 'deflate':
          buf_stream
          .pipe(res);
          break;

          default:
          buf_stream
          .pipe(zlib.createInflateRaw())
          .pipe(res);
          break;
        }
        res.writeHead(200, header);
        buf_stream.end(msg.data, 'base64');
      }
      else { database.once('message', feed_handle); }
    }
    database.once('message', feed_handle);

    $.each(rss_twi2url.generating_items, function(k, v) {
      rss_twi2url.queued_urls.unshift(v);
    });
    rss_twi2url.generating_items = {};
  })
  .listen(config.port)
  .on('clientError', function(e) { console.error(e); });

  console.log('twi2url started: ' + config.feed_url);
  console.log('As user: ' + rss_twi2url.screen_name + ' (' + rss_twi2url.user_id + ')');

  backup();
  setTimeout(function() {
    var i = 0;
    for(; i < config.executer; i++) { generate_item(); }
  }, config.item_generation_frequency);

  zlib.deflateRaw(new Buffer(JSON.stringify(rss_twi2url)), function(err, buf) {
    if(err) { throw err; }
    twitter_api.send({ type: 'fetch', data: buf.toString('base64') });
  });

  setInterval(backup, config.backup_frequency);
  setInterval(function() {
    zlib.deflateRaw(
      new Buffer(JSON.stringify(rss_twi2url)),
      function(err, buf) {
        if(err) { throw err; }
        twitter_api.send({ type: 'fetch', data: buf.toString('base64') });
      });
  }, config.fetch_frequency);

  setInterval(function() {
    if((Date.now() - last_item_generation) > config.check_frequency) {
      var i = 0;
      for(; i < config.executer; ++i) { generate_item(); }
    }
  }, config.check_frequency);
};

require('request')
.get({uri: 'http://code.jquery.com/jquery-latest.min.js'}, function(e, r, body) {
  if(e) { throw e; }
  config.jquery_src = body;

  twitter_api = create_twitter_api();
  database = create_database();

  send_config();
  twitter_api.send({ type: 'signin', data: is_signed_in()? rss_twi2url : null });
});
