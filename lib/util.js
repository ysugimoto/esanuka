const { detailedDiff } = require('deep-object-diff');

const _makePatch = (diff, op, patchFields, prefix = '/', nested = false) => {
  return Object.keys(diff).reduce((prev, next) => {
    if (!nested && !patchFields.includes(next)) {
      return prev;
    }
    if (diff[next] === null || diff[next] === void 0) {
      prev.push(Object.assign({
        op,
        path: `${prefix}${next}`
      }, op === 'remove' ? {} : { value: '' }));
      return prev;
    }
    const t = typeof diff[next];
    if (t === 'string' || t === 'number' || t === 'boolean') {
      prev.push(Object.assign({
        op,
        path: `${prefix}${next}`
      }, op === 'remove' ? {} : { value: diff[next].toString() }));
    } else {
      prev.push(..._makePatch(diff[next], op, patchFields, `${prefix}${next}/`, true));
    }
    return prev;
  }, []);
}

const patchOperation = (local, remote, patchFields = []) => {
  const diff = detailedDiff(remote, local);
  if (
    Object.keys(diff.added).length === 0 &&
    Object.keys(diff.updated).length === 0 &&
    Object.keys(diff.deleted).length === 0
  ) {
    return null;
  }
  const patch = [].concat([],
    _makePatch(diff.added, 'add', patchFields),
    _makePatch(diff.updated, 'replace', patchFields),
    _makePatch(diff.deleted, 'remove', patchFields)
  );
  return patch.length > 0 ? patch : null;
};

const storedObject = Object.create(null);

const setStore = (key, val) => {
  storedObject[key] = val;
};

const getStore = (key, defaultValue = null) => {
  return (key in storedObject) ? storedObject[key] : defaultValue;
};

const purgeStore = () => {
  Object.keys(storedObject).forEach(key => {
    delete storedObject[key];
  });
};

const isDryrun = () => Boolean(getStore('dryRun', false));
const wait = (timeout = 1) => {
  return new Promise(resolve => {
    setTimeout(resolve, timeout * 1000);
  });
};

module.exports = {
  patchOperation,
  setStore,
  getStore,
  purgeStore,
  isDryrun,
  wait
};
