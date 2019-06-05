const { apigateway, lambda, region, accountId } = require('./aws.js');
const { patchOperation, getStore, isDryrun, wait } = require('./util.js');
const logger = require('./log.js')('integration');

const createIntegrationRequestparams = localMethod => {
  const toParamObject = (place, params, from = '') => {
    return Object.keys(params).reduce((prev, next) => {
      prev[`integration.request.${place}.${next}`] = from ?
        `${from}.${params[next]}` :
        `method.request.${place}.${next}`;
      return prev;
    }, {});
  };

  return Object.assign({},
    toParamObject('header', localMethod.headers || {}),
    toParamObject('querystring', localMethod.queryStrings || {}),
    toParamObject('path', localMethod.paths || {}),
    getStore('onIntegrationParameters')(localMethod)
  );
};

const addLambdaFunctionPermission = async (resourceBase, path, functionArn, functionName, alias = '') => {
  const input = {
    Action: 'lambda:InvokeFunction',
    Principal: 'apigateway.amazonaws.com',
    SourceArn: `arn:aws:execute-api:${region}:${accountId}:${resourceBase.restApiId}/*/${resourceBase.httpMethod}${path}`,
    FunctionName: `${functionArn}${alias ? ':' + alias : ''}`,
    StatementId: `Esanuka-Generated-${resourceBase.resourceId}-${functionName}-${resourceBase.httpMethod}`
  };
  try {
    if (!isDryrun()) {
      await lambda.addPermission(input).promise();
      await wait();
    }
    // no logging
    // logger(`Add lambda permission for ${functionName}${alias ? ':' + alias : ''}`, input);
  } catch (err) {
    if (err.code !== 'ResourceConflictException') {
      throw new Error(err.message);
    }
  }
};

const generateLambdaIntegration = async (resourceBase, functionArn, remote) => {
  const alias = getStore('useLambdaWithStage', false) ? ':${stageVariables.environment}' : '';
  const from = Object.assign({}, resourceBase, {
    type: 'AWS_PROXY',
    uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${functionArn}${alias}/invocations`,
    integrationHttpMethod: 'POST',
    contentHandling: 'CONVERT_TO_BINARY'
  });

  if (!remote) {
    logger(`Create new lambda integration`, from);
    if (!isDryrun()) {
      await apigateway.putIntegration(from).promise();
      await wait();
    }
    return;
  }

  const to = {
    httpMethod: remote.httpMethod,
    resourceId: remote.resourceId,
    restApiId: remote.restApiId,
    type: remote.type,
    uri: remote.uri,
    integrationHttpMethod: remote.integrationHttpMethod,
    contentHandling: remote.contentHandling
  };
  const patchOperations = patchOperation(
    from,
    to,
    ['type', 'uri', 'integrationMethod', 'contentHandling']
  );
  if (patchOperations !== null) {
    const update = Object.assign({}, resourceBase, { patchOperations });
    logger(`Update lambda integration`, update);
    if (!isDryrun()) {
      await apigateway.updateIntegration(update).promise();
      await wait();
    }
  }
};

const generateHttpProxyIntegration = async (resourceBase, local, remote) => {
  const from = Object.assign({}, resourceBase, {
    type: 'HTTP_PROXY',
    uri: local.url,
    integrationHttpMethod: 'ANY',
    requestParameters: createIntegrationRequestparams(local)
  });

  if (!remote) {
    logger(`New Http integration`, from);
    if (!isDryrun()) {
      await apigateway.putIntegration(from).promise();
      await wait();
    }
    return;
  }

  const to = {
    httpMethod: remote.httpMethod,
    type: remote.type,
    uri: remote.uri,
    resourceId: remote.resourceId,
    restApiId: remote.restApiId,
    integrationHttpMethod: remote.integrationHttpMethod,
    requestParameters: remote.requestParameters
  };
  const patchOperations = patchOperation(
    from,
    to,
    ['type', 'uri', 'integrationHttpMethod', 'requestParameters']
  );
  if (patchOperations !== null) {
    const update = Object.assign({}, resourceBase, { patchOperations });
    logger(`Update Http integration`, update);
    if (!isDryrun()) {
      await apigateway.updateIntegration(update).promise();
      await wait();
    }
  }
};

const generateVpcIntegration = async (resourceBase, path, local, remote) => {
  const backend = local.backendPath || path;
  const protocol = local.httpsProxy ? 'https': 'http';
  const host = local.fixedHost ? local.fixedHost : `${local.serviceName}.${getStore('baseDomain')}`;

  const from = Object.assign({}, resourceBase, {
    type: 'HTTP',
    integrationHttpMethod: resourceBase.httpMethod,
    connectionId: local.vpcLinkId,
    connectionType: 'VPC_LINK',
    requestParameters: createIntegrationRequestparams(local),
    uri: `${protocol}://${host}${backend}`
  });

  if (!remote) {
    if (backend !== path) {
      logger(`backed path overrides from ${path} to ${backend}`);
    }
    logger(`New VPC integration`, from);
    if (!isDryrun()) {
      await apigateway.putIntegration(from).promise();
      await wait();
    }
    return;
  }

  const to = {
    httpMethod: remote.httpMethod,
    resourceId: remote.resourceId,
    restApiId: remote.restApiId,
    type: remote.type,
    integrationHttpMethod: remote.integrationHttpMethod,
    connectionId: remote.connectionId,
    connectionType: remote.connectionType,
    requestParameters: remote.requestParameters,
    uri: remote.uri
  };
  const patchOperations = patchOperation(
    from,
    to,
    ['type', 'integrationHttpMethod', 'connectionId', 'connectionType', 'requestParameters', 'uri']
  );
  if (patchOperations !== null) {
    const update = Object.assign({}, resourceBase, { patchOperations });
    if (backend !== path) {
      logger(`[NOTICE] backed path overrides from ${path} to ${backend}`);
    }
    logger(`Update VPC integration`, update);
    if (!isDryrun()) {
      await apigateway.updateIntegration(update).promise();
      await wait();
    }
  }
};

