const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_report } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_rpt_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const minimalManifest = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:imsss="http://www.imsglobal.org/xsd/imsss" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" identifier="MANIFEST-1">
  <organizations default="org1">
    <organization identifier="org1">
      <title>Org</title>
      <item identifier="i1" identifierref="res1">
        <title>Leaf with resource</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res1" adlcp:scormType="sco" href="index.html" />
  </resources>
</manifest>`;

describe('MCP scorm_report', () => {
  test('returns JSON report and score number', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), minimalManifest);
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>ok</body></html>');
      const res = await scorm_report({ workspace_path: dir });
      expect(res.format).toBe('json');
      expect(typeof res.compliance_score).toBe('number');
      const parsed = JSON.parse(res.report);
      expect(typeof parsed.score).toBe('number');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

