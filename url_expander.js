module.exports = function(url, cb, timeout) {
  require('request').head(
    { url: url, timeout: timeout, followAllRedirects: true },
    function(err, res) {
      var result = err? url : res.request.href;
      cb(result);
    });
};
