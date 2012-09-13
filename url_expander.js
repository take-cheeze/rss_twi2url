function expand_url(url, cb, timeout) {
  var parsed_url = require('url').parse(url);
  var req =
    require('http').request({
      host: parsed_url.hostname,
      path: (parsed_url.pathname || '') + (parsed_url.search || ''),
      method: 'HEAD'
    }, function(res) {
         res.on('error', function(e) { cb(url); });
         res.socket.on('error', function(e) { cb(url); });

         res.on('end', function(chunk) {
           var result = (res.headers &&
                         res.headers.location &&
                         (res.headers.location.indexOf('http') > -1))
                      ? res.headers.location : url;
           cb(result);
         });
       });
  req.on('error', function(e) { cb(url); });
  req.end();
}

module.exports = expand_url;
