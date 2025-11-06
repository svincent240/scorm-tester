const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_take_screenshot } = require('../../../src/mcp/tools/runtime');

describe('MCP scorm_take_screenshot (always real)', () => {
  test('throws ELECTRON_REQUIRED when Electron not available; otherwise returns screenshot data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp_ss_'));
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      let threw = false;
      try {
        const result = await scorm_take_screenshot({ workspace_path: dir });
        if (!process.versions.electron) {
          // Should not reach here when Electron is not available
          threw = false;
        } else {
          expect(result).toHaveProperty('supported');
          expect(result.supported).toBe(true);
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

