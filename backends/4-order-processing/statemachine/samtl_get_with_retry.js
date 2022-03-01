const exponentialDelay = (retryCount, backoff) => new Promise(resolve => setTimeout(resolve, 1000 * backoff ** retryCount));

const _getWithRetry = async (apiCall, checkApiCallResult, maxRetries, maxEndTime, retryCount = 0, lastError = null) => {
    if (retryCount > maxRetries) throw new Error(lastError);

    if(new Date() > maxEndTime) {
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

module.exports = getWithRetry