const assert = require('assert');
const TokenBucketRateLimiter = require('../../../../src/main/services/ipc/rate-limiter');
const createSingleflight = require('../../../../src/shared/utils/singleflight');
const ScormInspectorTelemetryStore = require('../../../../src/main/services/scorm-inspector/scorm-inspector-telemetry-store');

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

describe('ScormInspectorTelemetryStore', function() {
});

describe('FileManager (stubs)', function() {
  it.todo('add tests for extractZipWithValidation (requires zip fixtures)');
});