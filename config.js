module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: "ubuntu.local",
  port: 8090,
  pathname: "",
  author: "Takeshi Watanabe",

  feed_item_max: 100,
  retry_max: 2,
  executer: 2,
  url_expander_number: 5,

  long_url_length: 40,
  tweet_max: 200,

  fetch_frequency: 1000 * 60 * 30,
  item_generation_frequency: 1000 * 0.5,
  backup_frequency: 1000 * 60,
  timeout: 1000 * 2,
  check_frequency: 1000 * 10,
  retry_failure_max: 3,

  user_agent: [
    'Mozilla/5.0',
    'RSS twi2url ( https://github.com/take-cheeze/rss_twi2url )',
    'by take-cheeze( takechi101010@gmail.com )'
  ].join(),

  selectors: [
    'article', '.article', '.article-body',
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
    '.Photo',
    'table', 'pre', 'body',
  ],

  removing_tag: [
    'link', 'script', 'dl',
    '#comment', '.comment_area', '.comment', '#comments-list',
    '.comments', '#comment-form',
    '.notes', '.note',
    '#imageBox',
    '#more-from',
    '#post-tabs', '.post-meta',
    '.related-articles',
    '.pagenav-outer',
  ],

  removing_attribute: [
/*
    'data-hatena-bookmark-layout',
    'data-hatena-bookmark-title', 'data-lang', 'data-count',
    'data-url', 'data-text', 'data-via',
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
    '/www.pixiv.net/member_illust.php',
    'auctions.yahoo.co.jp/',
    '://t.co/',
    'shindanmaker.com/',
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
    'gohantabeyo.com/',
    'http://4gamer.net/',
    'http://bit.ly/',
  ],
};
