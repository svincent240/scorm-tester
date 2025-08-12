const assert = require('assert');
const createWrappedHandlerFactory = require('../../../../src/main/services/ipc/wrapper-factory');
const IPC_RESULT = require('../../../../src/shared/utils/ipc-result');
const createSingleflight = require('../../../../src/shared/utils/singleflight');

describe('IPC - Wrapper Factory', function() {

  it('returns failure envelope when handler is missing', async function() {
    const ctx = { logger: { error: () => {} }, recordOperation: () => {} };
    const route = { channel: 'missing-channel', handlerName: 'nonexistent', options: { useIpcResult: true } };
    const wrapped = createWrappedHandlerFactory.createWrappedHandler(route, ctx);
    const res = await wrapped({}, 'arg1');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'handler_not_found');
  });

  it('validation failure (unsafe path) returns validation_failed envelope when validateArgs=true', async function() {
    // extract-scorm is treated as path-like by validation helper
    const route = { channel: 'extract-scorm', handlerName: 'handleExtractScorm', options: { useIpcResult: true, validateArgs: true } };
    // ctx with a dummy handler that should not be called due to validation failure
    let called = false;
    const ctx = {
      handleExtractScorm: async () => { called = true; return { success: true }; },
      logger: { warn: () => {}, debug: () => {} },
      recordOperation: () => {}
    };
    const wrapped = createWrappedHandlerFactory.createWrappedHandler(route, ctx);
    // Provide unsafe path with traversal to trigger validation failure
    const res = await wrapped({}, '../etc/passwd');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'validation_failed');
    assert.strictEqual(called, false);
  });

  

  
});