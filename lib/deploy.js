const { apigatway } = require('./aws.js');
const { wait } = require('./util.js');
const logger = require('./log.js')('deploy');

const deployStage = async (restApiId, stageName, variables) => {
  const date = new Date();
  const input = {
    restApiId,
    stageName,
    variables,
    cacheClusterEnabled: false,
    description: `[${process.env.CIRCLE_SHA1 || 'manual'}] deployed by esanuka at ${date.toLocaleString()}`
  };
  logger(`Deploy Resources to ${stageName} --------------------->`);
  await wait();
  await apigatway.createDeployment(input).promise();
};

module.exports = {
  deployStage
};