const generateMockIntegration = async (resourceBase, remote) => {
  const from = Object.assign({}, resourceBase, {
    type: 'MOCK'
  });
  const to = {
    httpMethod: remote.httpMethod,
    resourceId: remote.resourceId,
    restApiId: remote.restApiId,
    type: remote.type
  };
  const patchOperations = patchOperation(from, to, ['type']);
  if (patchOperations !== null) {
    const update = Object.assign({}, resourceBase, { patchOperations });
    logger(`Put MOCK integration`, update);
    if (!isDryrun()) {
      await apigateway.updateIntegration(update).promise();
      await wait();
    }
  }
};

const generateIntegrationResponse = async (resourceBase, localResponses, remoteResponses) => {
  const keys = Object.keys(localResponses);

  // Need to do "ordered" promise, should not parallel it.
  // Otherwise, API call rate limit reaches immediately.
  for (let i = 0; i < keys.length; ++i) {
    const key = keys[i];
    const localResponse = localResponses[key];
    const local = Object.assign({}, resourceBase, {
      statusCode: key,
      responseTemplates: {
        'application/json': ''
      },
      selectionPattern: localResponse.pattern || key,
      responseParameters: Object.keys(localResponse.headers).reduce((prev, next) => {
        prev[`method.response.header.${next}`] = localResponse.headers[next] === true ?
          `integration.response.header.${next}` :
          null;
        return prev;
      }, {
        'method.response.header.Content-Type': 'integration.response.header.Content-Type'
      })
    });

    if (!remoteResponses.hasOwnProperty(key)) {
      logger(`Create integration response`, local);
      if (!isDryrun()) {
        await apigateway.putIntegrationResponse(local).promise();
        await wait();
      }
      remoteResponses[key] = local;
    }
    // Special dealing with 'null' responseParameters
    // SDK don't return null paramter, then isPropertyEqual detected as 'deteted'.
    // We wouldn't deal with deleted, so try to merge as null header.
    Object.keys(local.responseParameters).forEach(rp => {
      if (local.responseParameters[rp] !== null) {
        return;
      }
      remoteResponses[key].responseParameters[rp] = null;
    });

    const patchOperations = patchOperation(
      local,
      remoteResponses[key],
      ['responseTemplates', 'selectionPattern', 'responseParameters']
    );
    if (patchOperations !== null) {
      const update = Object.assign({}, resourceBase, {
        statusCode: key,
        patchOperations
      });
      logger(`Update integration response`, update);
      if (!isDryrun()) {
        await apigateway.updateIntegrationResponse(update).promise();
        await wait();
      }
    }
  }
};

module.exports = {
  generateIntegrationResponse,
  generateLambdaIntegration,
  generateHttpProxyIntegration,
  generateVpcIntegration,
  generateMockIntegration,
  addLambdaFunctionPermission
};
