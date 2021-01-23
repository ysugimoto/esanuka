const { apigateway, lambda } = require('./aws.js');
const { patchOperation, getStore, isDryrun, wait } = require('./util.js');
const logger = require('./log.js')('method');
const {
  generateLambdaIntegration,
  generateHttpProxyIntegration,
  generateVpcIntegration,
  generateMockIntegration,
  generateIntegrationResponse,
  addLambdaFunctionPermission
} = require('./integration.js');

const createMethodRequestParams = localMethod => {
  const toParamObject = (place, params) => {
    return Object.keys(params).reduce((prev, next) => {
      prev[`method.request.${place}.${next}`] = Boolean(params[next]);
      return prev;
    }, {});
  };

  return Object.assign({},
    toParamObject('header', localMethod.headers || {}),
    toParamObject('querystring', localMethod.queryStrings || {}),
    toParamObject('path', localMethod.paths || {}),
    getStore('onMethodRequestParameters')(localMethod)
  );
};

const generateMethodResponse = async (resourceBase, localResponses, remoteResponses) => {
  const keys = Object.keys(localResponses);

  // Need to do "ordered" promise, should not parallel it.
  // Otherwise, API call rate limit reaches immediately.
  for (let i = 0; i < keys.length; ++i) {
    const key = keys[i];
    const localResponse = localResponses[key];
    const local = Object.assign({}, resourceBase, {
      statusCode: key,
      responseModels: {
        'application/json': 'Empty'
      },
      responseParameters: Object.keys(localResponse.headers).reduce((prev, next) => {
        prev[`method.response.header.${next}`] = Boolean(localResponse.headers[next]);
        return prev;
      }, {
        'method.response.header.Content-Type': false
      })
    });
    if (!remoteResponses.hasOwnProperty(key)) {
      logger(`Create method response for ${key}`, local);
      if (!isDryrun()) {
        await apigateway.putMethodResponse(local).promise();
        await wait();
      }
      remoteResponses[key] = local;
    }
    const patchOperations = patchOperation(
      local,
      remoteResponses[key],
      ['responseParameters']
    );
    if (patchOperations !== null) {
      const update = Object.assign({}, resourceBase, {
        statusCode: key,
        patchOperations
      })
      logger(`Update method response for ${key}`, update);
      if (!isDryrun()) {
        await apigateway.updateMethodResponse(update).promise();
        await wait();
      }
    }
  }
};

const generateMethods = async (localResource, remoteResource, authorizers) => {
  const localMethods = localResource.methods;
  const { resource, methods } = remoteResource;

  // Need to do "ordered" promise, should not parallel it.
  // Otherwise, API call rate limit reaches immediately.
  const keys = Object.keys(localMethods);
  for (let i = 0; i < keys.length; ++i) {
    const method = keys[i];
    const localMethod = localMethods[method];
    const local = Object.assign({
      httpMethod: method,
      resourceId: remoteResource.id,
      restApiId: resource.restApiId,
      apiKeyRequired: localMethod.apiKeyRequired || false,
      requestParameters: createMethodRequestParams(localMethod),
      authorizationType: localMethod.authorizerType || 'NONE'
    }, localMethod.authorizer && localMethod.authorizerType === 'CUSTOM' ?
      { authorizerId: authorizers[localMethod.authorizer] } :
      {}
    );
    if (!methods.hasOwnProperty(method)) {
      logger(`Create method for ${method}`, local);
      if (!isDryrun()) {
        await apigateway.putMethod(local).promise();
        await wait();
      }
      methods[method] = {
        methodRequest: local
      };
    }
    const patchOperations = patchOperation(
      local,
      methods[method].methodRequest,
      ['apiKeyRequired', 'authorizationType', 'authorizerId', 'requestParameters']
    )
    if (patchOperations !== null) {
      const update = Object.assign({}, {
        httpMethod: method,
        resourceId: remoteResource.id,
        restApiId: resource.restApiId,
        patchOperations
      })
      logger(`Update method for ${method}`, update);
      if (!isDryrun()) {
        await apigateway.updateMethod(update).promise();
        await wait();
      }
    }
    const resourceBase = {
      restApiId: resource.restApiId,
      httpMethod: method,
      resourceId: remoteResource.id
    };
    const integration = methods[method].integration;
    switch (localMethod.integrationType) {
      case 'lambda':
        /* eslint-disable no-case-declarations */
        let arn;
        try {
          const fn = await lambda.getFunction({ FunctionName: localMethod.function }).promise();
          await wait();
          arn = fn.Configuration.FunctionArn;
        } catch (err) {
          if (!getStore('skipFunctionExistence')) {
            throw err;
          }
          logger(`Getting function error: ${err.message}, but skipped due to skipFunctionExistence option`);
          break;
        }
        /* eslint-enable no-case-declarations */
        const aliases = getStore('lambdaAliases', []);
        for (let j = 0; j < aliases.length; ++j) {
          await wait();
          await addLambdaFunctionPermission(
            resourceBase,
            localResource.path,
            arn,
            localMethod.function,
            aliases[j]
          );
        }
        await addLambdaFunctionPermission(resourceBase, localResource.path, arn, localMethod.function);
        await generateLambdaIntegration(resourceBase, arn, integration);
        continue;
      case 'http':
        await generateHttpProxyIntegration(resourceBase, localMethod, integration);
        break;
      case 'vpc':
        await generateVpcIntegration(resourceBase, localResource.path, localMethod, integration);
        break;
      case 'cors':
        await generateMockIntegration(resourceBase, integration);
        break;
    }
    await generateMethodResponse(resourceBase, localMethod.responses || {}, methods[method].methodResponse || {});
    await generateIntegrationResponse(resourceBase, localMethod.responses || {}, methods[method].integrationResponse || {});
  }
};


module.exports = {
  generateMethods,
  generateMethodResponse
};
