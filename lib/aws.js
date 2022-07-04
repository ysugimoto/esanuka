const aws = require('aws-sdk');

const defaultRegion = 'ap-northeast-1';
const sessionTokenObject = process.env.AWS_SESSION_TOKEN
  ? { sessionToken: process.env.AWS_SESSION_TOKEN }
  : {};

module.exports = {
  apigateway: new aws.APIGateway(
    Object.assign(sessionTokenObject, {
    apiVersion: '2015-07-09',
    region: process.env.AWS_DEFAULT_REGION || defaultRegion,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID_APIGW || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_APIGW || process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN
  })),
  lambda: new aws.Lambda(
    Object.assign(sessionTokenObject, {
    apiVersion: '2015-03-31',
    region: process.env.AWS_DEFAULT_REGION || defaultRegion,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID_LAMBDA || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_LAMBDA || process.env.AWS_SECRET_ACCESS_KEY
  })),
  cloudWatch: new aws.CloudWatch(
    Object.assign(sessionTokenObject, {
    apiVersion: '2010-08-01',
    region: process.env.AWS_DEFAULT_REGION || defaultRegion,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID_CLOUDWATCH || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_CLOUDWATCH || process.env.AWS_SECRET_ACCESS_KEY
  })),
  region: process.env.AWS_DEFAULT_REGION || defaultRegion,
  accountId: process.env.AWS_ACCOUNT_ID
};
