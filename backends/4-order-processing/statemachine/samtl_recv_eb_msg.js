const AWS = require('aws-sdk')
const sqs = new AWS.SQS()

const getWithRetry = require('./samtl_get_with_retry')

const receiveEventBridgeMessage = async (stackName, busName, filterFunction, expectedMsgCount, timeoutSec) => {
    queues = await sqs.listQueues({ QueueNamePrefix: stackName + '-' + busName + '-' + 'TestListenerQueue'}).promise() // todo max name size?
    queueUrl = queues.QueueUrls[0]

    console.log(`Retrieving message from test queue ${queueUrl}`)

    msgs = []  // used to collect messages received for this test (as checked by filterFunction)

    getMsgs = async () => {
        recv = await sqs.receiveMessage({
            AttributeNames: [ "SentTimestamp" ],
            MaxNumberOfMessages: 10,
            MessageAttributeNames: [ "All" ],
            QueueUrl: queueUrl,
            VisibilityTimeout: 20,
            WaitTimeSeconds: 5
        }).promise()

        console.log(`Received ${recv.Messages.length} SQS msgs: ${JSON.stringify(recv)}`)

        receipts = []
        // filter user ids
        recv.Messages.forEach(msg => {
            if(filterFunction(msg.Body)) {
                msgs.push(msg.Body)
                receipts.push({ Id: ''+receipts.length, ReceiptHandle: msg.ReceiptHandle })
            }
        })

        if(receipts.length > 0) { // delete messages that belong to this test
            console.log(`Deleting ${receipts.length} SQS msgs`)
            await sqs.deleteMessageBatch({ Entries: receipts, QueueUrl: queueUrl }).promise()
        }

        return msgs
    }

    await getWithRetry(getMsgs, (m) => m.length >= expectedMsgCount, 100 /* use high num and let timeout decide */, new Date(new Date().getTime() + timeoutSec*1000))
    return msgs
}

module.exports = receiveEventBridgeMessage