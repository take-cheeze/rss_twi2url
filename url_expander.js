var request = require('request');

var MAX_REDIRECTS = 5;

function expand_url(url, cb, timeout) {
  request.head(
    { 'timeout': timeout, 'url': url, maxRedirects: MAX_REDIRECTS },
    function(err, res) {
      cb((err? url : res.request.href) || url);
    });
}

module.exports = expand_url;
