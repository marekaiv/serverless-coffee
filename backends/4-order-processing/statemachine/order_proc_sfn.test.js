// aws ssm put-parameter --name /Serverlesspresso/dummy --value dummy --type String

// Load SFN definition -- could also get from SFN itself 
fs = require('fs')
asl = JSON.parse(fs.readFileSync('op.asl.json'))

const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const sfn = new AWS.StepFunctions()
const samtl = require('./samtl')
const { fail } = require('assert')

testStack = process.env.SAMTL_TEST_STACK || 'slscoffee-4'

// // capture original SFN definition
// beforeAll(async () => {
//     stateMachineArn = await getStackOutput('slscoffee-4', 'OrderProcessorStateMachine')

//     console.log(`Got state machine ARN ${stateMachineArn}`)
//     machine = await sfn.describeStateMachine({ stateMachineArn: stateMachineArn }).promise()
//     originalSFNDefinition = machine['definition']
// })

test('Test shop open but at capacity', async () => {
    stateMachineArn = await samtl.getStackOutput(testStack, 'OrderProcessorStateMachine')
    userId = Math.floor(Math.random() * (2**32 - 1))

    // set up state machine with mocks
    samtl.stepFnMockTaskState(asl, 'Get Shop Status', [
        { except: 'something went wrong' }, // emulate failure
        { response: { statusCode: 200, body: JSON.stringify({ storeOpen: true }), isBase64Encoded: false } }
    ])
    samtl.stepFnMockTaskState(asl, 'Get Capacity Status', { response: { isCapacityAvailable: false } })
    await samtl.stepFnUpdate(stateMachineArn, JSON.stringify(asl))

    // run test
    console.log(`Starting execution for ${stateMachineArn}`) // or should we start it through the EB Event rule?
    execResp = await sfn.startExecution({
            stateMachineArn: stateMachineArn,
            input: JSON.stringify({ detail: { userId: userId, orderId: 25 } })
        }).promise()
    console.log(`Execution started: ${JSON.stringify(execResp)}`)

    // wait until SFN execution completes -- optional and not possible for express state machines    
    await samtl.stepFnWaitUntilNotRunning(execResp.executionArn, 5000 /* ms */)
        .then(resp => {
            console.log(`SFN Done ${JSON.stringify(resp)}`)
            expect(resp.status).toBe('SUCCEEDED')
        })
        .catch(err => fail(`Test failed: ${err}`))

    // check that two EventBridge messages with the correct detail-type were generated
    const isMessageForThisTest = (msg) => {
        body = JSON.parse(msg)
        console.log(`Parsed body to be ${JSON.stringify(body)}, checking userid match for ${userId}`)
        return body.detail.userId == userId
    }

    msgs = await samtl.receiveEventBridgeMessage(
        testStack, 
        await samtl.getStackParameter(testStack, "CoreEventBusName"), 
        isMessageForThisTest, 
        2 /* expected messages */, 
        20 /* timout seconds */)

    // we're scoped down to our userId, should have exactly two messages
    expect(msgs.length).toBe(2)

    detailTypes = msgs.map(x => JSON.parse(x)['detail-type'])
    expect(detailTypes.sort()).toEqual(["OrderProcessor.ShopUnavailable", "OrderProcessor.orderFinished"])
}, 60*1000)