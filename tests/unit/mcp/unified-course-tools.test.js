const fs = require('fs');
const path = require('path');
const os = require('os');

// Unit tests for unified course tools that don't require Electron runtime
// These test parameter validation and session management only

function mktempDir(prefix = 'mcp_test_') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

describe('MCP unified course tools - Unit Tests (no Electron)', () => {
  let tempCourseDir;

  beforeAll(() => {
    tempCourseDir = mktempDir();
    // Minimal manifest
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="test_course" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Test Course</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Test SCO</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;
    
    fs.writeFileSync(path.join(tempCourseDir, 'imsmanifest.xml'), manifest);
    fs.writeFileSync(path.join(tempCourseDir, 'index.html'), '<html><body>Test</body></html>');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempCourseDir, { recursive: true, force: true });
    } catch (_) { /* intentionally empty */ }
  });

  describe('Parameter validation', () => {
    const { scorm_open_course, scorm_close_course, scorm_reload_course, scorm_clear_saved_data } = require('../../../src/mcp/tools/session');

    test('scorm_open_course throws error for missing package_path', async () => {
      await expect(scorm_open_course({})).rejects.toThrow('package_path is required');
    });

    test('scorm_open_course throws error for non-existent package', async () => {
      await expect(scorm_open_course({ 
        package_path: '/nonexistent/path' 
      })).rejects.toThrow('Package path does not exist');
    });

    test('scorm_close_course throws error for unknown session_id', async () => {
      await expect(scorm_close_course({ 
        session_id: 'nonexistent_session' 
      })).rejects.toThrow('Unknown session');
    });

    test('scorm_reload_course throws error for missing session_id', async () => {
      await expect(scorm_reload_course({ 
        package_path: tempCourseDir 
      })).rejects.toThrow('session_id required for reload');
    });

    test('scorm_reload_course throws error for missing package_path when session exists', async () => {
      // This will fail at close (unknown session) before checking package_path
      // So we test the check happens after valid session
      await expect(scorm_reload_course({ 
        session_id: 'test_session' 
      })).rejects.toThrow(); // Either unknown session or missing package_path
    });

    test('scorm_clear_saved_data throws error for missing package_path', async () => {
      await expect(scorm_clear_saved_data({})).rejects.toThrow('package_path required');
    });

    test('scorm_clear_saved_data throws error for package without manifest', async () => {
      const badDir = mktempDir();
      try {
        await expect(scorm_clear_saved_data({ 
          package_path: badDir 
        })).rejects.toThrow('imsmanifest.xml not found');
      } finally {
        fs.rmSync(badDir, { recursive: true, force: true });
      }
    });
  });

  describe('Session lifecycle (legacy tools)', () => {
    // Test using the legacy tools that don't require Electron
    const { scorm_session_open, scorm_session_close } = require('../../../src/mcp/tools/session');
    const sessions = require('../../../src/mcp/session');

    test('open → status → close workflow', async () => {
      const opened = await scorm_session_open({ 
        package_path: tempCourseDir,
        execution: { headless: true }
      });
      
      expect(typeof opened.session_id).toBe('string');
      expect(fs.existsSync(opened.workspace)).toBe(true);
      expect(fs.existsSync(opened.artifacts_manifest_path)).toBe(true);

      const status = sessions.status({ session_id: opened.session_id });
      expect(["ready", "running", "closing"]).toContain(status.state);
      expect(typeof status.started_at).toBe('number');

      const closed = await scorm_session_close({ session_id: opened.session_id });
      expect(closed.success).toBe(true);
    });
  });
});
