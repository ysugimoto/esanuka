const aws = require('aws-sdk');

const defaultRegion = 'ap-northeast-1';

module.exports = {
  apigateway: new aws.APIGateway({
    apiVersion: '2015-07-09',
    region: process.env.AWS_DEFAULT_REGION || defaultRegion
  }),
  lambda: new aws.Lambda({
    apiVersion: '2015-03-31',
    region: process.env.AWS_DEFAULT_REGION || defaultRegion
  }),
  cloudWatch: new aws.CloudWatch({
    apiVersion: '2010-08-01',
    region: process.env.AWS_DEFAULT_REGION || defaultRegion
  }),
  region: process.env.AWS_DEFAULT_REGION || defaultRegion,
  accountId: process.env.AWS_ACCOUNT_ID
};
