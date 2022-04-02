// aws ssm put-parameter --name /Serverlesspresso/dummy --value dummy --type String

// Load SFN definition -- could also get from SFN itself 
fs = require('fs')
asl = JSON.parse(fs.readFileSync('op.asl.json'))

const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const eventbridge = new AWS.EventBridge()
const samtl = require('./samtl')

testStack = process.env.SAMTL_TEST_STACK || 'slscoffee-4'

test('Test shop open but at capacity contract test', async () => {
    userId = Math.floor(Math.random() * (2**32 - 1))
    busName = await samtl.getStackParameter(testStack, "CoreEventBusName")
    stateMachineArn = await samtl.getStackOutput(testStack, 'OrderProcessorStateMachine')

    // set up state machine with mocks
    samtl.stepFnMockTaskState(asl, 'Get Shop Status', [
        { response: { statusCode: 200, body: JSON.stringify({ storeOpen: true }), isBase64Encoded: false } }
    ])
    samtl.stepFnMockTaskState(asl, 'Get Capacity Status', { response: { isCapacityAvailable: false } })
    await samtl.stepFnUpdate(stateMachineArn, JSON.stringify(asl))

    // trigger test
    const params = { Entries: [{
        Detail: JSON.stringify({
          orderId: 'order' + userId,
          userId,
          robot: true,
          bucket: {}
        }),
        DetailType: 'Validator.NewOrder',
        EventBusName: busName,
        Source: 'awsserverlessda.serverlesspresso',
        Time: new Date
      }] 
    }
    const response = await eventbridge.putEvents(params).promise()
    console.log('EventBridge putEvents:', response)    

    // check that two EventBridge messages with the correct detail-type were generated
    const isMessageForThisTest = (msg) => {
        body = JSON.parse(msg)
        console.log(`Parsed body to be ${JSON.stringify(body)}, checking userid match for ${userId}`)
        return body['detail-type'] != "Validator.NewOrder" && body.detail.userId == userId
    }

    msgs = await samtl.receiveEventBridgeMessage(
        testStack, 
        busName, 
        isMessageForThisTest, 
        2 /* expected messages */, 
        20 /* timeout seconds */)

    console.log(`Got msgs ${JSON.stringify(msgs)}`)

    // we're scoped down to our userId, should have exactly two messages
    expect(msgs.length).toBe(2)

    detailTypes = msgs.map(x => JSON.parse(x)['detail-type'])
    expect(detailTypes.sort()).toEqual(["OrderProcessor.ShopUnavailable", "OrderProcessor.orderFinished"])
}, 60*1000)