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

  it('singleflight coalesces concurrent calls with same sender', async function() {
    const route = { channel: 'open-debug-window', handlerName: 'handleOpenDebugWindow', options: { singleFlight: true } };
    let runCount = 0;
    const handlerDelay = 100;
    const ctx = {
      handleOpenDebugWindow: async () => { runCount++; await new Promise(r => setTimeout(r, handlerDelay)); return { created: true }; },
      logger: { info: () => {}, debug: () => {}, warn: () => {} },
      recordOperation: () => {},
      getDependency: () => null
    };
    // Ensure wrapper-factory will construct a singleflight instance
    const wrapped = createWrappedHandlerFactory.createWrappedHandler(route, ctx);
    const fakeEvent = { sender: { id: 'sender1' } };
    const p1 = wrapped(fakeEvent);
    const p2 = wrapped(fakeEvent);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(r1, r2);
    // The underlying handler should have run once due to singleflight
    assert.strictEqual(runCount, 1);
  });

  it('debounce coalesces calls and schedules trailing execution', async function() {
    const route = { channel: 'open-debug-window', handlerName: 'handleOpenDebugWindow', options: { debounceMs: 200 } };
    let runCount = 0;
    const ctx = {
      handleOpenDebugWindow: async () => { runCount++; return { done: true }; },
      logger: { info: () => {}, debug: () => {}, warn: () => {} },
      recordOperation: () => {},
      getDependency: () => null
    };
    const wrapped = createWrappedHandlerFactory.createWrappedHandler(route, ctx);
    const fakeEvent = { sender: { id: 'sender-debounce' } };
    // First call schedules trailing execution
    const res1 = await wrapped(fakeEvent);
    assert.ok(res1 && (res1.coalesced === true || res1.deferred === true || res1.success === true));
    // Call again quickly to coalesce into trailing
    const res2 = await wrapped(fakeEvent);
    assert.ok(res2 && (res2.coalesced === true || res2.deferred === true || res2.success === true));
    // Wait longer than debounceMs to allow trailing execution to occur
    await new Promise(r => setTimeout(r, 350));
    // Trailing handler should have been invoked at least once
    assert.ok(runCount >= 1, 'Trailing execution did not run');
  });
});