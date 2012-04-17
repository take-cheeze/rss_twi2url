module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: "ubuntu.local",
  port: 8090,
  pathname: "",
  author: "Takeshi Watanabe",

  feed_item_max: 200,
  retry_max: 2,
  executer: 6,

  fetch_frequency: 10 * 60 * 1000,
  item_generation_frequency: 1000 * 1.0,
  backup_frequency: 1000 * 30,
  timeout: 1000 * 5,
  check_frequency: 1000 * 30,
  retry_failure_max: 3,

  user_agent: [
    'Mozilla/5.0',
    'RSS twi2url ( https://github.com/take-cheeze/rss_twi2url )',
    'by take-cheeze( takechi101010@gmail.com )'
  ].join(),

  selectors: [
    'article', '.article',
    '.POST_BODY', // exblog
    '.articleText', '.subContents', // ameblo
    '#main', '.main', '.mainmore',
    '#content', '.content', '.caption',
    '.entry-content',
    '.entry_text', '.entry-text',
    '.entry_body', '.entry-body',
    '.ently_text', '.ently-text',
    '.ently_body', '.ently-body',
    '.entry', '.body',
    'pre',
  ],
  removing_tag: [
    'link', 'script', 'dl',
    '#comment', '.comment_area', '.comment', '#comments-list',
    '.notes', '.note',
    '#more-from',
    'articleImageListArea',
  ],
  removing_attribute: [
    'data-hatena-bookmark-layout',
    'data-hatena-bookmark-title', 'data-lang', 'data-count',
    'data-url', 'data-text', 'data-via',
  ],

  exclude_filter: [
    '/www.pixiv.net/member_illust.php',
    'auctions.yahoo.co.jp/',
    '://t.co/',
    'http://shindanmaker.com/',
    'news',
    'foursquare.com/',
    '/tou.ch/',
    'amazon.co',
    'youtube.com/',
    // 'nicovideo.jp/watch/',
    'paper.li/',
    'wikipedia.org',
    'http://homepage1.nifty.com/herumi/diary/',
    '/stream.ogg',
  ],
};
