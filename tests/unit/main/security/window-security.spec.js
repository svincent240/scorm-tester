const path = require('path');

// We will capture BrowserWindow options by mocking electron before requiring the module

describe('Window security defaults', () => {
  let createdOptions = null;
  let permissionRequestHandler = null;

  beforeEach(() => {
    jest.resetModules();
    createdOptions = null;
    permissionRequestHandler = null;

    jest.doMock('electron', () => {
      class FakeBW {
        constructor(opts) {
          createdOptions = opts;
          this.id = 1;
          this.webContents = {
            on: jest.fn(),
            setWindowOpenHandler: jest.fn(),
            session: {
              setPermissionRequestHandler: jest.fn((handler) => {
                permissionRequestHandler = handler;
              }),
              webRequest: { onHeadersReceived: jest.fn() }
            },
            isDestroyed: () => false,
            send: jest.fn(),
            openDevTools: jest.fn()
          };
        }
        loadURL = jest.fn().mockResolvedValue();
        show = jest.fn();
        isDestroyed = () => false;
        on = jest.fn();
      }
      return { BrowserWindow: FakeBW, screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }, protocol: { registerFileProtocol: jest.fn(), isProtocolRegistered: () => true }, shell: {} };
    });
  });

  test('BrowserWindow is created with hardened webPreferences', async () => {
    const BaseService = require('../../../../src/main/services/base-service');
    const WindowManager = require('../../../../src/main/services/window-manager');

    const noopEH = { setError: () => {} };
    const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    const wm = new WindowManager(noopEH, noopLogger);
    await wm.initialize(new Map());
    await wm.createMainWindow();

    expect(createdOptions).toBeTruthy();
    const wp = createdOptions.webPreferences;
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.contextIsolation).toBe(true);
    expect(wp.sandbox).toBe(true);
    expect(wp.enableRemoteModule).toBe(false);
    expect(wp.webSecurity).toBe(true);
    expect(wp.webviewTag).toBe(false);
    expect(typeof wp.preload).toBe('string');
  });

  test('Permission handler allows clipboard access but denies other permissions', async () => {
    const BaseService = require('../../../../src/main/services/base-service');
    const WindowManager = require('../../../../src/main/services/window-manager');

    const noopEH = { setError: () => {} };
    const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    const wm = new WindowManager(noopEH, noopLogger);
    await wm.initialize(new Map());
    await wm.createMainWindow();

    expect(permissionRequestHandler).toBeTruthy();

    // Test clipboard permissions are allowed
    let callbackResult = null;
    permissionRequestHandler(null, 'clipboard-sanitized-write', (allowed) => {
      callbackResult = allowed;
    });
    expect(callbackResult).toBe(true);

    callbackResult = null;
    permissionRequestHandler(null, 'clipboard-read', (allowed) => {
      callbackResult = allowed;
    });
    expect(callbackResult).toBe(true);

    // Test other permissions are denied
    callbackResult = null;
    permissionRequestHandler(null, 'geolocation', (allowed) => {
      callbackResult = allowed;
    });
    expect(callbackResult).toBe(false);

    callbackResult = null;
    permissionRequestHandler(null, 'notifications', (allowed) => {
      callbackResult = allowed;
    });
    expect(callbackResult).toBe(false);

    callbackResult = null;
    permissionRequestHandler(null, 'media', (allowed) => {
      callbackResult = allowed;
    });
    expect(callbackResult).toBe(false);
  });
});

