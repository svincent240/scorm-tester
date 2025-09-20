const assert = require('assert');
let TokenBucketRateLimiter = null;
try { TokenBucketRateLimiter = require('../../../../src/main/services/ipc/rate-limiter'); } catch (_) { /* module removed per Phase 1 */ }

const suite = TokenBucketRateLimiter ? describe : describe.skip;

suite('TokenBucketRateLimiter - profiles and behavior', function() {
  let limiter;
  const sender = { id: 'sender-1' };

  beforeEach(function() {
    const { createLoggerSink } = require('../../../setup');
    const logger = createLoggerSink();
    limiter = new TokenBucketRateLimiter({}, logger);
    // Speed up tests by shrinking windows and limits where needed
    limiter.profiles.default = { windowMs: 1000, max: 3 };
    limiter.profiles.rendererLogs = { windowMs: 1000, max: 2, softDropOnLimit: true };
    limiter.profiles.uiSparse = { windowMs: 1000, max: 2 };
  });

  it('allows up to the profile max for default profile and then rejects', function() {
    const channel = 'some:default-channel';
    // First 3 calls should be allowed
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'default' }), true);
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'default' }), true);
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'default' }), true);
    // Exceeding the limit should return false
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'default' }), false);
  });

  it('rendererLogs profile exposes softDropOnLimit in profile and enforces higher limit', function() {
    const channel = 'renderer-log-info';
    // rendererLogs max is 2 in test setup
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'rendererLogs' }), true);
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'rendererLogs' }), true);
    // After hitting limit, limiter.allow returns false (softDrop is signalled via profileDef)
    assert.strictEqual(limiter.allow(sender, channel, { profile: 'rendererLogs' }), false);
    // Ensure profile object still indicates softDropOnLimit
    assert.strictEqual(limiter.profiles.rendererLogs.softDropOnLimit, true);
  });

  it('snBypass profile (and explicit SN channels) are not rate limited', function() {
    // Explicit SN bypass via channel name check
    assert.strictEqual(limiter.allow(sender, 'sn:getStatus', { profile: 'snBypass' }), true);
    assert.strictEqual(limiter.allow(sender, 'sn:processNavigation', {}), true);

    // snBypass profileDef is null in implementation; calling with profile snBypass should allow
    limiter.profiles.snBypass = null;
    assert.strictEqual(limiter.allow(sender, 'any-channel', { profile: 'snBypass' }), true);
  });

  

  it('allows scorm-get-value during the SCORM grace window even when profile would otherwise block', function() {
    const channel = 'scorm-get-value';
    // Force default profile to be effectively blocking by setting max to 0
    limiter.profiles.default.max = 0;

    // Provide a scormService that indicates a session started just now
    const fakeScorm = {
      getAllSessions: () => [{ startTime: Date.now() }]
    };

    // Because scorm-get-value check is performed early, this should return true despite the 0 max
    assert.strictEqual(limiter.allow(sender, channel, { scormService: fakeScorm, profile: 'default' }), true);

    // For non-scorm channels the same 0 max will block
    // For non-scorm channels the same 0 max will block
    assert.strictEqual(limiter.allow(sender, 'some-other-channel', { profile: 'default' }), false);
  });
});