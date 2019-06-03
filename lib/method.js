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
  await Promise.all(keys.map(async key => {
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
      if (isDryrun()) {
        logger(`Create method response for ${key}`, local);
      } else {
        await apigateway.putMethodResponse(local).promise();
        await wait();
      }
      remoteResponses[key] = local;
    }
    const patchOperations = patchOperation(
      local,
      remoteResponses[key],
      ['responseModels', 'responseParameters']
    );
    if (patchOperations !== null) {
      const update = Object.assign({}, resourceBase, {
        statusCode: key,
        patchOperations
      })
      if (isDryrun()) {
        logger(`Update method response for ${key}`, update);
      } else {
        await apigateway.updateMethodResponse(update).promise();
        await wait();
      }
    }
  }));
};

const generateMethods = async (localResource, remoteResource, authorizers) => {
  const localMethods = localResource.methods;
  const { resource, methods } = remoteResource;
  await Promise.all(Object.keys(localMethods).map(async method => {
    const localMethod = localMethods[method];
    const local = Object.assign({
      httpMethod: method,
      resourceId: remoteResource.id,
      restApiId: resource.restApiId,
      apikeyRequired: false,
      requestParameters: createMethodRequestParams(localMethod),
      authorizationType: localMethod.authorizerType || 'NONE'
    }, localMethod.authorizer ?
      { authorizerId: authorizers[localMethod.authorizer] } :
      {}
    );
    if (!methods.hasOwnProperty(method)) {
      if (isDryrun()) {
        logger(`Create method for ${method}`, local);
      } else {
        await apigateway.createMethod(local).promise();
        await wait();
      }
      methods[method] = {
        methodRequest: local
        // methodResponse: {},
        // integration: {},
        // integrationResponse: {}
      };
    }
    const patchOperations = patchOperation(
      local,
      methods[method].methodRequest,
      ['apikeyRequired', 'authorizationType', 'authorizerId', 'requestParameters']
    )
    if (patchOperations !== null) {
      const update = Object.assign({}, {
        httpMethod: method,
        resourceId: remoteResource.id,
        restApiId: resource.restApiId,
        patchOperations
      })
      if (isDryrun()) {
        logger(`Update method for ${method}`, update);
      } else {
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
        const fn = await lambda.getFunction({ FunctionName: localMethod.function }).promise();
        await wait();
        const arn = fn.Configuration.FunctionArn;
        /* eslint-enable no-case-declarations */
        await Promise.all(getStore('lambdaAliases', []).map(async alias => {
          await wait();
          return await addLambdaFunctionPermission(
            resourceBase,
            localResource.path,
            arn,
            localMethod.function,
            alias
          );
        }));
        await addLambdaFunctionPermission(resourceBase, localResource.path, arn, localMethod.function);
        await generateLambdaIntegration(resourceBase, arn, integration);
        // Note that return after lambda integration, because lambda integration doesn't need any response integration.
        return;
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
  }));
};


module.exports = {
  generateMethods,
  generateMethodResponse
};
