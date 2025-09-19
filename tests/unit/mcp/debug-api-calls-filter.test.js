const fs = require('fs');
const path = require('path');
const os = require('os');

function mktempDir(prefix = 'mcp_dbgf_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_debug_api_calls with filter_methods', () => {
  test('Electron-mocked path: returns only filtered methods', async () => {
    const openPageMock = jest.fn(async () => ({}));
    const injectApiRecorderMock = jest.fn(async () => {});
    const getCapturedCallsMock = jest.fn(async () => ([
      { method: 'Initialize', parameters: [''] },
      { method: 'SetValue', parameters: ['cmi.location', '1'] },
      { method: 'Commit', parameters: [''] },
      { method: 'Terminate', parameters: [''] },
    ]));
    const closeMock = jest.fn(async () => {});
    const resolveEntryPathMock = jest.fn();

    jest.resetModules();
    const runtimeManagerModuleId = require.resolve('../../../src/mcp/runtime-manager');
    jest.doMock(runtimeManagerModuleId, () => ({
      RuntimeManager: {
        isSupported: true,
        openPage: openPageMock,
        injectApiRecorder: injectApiRecorderMock,
        getCapturedCalls: getCapturedCallsMock,
        close: closeMock,
      },
      resolveEntryPathFromManifest: resolveEntryPathMock,
    }));

    const { scorm_debug_api_calls } = require('../../../src/mcp/tools/runtime');

    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      const indexPath = path.join(dir, 'index.html');
      fs.writeFileSync(indexPath, '<html><body>OK</body></html>');
      resolveEntryPathMock.mockResolvedValue(indexPath);

      const res = await scorm_debug_api_calls({
        workspace_path: dir,
        filter_methods: ['Initialize', 'Commit']
      });

      expect(res.supported).toBe(true);
      expect(res.entry_found).toBe(true);
      expect(Array.isArray(res.calls)).toBe(true);
      const methods = res.calls.map(c => c.method);
      expect(methods).toEqual(['Initialize', 'Commit']);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

