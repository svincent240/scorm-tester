const assert = require('assert');
const createWrappedHandlerFactory = require('../../../../src/main/services/ipc/wrapper-factory');

describe('open-debug-window singleflight + debounce behavior', function() {

  it('singleflight coalesces concurrent calls with same sender', async function() {
    const ctx = { logger: { error: () => {}, info: () => {}, warn: () => {} }, recordOperation: () => {} };
    let runCount = 0;
    // dummy actual handler simulates createDebugWindow side-effect
    ctx.handleOpenDebugWindow = async (event) => {
      runCount++;
      return { success: true };
    };

    const route = { channel: 'open-debug-window', handlerName: 'handleOpenDebugWindow', options: { singleFlight: true } };
    const wrapped = createWrappedHandlerFactory.createWrappedHandler(route, ctx);

    // Simulate two concurrent calls from same sender
    const sender = { id: 'sender-1' };
    const event1 = { sender };
    const p1 = wrapped(event1);
    const p2 = wrapped(event1);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(r1, r2, 'concurrent results should match');
    assert.strictEqual(runCount, 1, 'underlying handler should have run once due to singleflight');
  });

  it('debounce coalesces calls and schedules trailing execution', async function() {
    const ctx = { logger: { error: () => {}, info: () => {}, warn: () => {} }, recordOperation: () => {} };
    let runCount = 0;
    ctx.handleOpenDebugWindow = async (event) => {
      runCount++;
      return { success: true, runAt: Date.now() };
    };

    // Use debounceMs to force coalescing
    const route = { channel: 'open-debug-window', handlerName: 'handleOpenDebugWindow', options: { debounceMs: 200, useIpcResult: true } };
    const wrapped = createWrappedHandlerFactory.createWrappedHandler(route, ctx);

    const sender = { id: 'sender-2' };
    const ev = { sender };

    // First call schedules trailing execution and returns deferred
    const r1 = await wrapped(ev);
    assert.deepStrictEqual(r1, { success: true, data: { coalesced: true, deferred: true } } , 'first call should return deferred coalesced result');

    // Second call shortly after should also return deferred and not increase runCount immediately
    const r2 = await wrapped(ev);
    assert.deepStrictEqual(r2, { success: true, data: { coalesced: true, deferred: true } } , 'second call also deferred');

    // Wait longer than debounce to allow trailing execution to occur
    await new Promise(res => setTimeout(res, 400));

    // Underlying handler should have been run exactly once (trailing)
    assert.strictEqual(runCount, 1, 'debounce trailing execution should run underlying handler once');
  });
});