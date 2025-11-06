const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_lint_sequencing } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_seq_') {
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

describe('MCP scorm_lint_sequencing', () => {
  test('flags leaf items without identifierref', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), minimalBadManifest);
      const res = await scorm_lint_sequencing({ workspace_path: dir });
      expect(Array.isArray(res.issues)).toBe(true);
      const hasLeafIssue = res.issues.some(i => i.rule === 'leaf_without_identifierref');
      expect(hasLeafIssue).toBe(true);
      expect(res.stats.itemsScanned).toBeGreaterThan(0);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });
});

