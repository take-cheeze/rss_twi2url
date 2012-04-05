module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: "ubuntu.local",
  port: 8090,
  pathname: "",
  author: "Takeshi Watanabe",

  feed_item_max: 200,
  retry_max: 2,
  executer: 4,

  fetch_frequency: 10 * 60 * 1000,
  item_generation_frequency: 1000 * 0.5,
  backup_frequency: 1000 * 30,
  timeout: 1000 * 5,
  check_frequency: 1000 * 30,

  user_agent: [
    'Mozilla/5.0',
    'RSS twi2url ( https://github.com/take-cheeze/rss_twi2url )',
    'by take-cheeze( takechi101010@gmail.com )'
  ].join(),

  exclude_filter: [
    'http://shindanmaker.com/',
    'news',
    'foursquare.com/',
    /*
     'amazon.co',
     'youtube.com/watch',
     'nicovideo.jp/watch/',
     */
    'paper.li/',
    'wikipedia.org',
    '/stream.ogg',
  ],
};
