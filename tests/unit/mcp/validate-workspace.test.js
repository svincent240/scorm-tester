const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_validate_workspace } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_val_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_validate_workspace', () => {
  test('aggregates manifest and api usage', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      fs.writeFileSync(path.join(dir, 'sco.js'), 'SetValue("cmi.x","1");');
      const res = await scorm_validate_workspace({ workspace_path: dir });
      expect(res).toHaveProperty('validation_results');
      expect(res.validation_results).toHaveProperty('manifest');
      expect(res.validation_results).toHaveProperty('api_usage');
      expect(typeof res.compliance_score).toBe('number');
      expect(Array.isArray(res.actionable_fixes)).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

