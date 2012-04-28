/*
 HTML Compression Options:
 * preserve-comments           Preserve comments
 * preserve-multi-spaces       Preserve multiple spaces
 * preserve-line-breaks        Preserve line breaks
 * remove-intertag-spaces      Remove intertag spaces
 * remove-quotes               Remove unneeded quotes
 * simple-doctype              Change doctype to <!DOCTYPE html>
 * remove-style-attr           Remove TYPE attribute from STYLE tags
 * remove-link-attr            Remove TYPE attribute from LINK tags
 * remove-script-attr          Remove TYPE and LANGUAGE from SCRIPT tags
 * remove-form-attr            Remove METHOD="GET" from FORM tags
 * remove-input-attr           Remove TYPE="TEXT" from INPUT tags
 * simple-bool-attr            Remove values from boolean tag attributes
 * remove-js-protocol          Remove "javascript:" from inline event handlers
 * remove-http-protocol        Remove "http:" from tag attributes
 * remove-https-protocol       Remove "https:" from tag attributes
 * remove-surrounding-spaces <min|max|all|custom_list>
                               Predefined or custom comma separated list of tags
 * compress-js                 Enable inline JavaScript compression
 * compress-css                Enable inline CSS compression using YUICompressor
 * js-compressor <yui|closure> Switch inline JavaScript compressor between
                               YUICompressor (default) and Closure Compiler

 - options is optional argument
 - callback type -> function(err, stdout, stderr) {}

 - to use this module download htmlcompressor-1.5.3.jar from
 -- http://code.google.com/p/htmlcompressor/downloads/detail?name=htmlcompressor-1.5.3.jar
 */

module.exports = function(str, options, callback) {
  if(callback === undefined) {
    callback = options;
    options = [];
  }
  else {
    var i = 0;
    for(; i < options.length; ++i) {
      if(!/^--/.test(options[i])) { options[i] = '--' + options[i]; }
    }
  }
  if(typeof callback !== 'function') { throw 'argument error'; }

  options.unshift(__dirname + '/htmlcompressor-1.5.3.jar');
  options.unshift('-jar');
  var child = require('child_process').execFile(
    'java', options,
    { cwd: process.cwd(), env: process.env, maxBuffer: 1024 * 1024 * 5 }, callback);
  child.stdin.end(str);
};
