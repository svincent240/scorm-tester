const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_test_api_integration } = require('../../../src/mcp/tools/runtime');

function mktempDir(prefix = 'mcp_run_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_test_api_integration (always real)', () => {
  test('throws ELECTRON_REQUIRED when Electron not available; otherwise returns structured runtime results', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      let threw = false;
      try {
        const res = await scorm_test_api_integration({ workspace_path: dir, capture_api_calls: true, test_scenario: { steps: [] } });
        if (!process.versions.electron) {
          threw = false; // should not reach
        } else {
          expect(res).toHaveProperty('api_test_results');
          expect(res).toHaveProperty('manifest_ok');
          expect(typeof res.api_test_results.initialize_success).toBe('boolean');
          expect(Array.isArray(res.api_test_results.api_calls_captured)).toBe(true);
          expect(res.scenario_ack).toBe(true);
        }
      } catch (e) {
        threw = true;
        if (!process.versions.electron) {
          expect(e && e.code).toBe('ELECTRON_REQUIRED');
        } else {
          throw e;
        }
      }
      if (!process.versions.electron) expect(threw).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

