if(!process.send) { throw 'not forked'; }

console.log = function() {
  process.send({ type: 'log', data: Array.prototype.slice.call(arguments) });
};
console.error = function() {
  process.send({ type: 'error', data: Array.prototype.slice.call(arguments)});
};

var request = require('request');

var MAX_REDIRECTS = 3, config = null;

function expand_url(u, cb) {
  request.head(
    { url: u, maxRedirects: MAX_REDIRECTS, timeout: config.timeout },
    function(err, res) {
      cb((err? u : res.request.href) || u);
    });
}

process.on('message', function(m) {
  if(!m.type) { throw 'no message type'; }
  if(!m.data) { throw 'no data'; }

  switch(m.type) {
    case 'expand_url':
    expand_url(m.data, function(res) {
      process.send({ type: 'expanded', data: { original: m.data, result: res} });
    });
    break;

    case 'config':
    config = m.data;
    break;

    default:
    throw 'unknown message type';
  }
});
