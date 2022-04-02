
sfnmock.mockTaskState(asl, 'Get Shop Status', { statusCode: 200, body: JSON.stringify({ storeOpen: true }), isBase64Encoded: false })
sfnmock.mockTaskState(asl, 'Get Capacity Status', { isCapacityAvailable: false })


const AWS = require('aws-sdk')
const getWithRetry = require('./samtl_get_with_retry')
AWS.config.update({region: process.env.AWS_REGION})
const sfn = new AWS.StepFunctions()


updateSfn = async (arn, asl) => {
    resp = await sfn.updateStateMachine({ stateMachineArn: arn, definition: JSON.stringify(asl) }).promise()
    console.log(`SFN Update success ${JSON.stringify(resp)}`)
    console.log(`Starting execution for ${arn}`)
    return sfn.startExecution({
            stateMachineArn: arn,
            input: JSON.stringify({ 'detail': { 'userId': 100, 'orderId': 25}})
        }).promise()
}

updateSfn('arn:aws:states:us-west-2:591171941290:stateMachine:OrderProcessorStateMachine-KiT1d0o9UrAQ', asl)
    .then(x => { 
        console.log(`SFN Started ${JSON.stringify(x)}`);

        getResult = async () => sfn.describeExecution({ executionArn: x.executionArn }).promise()
        checkResult = (resp) => {
            console.log(`checkResult ${JSON.stringify(resp)}`)
            return resp.status != 'RUNNING'
        }
        
        resp = getWithRetry(getResult, checkResult, 5, new Date(new Date().getTime() + 5000))
        console.log(`Done done ${JSON.stringify(resp)}`)
    })
    .catch(err => { console.log('error'); console.log(err) })