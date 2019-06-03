const { apigateway, cloudWatch } = require('./aws.js');
const logger = require('./log.js')('alarm');
const { wait, getStore, isDryrun } = require('./util.js');

const generateAlarmName = (apiName, key) => {
  const prefix = getStore('alarmNamePrefix', 'esanuka-alarm');
  return `${prefix}-${apiName}-${key}-alarm`;
};

const checkAlarmExistence = async (apiName, key) => {
  const alarmName = generateAlarmName(apiName, key);
  const resp = await cloudWatch.describeAlarms({
    AlarmNames: [alarmName]
  }).promise();
  await wait(1);

  return (resp.MetricAlarms || []).some(item => {
    return item.AlarmName === alarmName && item.MetricName === key;
  });
};

const generateAlarms = async (restApiId, definition) => {
  const resp = await apigateway.getRestApi({ restApiId }).promise();
  await wait(1);
  const alarms = definition.alarms || {};
  const filtered = Object.keys(alarms).filter(key => {
    const alarm = alarms[key];
    const topics = ['ok', 'insufficient', 'alarm'].filter(a => alarm.hasOwnProperty(a));
    if (topics.length === 0) {
      logger(`${key} doesnt' have enough alarm notifications`);
      return false;
    }
    return true;
  });

  await Promise.all(filtered.map(async key => {
    const exists = await checkAlarmExistence(resp.name, key);
    if (exists) {
      logger(`alarm ${key} already exists`);
      return;
    }
    await wait(1);
    const alarm = alarms[key];
    const input = {
      AlarmName: generateAlarmName(resp.name, key),
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      MetricName: key,
      Namespace: 'AWS/ApiGateway',
      Period: alarm.period || 300,
      Threshold: alarm.threshold,
      ActionsEnabled: true,
      AlarmDescription: `Alarm for ise-rc-apigateway of ${resp.name}`,
      Dimensions: [{
        'Name': 'ApiName',
        'Value': resp.name
      }],
      Statistic: 'Average',
      TreatMissingData: 'notBreaching',
      OKActions: alarm.ok || [],
      AlarmActions: alarm.alarm || [],
      InsufficientDataActions: alarm.insufficient || [],
      EvaluationPeriods: 1,
      DatapointsToAlarm: 1
    };
    if (isDryrun()) {
      logger(`Create new alarm ${key}`, input);
    } else {
      await cloudWatch.putMetricAlarm(input).promise();
      await wait(1);
    }
  }));
};

module.exports = {
  generateAlarms
};
