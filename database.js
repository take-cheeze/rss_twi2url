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

function generate_feed(items) {
  var len = items.length, count = 0;

  var feed = new (require('rss'))(
    {
      title: config.title,
      description: config.description,
      feed_url: 'http://' + config.hostname + ':' + config.port + '/',
      site_url: 'http://' + config.hostname + ':' + config.port + '/' + config.pathname,
      author: config.author });

  if(len == 0) {
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

var db = null;

function create_child() {
  return require('child_process')
    .fork(__dirname + '/description.js', [], { env: process.env });
}
var description = create_child();

function generate_item(v) {
  if((function(str) {
        for(k in config.exclude_filter) {
          if((new RegExp(config.exclude_filter[k])).test(str)) { return true; } }
        return false;
      })(v.url)) { return; }

  description.send({ type: 'get_description', data: v });
}

description.on(
  'exit', function(code, signal) {
    if(code && signal) { console.error('signal from description.js:', signal); }

    description = create_child();
  });

description.on(
  'message', function(msg) {
    if(msg.data === undefined) { throw 'empty data in message: ' + msg.type; }

    switch(msg.type) {
    case 'got_description':
      var v = msg.data[0];
      (function(url, title, description) {
         if(!title) {
           console.error('Invalid title:', title);
           console.error('URL:', url);
           title = url;
         }
         if(!description) {
           if(description === null) { console.trace(); }
           console.error('Invalid description:', description);
           console.error('URL:', url);
           description = 'empty description';
         }

         var cleaned = $('<div />').html(description);

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
       })(msg.data[1], msg.data[2], msg.data[3]);
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });

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
      db = new (require('leveldb').DB);
      db.open(
        config.DB_FILE, { create_if_missing: true }, function(err) {
          if(err) throw err;
        });
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
