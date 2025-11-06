const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_trace_sequencing } = require('../../../src/mcp/tools/runtime');

function mktempDir(prefix = 'mcp_trc_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_trace_sequencing (always real)', () => {
  test('throws ELECTRON_REQUIRED when Electron not available; otherwise returns trace', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      let threw = false;
      try {
        const res = await scorm_trace_sequencing({ workspace_path: dir });
        if (!process.versions.electron) {
          threw = false; // should not reach
        } else {
          expect(res).toHaveProperty('supported');
          expect(res.supported).toBe(true);
          expect(Array.isArray(res.trace)).toBe(true);
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });
});

