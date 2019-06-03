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
    Action: 'lambda.InvokeFunction',
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
    if (isDryrun()) {
      logger(`Create new lambda integration`, from);
    } else {
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
    if (isDryrun()) {
      logger(`Update lambda integration`, update);
    } else {
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
    if (isDryrun()) {
      logger(`New Http integration`, from);
    } else {
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
    if (isDryrun()) {
      logger(`Update Http integration`, update);
    } else {
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
    if (isDryrun()) {
      if (backend !== path) {
        console.log(`[NOTICE] backed path overrides from ${path} to ${backend}`);
      }
      logger(`New VPC integration`, from);
    } else {
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
    if (isDryrun()) {
      if (backend !== path) {
        console.log(`[NOTICE] backed path overrides from ${path} to ${backend}`);
      }
      logger(`Update VPC integration`, update);
    } else {
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
    if (isDryrun()) {
      logger(`Put MOCK integration`, update);
    } else {
      await apigateway.updateIntegration(update).promise();
      await wait();
    }
  }
};

const generateIntegrationResponse = async (resourceBase, localResponses, remoteResponses) => {
  const keys = Object.keys(localResponses);
  await Promise.all(keys.map(async key => {
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
      if (isDryrun()) {
        logger(`Create integration response`, local);
      } else {
        await apigateway.putMethodResponse(local).promise();
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
      if (isDryrun()) {
        logger(`Update integration response`, update);
      } else {
        await apigateway.updateMethodResponse(update).promise();
        await wait();
      }
    }
  }));
};

module.exports = {
  generateIntegrationResponse,
  generateLambdaIntegration,
  generateHttpProxyIntegration,
  generateVpcIntegration,
  generateMockIntegration,
  addLambdaFunctionPermission
};
