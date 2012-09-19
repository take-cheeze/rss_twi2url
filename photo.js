var
    jsdom = require('jsdom')
  , $ = require('jquery')
;

var document = jsdom.jsdom(), window = document.createWindow();

function image_tag(v, width, height) {
  if(!v) {
    return 'empty url in image tag';
  }
  var ret = $('<img />').attr('src', v);
  if(width) { ret.attr('width', width); }
  if(height) { ret.attr('height', height); }
  return $('<div />').append(ret).html();
}

var photo_filter = {
  '://photozou.jp/photo/\\w+/(\\d+)/(\\d+)$': function(url) {
    var id = url.match(/:\/\/photozou.jp\/photo\/\w+\/(\d+)\/(\d+)/)[2];
    return $('<div />').append(
      $('<a />').attr('href', url.replace('show', 'photo_only')).append(
        image_tag('http://photozou.jp/p/img/' + id))).html();
  },

  '://yfrog\\.com/(\\w+)/?': function(url) {
    var id = url.match(/:\/\/yfrog\.com\/(\w+)\/?/)[1];
    return $('<div />').append(
      $('<a />').attr('href', 'http://yfrog.com/z/' + id).append(
        image_tag('http://yfrog.com/' + id + ':medium'))).html();
  },

  '://twitter\\.yfrog\\.com/(\\w+)/?': function(url) {
    var id = url.match(/:\/\/twitter\.yfrog\.com\/(\w+)\/?/)[1];
    return $('<div />').append(
      $('<a />').attr('href', 'http://twitter.yfrog.com/z/' + id).append(
        image_tag('http://yfrog.com/' + id + ':medium'))).html();
  },

  '://instagr.am/p/[\\-\\w_]+/?$': function(url) {
    var id = url.match(/:\/\/instagr.am\/p\/([\-\w_]+)\/?$/)[1];
    return image_tag('http://instagr.am/p/' + id + '/media/?size=l');
  },

  '://imgur.com/\\w+$': function(url) {
    var id = url.match(/:\/\/imgur.com\/(\w+)$/)[1];
    return image_tag('http://i.imgur.com/' + id + '.jpg');
  },

  '://moby.to/\\w+$': function(url) {
    var id = url.match(/:\/\/moby.to\/(\w+)$/)[1];
    return image_tag('http://moby.to/' + id + ':full');
  },

  '://tuna.be/t/\\w+$': function(url) {
    var id = url.match(/:\/\/tuna.be\/t\/(\w+)$/)[1];
    return image_tag('http://tuna.be/show/thumb/' + id + ':full');
  },

  '://lockerz.com/s/\\d+$': function(url) {
    return image_tag('http://api.plixi.com/api/tpapi.svc/imagefromurl?' +
                     $.param({ size: 'big', 'url': url }));
  },

  '://img.ly/\\w+$': function(url) {
    var id = url.match(/:\/\/img.ly\/(\w+)$/)[1];
    return $('<div />').append(
      $('<a />').attr('href', 'http://img.ly/images/' + id + '/full').append(
        image_tag('http://img.ly/show/full/' + id))).html();
  },

  '://ow.ly/i/\\w+': function(url) {
    var id = url.match(/:\/\/ow.ly\/i\/(\w+)/)[1];
    return image_tag('http://static.ow.ly/photos/normal/' + id + '.jpg');
  },

  '://twitpic\\.com/(\\w+)(/full)?/?': function(url) {
    var id = url.match(/:\/\/twitpic.com\/(\w+)(\/full)?\/?/)[1];
    return $('<div />').append(
      $('<a />').attr('href', 'http://twitpic.com/' + id + '/full').append(
        image_tag('http://twitpic.com/show/large/' + id))).html();
  },

  '://p.twipple.jp/\\w+/?$': function(url) {
    var id = url.match(/:\/\/p.twipple.jp\/(\w+)\/?$/)[1];
    return image_tag('http://p.twpl.jp/show/orig/' + id);
  },

  '://movapic.com/pic/\\w+$': function(url) {
    return image_tag(url.replace(
      /http:\/\/movapic.com\/pic\/(\w+)/,
      'http://image.movapic.com/pic/m_$1.jpeg'));
  },

  '://layercloud.net/items/detail_top/\\d+$': function(url) {
    var id = url.match(/:\/\/layercloud.net\/items\/detail_top\/(\d+)$/)[1];
    return image_tag('http://layercloud.net/img/items/(' + id + '.jpg');
  },

  '://seiga.nicovideo.jp/seiga/im\\d+': function(url) {
    var id = url.match(/\/seiga\/im(\d+)/)[1];
    return image_tag('http://lohas.nicoseiga.jp/thumb/' + id + 'i.jpg');
  },

  '://gyazo.com/\\w+$': function(url) { return image_tag(url + '.png'); }
};

module.exports = {
  'is_photo': function(url) {
    var result = false;
    $.each(photo_filter, function(k,v) {
      if((new RegExp(k)).test(url)) {
        result = true;
        return false;
      } else { return undefined; }
    });
    return result;
  },

  'photo_tag': function(url) {
    var result = false;
    $.each(photo_filter, function(k,v) {
      if((new RegExp(k)).test(url)) {
        result = v(url);
        return false;
      } else { return undefined; }
    });
    return result;
  }
};
