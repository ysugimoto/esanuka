const { apigateway, region, accountId } = require('./aws.js');
const { isDryrun, wait } = require('./util.js');
const logger = require('./log.js')('authorizer');

const _getAuthorizerIdentifySource = authorizer => {
  if (authorizer.sourceHeader) {
    return `method.request.header.${authorizer.sourceHeader}`;
  } else if (authorizer.sourceQuery) {
    return `method.request.querystring.${authorizer.sourceQuery}`;
  }
  return '';
};

const generateAuthorizers = async (restApiId, authorizers) => {
  const resp = await apigateway.getAuthorizers({ restApiId }).promise();
  const keys = Object.keys(authorizers);
  await wait(1);

  return keys.reduce(async (prev, name) => {
    const authorizer = authorizers[name];
    const found = resp.items.find(r => r.name === name);
    if (!found) {
      if (isDryrun()) {
        logger(`${name} not found. create new`);
        prev[name] = 'dry-run';
      } else {
        const created = await apigateway.createAuthorizer({
          name,
          restApiId,
          type: 'REQUEST',
          authType: 'custom',
          authorizerResultTtlInSeconds: authorizer.ttl || 300,
          authorizerUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${region}:${accountId}:function:${authorizer.function}/invocations`,
          identifySource: _getAuthorizerIdentifySource(authorizer)
        }).promise();
        await wait(1);
        prev[name] = created.id;
      }
    } else {
      prev[name] = found.id;
    }
    return prev;
  }, {});
};

module.exports = {
  generateAuthorizers
};
