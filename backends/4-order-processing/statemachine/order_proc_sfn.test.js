// aws ssm put-parameter --name /Serverlesspresso/dummy --value dummy --type String

// Load SFN definition -- could also get from SFN itself 
fs = require('fs')
aslText = fs.readFileSync('op.asl.json')

const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const sfn = new AWS.StepFunctions()
const cfn = new AWS.CloudFormation()
const sfnmock = require('./samtl_sfn_mock')
const getWithRetry = require('./samtl_get_with_retry')
const receiveEventBridgeMessage = require('./samtl_recv_eb_msg')
const stackUtils = require('./samtl_stack_utils')
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
    userId = Math.floor(Math.random() * (2**32 - 1))
    asl = JSON.parse(aslText)

    stateMachineArn = await stackUtils.getStackOutput(testStack, 'OrderProcessorStateMachine')

    // set up state machine with mocks
    sfnmock.mockTaskState(asl, 'Get Shop Status', [
        { except: 'something went wrong' }, // emulate failure
        { response: { statusCode: 200, body: JSON.stringify({ storeOpen: true }), isBase64Encoded: false } }
    ])
    sfnmock.mockTaskState(asl, 'Get Capacity Status', { response: { isCapacityAvailable: false } })

    // update SFN with mock
    resp = await sfn.updateStateMachine({ stateMachineArn: stateMachineArn, definition: JSON.stringify(asl) }).promise()
    console.log(`SFN Update success ${JSON.stringify(resp)}`)
    // updateStateMachine is eventually consistent so sleep a bit ... todo need a better way
    await new Promise(resolve => setTimeout(resolve, 2500))

    // run test
    console.log(`Starting execution for ${stateMachineArn}`) // or should we start it through the EB Event rule?
    execResp = await sfn.startExecution({
            stateMachineArn: stateMachineArn,
            input: JSON.stringify({ detail: { userId: userId, orderId: 25 } })
        }).promise()
    console.log(`Execution started: ${JSON.stringify(execResp)}`)

    // wait until SFN execution completes
    getResult = async () => sfn.describeExecution({ executionArn: execResp.executionArn }).promise()
    checkResult = (resp) => {
        console.log(`checkResult ${JSON.stringify(resp)}`)
        return resp.status != 'RUNNING'
    }
    
    await getWithRetry(getResult, checkResult, 5, new Date(new Date().getTime() + 5000))
        .then(resp => {
            console.log(`SFN Done ${JSON.stringify(resp)}`)
            expect(resp.status).toBe('SUCCEEDED')
        })
        .catch(err => fail(`Test failed: ${err}`))

    // check that two EventBridge messages with the correct detail-type were generated
    const isMessageForThisTest = (msg) => {
        body = JSON.parse(msg)
        console.log(`Parsed body to be ${JSON.stringify(body)}`)
        console.log(`Found ${body.detail.userId}, looking for ${userId}`)
        return body.detail.userId == userId
    }

    msgs = await receiveEventBridgeMessage(
        testStack, 
        await stackUtils.getStackParameter(testStack, "CoreEventBusName"), 
        isMessageForThisTest, 
        2 /* expected messages */, 
        20 /* seconds */)

    // we're scoped down to our userId, should have exactly two messages
    expect(msgs.length).toBe(2)

    detailTypes = msgs.map(x => JSON.parse(x)['detail-type'])
    expect(detailTypes.sort()).toEqual(["OrderProcessor.ShopUnavailable", "OrderProcessor.orderFinished"])
}, 60*1000)