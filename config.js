module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: process.env.HOST || "ubuntu.local",
  port: process.env.PORT || 8090,
  author: "Takeshi Watanabe",

  feed_item_max: 300,
  photo_feed_item_max: 750,
  retry_max: 1,
  executer: 2,
  url_expander_number: 5,
  first_fetching_page_number: 2,

  long_url_length: 30,
  tweet_max: 200,
  search_max: 100,
  search_type: 'recent',

  fetch_frequency: 1000 * 60 * 15,
  item_generation_frequency: 1000 * 1.1,
  backup_frequency: 1000 * 60,
  timeout: 1000 * 20,
  check_frequency: 1000 * 30,
  retry_failure_max: 1,

  user_agent: [
    'Mozilla/5.0',
    'RSS twi2url ( https://github.com/take-cheeze/rss_twi2url )',
    'by take-cheeze( takechi101010@gmail.com )'
  ].join(),

  url_expantion_exclude: [
    'twitpic.com/',
    'gist.github.com/',
    'p.twipple.jp/',
    'ideone.com/',
    'instagr.am/p/',
    'lockerz.com/',
  ],

  exclude_filter: [
    'twitlonger.com/',
    'theinterviews.jp/',
    '/www.pixiv.net/member_illust.php',
    'live.nicovideo.jp/watch/',
    'twitcmap.jp/',
    'mb4sq.jp/',
    'animita.tv/',
    'dw.sipo.jp/',
    'dmm.co.jp/digital/videoa/',
    'caribbeancom.com/',
    'tenhou.net/',
    'b.hatena.ne.jp/',
    'mogsnap.jp/',
    'miil.me/p/',
    'florian.hatenablog.jp/',
    'av-adult-flash.com/',
    'facebook.com/login.php',
    'nikkei.com/',
    'melonbooks.co.jp/',
    'nicovideo.jp/watch/',
    '\\.tumblr.com/',
    'booklog.jp/',
    'youtube.com/',
    'youtu.be/',
    's.twipple.jp/',
    'friendfeed.com/',
    'qa-now.com/',
    'db.netkeiba.com/',
    'bgm.tv/',
    'sarupli.com/',
    'pocket.co/',
    'nico.ms/',

    '^https?://twitter.com/.+/status/\\d+$',
    /*
    'blog',
    'ameblo.jp/',
    'pic', 'photo',
    'github.com/',
     */

    'news',
    'foursquare.com/',
    '4sq.com/',
    'shindanmaker.com/',
    'wikipedia.org',
    'stickam.jp/',
    'ustream.tv/',

    'bunsekikun.com/',
    'imakoko-iphone.appspot.com/',
    'twitter.sengokudroid.com/',
    'seiga.nicovideo.jp/seiga/',
    'headlines.yahoo.co.jp/',
    'uranaitter.com/',
    '/ux.nu/',
    '/p.tl/',
    '/dqnplus/',
    'ymnn.rdy.jp/',
    'book.akahoshitakuya.com/',
    'mediamarker.net/',
    'itunes.apple.com/',
    's.installnow.jp/',
    'google.co.jp/search',
    'google.com/search',
    'slashdot.jp/',
    'blogos.com/',
    'yaraon.blog109.fc2.com/',
    'jin115.com/',
    'togetter.com/',
    'blog.esuteru.com/',
    '/matome.naver.jp/',
    'maps.google.co',
    'favstar.fm/',
    'toranoana.jp/',
    'auctions.yahoo.co.jp/',
    '/tou.ch/',
    'amazon.co',
    'paper.li/',
    'http://homepage1.nifty.com/herumi/diary/',
    '/stream.ogg',
    'gohantabeyo.com/',
    'http://4gamer.net/',
    'twilog.org/',
    'naturum.co.jp/',
    'cnn.co.jp/',
    'radiolopolis.com/'
  ]
};
