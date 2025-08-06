/**
 * SN ↔ Navigation Contract Tests (minimal non-breaking scaffold)
 * - Use only public SN entrypoint
 * - Deterministic activity-tree fixture
 * - No production code modifications
 */

const path = require('path');
const fs = require('fs');
const SN = require('../../../src/main/services/scorm/sn/index.js');

function readJSON(relPath) {
  const p = path.join(__dirname, '../../..', 'fixtures', relPath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('Contract: SN ↔ Navigation', () => {
  test('linear activity tree exposes forward navigation from start', () => {
    const tree = readJSON(path.join('activity-trees', 'linear.json'));
    const engine = SN.createEngine(tree);

    const state = engine.getStateSnapshot();
    expect(state).toBeDefined();
    expect(state.currentActivity || state.current).toBeDefined();

    const valid = engine.getValidRequests();
    // Contract-level expectation for a linear course: Continue should be valid at start.
    expect(valid).toBeDefined();
    const names = Array.isArray(valid) ? valid.map(v => v.request || v) : Object.keys(valid);
    // Do not overfit exact structure: accept array form or object form
    const flattened = Array.isArray(valid) ? names : Object.keys(valid).filter(k => valid[k] === true);
    expect(flattened).toEqual(expect.arrayContaining(['Continue', 'continue']));

    // Perform a Continue to move forward; ensure no error is thrown and state updates
    const prev = engine.getStateSnapshot();
    engine.request('Continue');
    const next = engine.getStateSnapshot();
    expect(next).toBeDefined();
    // basic invariant: state changed or current index advanced
    expect(JSON.stringify(next)).not.toEqual(JSON.stringify(prev));
  });
});