const fs = require('fs');
const path = require('path');
const os = require('os');

function mktempDir(prefix = 'mcp_dbgm_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_debug_api_calls metrics', () => {
  test('computes total_calls and by_method (mocked Electron path)', async () => {
    const openPageMock = jest.fn(async () => ({}));
    const injectApiRecorderMock = jest.fn(async () => {});
    const getCapturedCallsMock = jest.fn(async () => ([
      { method: 'Initialize', parameters: [''] },
      { method: 'SetValue', parameters: ['cmi.location', '1'] },
      { method: 'SetValue', parameters: ['cmi.score.raw', '95'] },
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

      const res = await scorm_debug_api_calls({ workspace_path: dir });
      expect(res.supported).toBe(true);
      expect(res.entry_found).toBe(true);
      expect(Array.isArray(res.calls)).toBe(true);
      expect(res.metrics).toBeTruthy();
      expect(res.metrics.total_calls).toBe(5);
      expect(res.metrics.by_method).toEqual({ Initialize: 1, SetValue: 2, Commit: 1, Terminate: 1 });
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('metrics reflect filter_methods', async () => {
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

      const res = await scorm_debug_api_calls({ workspace_path: dir, filter_methods: ['Initialize', 'Commit'] });
      expect(res.supported).toBe(true);
      expect(res.entry_found).toBe(true);
      expect(Array.isArray(res.calls)).toBe(true);
      expect(res.calls.map(c => c.method)).toEqual(['Initialize', 'Commit']);
      expect(res.metrics.total_calls).toBe(2);
      expect(res.metrics.by_method).toEqual({ Initialize: 1, Commit: 1 });
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

