const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_validate_compliance } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_comp_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const minimalBadManifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:imsss="http://www.imsglobal.org/xsd/imsss" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" identifier="MANIFEST-1">
  <organizations default="org1">
    <organization identifier="org1">
      <title>Org</title>
      <item identifier="item1">
        <title>Leaf without identifierref</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res1" adlcp:scormType="sco" href="index.html" />
  </resources>
</manifest>`;

describe('MCP scorm_validate_compliance', () => {
  test('aggregates lint results and computes a score', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), minimalBadManifest);
      // add a simple file with API usage to surface api warnings
      fs.writeFileSync(path.join(dir, 'index.html'), '<script>API_1484_11.SetValue("cmi.score.raw","100");</script>');

      const res = await scorm_validate_compliance({ workspace_path: dir });
      expect(typeof res.compliance_score).toBe('number');
      expect(res.compliance_score).toBeGreaterThanOrEqual(0);
      expect(res.compliance_score).toBeLessThanOrEqual(100);
      expect(Array.isArray(res.errors)).toBe(true);
      expect(Array.isArray(res.warnings)).toBe(true);
      expect(Array.isArray(res.suggestions)).toBe(true);
      expect(typeof res.validation_report).toBe('string');
      // parseable JSON report
      const parsed = JSON.parse(res.validation_report);
      expect(typeof parsed.score).toBe('number');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });
});

