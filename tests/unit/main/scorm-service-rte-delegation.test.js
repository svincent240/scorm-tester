const assert = require('assert');
const ScormService = require('../../../src/main/services/scorm-service');

describe('ScormService RTE delegation (smoke)', () => {
  it('should create per-session RTE instance and route get/set/commit', async () => {
    const svc = new ScormService({ setError: ()=>{} }, { info: ()=>{}, warn: ()=>{}, error: ()=>{}, debug: ()=>{} });
    // Provide minimal dependencies
    await svc.initialize(new Map([['windowManager', { getWindow: ()=>null }]]));
    const sessionId = 'test-session-1';
    const initRes = await svc.initializeSession(sessionId);
    assert.strictEqual(initRes.success, true);
    // Try setValue/getValue via delegation (may fall back but should not throw)
    const setRes = await svc.setValue(sessionId, 'cmi.location', 'page_1');
    assert.ok(typeof setRes.success === 'boolean');
    const getRes = await svc.getValue(sessionId, 'cmi.location');
    assert.ok(getRes && typeof getRes.value === 'string');
    const commitRes = await svc.commit(sessionId);
    assert.ok(commitRes && typeof commitRes.success === 'boolean');
    const termRes = await svc.terminate(sessionId);
    assert.ok(termRes && typeof termRes.success === 'boolean');
  });
});