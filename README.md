# esanuka

esanuka is manage idempotency tool for AWS API Gateway.

## Installation

You can install via `npm`:

```shell
npm install esanuka -D
```

Or `yarn`:

```shell
yarn add esanuka -D`
````

## Resource Definition

`esanuka` accepts following YAML structure:

```yaml
authorizers:
  authorizer-function-name:
    type: lambda
    function: authorizer-lambda-function
    sourceHeader: cookie
    ttl: 300

resources:
  - path: /path/to/endpoint
    description: Endpoint description
    methods:
      GET:
        integrationType: lambda
        function: dispatch-lambda-function
  ...
```

Parameters specifications are:

| name                                                  | type   | required | description                                                                                                               |
|:------------------------------------------------------|:------:|:--------:|:--------------------------------------------------------------------------------------------------------------------------|
| authorizers                                           | Object | No       | Authorizer specifications. Key is authorizer name                                                                         |
| authorizers[key].type                                 | String | Yes      | Authorizer Type. Currentry support `lamba` only                                                                           |
| authorizers[key].function                             | String | Yes      | Lambda function name                                                                                                      |
| authorizers[key].sourceHeader                         | String | No       | Authorize identity source from header name. Either sourceHeader or sourceQuery is required                                |
| authorizers[key].sourceQuery                          | String | No       | Authorize identity source from querystring. Either sourceHeader or sourceQuery is required                                |
| authorizers[key].ttl                                  | Number | No       | TTL of authentication cache                                                                                               |
| resources                                             | Array  | Yes      | Resource specifications                                                                                                   |
| resources[].path                                      | String | Yes      | Endpoint path                                                                                                             |
| resources[].description                               | String | Yes      | Endpoint description                                                                                                      |
| resources[].methods                                   | Object | Yes      | Endpoint method specifications. Key is method name                                                                        |
| resources[].methods[method].integrationType           | String | Yes      | Backend integration type. Value must be one of `lambda`, `http`, and `vpc`                                                |
| resources[].methods[method].function                  | String | No       | Lambda function name. This is required if `integrationType` is `lambda`                                                   |
| resources[].methods[method].url                       | String | No       | HTTP proxy URL. This is required if `integrationType` is `http`                                                           |
| resources[].methods[method].vpcLinkId                 | String | No       | VPC Link Id. This is required if `integrationType` is `vpc`                                                               |
| resources[].methods[method].serviceName               | String | No       | Backend service name. This is used for VPC link to host                                                                   |
| resources[].methods[method].paths                     | Object | No       | Endpoint path paramter specifications. e.g If endpoint is `/path/to/{id}`, paths must specify as `id: true`               |
| resources[].methods[method].queryStrings              | Object | No       | Endpoint query string specifications. e.g If endpoint accepts `/path/to?id=[id]`, queryStrings must specify as `id: true` |
| resources[].methods[method].authorizerType            | String | No       | Authorizer type. Value is one of `CUSTOM` of `AWS_IAM`                                                                    |
| resources[].methods[method].authorizer                | String | No       | Authorizer name. This is required if `authorizerType` is `CUSTOM`                                                         |
| resources[].methods[method].responses                 | Object | Yes      | Method/Integration response specifications                                                                                |
| resources[].methods[method].responses[status].headers | Object | No       | Sending HTTP headers to client                                                                                            |
| resources[].methods[method].responses[status].pattern | Object | No       | Mapping status code pattern                                                                                               |

Example is below:

### Lambda Integration

Lambda integration always set as **Lambda Proxy Integration**

```yaml
resources:
  - path: /path/to/endpoint
    description: Endpoint description
    methods:
      GET:
        integrationType: lambda
        function: dispatch-lambda-function
```

In Lambda integration, status code and http headers are passthrough between the request/response.

### VPC Integration

Request can proxy using VPC Link. The usage of this is backend origins put in private VPC network.

```yaml
resources:
  - path: /path/to/endpoint/{id}
    description: Endpoint description
    methods:
      GET:
        integrationType: vpc
        vpcLinkId: [vpc link id]
        serviceName: example.ap-northeast-1.elasticbeanstalk.com
        paths:
          id: true
        responses:
          200:
            headers:
              Access-Control-Allow-Origin: false
```

On above case, API Gateway will proxy to `http://example.ap-northeast-1.elasticbeanstalk.com/path/to/endpoint/{id}` using with VPC Link.
And `path` contains `{id}`, bind paramter, so you need to define `paths` section.

