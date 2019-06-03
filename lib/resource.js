const { apigateway } = require('./aws.js');
const { generateAuthorizers } = require('./authorizer.js');
const { generateMethods } = require('./method.js');
const { isDryrun, wait } = require('./util.js');
const logger = require('./log.js')('resource');

const generateBinaryTypes = async restApiId => {
  const input = {
    restApiId,
    patchOperations: [{
      op: 'add',
      path: '/binaryMediaTypes/*~1*'
    }]
  };
  if (isDryrun()) {
    return logger('update binary types', input);
  }
  await apigateway.updateRestApi(input).promise();
  await wait();
};

const findOrCreateParentResourceId = async (restApiId, endpoint, remote) => {
  // always exists '/' of root path
  const root = remote['/'];
  let parentId = root.id;
  await endpoint.split('/').filter(p => p).reduce(async (prev, next) => {
    const p = await prev;
    const path = `${p === '/' ? '' : p}/${next}`;
    if (!remote.hasOwnProperty(path)) {
      const input = { parentId, restApiId, pathPart: next };
      if (isDryrun()) {
        logger(`Create new resource: ${path}`, input);
        parentId = 'dry-run';
      } else {
        const resp = await apigateway.createResouce(input);
        await wait();
        parentId = resp.id;
      }
    } else {
      parentId = remote[path].id;
    }
    return path;
  }, '/');
  return parentId;
};

const generateResources = async (restApiId, definition, remote) => {
  // Merge and create authorizer
  const authorizers = await generateAuthorizers(restApiId, definition.authorizers || {});

  // Generate response binary types for API if user wants to be enable
  if (definition.enableBinary) {
    await generateBinaryTypes(restApiId);
  }

  // generate resources recursively
  const resources = definition.resources.sort((a, b) => {
    const aa = a.path.split('/').filter(p => p);
    const bb = b.path.split('/').filter(p => p);
    return aa.length > bb.length ? 1 : -1;
  });
  await Promise.all(resources.map(async resource => {
    const path = resource.path === '/' ? '/' : resource.path.replace(/\/$/, '');
    // check remote resource already exists
    if (!remote.hasOwnProperty(path)) {
      // get or create resource
      const id = await findOrCreateParentResourceId(restApiId, path, remote);
      remote[path] = {
        id,
        resource: { restApiId },
        methods: {}
      };
    }
    const remoteResource = remote[path];
    console.log(`\n==================== process for path: ${path} =====================`);
    await generateMethods(resource, remoteResource, authorizers);
    await wait();
  }));
};

module.exports = {
  generateResources
};
