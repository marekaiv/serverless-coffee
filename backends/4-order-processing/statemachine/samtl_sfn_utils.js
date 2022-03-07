// TESTING LIBRARY

const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const sfn = new AWS.StepFunctions()
const getWithRetry = require('./samtl_get_with_retry')


mockTaskState = (asl, name, output) => {
    state = asl['States'][name];
    state['Type'] = 'Task';
    state['Resource'] = 'arn:aws:states:::lambda:invoke';
    state['Parameters'] = {
        FunctionName: 'arn:aws:lambda:us-west-2:591171941290:function:sls-task-emulator',
        Payload: {
            'Original.$': '$',
            'Context.$': '$$',
            'RespondWith': output
        }
    }
}

waitForSFNToStop = async (executionArn, timeoutMSec) => {
    getResult = async () => sfn.describeExecution({ executionArn: executionArn }).promise()
    checkResult = (resp) => {
        console.log(`SFN checkResult ${executionArn}: ${JSON.stringify(resp)}`)
        return resp.status != 'RUNNING'
    }
    
    return getWithRetry(getResult, checkResult, 100000 /* don't limit retries */, new Date(new Date().getTime() + timeoutMSec))
}

updateDefinition = async (stateMachineArn, definition) => { 
    resp = await sfn.updateStateMachine({ stateMachineArn: stateMachineArn, definition: definition }).promise()
        .catch((err) => {
            console.log(`Error starting ${stateMachineArn}: ${err}`)
            throw err
        })
    console.log(`SFN Update success ${JSON.stringify(resp)}`)

    // updateStateMachine is eventually consistent so check if the update is finished
    start = new Date
    while(new Date - start < 15000) { // don't wait longer than 15s -- something's wrong if it takes longer
        machine = await sfn.describeStateMachine({ stateMachineArn: stateMachineArn }).promise()
        if(definition == machine['definition']) {
            console.log(`ASL definition for ${stateMachineArn} matches updated string`)
            return resp
        }
        await new Promise(resolve => setTimeout(resolve, 200))
    }

    throw new Error('State machine did not update in time')
}

module.exports = {
    mockTaskState: mockTaskState,
    updateDefinition: updateDefinition,

    waitForSFNToStop: waitForSFNToStop
}
