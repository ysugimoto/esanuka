module.exports = prefix => {
  return (...message) => {
    if (!process.env.ESANUKA_DEBUG) {
      return;
    }
    console.log(`[${prefix}] `, ...message);
  };
};
