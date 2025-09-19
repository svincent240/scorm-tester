const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_lint_api_usage } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_api_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_lint_api_usage', () => {
  test('flags missing Initialize with SetValue', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), 'API_1484_11.SetValue("cmi.score.raw","90");');
      const res = await scorm_lint_api_usage({ workspace_path: dir });
      expect(res.scanned_files).toContain('sco.js');
      expect(Array.isArray(res.issues)).toBe(true);
      expect(res.issues.length).toBeGreaterThanOrEqual(1);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

