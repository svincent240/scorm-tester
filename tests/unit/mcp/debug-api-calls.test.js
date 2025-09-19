const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_debug_api_calls } = require('../../../src/mcp/tools/runtime');

function mktempDir(prefix = 'mcp_dbg_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_debug_api_calls (always real)', () => {
  test('throws ELECTRON_REQUIRED when Electron not available; otherwise returns calls and metrics', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      let threw = false;
      try {
        const res = await scorm_debug_api_calls({ workspace_path: dir });
        if (!process.versions.electron) {
          threw = false; // should not reach
        } else {
          expect(res).toHaveProperty('supported');
          expect(res.supported).toBe(true);
          expect(Array.isArray(res.calls)).toBe(true);
          expect(res.metrics && typeof res.metrics).toBe('object');
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

