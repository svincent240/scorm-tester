const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_test_api_integration } = require('../../../src/mcp/tools/runtime');
const { RuntimeManager } = require('../../../src/mcp/runtime-manager');

function mktempDir(prefix = 'mcp_real_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeMinimalScormPackage(dir) {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MAN-1" version="1.0" xmlns:imscp="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Test Org</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Launch Item</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" adlcp:scormType="sco" href="index.html" type="webcontent" />
  </resources>
</manifest>`;
  fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), manifest);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>SCORM Test</title></head><body><div id="app">Hello</div></body></html>');
}

describe('Real SCORM API adapter (always on)', () => {
  test('captures API calls via preload bridge without flags', async () => {
    // Skip gracefully if Electron is not available in this environment
    if (!RuntimeManager.isSupported) {
      expect(RuntimeManager.isSupported).toBe(false);
      return;
    }

    const dir = mktempDir();
    try {
      writeMinimalScormPackage(dir);

      const res = await scorm_test_api_integration({
        workspace_path: dir,
        capture_api_calls: true,
        test_scenario: { steps: ['initialize', 'commit', 'terminate'] }
      });

      expect(res).toBeDefined();
      expect(res.manifest_ok).toBe(true);
      expect(res.api_test_results).toBeDefined();
      expect(res.api_test_results.initialize_success).toBe(true);
      expect(Array.isArray(res.api_test_results.api_calls_captured)).toBe(true);
      const methods = new Set(res.api_test_results.api_calls_captured.map(c => String(c.method)));
      expect(methods.has('Initialize')).toBe(true);
      expect(methods.has('Commit')).toBe(true);
      expect(methods.has('Terminate')).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

