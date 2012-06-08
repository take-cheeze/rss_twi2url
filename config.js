module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: process.env.HOST || "ubuntu.local",
  port: process.env.PORT || 8090,
  pathname: "",
  author: "Takeshi Watanabe",

  feed_item_max: 300,
  retry_max: 1,
  executer: 1,
  url_expander_number: 10,

  long_url_length: 30,
  tweet_max: 200,
  search_max: 100,
  search_type: 'recent',

  fetch_frequency: 1000 * 60 * 20,
  item_generation_frequency: 1000 * 1.1,
  backup_frequency: 1000 * 60,
  timeout: 1000 * 7.5,
  check_frequency: 1000 * 60,
  retry_failure_max: 1,

  user_agent: [
    'Mozilla/5.0',
    'RSS twi2url ( https://github.com/take-cheeze/rss_twi2url )',
    'by take-cheeze( takechi101010@gmail.com )'
  ].join(),

  selectors: [
    'article', '.article', '.article-body',
    '.POST_BODY', '.post', // exblog
    '.articleText', '.subContents', // ameblo
    '.viewbody', // tinami
    '#foto-body', // hatena photo
    '.foto_thumb', // hatena photo gallery
    '#q_back1', // nazolab
    '.kiji-column-main', // ura-akiba
    '.EntryText',
    '.section', // hatena diary
    '.archive', // drawtwit
    '.thread', // 2ch
    '.thread_body', // nanbbs
    '#main', '.main', '.mainmore', '.blogbody',
    '#content', '.content', '.caption',
    '.mainEntryBody',
    '.entry-content', // hatenablog
    '.entry_text', '.entry-text',
    '.entry_body', '.entry-body',
    '.ently_text', '.ently-text',
    '.ently_body', '.ently-body',
    '.entry', '#entry', '.body',
    '#posts', '.Photo',
    '.Text',
    'pre', 'table',
    '[istex="istex"]',
    'body:first-child'
  ],

  removing_tag: [
    'link', 'script', 'dl', 'object', 'style', 'input',
    'frameset', 'frame', 'noframes', 'title', 'form',
    'embed', 'meta',
    '#comment', '.comment_area', '.comment', '#comments-list',
    '.comments', '#comment-form', '#comment_post', '#comment_preview',
    '#comment_form_table',
    '.entryInfoList',
    '.notes', '.note', '#menu',
    '#imageBox',
    '#more-from',
    '#post-tabs', '.post-meta',
    '.related-articles',
    '.pagenav-outer',
    '#sub', '.side',
    '.tweetBtn1201',
    '.appstore',
    'img[src^="http://stat.ameba.jp/blog/ucs/img/char/"]', // ameblo emoji
    'img[src^="http://parts.blog.livedoor.jp/img/emoji/2/"]', // livedoor emoji
    '.content_footer'
  ],

  removing_attribute: [
    /*
    'pubdate',
    'onclick', 'onmouseover', 'onmouseout', 'illustrations',
    'by', 'cesar', 'onkeypress', 'onsubmit', 'onkeydown',
    'onblur', 'onfocus', 'onkeyup', 'role',
    'columnguid', 'rodrez',
    'preview-capable-text', 'more-text',
    'metrics-loc', 'num-items', 'rating-software',
    'parental-rating', 'adam-id', 'preview-artist',
    'aria-label', 'preview-title', 'columnid',
    'state', 'border_color', 'padding',
    'border_width', 'boder_type', 'onchange'
     */
  ],

  url_expantion_exclude: [
    'twitpic.com/',
    'gist.github.com/',
    'p.twipple.jp/',
    'ideone.com/',
    'instagr.am/p/',
    'lockerz.com/',
  ],

  exclude_filter: [
    '^https?://twitter.com/.+/status/\\d+$',
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

    /*
    'nicovideo.jp/watch/',
    'booklog.jp/',
    '\\.tumblr.com/',
    'blog',
    'ameblo.jp/',
    'pic', 'photo',
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
    'youtube.com/',
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
