const fs = require('fs');
const path = require('path');
const os = require('os');
const sessions = require('../../../src/mcp/session');
const { scorm_report } = require('../../../src/mcp/tools/validate');

function mktempDir(prefix = 'mcp_rpth_') {
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

describe('MCP scorm_report (HTML variant)', () => {
  test('returns HTML when format:html is requested', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), minimalManifest);
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>ok</body></html>');
      const res = await scorm_report({ workspace_path: dir, format: 'html' });
      expect(res.format).toBe('html');
      expect(typeof res.report).toBe('string');
      expect(res.report.toLowerCase()).toContain('<html');
      expect(typeof res.compliance_score).toBe('number');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });

  test('writes HTML report artifact when session_id is provided', async () => {
    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), minimalManifest);
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>ok</body></html>');
      const { session_id, workspace } = sessions.open({ package_path: dir });
      const res = await scorm_report({ workspace_path: dir, format: 'html', session_id });
      expect(res.format).toBe('html');
      expect(typeof res.report).toBe('string');
      expect(res.report.toLowerCase()).toContain('<html');
      expect(typeof res.compliance_score).toBe('number');
      expect(res.artifact_path).toBeTruthy();
      expect(fs.existsSync(res.artifact_path)).toBe(true);
      // artifacts manifest should include the report entry
      const manifestPath = path.join(workspace, 'artifacts_manifest.json');
      const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const hasReport = (doc.artifacts || []).some(a => a.type === 'report' && a.path === res.artifact_path);
      expect(hasReport).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });
});

