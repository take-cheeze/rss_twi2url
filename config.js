module.exports = {
  title: "twi2url",
  description: "twitter 2 url",
  hostname: "takecheeze.orz.hm",
  port: 8090,
  pathname: "",
  author: "Takeshi Watanabe",

  feed_item_max: 500,

  fetch_frequency: 10 * 60 * 1000,
  item_generation_frequency: 1000 * 2,
  backup_frequency: 1000 * 10,

  exclude_filter: [
    'ustream.tv',
    'http://shindanmaker.com/',
  ],
};
