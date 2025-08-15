/**
 * Window Management Integration Tests
 *
 * Tests the complete window lifecycle including creation, destruction,
 * state persistence, multi-window scenarios, protocol registration,
 * and crash recovery according to SCORM 2004 4th Edition requirements.
 *
 * @fileoverview Integration tests for WindowManager service
 */

const WindowManager = require('../../src/main/services/window-manager');
const {
  WINDOW_TYPES,
  WINDOW_STATES,
  SERVICE_EVENTS
} = require('../../src/shared/constants/main-process-constants');
const { createLoggerSink, makeTempDir, rimraf } = require('../setup');

// Mock Electron modules - define mocks before using them
const mockBrowserWindowInstances = [];

const createMockBrowserWindow = (options) => {
  const instance = {
    id: Math.floor(Math.random() * 10000),
    options,
    isDestroyed: jest.fn(() => false),
    close: jest.fn(),
    show: jest.fn(),
    focus: jest.fn(),
    loadURL: jest.fn().mockResolvedValue(undefined),
    webContents: {
      send: jest.fn(),
      isDestroyed: jest.fn(() => false),
      openDevTools: jest.fn(),
      on: jest.fn() // Add missing webContents.on method
    },
    on: jest.fn(),
    emit: jest.fn(),
    _events: new Map()
  };

  // Store event handlers for testing
  instance.on.mockImplementation((event, handler) => {
    instance._events.set(event, handler);
  });

  mockBrowserWindowInstances.push(instance);
  return instance;
};

// Mock Electron after defining the mock objects
jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation((options) => {
    return createMockBrowserWindow(options);
  }),
  screen: {
    getPrimaryDisplay: jest.fn(() => ({
      workAreaSize: { width: 1920, height: 1080 }
    }))
  },
  protocol: {
    registerFileProtocol: jest.fn((scheme, handler) => {
      return true;
    })
  }
}));

// Mock path utilities
jest.mock('../../src/shared/utils/path-utils', () => ({
  getPreloadPath: jest.fn(() => '/mock/preload.js'),
  getAppRoot: jest.fn(() => '/mock/app'),
  handleProtocolRequest: jest.fn((url, appRoot) => ({
    success: true,
    resolvedPath: '/mock/resolved/path'
  })),
  fileExists: jest.fn(() => true)
}));

// Mock menu builder
jest.mock('../../src/main/services/menu-builder', () => {
  return jest.fn().mockImplementation(() => ({
    createApplicationMenu: jest.fn()
  }));
});

