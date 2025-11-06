const fs = require('fs');
const path = require('path');
const os = require('os');

// We will mock the runtime-manager to simulate an Electron-capable environment
// for one of the tests. To ensure the mock is applied before the module under
// test is loaded, we conditionally require inside each test as needed.

function mktempDir(prefix = 'mcp_nav_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_test_navigation_flow', () => {
  test('throws ELECTRON_REQUIRED when Electron not available', async () => {
    // Load the real implementation (no mocks)
    const { scorm_test_navigation_flow } = require('../../../src/mcp/tools/runtime');

    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      let threw = false;
      try {
        await scorm_test_navigation_flow({
          workspace_path: dir,
          navigation_sequence: ['start', 'next', 'complete'],
          capture_each_step: true,
          viewport: { device: 'mobile' }
        });
      } catch (e) {
        threw = true;
        if (!process.versions.electron) {
          expect(e && e.code).toBe('ELECTRON_REQUIRED');
        } else {
          throw e;
        }
      }
      if (!process.versions.electron) expect(threw).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });

  test('Electron-mocked path: emits events, captures per-step artifacts, honors viewport presets', async () => {
    // Arrange mocks BEFORE requiring the module under test
    const fakeCapturePng = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG header bytes
    const openPageMock = jest.fn(async ({ entryPath, viewport }) => ({ entryPath, viewport }));
    const injectApiRecorderMock = jest.fn(async () => {});
    const captureMock = jest.fn(async () => fakeCapturePng);
    const closeMock = jest.fn(async () => {});
    const resolveEntryPathMock = jest.fn();

    jest.resetModules();
    const runtimeManagerModuleId = require.resolve('../../../src/mcp/runtime-manager');
    jest.doMock(runtimeManagerModuleId, () => ({
      RuntimeManager: {
        isSupported: true,
        openPage: openPageMock,
        injectApiRecorder: injectApiRecorderMock,
        capture: captureMock,
        close: closeMock,
      },
      resolveEntryPathFromManifest: resolveEntryPathMock,
    }));

    const { scorm_session_open, scorm_session_events, scorm_session_close } = require('../../../src/mcp/tools/session');
    const { scorm_test_navigation_flow } = require('../../../src/mcp/tools/runtime');

    const dir = mktempDir();
    try {
      // Prepare minimal workspace with an index.html; we will mock entry resolution anyway
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      const indexPath = path.join(dir, 'index.html');
      fs.writeFileSync(indexPath, '<html><body>OK</body></html>');
      resolveEntryPathMock.mockResolvedValue(indexPath);

      // Open a session to capture events and artifacts
      const session = await scorm_session_open({ package_path: dir });

      const nav = await scorm_test_navigation_flow({
        workspace_path: dir,
        session_id: session.session_id,
        navigation_sequence: ['start', 'next', 'complete'],
        capture_each_step: true,
        viewport: { device: 'mobile' }
      });

      // Assertions on result shape
      expect(nav.supported).toBe(true);
      expect(nav.entry_found).toBe(true);
      expect(nav.steps_executed).toBe(3);
      expect(Array.isArray(nav.artifacts)).toBe(true);
      expect(nav.artifacts.length).toBeGreaterThanOrEqual(1);

      // Assert viewport preset used (mobile)
      expect(openPageMock).toHaveBeenCalledTimes(1);
      const callArg = openPageMock.mock.calls[0][0];
      expect(callArg.viewport).toEqual({ width: 390, height: 844, scale: 1 });

      // Events should include navigation:start and navigation:completed and screenshot:capture_done
      const eventsRes = await scorm_session_events({ session_id: session.session_id });
      const types = (eventsRes.events || []).map(e => e.type);
      expect(types).toEqual(expect.arrayContaining(['navigation:start', 'navigation:completed']));
      expect(types).toEqual(expect.arrayContaining(['screenshot:capture_done']));

      // Close session
      const closed = await scorm_session_close({ session_id: session.session_id });
      expect(closed.success).toBe(true);

    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* intentionally empty */ }
    }
  });
});

