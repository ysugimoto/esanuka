const { apigateway, lambda } = require('./aws.js');
const { getStore, wait } = require('./util.js');
const { URL } = require('url');

const EXPECTED_ALERMS = [
  '5XXError',
  'IntegrationLatency',
  '4XXError',
  'CacheHitCount',
  'CacheMissCount',
  'Count',
  'Latency'
];

const VALID_METHODS = [
  'GET',
  'POST',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'PUT',
  'ANY'
];

const VALID_AUTHORIZER_TYPES = [
  'NONE',
  'AWS_IAM',
  'COGNITO_USER_POOLS',
  'CUSTOM'
];

const VALID_INTEGRATION_MAP = {
  lambda: 'AWS_PROXY',
  http: 'HTTP_PROXY',
  vpc: 'VPC',
  cors: 'MOCK'
};

const validateAuthorizers = async authorizers => {
  const keys = Object.keys(authorizers);
  await Promise.all(keys.map(async key => {
    const authorizer = authorizers[key];
    // basic parameter validation
    if (authorizer.type !== 'lambda') {
      throw new Error(`Invalid authorizer on index ${key}: type must be 'lambda'`);
    } else if (!authorizer.sourceHeader && !authorizer.sourceQuery) {
      throw new Error(`Invalid authorizer on index ${key}: either sourceHeader or sourceQuery is required`);
    } else if (authorizer.ttl && authorizer.ttl > 3600) {
      throw new Error(`Invalid authorizer on index ${key}: ttl must be less than 3600 (sec)`);
    } else if (!authorizer.function) {
      throw new Error(`Invalid authorizer on index ${key}: function field is required and must exist`);
    }
    // function validate
    if (!getStore('skipFunctionExistence')) {
      Vawait lambda.getFunction({ FunctionName: authorizer.function }).promise();
      await wait();
    }
  }));
};

const validateAlarms = async alarms => {
  const keys = Object.keys(alarms);
  // check invalid key existence
  await Promise.all(keys.map(async key => {
    const alarm = alarms[key];

    if (!EXPECTED_ALERMS.includes(key)) {
      throw new Error(`Invalid alarm definition: ${key} is invalid`);
    } else if (!alarm.threshold) {
      throw new Error(`Invalid alarm definition for ${key}: threshold field is required`);
    }
  }));
};

const validateMethods = async (path, methods, authorizers) => {
  return Promise.all(Object.keys(methods).map(async key => {
    if (!VALID_METHODS.includes(key)) {
      throw new Error(
        `Invalid method for ${path}: ${key} must be one of ${VALID_METHODS.join(', ')}`
      );
    }
    const method = methods[key];
    if (method.authorizerType) {
      if (!VALID_AUTHORIZER_TYPES.includes(method.authorizerType)) {
        throw new Error(
          `Invalid authorizerType for ${path}: ${method.authorizerType} must be one of ${VALID_AUTHORIZER_TYPES.join(', ')}`
        );
      }
    }
    if (method.authorizer) {
      if (!authorizers.hasOwnProperty(method.authorizer)) {
        throw new Error(
          `Invalid authorizer for ${path}: ${method.authorizer} doesn't exist on authorizer definition`
        );
      }
    }
  }));
};

const validateLambdaIntegration = async (path, httpMethod, method) => {
  const prefix = `Invalid Lambda integration for ${httpMethod} ${path}:`;

  if (!method.function) {
    throw new Error(`${prefix} function field is required`);
  }
  // check lambda function existence
  try {
    await lambda.getFunction({ FunctionName: method.function } ).promise();
    await wait();
  } catch (err) {
    throw new Error(`${prefix} function ${method.function} is not found`);
  }

  // check list aliases existence
  const aliases = await lambda.listAliases({ FunctionName: method.function, MaxItems: 50 }).promise();
  await wait();
  const notFoundAliases = (getStore('lambdaAliases', [])).filter(alias => {
    const found = aliases.Aliases.find(a => a.Name === alias);
    return !found;
  });
  if (notFoundAliases.length > 0) {
    throw new Error(
      `${prefix} function aliases ${notFoundAliases.join(', ')} not defined. Ensure your lambda deployment`
    );
  }
};

const validateHTTPIntegration = async (path, httpMethod, method) => {
  const prefix = `Invalid HTTP integration for ${httpMethod} ${path}:`;

  if (!method.url) {
    throw new Error(`${prefix} url field is required`);
  }
  try {
    const u = new URL(method.url);
    if (u.protocol === '') {
      throw new Error(`${prefix} url protocol cannot recognized`);
    }
  } catch (err) {
      throw new Error(`${prefix} ${err.message}`);
  }
};

