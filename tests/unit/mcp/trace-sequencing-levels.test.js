const fs = require('fs');
const path = require('path');
const os = require('os');

function mktempDir(prefix = 'mcp_trcl_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('MCP scorm_trace_sequencing trace levels', () => {
  test('basic vs detailed vs verbose (mocked Electron path)', async () => {
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
        close: closeMock,
      },
      resolveEntryPathFromManifest: resolveEntryPathMock,
    }));

    const { scorm_trace_sequencing } = require('../../../src/mcp/tools/runtime');

    const dir = mktempDir();
    try {
      fs.writeFileSync(path.join(dir, 'imsmanifest.xml'), '<manifest/>');
      const indexPath = path.join(dir, 'index.html');
      fs.writeFileSync(indexPath, '<html><body>OK</body></html>');
      resolveEntryPathMock.mockResolvedValue(indexPath);

      const resBasic = await scorm_trace_sequencing({ workspace_path: dir, trace_level: 'basic' });
      expect(resBasic.supported).toBe(true);
      expect(resBasic.entry_found).toBe(true);
      expect(Array.isArray(resBasic.trace)).toBe(true);
      expect(resBasic.trace_level).toBe('basic');
      const basicSteps = resBasic.trace.map(t => t.step);
      expect(basicSteps).toEqual(expect.arrayContaining(['start', 'page_opened']));

      const resDetailed = await scorm_trace_sequencing({ workspace_path: dir, trace_level: 'detailed' });
      expect(resDetailed.supported).toBe(true);
      expect(resDetailed.entry_found).toBe(true);
      expect(Array.isArray(resDetailed.trace)).toBe(true);
      expect(resDetailed.trace_level).toBe('detailed');
      const detailedSteps = resDetailed.trace.map(t => t.step);
      expect(detailedSteps).toEqual(expect.arrayContaining(['start', 'manifest_resolved', 'page_opened', 'api_recorder_injected']));
      expect(resDetailed.trace.length).toBeGreaterThanOrEqual(resBasic.trace.length);

      const resVerbose = await scorm_trace_sequencing({ workspace_path: dir, trace_level: 'verbose' });
      expect(resVerbose.supported).toBe(true);
      expect(resVerbose.entry_found).toBe(true);
      expect(Array.isArray(resVerbose.trace)).toBe(true);
      expect(resVerbose.trace_level).toBe('verbose');
      const verboseSteps = resVerbose.trace.map(t => t.step);
      expect(verboseSteps).toEqual(expect.arrayContaining(['context_info']));
      expect(resVerbose.trace.length).toBeGreaterThanOrEqual(resDetailed.trace.length);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

