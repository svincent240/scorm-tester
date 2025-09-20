/**
 * @jest-environment jsdom
 *
 * Renderer must not initialize SN directly; SNBridge should use IPC only
 */

// Mock minimal Electron preload surface
jest.mock('electron', () => ({
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn() },
  contextBridge: { exposeInMainWorld: jest.fn() }
}));

beforeEach(() => {
  jest.clearAllMocks();
  // Provide a stubbed electronAPI with invoke spy
  window.electronAPI = {
    invoke: jest.fn().mockResolvedValue({ success: true }),
  };
});

describe('SNBridge (renderer) does not construct SN directly', () => {
  test('initialize and initializeCourse use IPC channels and never access main SN classes', async () => {
    const mod = await import('../../../src/renderer/services/sn-bridge.js');
    const { SNBridge } = mod;

    const bridge = new SNBridge();

    // initialize() should call sn:getStatus via IPC and set connected
    window.electronAPI.invoke.mockResolvedValueOnce({ success: true });
    const initRes = await bridge.initialize();
    expect(initRes.success).toBe(true);
    expect(window.electronAPI.invoke).toHaveBeenCalledWith('sn:getStatus', {});

    // initializeCourse should call sn:initialize via IPC
    window.electronAPI.invoke.mockResolvedValueOnce({ success: true, sessionId: 's1' });
    const courseRes = await bridge.initializeCourse({ organizations: {} }, { folderPath: '/tmp' });
    expect(courseRes.success).toBe(true);
    expect(window.electronAPI.invoke).toHaveBeenCalledWith('sn:initialize', expect.any(Object));

  });
});