const validateVPCIntegration = async (path, httpMethod, method) => {
  const prefix = `Invalid VPC integration for ${httpMethod} ${path}:`;

  if (!method.vpcLinkId) {
    throw new Error(`${prefix} vpcLinkId field is required`);
  }
  if (!method.serviceName && !method.fixedHost) {
    throw new Error(`${prefix} either serviceName or fixedHost field must be defined`);
  }
  if (!getStore('baseDomain')) {
    throw new Error(`${prefix} baseDomain must be defined if you want to create VPC integration`);
  }
  try {
    await apigateway.getVpcLink({ vpcLinkId: method.vpcLinkId }).promise();
    await wait();
  } catch (err) {
    throw new Error(`${prefix} vpc ${method.vpcLinkId} is not found: ${err.message}`);
  }
};

const validateIntegrations = async (path, methods) => {
  return Promise.all(Object.keys(methods).map(async key => {
    const method = methods[key];
    switch (method.integrationType) {
      case 'lambda':
        await validateLambdaIntegration(path, key, method);
        break;
      case 'vpc':
        await validateVPCIntegration(path, key, method);
        break;
      case 'http':
        await validateHTTPIntegration(path, key, method);
        break;
      default:
        if (!method.integrationType) {
          throw new Error(
            `Invalid integration for ${path}: integrationType filed is required`
          );
        }
        throw new Error(
          `Invalid integration type for ${path}: ${method.integrationType} must be one of ${Object.keys(VALID_INTEGRATION_MAP).join(', ')}`
        );
    }
  }));
};

const validateResources = async resources => {
  if (resources.length === 0) {
    throw new Error(`resources cannot be empty`);
  }
  await Promise.all(resources.map(async (resource, index) => {
    if (!resource.path) {
      throw new Error(`Invalid resource definition for index ${index}: path field is required`)
    } else if (!/^\/[\w\-_{}+/.]*$/.test(resource.path)) {
      throw new Error(`Invalid resource definition for ${resource.path}: invalid character contains in path`)
    } else if (!resource.description) {
      throw new Error(`Invalid resource definition for ${resource.path}: description field is required`)
    }
  }));
};

const validateDefinition = async (restApiId, defs) => {
  const errors = [];

  // ensure REST API exists in aws
  try {
    await apigateway.getRestApi({ restApiId }).promise();
  } catch (err) {
    errors.push(err);
  }

  // validate authtorizers
  try {
    await validateAuthorizers(defs.authorizers || {});
  } catch (err) {
    errors.push(err);
  }

  // validate alarms
  try {
    await validateAlarms(defs.alarms || {});
  } catch (err) {
    errors.push(err);
  }

  // validate resources
  try {
    await validateResources(defs.resources || []);
  } catch (err) {
    errors.push(err);
  }

  // validate methods
  try {
    await Promise.all((defs.resources || []).map(async resource => {
      return await validateMethods(resource.path, resource.methods || {}, defs.authorizers || {});
    }));
  } catch (err) {
    errors.push(err);
  }

  // validate integrations
  try {
    await Promise.all((defs.resources || []).map(async resource => {
      return await validateIntegrations(resource.path, resource.methods || {});
    }));
  } catch (err) {
    errors.push(err);
  }

  return {
    valid: errors.length === 0,
    message: errors.map(e => e.message).join('\n')
  };
}

const validateConfig = (config, dryRun) => {
  if (!config.restApiId) {
    throw new Error(`Configuration error: restApiId must be specified`);
  } else if (!config.deploymentStage) {
    if (!dryRun) {
      throw new Error(`Configuration error: deploymentSrage must be specified`);
    }
  }
};

const validateAwsConfig = () => {
  const exists = key => key in process.env;
  const requires = [];

  if (!exists('AWS_ACCOUNT_ID')) {
    requires.push('AWS_ACCOUNT_ID');
  }
  if (!exists('AWS_ACCESS_KEY_ID') || !exists('AWS_SECRET_ACCESS_KEY')) {
    const identifyKeys = [
      'AWS_ACCESS_KEY_ID_APIGW',
      'AWS_ACCESS_KEY_ID_LAMBDA',
      'AWS_ACCESS_KEY_ID_CLOUDWATCH',
      'AWS_SECRET_ACCESS_KEY_APIGW',
      'AWS_SECRET_ACCESS_KEY_LAMBDA',
      'AWS_SECRET_ACCESS_KEY_CLOUDWATCH'
    ];
    requires.push(...identifyKeys.filter(k => !exists(k)));
  }
  if (requires.length > 0) {
    throw new Error(`AWS Configuration failed: ${requires.join(', ')} must be defiend in environment`);
  }
};


module.exports = {
  validateDefinition,
  validateConfig,
  validateAwsConfig
};
