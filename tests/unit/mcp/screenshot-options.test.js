const fs = require('fs');
const path = require('path');
const os = require('os');

function mktempDir(prefix = 'mcp_ss_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_take_screenshot capture_options', () => {
  test('Electron-mocked path: waits for selector then captures', async () => {
    const fakeCapturePng = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    const executeJavaScriptMock = jest.fn(async () => true);
    const fakeWin = { webContents: { executeJavaScript: executeJavaScriptMock } };
    const openPageMock = jest.fn(async () => fakeWin);
    const captureMock = jest.fn(async () => fakeCapturePng);
    const closeMock = jest.fn(async () => {});
    const resolveEntryPathMock = jest.fn();

    jest.resetModules();
    const runtimeManagerModuleId = require.resolve('../../../src/mcp/runtime-manager');
    jest.doMock(runtimeManagerModuleId, () => ({
      RuntimeManager: {
        isSupported: true,
        openPage: openPageMock,
        injectApiRecorder: jest.fn(async () => {}),
        capture: captureMock,
        close: closeMock,
      },
      resolveEntryPathFromManifest: resolveEntryPathMock,
    }));

    const { scorm_take_screenshot } = require('../../../src/mcp/tools/runtime');

    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      const indexPath = path.join(dir, 'index.html');
      fs.writeFileSync(indexPath, '<html><body><div id="ready">OK</div></body></html>');
      resolveEntryPathMock.mockResolvedValue(indexPath);

      const res = await scorm_take_screenshot({
        workspace_path: dir,
        viewport: { device: 'desktop' },
        capture_options: { wait_for_selector: '#ready', wait_timeout_ms: 1000, delay_ms: 0 }
      });

      expect(res.supported).toBe(true);
      expect(openPageMock).toHaveBeenCalledTimes(1);
      expect(executeJavaScriptMock).toHaveBeenCalled();
      // Ensure our polling script was invoked (contains document.querySelector)
      const args = executeJavaScriptMock.mock.calls[0][0];
      expect(typeof args).toBe('string');
      expect(args).toContain('document.querySelector');
      expect(captureMock).toHaveBeenCalledTimes(1);
      expect(typeof res.screenshot_data === 'string' || res.screenshot_data === null).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

