/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */

const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const cloudWatch = new AWS.CloudWatch({apiVersion: '2010-08-01'})
const eventbridge = new AWS.EventBridge()
const ssm = new AWS.SSM()

const putEventsParams = {
  Entries: [
    {
      Detail: JSON.stringify({     
        "actionUserId": "6e95c051-ee28-4d9a-8a97-96f1f8efde0e",
        "orderId": "HlFIDTdD1kp5OkJb_aj91",
        "order": {
          "orderNumber": 3,
          "userId": "robot",
          "drinkOrder": {
            "icon": "barista-icons_espresso-alternative",
            "modifiers": ["Single"],
            "drink": "Espresso"
          },
          "orderState": "CANCELLED"
        },
        "userId": "robot"
      }),
      DetailType: 'OrderManager.OrderCancelled',
      EventBusName: 'will-retrieve-from-ssm', 
      Source: "awsserverlessda.serverlesspresso", // get from ssm?
      Time: new Date
    }
  ]
}

TIMEOUT_S = 60
appName = process.env.AppName || 'Serverlesspresso'
metricNamespace = `${appName}-dev`


/////////// FUTURE SLS TEST LIBRARY ///////
// todo add small jitter?  pass in backoff parameters in a struct/class with 
// backoff, max-wait 
const exponentialDelay = (retryCount, backoff) => new Promise(resolve => setTimeout(resolve, 1000 * backoff ** retryCount));

const _getWithRetry = async (apiCall, checkApiCallResult, maxRetries, maxEndTime, retryCount = 0, lastError = null) => {
  if (retryCount > maxRetries) throw new Error(lastError);

  if(new Date() > endTime) {
    if(lastError) {
      throw new Error(lastError)
    } else {
      throw new Error("Operation timed out")
    }
  }

  try {
    data = await apiCall();
    console.log(new Date() + ' Got data ' + JSON.stringify(data))
    if(checkApiCallResult(data)) {
      return data
    }
    lastError = null
  } catch (e) {
    console.log(new Date() + ' Got error ' + e)
    lastError = e
  }

  await exponentialDelay(retryCount, 2);
  return _getWithRetry(apiCall, checkApiCallResult, maxRetries, maxEndTime, retryCount + 1, lastError);

};

const getWithRetry = async (apiCall, checkApiCallResult, maxRetries, maxEndTime) => {
  maxRetries = Math.max(0, maxRetries)
  // todo enforce a max for maxRetries?
  return _getWithRetry(apiCall, checkApiCallResult, maxRetries, maxEndTime)
}
///////////////////////////

test('cancelled order generates CloudWatch metric', async () => {
  // metrics are reported at the start of the minute (for minute metrics) so backtrack 60 seconds
  // (todo could zero out seconds?)
  testStartTime = new Date(new Date().getTime() - 60000)

  // test that part of our input interface (SSM parameter) is present
  eventBusParm = await ssm.getParameter({ Name: '/Serverlesspresso/core/eventbusname' }).promise()
  expect(eventBusParm['Parameter']['Type']).toBe('String')
  expect(eventBusParm['Parameter']['Value'].length).toBeGreaterThan(0)
  putEventsParams['Entries'][0]['EventBusName'] = eventBusParm['Parameter']['Value']

  // generate the expected input -- an event in EventBridge
  await eventbridge.putEvents(putEventsParams).promise()
  console.log('EventBridge event sent')

  endTime = new Date(new Date().getTime() + TIMEOUT_S * 1000)

  // aws cloudwatch list-metrics --namespace Serverlesspresso-dev --metric-name Order
  // {
  //   "Metrics": [
  //       {
  //           "Namespace": "Serverlesspresso-dev",
  //           "MetricName": "Order",
  //           "Dimensions": [
  //               {
  //                   "Name": "State",
  //                   "Value": "Cancelled"
  //               }
  //           ]
  //       }
  //   ]
  // }
  // ws cloudwatch get-metric-data --start-time '2022-02-25T18:00:00.000Z' --end-time '2022-02-25T18:42:00.000Z' --metric-data-queries '[{"Id":"id1","MetricStat":{"Metric":{"MetricName":"Order", "Namespace": "Serverlesspresso-dev", "Dimensions":[{"Name":"State","Value":"Cancelled"}]}, "Period":60,"Stat":"SampleCount"}}]'

  getMetricParams = {
    'EndTime': new Date,
    'MetricDataQueries': [
      {
        'Id': 'testStatAvg',
        'MetricStat': {
          'Metric': {        
            'MetricName': 'Order',
            'Namespace': metricNamespace,
            'Dimensions': [{
              'Name': 'State',
              'Value': 'Cancelled'
            }]
          },
          'Period': 5,
          'Stat': 'Average'
        }
      },
      {
        'Id': 'testStatCount',
        'MetricStat': {
          'Metric': {        
            'MetricName': 'Order',
            'Namespace': metricNamespace,
            'Dimensions': [{
              'Name': 'State',
              'Value': 'Cancelled'
            }]
          },
          'Period': 5,
          'Stat': 'SampleCount'
        }
      },
    ],
    'StartTime': testStartTime      
  }

  apiCall = async () => { return await cloudWatch.getMetricData(getMetricParams).promise() }
  // {"ResponseMetadata":{"RequestId":"c7ee1b64-b81f-4a8e-9425-f65cc87ec2e3"},"MetricDataResults":[{"Id":"testStatAvg","Label":"Order","Timestamps":[],"Values":[],"StatusCode":"Complete","Messages":[]}],"Messages":[]}
  checkResult = (data) => data['MetricDataResults'][0]['Timestamps'].length > 0

  // poll for CloudWatch data
  cloudWatchData = await getWithRetry(apiCall, checkResult, 5, endTime)

  // confirm that the value is correct
  expect(cloudWatchData['MetricDataResults'][0]['Values'].length).toBeGreaterThan(0)
  expect(cloudWatchData['MetricDataResults'][0]['Values'][0]).toBe(1)
  
}, TIMEOUT_S*1000);