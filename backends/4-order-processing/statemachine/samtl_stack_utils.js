const AWS = require('aws-sdk')
AWS.config.update({region: process.env.AWS_REGION})
const cfn = new AWS.CloudFormation()

const getStackOutput = async(stackName, outputName) => {
    return cfn.describeStacks({ StackName: stackName })
        .promise()
        .then(stack => {
            return stack.Stacks[0].Outputs.filter(x => x.OutputKey == outputName)[0].OutputValue
        })
        // todo proper error handling
}

const getStackParameter = async(stackName, parameterName) => {
    return cfn.describeStacks({ StackName: stackName })
        .promise()
        .then(stack => {
            parm = stack.Stacks[0].Parameters.filter(x => x.ParameterKey == parameterName)[0]
            return 'ResolvedValue' in parm ? parm.ResolvedValue : parm.ParameterValue
        })
        // todo proper error handling
}

module.exports = {
    getStackOutput: getStackOutput,
    getStackParameter: getStackParameter
}

