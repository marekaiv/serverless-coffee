// aws ssm put-parameter --name /Serverlesspresso/dummy --value dummy --type String

// Load SFN definition -- could also get from SFN itself 
fs = require('fs')
aslText = fs.readFileSync('op.asl.json')

const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const sfn = new AWS.StepFunctions()
const cfn = new AWS.CloudFormation()
const sqs = new AWS.SQS()
const sfnmock = require('./samtl_sfn_mock')
const getWithRetry = require('./samtl_get_with_retry')
const { fail } = require('assert')

testStack = process.env.SAMTL_TEST_STACK || 'slscoffee-4'

// const cloudWatch = new AWS.CloudWatch({apiVersion: '2010-08-01'})
// const eventbridge = new AWS.EventBridge()
// const ssm = new AWS.SSM()

// SLSTEST LIBRARY?? 
const getStackOutput = async(stackName, outputName) => {
    return cfn.describeStacks({ StackName: stackName })
        .promise()
        .then(stack => {
            return stack.Stacks[0].Outputs.filter(x => x.OutputKey == outputName)[0].OutputValue
        })
        // todo proper error handling
}

// // capture original SFN definition
// beforeAll(async () => {
//     stateMachineArn = await getStackOutput('slscoffee-4', 'OrderProcessorStateMachine')

//     console.log(`Got state machine ARN ${stateMachineArn}`)
//     machine = await sfn.describeStateMachine({ stateMachineArn: stateMachineArn }).promise()
//     originalSFNDefinition = machine['definition']
// })

test('sfn test1', async () => {
    userId = Math.floor(Math.random() * (2**32 - 1))
    asl = JSON.parse(aslText)

    stateMachineArn = await getStackOutput(testStack, 'OrderProcessorStateMachine')

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

    testQueueURL = await getStackOutput(testStack, "TestEventBridgeListenerQueue")
    console.log(`Retrieving message from test queue ${testQueueURL}`)

    msgs = []

    getMsgs = async () => {
        recv = await sqs.receiveMessage({
            AttributeNames: [ "SentTimestamp" ],
            MaxNumberOfMessages: 10,
            MessageAttributeNames: [ "All" ],
            QueueUrl: testQueueURL,
            VisibilityTimeout: 20,
            WaitTimeSeconds: 5
        }).promise()

        console.log(`Received SQS msgs: ${JSON.stringify(recv)}`)

        receipts = []
        // filter user ids
        recv.Messages.forEach(msg => {
            body = JSON.parse(msg.Body)
            console.log(`Parsed body to be ${JSON.stringify(body)}`)
            console.log(`Found ${body.detail.userId}, looking for ${userId}`)
            if(body.detail.userId == userId) {
                msgs.push(body)
                receipts.push({ Id: receipts.length, ReceiptHandle: msg.ReceiptHandle })
            }
        })

        if(receipts.length > 0) { // delete messages that belong to this test
            console.log(`Deleting ${receipts.length} SQS msgs`)
            await sqs.deleteMessageBatch({ Entries: receipts, QueueUrl: testQueueURL }).promise()
        }

        return msgs
    }

    await getWithRetry(getMsgs, (m) => m.length >= 2, 5, new Date(new Date().getTime() + 20000))

    // we're scoped down to our userId, should have exactly two messages
    expect(msgs.length).toBe(2)

    detailTypes = msgs.map(x => x['detail-type'])
    expect(detailTypes.sort()).toEqual(["OrderProcessor.ShopUnavailable", "OrderProcessor.orderFinished"])
}, 60*1000)