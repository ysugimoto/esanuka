const { apigateway } = require('./aws.js');

const createMethodRequest = (resource, method) => {
  return Object.assign({}, resource, {
    apikeyRequired: method.apikeyRequired || false,
    authorizationType: method.authorizationType,
    requestParameters: method.requestParameters
  }, method.authorizerId ? { authorizerId: method.authorizerId } : {});
};

const createMethodResponse = (resource, responses) => {
  return Object.keys(responses).reduce((prev, next) => {
    prev[next] = Object.assign({}, resource, responses[next]);
    return prev;
  }, {});
};

const createIntegrationResponse = (resource, integration) => {
  const responses = integration.integrationResponses || {};

  return Object.keys(responses).reduce((prev, next) => {
    // Special dealing with emptry string for responseTemplates
    // SDK accepts emptry string, but API responds with null
    const rp = responses[next];
    Object.keys(rp.responseTemplates || {}).forEach(key => {
      if (rp.responseTemplates[key] === null) {
        rp.responseTemplates[key] = '';
      }
    });
    prev[next] = Object.assign({}, resource, rp);
    return prev;
  }, {});
}

const createIntegration = (resource, integration) => {
  switch (integration.type) {
    case 'HTTP':
      // VPC integration
      return Object.assign({}, resource, {
        type: integration.type,
        integrationHttpMethod: resource.httpMethod,
        connectionId: integration.connectionId,
        connectionType: 'VPC_LINK',
        uri: integration.uri,
        requestParameters: integration.requestParameters
      });
    case 'HTTP_PROXY':
      // HTTP Proxy integration
      return Object.assign({}, resource, {
        type: integration.type,
        integrationHttpMethod: 'ANY',
        uri: integration.uri,
        requestParameters: integration.requestParameters
      });
    case 'AWS_PROXY':
      // Lambda integration
      return Object.assign({}, resource, {
        type: integration.type,
        integrationHttpMethod: 'POST',
        uri: integration.uri,
        contentHandling: 'CONVERT_TO_BINARY'
      });
    case 'MOCK':
      // CORS mock integration
      return Object.assign({}, resource, {
        type: integration.type
      });
    default:
      throw new Error(`unexpected integration type: ${integration.type} is coming`);
  }
};

const createMethod = (restApiId, resourceId, methods) => {
  const keys = Object.keys(methods);
  return keys.reduce((prev, next) => {
    const method = methods[next];
    const resource = {
      httpMethod: next,
      resourceId,
      restApiId
    };
    prev[next] = {
      methodRequest: createMethodRequest(resource, method),
      methodResponse: createMethodResponse(resource, method.methodResponses || {}),
      integrationResponse: createIntegrationResponse(resource, method.methodIntegration || {}),
      integration: createIntegration(resource, method.methodIntegration || {})
    };
    return prev;
  }, {});
};

const remote = async restApiId => {
  const resources = await apigateway.getResources({
    restApiId,
    limit: 500,
    embed: ['methods']
  }).promise();
  return resources.items.reduce((prev, next) => {
    prev[next.path] = {
      id: next.id,
      resource: {
        restApiId: restApiId,
        parentId: next.parentId,
        pathPart: next.pathPart
      },
      methods: createMethod(restApiId, next.id, next.resourceMethods || {})
    };
    return prev;
  }, {});
};

module.exports = remote;