In addition, you can transform dispatch path with `backendPath` paramter:

```yaml
resources:
  - path: /path/to/endpoint/{id}
    description: Endpoint description
    methods:
      GET:
        integrationType: vpc
        vpcLinkId: [vpc link id]
        backendPath: /endpoint/{id} ## add this line
        serviceName: example.ap-northeast-1.elasticbeanstalk.com
        paths:
          id: true
        responses:
          200:
            headers:
              Access-Control-Allow-Origin: false
```

Then API Gateway will proxy to `http://example.ap-northeast-1.elasticbeanstalk.com/endpoint/{id}` using with VPC Link.

### HTTP Integration

Simply HTTP proxy.

```yaml
resources:
  - path: /proxies/{proxy+}
    description: Endpoint description
    methods:
      GET:
        integrationType: http
        url: https://example.com/proxies/{proxy}
```

API Gateway simply do proxy under `/proxies/*` requests to `https://example.com/proxies/*`.

## Dry Run

`esanuka` supports `dry-run`, which compares between local and remote definitons, and display resource create/modify/delete plans to output.
So you can confirm before deploy resources.

## Binding Parameters

You can use binding paramteres in definition YAML file in `${}` blaced:

```yaml
resources:
  - path: /path/to/endpoint/{id}
    description: Endpoint description
    methods:
      GET:
        integrationType: vpc
        vpcLinkId: ${VPC_LINK_ID}
        backendPath: /endpoint/{id} ## add this line
        serviceName: example.ap-northeast-1.elasticbeanstalk.com
        paths:
          id: true
        responses:
          200:
            headers:
              Access-Control-Allow-Origin: false
```

Then, `${VPC_LINK_ID}` will be replaced to environmen t variable.

## Deployment with CLI

Easiest way is run from command line:

```shell
easnuka -f [defitnition YAML file] -s prod --rest-api-id=[rest api id]
```

With dry-run:

```shell
easnuka -f [defitnition YAML file] -s prod --rest-api-id=[rest api id] --dry-run
```

## Deployment with programable

`esanuka` also can deploy with programably.

```js
const esanuka = require('easnuka');
const defitnitions = esanuka.factory('/path/to/definition.yml', {});
esanuka(definitions, {
  restApiId: '[rest api id]',
  deploymentStage: 'prod'
});
```

With dry-run:

```js
const esanuka = require('easnuka');
const defitnitions = esanuka.factory('/path/to/definition.yml', {});
esanuka.dryRun(definitions, {
  restApiId: '[rest api id]',
  deploymentStage: 'prod'
})l;
```

In addition, progoramable deployment has more garantees using options of second arguments:

```js
const esanuka = require('easnuka');
const defitnitions = esanuka.factory('/path/to/definition.yml', {});
esanuka.dryRun(definitions, {
  onIntegrationParameters: Function,
  onMethodRequestParameters: Function,
  useLambdaWithStage: Boolean,
  lambdaAliases: Array<String>,
  baseDomain: String,
  restApiId: String,
  deploymentStage: String,
  verbose: Boolean,
  skipFunctionExistence: Boolean
});
```

Describes option fields with following:

| name                      | type                 | required | description                                                                                          |
|:--------------------------|:--------------------:|:--------:|:-----------------------------------------------------------------------------------------------------|
| onIntegrationParameters   | Function(obj) => obj | No       | Hook on create integration request parameters. You can add more integration headers in this function |
| onMethodRequestParameters | Function(obj) => obj | No       | Hook on create method request parameters. You can add more integration headers in this function      |
| useLambdaWithStage        | Boolean              | No       | If `true`, create Lambda integration with staging environment as ${environment.stage} function alias |
| lambdaAliases             | Array of aliaes      | No       | Additional lambda function aliases. esanuka add lambda permissions automatically.                    |
| baseDomain                | String               | No       | Additional base domain                                                                               |
| restApiId                 | String               | Yes      | APIGateway REST API ID                                                                               |
| deploymentStage           | String               | Yes      | Deployment target stage name                                                                         |
| verbose                   | Boolean              | No       | Verbose process logs                                                                                 |
| skipFunctionExistence     | Boolean              | No       | If `true`, validation skips check of lambda function existence, it's useful for local development    |

## Author

Yoshiaki Sugimoto

## License

MIT
