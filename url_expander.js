var request = require('request');

function expand_url(url, cb, timeout) {
  request.head(
    { 'timeout': timeout, 'url': url },
    function(err, res) {
      cb(err? url : res.request.href);
    });
}

module.exports = expand_url;
