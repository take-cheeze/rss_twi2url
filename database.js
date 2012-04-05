if(!process.send) { throw 'is not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments).join(' ') });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments).join(' ') });
};

var $ = require('jquery');
var jsdom = require('jsdom');

var document = jsdom.jsdom(), window = document.createWindow();
var config = {};
var db = null;

function generate_feed(items) {
  var len = items.length, count = 0;

  var feed = new (require('rss'))(
    {
      title: config.title,
      'description': config.description,
      feed_url: 'http://' + config.hostname + ':' + config.port + '/',
      site_url: 'http://' + config.hostname + ':' + config.port + '/' + config.pathname,
      author: config.author });

  if(len === 0) {
    process.send({ type: 'feed', data: feed.xml() });
    return;
  }

  $.each(
    items, function(idx, key) {
      db.get(key, function(err, data) {
               if(err) { throw err; }
               
               feed.item(JSON.parse(data));
               if(++count === len) {
                 process.send({ type: 'feed', data: feed.xml() });
               }
             });
    });
}

function create_child() {
  var ret = require('child_process')
    .fork(__dirname + '/description.js', [], { env: process.env });
  ret.send({ type: 'config', data: config });

  ret.on(
    'exit', function(code, signal) {
      process.exit(code, signal);
    });

  ret.on(
    'message', function(msg) {
      if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

      switch(msg.type) {
      case 'log':
        console.log(msg.data);
        break;
      case 'error':
        console.error(msg.data);
        break;

      case 'got_description':
        var v = msg.data[0];
        (function(url, title, desc) {
           if(!title) {
             console.error('Invalid title:', url);
             title = url;
           }
           if(!desc) {
             console.error('Invalid description:', url);
             desc = 'empty description';
           }

           var cleaned = $('<div />').html(desc);

           $.each(
             [ 'link', 'script', 'dl' ],
             function(k,v) { cleaned.find(v).empty(); });

           $.each(
             [ 'data-hatena-bookmark-layout',
               'data-hatena-bookmark-title', 'data-lang', 'data-count',
               'data-url', 'data-text', 'data-via' ],
             function(k,v) {
               cleaned.find('[' + v + ']').removeAttr(v);
             });

           db.put(
             url, JSON.stringify(
               {
                 title: title, description: $('<div />').append(cleaned.clone()).html(),
                 'url': url, author: v.author, date: v.date
               }), {}, function(err) { if(err) { throw err; } });

           process.send({ type: 'item_generated', data: url });
         }(msg.data[1], msg.data[2], msg.data[3]));
        break;

      default:
        throw 'unknown message type: ' + msg.type;
      }
    });

  return ret;
}

var executer = [], next_executer = 0;

function generate_item(v) {
  executer[next_executer++].send({ type: 'get_description', data: v });
  if(next_executer >= config.executer) { next_executer = 0; }
}

process.on(
  'message', function(msg) {
    if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

    switch(msg.type) {
    case 'generate_item':
      generate_item(msg.data);
      break;

    case 'get_feed':
      generate_feed(msg.data);
      break;

    case 'config':
      config = msg.data;
      db = new (require('leveldb').DB)();
      db.open(
        config.DB_FILE, { create_if_missing: true }, function(err) {
          if(err) { throw err; }
        });
      executer[config.executer - 1] = undefined;
      $.each(executer, function(k, v) {
               executer[k] = create_child();
             });
      $.each(executer, function(k, v) {
               v.send({ type: 'config', data: config }); });
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
