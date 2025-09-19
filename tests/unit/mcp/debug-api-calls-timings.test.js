const fs = require('fs');
const path = require('path');
const os = require('os');

function mktempDir(prefix = 'mcp_dbgt_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_debug_api_calls timing metrics', () => {
  test('computes first_ts, last_ts, and duration_ms (mocked Electron path)', async () => {
    const openPageMock = jest.fn(async () => ({}));
    const injectApiRecorderMock = jest.fn(async () => {});
    const closeMock = jest.fn(async () => {});
    const resolveEntryPathMock = jest.fn();

    jest.resetModules();
    const runtimeManagerModuleId = require.resolve('../../../src/mcp/runtime-manager');
    jest.doMock(runtimeManagerModuleId, () => ({
      RuntimeManager: {
        isSupported: true,
        openPage: openPageMock,
        injectApiRecorder: injectApiRecorderMock,
        getCapturedCalls: jest.fn(async () => ([
          { method: 'Initialize', parameters: [''], ts: 1000 },
          { method: 'SetValue', parameters: ['cmi.location', '1'], ts: 1100 },
          { method: 'Commit', parameters: [''], ts: 1200 },
          { method: 'Terminate', parameters: [''], ts: 1500 },
        ])),
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

      const res = await scorm_debug_api_calls({ workspace_path: dir });
      expect(res.supported).toBe(true);
      expect(res.entry_found).toBe(true);
      expect(res.metrics.first_ts).toBe(1000);
      expect(res.metrics.last_ts).toBe(1500);
      expect(res.metrics.duration_ms).toBe(500);
      expect(res.metrics.methods.sort()).toEqual(['Commit','Initialize','SetValue','Terminate'].sort());
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

