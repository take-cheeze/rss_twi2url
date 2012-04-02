module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: "electric-frost-6620.herokuapp.com",
  port: 80,
  pathname: "",
  author: "Takeshi Watanabe",

  feed_item_max: 300,

  fetch_frequency: 10 * 60 * 1000,
  item_generation_frequency: 1000 * 3,
  backup_frequency: 1000 * 30,
  timeout: 1000 * 4,

  user_agent: [
    'Mozilla/5.0',
    'RSS twi2url ( https://github.com/take-cheeze/rss_twi2url )',
    'by take-cheeze( takechi101010@gmail.com )'
  ].join(),

  exclude_filter: [
    'http://shindanmaker.com/',
  ],
};
