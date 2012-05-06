if(!process.send) { throw 'is not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments).join(' ') });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments).join(' ') });
};

var $ = require('jquery');
var htmlcompressor = require(__dirname + '/htmlcompressor.js');
var jsdom = require('jsdom');
var zlib = require('zlib');

var document = jsdom.jsdom(), window = document.createWindow();
var config = {};
var db = null;
var retry_failure_count = [];
var is_generating_feed = false;

function generate_feed(items) {
  if(is_generating_feed) { return; }

  var len = items.length, count = 0;

  var feed = new (require('rss'))(
    {
      title: config.title,
      'description': config.description,
      feed_url: 'http://' + config.hostname + ':' + config.port + '/',
      site_url: 'http://' + config.hostname + ':' + config.port + '/' + config.pathname,
      author: config.author });

  is_generating_feed = true;
  function send_feed() {
    zlib.deflateRaw(new Buffer(feed.xml(), 'utf8'), function(err, out) {
      if(err) { throw err; }
      process.send({ type: 'feed', data: out.toString('base64') });
      is_generating_feed = false;
    });

    // slow
    /*
    htmlcompressor(
      feed.xml(), function(c_err, stdout, stderr) {
        if(stderr) { console.error(stderr); }
        if(c_err) { throw c_err; }

        zlib.deflateRaw(
          stdout, function(err, out) {
            if(err) { throw err; }
            process.send({ type: 'feed', data: out.toString('base64') });
          });
      });
     */
  }

  if(len === 0) {
    send_feed();
    return;
  }

  $.each(
    items, function(idx, key) {
      db.get(key, function(err, data) {
               if(err) { throw err; }
               if(data) { feed.item(JSON.parse(data)); }
               if(++count === len) { send_feed(); }
             });
    });
}

var executer = [], next_executer = 0;

function executer_index(exe) {
  var ret = -1;
  $.each(executer, function(k, v) {
           if(v === exe) {
             ret = k;
             return false;
           }
           return undefined;
         });
  if(ret === -1) { throw 'cannot find executer'; }
  else { return ret; }
}

function create_child() {
  var ret = require('child_process')
    .fork(__dirname + '/description.js', [], { env: process.env });
  ret.send({ type: 'config', data: config });

  ret.on(
    'exit', function(code, signal) {
      var idx = executer_index(ret);
      if(executer[idx].restart) {
        executer[idx] = create_child();
        console.log('restarting executer:', idx);
      } else {
        process.exit(code, signal);
      }
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
           if(/retry count exceeded/.test(desc)) {
             var idx = executer_index(ret);
             if(++retry_failure_count[idx] >= config.retry_failure_max) {
               retry_failure_count[idx] = 0;
               executer[idx].kill();
               executer[idx].restart = true;
             }
           }

           if(!title) {
             console.error('Invalid title:', url);
             title = v.text;
           }
           if(!desc) {
             console.error('Invalid description:', url);
           }

           htmlcompressor(
             (typeof desc === 'string')? desc : '',
             function(err, stdout, stderr) {
               if(stderr) {
                 console.error('htmlcompressor error:', stderr.toString());
               }
               if(err) { throw err; }

               try {
                 var cleaned = $('<div />').html(stdout.toString());

                 $.each(config.removing_tag, function(k,v) {
                          cleaned.find(v).each(
                            function(k, elm) { elm.parentNode.removeChild(elm); }); });
                 $.each(config.removing_attribute, function(k,v) {
                          cleaned.find('[' + v + ']').removeAttr(v); });
                 cleaned.find('*').removeData();

                 if(!v.text) { throw 'invalid tweet text'; }
                 db.put(
                   url, JSON.stringify(
                     {
                       title: title,
                       description: v.text + (stdout? '<br /><br />' : '') +
                         $('<div />').append(cleaned.clone()).html(),
                       'url': url, author: v.author, date: v.date
                     }), {}, function(err) { if(err) { throw err; } });
               } catch(e) {
                 db.put(
                   url, JSON.stringify(
                     {
                       title: title,
                       description: e + '<br /><br />' +
                         v.text + (stdout? '<br /><br />' : '') + stdout.toString(),
                       'url': url, author: v.author, date: v.date
                     }), {}, function(err) { if(err) { throw err; } });
               }
             });

           process.send({ type: 'item_generated', data: url });
         }(msg.data[1], msg.data[2], msg.data[3]));
        break;

      case 'dummy': break;

      default:
        throw 'unknown message type: ' + msg.type;
      }
    });

  return ret;
}

function generate_item(v) {
  while(executer[next_executer].restart) {
    if(++next_executer >= config.executer) { next_executer = 0; }
  }
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
               retry_failure_count[k] = 0;
             });
      $.each(executer, function(k, v) {
               v.send({ type: 'config', data: config }); });
      setInterval(process.send, config.check_frequency, { type: 'dummy' });
      break;

    default:
      throw 'unknown message type: ' + msg.type;
    }
  });
