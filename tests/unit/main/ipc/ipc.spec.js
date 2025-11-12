const assert = require('assert');
const createSingleflight = require('../../../../src/shared/utils/singleflight');

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