const assert = require('assert');
const TokenBucketRateLimiter = require('../../../../src/main/services/ipc/rate-limiter');
const createSingleflight = require('../../../../src/shared/utils/singleflight');
const DebugTelemetryStore = require('../../../../src/main/services/debug/debug-telemetry-store');

describe('IPC - RateLimiter', function() {
  it('allows within limit and blocks when exceeded', function() {
    const rl = new TokenBucketRateLimiter();
    // create a tiny profile for test purposes
    rl.profiles.test = { windowMs: 1000, max: 2 };
    const sender = { id: 's1' };
    const ch = 'test-channel';
    assert.strictEqual(rl.allow(sender, ch, { profile: 'test' }), true);
    assert.strictEqual(rl.allow(sender, ch, { profile: 'test' }), true);
    assert.strictEqual(rl.allow(sender, ch, { profile: 'test' }), false);
  });

  it('snBypass channels are never limited', function() {
    const rl = new TokenBucketRateLimiter();
    const sender = { id: 's1' };
    assert.strictEqual(rl.allow(sender, 'sn:getStatus', {}), true);
  });
});

describe('IPC - Singleflight', function() {
  it('coalesces concurrent calls with same key', async function() {
    const sf = createSingleflight();
    let runCount = 0;
    const fn = async () => { runCount++; await new Promise(r => setTimeout(r, 50)); return 'ok'; };
    const p1 = sf('k', fn);
    const p2 = sf('k', fn);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1, 'ok');
    assert.strictEqual(r2, 'ok');
    assert.strictEqual(runCount, 1);
  });
});

describe('DebugTelemetryStore', function() {
  it('trims history to maxSize and supports getHistory/flushTo', function() {
    const store = new DebugTelemetryStore({ maxSize: 3, logger: null });
    store.storeApiCall({ id: 1 });
    store.storeApiCall({ id: 2 });
    store.storeApiCall({ id: 3 });
    store.storeApiCall({ id: 4 });
    const h = store.getHistory();
    assert.strictEqual(h.length, 3);
    assert.strictEqual(h[0].id, 2); // oldest (1) trimmed
    // flushTo should not throw when provided a minimal webContents-like object
    store.flushTo({ send: () => {} });
  });
});

describe('FileManager (stubs)', function() {
  it.todo('add tests for extractZipWithValidation (requires zip fixtures)');
});