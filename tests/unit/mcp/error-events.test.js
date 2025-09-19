const fs = require('fs');
const path = require('path');
const os = require('os');
const { scorm_session_open, scorm_session_events, scorm_session_close } = require('../../../src/mcp/tools/session');
const { scorm_test_navigation_flow } = require('../../../src/mcp/tools/runtime');

function mktempDir(prefix = 'mcp_err_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP error event emission', () => {
  test('runtime tools emit an error event on failure', async () => {
    const dir = mktempDir();
    try {
      // Minimal manifest without a launchable resource
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>' );

      const opened = await scorm_session_open({ package_path: dir });
      expect(typeof opened.session_id).toBe('string');

      let threw = false;
      try {
        await scorm_test_navigation_flow({ workspace_path: dir, session_id: opened.session_id, navigation_sequence: ['continue'], capture_each_step: false });
      } catch (e) {
        threw = true;
        // In environments without Electron, tools throw ELECTRON_REQUIRED before try/catch.
        // When failure occurs inside the tool's try, we map to NAV_FLOW_ERROR.
        const code = e && e.code;
        expect(typeof code).toBe('string');
        expect(['ELECTRON_REQUIRED', 'NAV_FLOW_ERROR']).toContain(code);

        // Only expect an emitted error event when failure happened inside the tool (i.e., NAV_FLOW_ERROR)
        if (code === 'NAV_FLOW_ERROR') {
          const ev = await scorm_session_events({ session_id: opened.session_id, since_event_id: 0, max_events: 100 });
          expect(Array.isArray(ev.events)).toBe(true);
          const errEvent = ev.events.find(x => x && x.type === 'error');
          expect(errEvent).toBeTruthy();
          expect(errEvent && errEvent.payload && errEvent.payload.error_code).toBe('NAV_FLOW_ERROR');
        }
      }
      expect(threw).toBe(true);
    } finally {
      try { await scorm_session_close({ session_id: opened && opened.session_id }); } catch (_) {}
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

