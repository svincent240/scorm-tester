const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_session_open, scorm_session_status, scorm_session_events, scorm_session_close } = require('../../../src/mcp/tools/session');

function mktempDir(prefix = 'mcp_test_') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

describe('MCP session tools', () => {
  let tempCourseDir;

  beforeAll(() => {
    tempCourseDir = mktempDir();
    // minimal manifest
    fs.writeFileSync(path.join(tempCourseDir, 'imsmanifest.xml'), '<manifest/>');
  });

  afterAll(() => {
    try {
      // clean input folder
      fs.rmSync(tempCourseDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('open → status → events → close', async () => {
    const opened = await scorm_session_open({ package_path: tempCourseDir, execution: { headless: true } });
    expect(typeof opened.session_id).toBe('string');
    expect(fs.existsSync(opened.workspace)).toBe(true);
    expect(fs.existsSync(opened.artifacts_manifest_path)).toBe(true);

    const status = await scorm_session_status({ session_id: opened.session_id });
    expect(["ready", "running", "closing"]).toContain(status.state);

    const ev = await scorm_session_events({ session_id: opened.session_id });
    expect(Array.isArray(ev.events)).toBe(true);
    expect(typeof ev.next_event_id).toBe('number');

    const closed = await scorm_session_close({ session_id: opened.session_id });
    expect(closed.success).toBe(true);
    expect(fs.existsSync(closed.artifacts_manifest_path)).toBe(true);
  });
});