describe('Window Management Integration Tests', () => {
  let windowManager;
  let logger;
  let errorHandler;
  let tempDir;

  beforeEach(() => {
    // Reset mocks
    mockBrowserWindowInstances.length = 0;

    // Get the actual mocked electron module
    const { protocol, BrowserWindow } = require('electron');
    protocol.registerFileProtocol.mockClear();
    protocol.registerFileProtocol.mockReturnValue(true); // Reset to success by default
    BrowserWindow.mockClear();

    // Reset BrowserWindow to default implementation
    BrowserWindow.mockImplementation((options) => {
      return createMockBrowserWindow(options);
    });

    // Create test dependencies
    logger = createLoggerSink();
    errorHandler = {
      setError: jest.fn(),
      getLastError: jest.fn(() => null)
    };

    tempDir = makeTempDir('window-test-');

    // Create WindowManager instance
    windowManager = new WindowManager(errorHandler, logger);
  });

  afterEach(async () => {
    if (windowManager) {
      await windowManager.shutdown();
    }
    rimraf(tempDir);
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    test('should initialize successfully with protocol registration', async () => {
      const result = await windowManager.initialize(new Map());

      expect(result).toBe(true);

      // Get the actual mocked protocol
      const { protocol } = require('electron');
      expect(protocol.registerFileProtocol).toHaveBeenCalledWith(
        'scorm-app',
        expect.any(Function)
      );
      expect(windowManager.protocolRegistered).toBe(true);
      expect(logger.entries.some(e =>
        e.level === 'info' &&
        e.msg.includes('Custom protocol "scorm-app://" registered successfully')
      )).toBe(true);
    });

    test('should handle protocol registration failure', async () => {
      // Create a new WindowManager with protocol failure mock
      const { protocol } = require('electron');
      protocol.registerFileProtocol.mockReturnValue(false);

      const failingWindowManager = new WindowManager(errorHandler, logger);

      // WindowManager should return false when protocol registration fails
      const result = await failingWindowManager.initialize(new Map());
      expect(result).toBe(false);
      expect(failingWindowManager.protocolRegistered).toBe(false);
      expect(errorHandler.setError).toHaveBeenCalled();
    });

    test('should initialize window states correctly', async () => {
      await windowManager.initialize(new Map());

      expect(windowManager.windowStates.get(WINDOW_TYPES.MAIN)).toBe(WINDOW_STATES.CLOSED);
    });
  });

  describe('Main Window Lifecycle', () => {
    beforeEach(async () => {
      await windowManager.initialize(new Map());
    });

    test('should create main window successfully', async () => {
      const mainWindow = await windowManager.createMainWindow();

      expect(mainWindow).toBeDefined();
      expect(mainWindow.loadURL).toHaveBeenCalledWith('scorm-app://index.html');
      expect(mainWindow.show).toHaveBeenCalled();
      expect(windowManager.getWindow(WINDOW_TYPES.MAIN)).toBe(mainWindow);
      expect(windowManager.windowStates.get(WINDOW_TYPES.MAIN)).toBe(WINDOW_STATES.READY);
    });

    test('should handle main window creation failure', async () => {
      const { BrowserWindow } = require('electron');
      BrowserWindow.mockImplementation(() => {
        throw new Error('Window creation failed');
      });

      await expect(windowManager.createMainWindow()).rejects.toThrow('Window creation failed');
      expect(windowManager.windowStates.get(WINDOW_TYPES.MAIN)).toBe(WINDOW_STATES.CLOSED);
      expect(errorHandler.setError).toHaveBeenCalled();
    });

    test('should set up main window event handlers', async () => {
      const mainWindow = await windowManager.createMainWindow();

      // Verify event handlers were registered
      expect(mainWindow.on).toHaveBeenCalledWith('closed', expect.any(Function));
      expect(mainWindow.on).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(mainWindow.on).toHaveBeenCalledWith('minimize', expect.any(Function));
      expect(mainWindow.on).toHaveBeenCalledWith('maximize', expect.any(Function));
      expect(mainWindow.on).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    });

    test('should handle window state transitions', async () => {
      const mainWindow = await windowManager.createMainWindow();
      const events = [];

      windowManager.on('windowStateChanged', (data) => {
        events.push(data);
      });

      // Simulate window events
      const closedHandler = mainWindow._events.get('closed');
      const focusHandler = mainWindow._events.get('focus');
      const minimizeHandler = mainWindow._events.get('minimize');

      focusHandler();
      expect(windowManager.windowStates.get(WINDOW_TYPES.MAIN)).toBe(WINDOW_STATES.FOCUSED);

      minimizeHandler();
      expect(windowManager.windowStates.get(WINDOW_TYPES.MAIN)).toBe(WINDOW_STATES.MINIMIZED);

      closedHandler();
      expect(windowManager.windowStates.get(WINDOW_TYPES.MAIN)).toBe(WINDOW_STATES.CLOSED);
      expect(windowManager.getWindow(WINDOW_TYPES.MAIN)).toBeNull();

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-Window Scenarios', () => {
    beforeEach(async () => {
      await windowManager.initialize(new Map());
      await windowManager.createMainWindow();
    });

    test('should create SCORM Inspector window', async () => {
      const inspectorWindow = await windowManager.createScormInspectorWindow();

      expect(inspectorWindow).toBeDefined();
      expect(inspectorWindow.loadURL).toHaveBeenCalledWith('scorm-app://scorm-inspector.html');
      expect(inspectorWindow.show).toHaveBeenCalled();
      expect(windowManager.getWindow(WINDOW_TYPES.SCORM_INSPECTOR)).toBe(inspectorWindow);
      expect(windowManager.windowStates.get(WINDOW_TYPES.SCORM_INSPECTOR)).toBe(WINDOW_STATES.READY);
    });

    test('should focus existing SCORM Inspector window instead of creating new one', async () => {
      const firstWindow = await windowManager.createScormInspectorWindow();
      const secondWindow = await windowManager.createScormInspectorWindow();

      expect(secondWindow).toBe(firstWindow);
      expect(firstWindow.focus).toHaveBeenCalledTimes(1);
      expect(mockBrowserWindowInstances.filter(w =>
        w.options.title === 'SCORM Inspector'
      )).toHaveLength(1);
    });

    test('should handle multiple window broadcasting', async () => {
      await windowManager.createScormInspectorWindow();

      const sentCount = windowManager.broadcastToAllWindows('test-channel', { test: 'data' });

      expect(sentCount).toBe(2); // Main + Inspector
      mockBrowserWindowInstances.forEach(window => {
        expect(window.webContents.send).toHaveBeenCalledWith('test-channel', { test: 'data' });
      });
    });
  });

  describe('Protocol Registration and Recovery', () => {
    test('should handle protocol request correctly', async () => {
      await windowManager.initialize(new Map());

      // Get the protocol handler that was registered
      const { protocol } = require('electron');
      const protocolCall = protocol.registerFileProtocol.mock.calls[0];
      expect(protocolCall[0]).toBe('scorm-app');

      const protocolHandler = protocolCall[1];
      expect(typeof protocolHandler).toBe('function');

      // Test protocol handler with mock callback
      const mockCallback = jest.fn();
      protocolHandler({ url: 'scorm-app://index.html' }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({ path: '/mock/resolved/path' });
    });

    test('should handle protocol request failure', async () => {
      // Mock path utils to return failure
      const PathUtils = require('../../src/shared/utils/path-utils');
      PathUtils.handleProtocolRequest.mockReturnValue({
        success: false,
        error: 'File not found'
      });

      await windowManager.initialize(new Map());

      const { protocol } = require('electron');
      const protocolHandler = protocol.registerFileProtocol.mock.calls[0][1];
      const mockCallback = jest.fn();

      protocolHandler({ url: 'scorm-app://nonexistent.html' }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({ error: -6 }); // ERR_FILE_NOT_FOUND
    });

    test('should prevent duplicate protocol registration', async () => {
      // First initialization should succeed
      const result1 = await windowManager.initialize(new Map());
      expect(result1).toBe(true);
      expect(windowManager.protocolRegistered).toBe(true);

      // Try to initialize again - should still succeed but not register protocol again
      const result2 = await windowManager.initialize(new Map());
      expect(result2).toBe(true);

      // Should only register protocol once
      const { protocol } = require('electron');
      expect(protocol.registerFileProtocol).toHaveBeenCalledTimes(1);
    });
  });

  describe('Window Crash Recovery', () => {
    beforeEach(async () => {
      await windowManager.initialize(new Map());
    });

    test('should handle destroyed window gracefully', async () => {
      const mainWindow = await windowManager.createMainWindow();

      // Simulate window destruction
      mainWindow.isDestroyed.mockReturnValue(true);

      // getWindow should return null for destroyed windows
      expect(windowManager.getWindow(WINDOW_TYPES.MAIN)).toBeNull();
    });

    test('should handle webContents destruction in broadcasting', async () => {
      const mainWindow = await windowManager.createMainWindow();
      const inspectorWindow = await windowManager.createScormInspectorWindow();

      // Simulate webContents destruction on one window
      mainWindow.webContents.isDestroyed.mockReturnValue(true);

      const sentCount = windowManager.broadcastToAllWindows('test-channel', { test: 'data' });

      // Should only send to the inspector window
      expect(sentCount).toBe(1);
      expect(inspectorWindow.webContents.send).toHaveBeenCalledWith('test-channel', { test: 'data' });
      expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    });

    test('should handle window send errors gracefully', async () => {
      const mainWindow = await windowManager.createMainWindow();

      // Simulate send error
      mainWindow.webContents.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      // Should not throw, but log warning
      const sentCount = windowManager.broadcastToAllWindows('test-channel', { test: 'data' });

      expect(sentCount).toBe(0);
      expect(logger.entries.some(e =>
        e.level === 'warn' &&
        e.msg.includes('Failed to send message to window')
      )).toBe(true);
    });
  });

  describe('Service Shutdown', () => {
    test('should close all windows on shutdown', async () => {
      await windowManager.initialize(new Map());
      const mainWindow = await windowManager.createMainWindow();
      const inspectorWindow = await windowManager.createScormInspectorWindow();

      await windowManager.shutdown();

      expect(mainWindow.close).toHaveBeenCalled();
      expect(inspectorWindow.close).toHaveBeenCalled();
      expect(windowManager.windows.size).toBe(0);
      expect(windowManager.windowStates.size).toBe(0);
    });

    test('should handle shutdown with destroyed windows', async () => {
      await windowManager.initialize(new Map());
      const mainWindow = await windowManager.createMainWindow();

      // Simulate window already destroyed
      mainWindow.isDestroyed.mockReturnValue(true);

      // Should not throw during shutdown
      await expect(windowManager.shutdown()).resolves.not.toThrow();
      expect(mainWindow.close).not.toHaveBeenCalled(); // Don't close destroyed windows
    });
  });
});