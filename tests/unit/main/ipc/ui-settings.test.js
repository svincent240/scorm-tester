const IpcHandler = require('../../../../src/main/services/ipc-handler');
const AppStateService = require('../../../../src/main/services/app-state');

// Minimal mocks for dependencies used by IpcHandler in these tests
const mockErrorHandler = { setError: jest.fn(), getError: jest.fn() };
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function createIpcHandlerWithAppState(appState) {
  const ipcHandler = new IpcHandler(mockErrorHandler, mockLogger, { IPC_REFACTOR_ENABLED: true });
  return ipcHandler.initialize(new Map([
    ['appState', appState],
  ])).then(() => ipcHandler);
}

describe('IPC: ui-settings get/set', () => {
  let ipcHandler;
  let appState;

  beforeEach(async () => {
    jest.clearAllMocks();
    appState = new AppStateService(mockErrorHandler, mockLogger);
    await appState.initialize(new Map());
    ipcHandler = await createIpcHandlerWithAppState(appState);
  });

  afterEach(() => {
    if (ipcHandler) ipcHandler.shutdown();
  });

  test('get returns default theme initially', async () => {
    const res = await ipcHandler.handleUIGetSettings({}, undefined);
    expect(res.success).toBe(true);
    expect(res.settings).toBeDefined();
    expect(res.settings.ui.theme).toBe('default');
  });

  test('set updates theme and get reflects change', async () => {
    const setRes = await ipcHandler.handleUISetSettings({}, { ui: { theme: 'dark' } });
    expect(setRes.success).toBe(true);
    expect(setRes.settings.ui.theme).toBe('dark');

    const getRes = await ipcHandler.handleUIGetSettings({}, undefined);
    expect(getRes.success).toBe(true);
    expect(getRes.settings.ui.theme).toBe('dark');
  });

  test('set updates boolean flags and get reflects change', async () => {
    const setRes = await ipcHandler.handleUISetSettings({}, { ui: { sidebarVisible: true, debugPanelVisible: false } });
    expect(setRes.success).toBe(true);
    expect(setRes.settings.ui.sidebarVisible).toBe(true);
    expect(setRes.settings.ui.debugPanelVisible).toBe(false);

    const getRes = await ipcHandler.handleUIGetSettings({}, undefined);
    expect(getRes.success).toBe(true);
    expect(getRes.settings.ui.sidebarVisible).toBe(true);
    expect(getRes.settings.ui.debugPanelVisible).toBe(false);
  });

  test('set rejects invalid theme value', async () => {
    const setRes = await ipcHandler.handleUISetSettings({}, { ui: { theme: 'neon' } });
    expect(setRes.success).toBe(false);
    expect(setRes.error).toBe('invalid_theme');

    const getRes = await ipcHandler.handleUIGetSettings({}, undefined);
    expect(getRes.success).toBe(true);
    expect(getRes.settings.ui.theme).toBe('default');
  });

  test('set rejects invalid boolean flags', async () => {
    let res = await ipcHandler.handleUISetSettings({}, { ui: { sidebarVisible: 'yes' } });
    expect(res.success).toBe(false);
    expect(res.error).toBe('invalid_sidebarVisible');
    res = await ipcHandler.handleUISetSettings({}, { ui: { devModeEnabled: 'no' } });
    expect(res.success).toBe(false);
    expect(res.error).toBe('invalid_devModeEnabled');
  });
});

