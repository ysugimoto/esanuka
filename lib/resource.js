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
  logger('update binary types', input);
  if (!isDryrun()) {
    await apigateway.updateRestApi(input).promise();
    await wait();
  }
};

const findOrCreateResource = async (restApiId, endpoint, remote) => {
  // always exists '/' of root path
  const root = remote['/'];
  let parentId = root.id;
  let resource = root;
  await endpoint.split('/').filter(p => p).reduce(async (prev, next) => {
    const p = await prev;
    const path = `${p === '/' ? '' : p}/${next}`;
    if (!remote.hasOwnProperty(path)) {
      const input = { parentId, restApiId, pathPart: next };
      logger(`Create new resource: ${path}`, input);
      if (isDryrun()) {
        parentId = 'dry-run';
      } else {
        const resp = await apigateway.createResource(input);
        await wait();
        resource = {
          id: resp.Id,
          resource: Object.assign({}, input)
        }
        parentId = resp.id;
      }
    } else {
      resource = remote[path];
      parentId = remote[path].id;
    }
    return path;
  }, '/');
  return resource;
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

  // Need to do "ordered" promise, should not parallel it.
  // Otherwise, API call rate limit reaches immediately.
  for (let i = 0; i < resources.length; ++i) {
    const resource = resources[i];
    const path = resource.path === '/' ? '/' : resource.path.replace(/\/$/, '');
    console.log(`\n==================== process for path: ${path} =====================`);
    // check remote resource already exists
    if (!remote.hasOwnProperty(path)) {
      // get or create resource
      const resource = await findOrCreateResource(restApiId, path, remote);
      console.log(resource);
      if (resource.hasOwnProperty('methods')) {
        remote[path] = resource;
      } else {
        remote[path] = Object.assign(resource, { methods: {} });
      }
    }
    const remoteResource = remote[path];
    await generateMethods(resource, remoteResource, authorizers);
    await wait();
  }
};

const removeUnusedResources = async (restApiId, localResources, remoteResources) => {
  const paths = Object.keys(remoteResources);
  const finder = path => {
    return localResources.find(resource => {
      const r = resource.path === '/' ? '/' : resource.path.replace(/\/$/, '');
      const p = path === '/' ? '/' : path.replace(/\/$/, '');
      return r === p;
    });
  };
  const haveChildResources = resource => {
    const id = resource.id;
    return paths.find(path => {
      return remoteResources[path].resource.parentId === id;
    });
  };

  await Promise.all(paths.map(async path => {
    // Definition not found in local
    if (finder(path)) {
      return;
    }
    // But if resource has child resources, DO NOT remove
    if (haveChildResources(remoteResources[path])) {
      return;
    }
    logger(`Remove resource: ${path}`);
    if (!isDryrun()) {
      await apigateway.deleteResource({
        restApiId,
        resourceId: remoteResources[path].id
      }).promise();
    }
  }));
};

module.exports = {
  generateResources,
  removeUnusedResources
};
