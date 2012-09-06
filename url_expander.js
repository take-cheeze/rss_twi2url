module.exports = function(url, cb, timeout) {
  var parsed_url = require('url').parse(url);
  var req =
    require('http').request({
      host: parsed_url.hostname,
      path: (parsed_url.pathname || '') + (parsed_url.search || ''),
      method: 'HEAD'
    }, function(res) {
         res.on('end', function(chunk) {
           cb((res.headers &&
               res.headers.location &&
               (res.headers.location.indexOf('http') > -1))
             ? res.headers.location : url);
         });
       });
  req.on('error', function(e) { cb(url); });
  req.end();
};
