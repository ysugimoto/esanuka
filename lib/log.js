const { getStore } = require('./util.js');

module.exports = prefix => {
  return (...message) => {
    if (!getStore('verbose')) {
      return
    }
    console.log(`[${prefix}] `, ...message);
  };
};
