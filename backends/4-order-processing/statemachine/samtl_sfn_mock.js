// TESTING LIBRARY
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
    };
};

module.exports = {
    mockTaskState: mockTaskState
}
