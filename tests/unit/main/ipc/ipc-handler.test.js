const IpcHandler = require('../../../../src/main/services/ipc-handler');
const EventEmitter = require('events');
const { ipcMain, BrowserWindow } = require('electron');

// Mock dependencies
const mockErrorHandler = {
  setError: jest.fn(),
  getLastError: jest.fn(),
  getErrorString: jest.fn(),
  clearError: jest.fn(),
};
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockScormService = {
  _apiCallLoggedCallback: null,
  _courseLoadedCallback: null,
  _sessionResetCallback: null,
  onScormApiCallLogged: jest.fn((callback) => {
    mockScormService._apiCallLoggedCallback = callback;
  }),
  eventEmitter: {
    on: jest.fn((event, callback) => {
      if (event === 'course:loaded') {
        mockScormService._courseLoadedCallback = callback;
      } else if (event === 'session:reset') {
        mockScormService._sessionResetCallback = callback;
      }
    }),
  },
};
const mockWindowManager = {
  windows: new Map(),
  getWindow: jest.fn(),
  createDebugWindow: jest.fn(),
};
const mockTelemetryStore = {
  clear: jest.fn(),
  getHistory: jest.fn(),
  storeApiCall: jest.fn(),
};
const mockFileManager = {
  selectScormPackage: jest.fn(),
  selectScormFolder: jest.fn(),
  extractScorm: jest.fn(),
  saveTemporaryFile: jest.fn(),
  findScormEntry: jest.fn(),
  getCourseInfo: jest.fn(),
  getCourseManifest: jest.fn(),
};

describe('IpcHandler Event Broadcasting', () => {
  let ipcHandler;

  beforeEach(async () => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Reset mockWindowManager.windows for each test
    mockWindowManager.windows.clear();

    // Manually set the implementation of onScormApiCallLogged after it's defined as a jest.fn()
    mockScormService.onScormApiCallLogged.mockImplementation((callback) => {
      mockScormService._apiCallLoggedCallback = callback;
    });

    // Manually set the implementation of eventEmitter.on after it's defined as a jest.fn()
    mockScormService.eventEmitter.on.mockImplementation((event, callback) => {
      if (event === 'course:loaded') {
        mockScormService._courseLoadedCallback = callback;
      } else if (event === 'session:reset') {
        mockScormService._sessionResetCallback = callback;
      }
    });

    // Create a new IpcHandler instance for each test
    ipcHandler = new IpcHandler(mockErrorHandler, mockLogger, {
      IPC_REFACTOR_ENABLED: true,
    });

    // Initialize the IpcHandler with dependencies
    await ipcHandler.initialize(new Map([
      ['scormService', mockScormService],
      ['windowManager', mockWindowManager],
      ['telemetryStore', mockTelemetryStore],
      ['fileManager', mockFileManager], // Add mockFileManager here
    ]));

    // Reset the clear mock after initialization to only count calls triggered by events
    mockTelemetryStore.clear.mockClear();
  });

  afterEach(() => {
    // Shut down the IpcHandler after each test
    ipcHandler.shutdown();
  });

  it('should subscribe to scorm-api-call-logged from ScormService and broadcast it', () => {
    // Simulate a renderer window being open
    const mockWebContents = { send: jest.fn() };
    const mockWindow = {
      id: 1,
      isDestroyed: () => false,
      webContents: mockWebContents,
    };
    mockWindowManager.windows.set(1, mockWindow);

    // Verify that onScormApiCallLogged was called during initialization
    expect(mockScormService.onScormApiCallLogged).toHaveBeenCalledTimes(1);

    // Get the callback function passed to onScormApiCallLogged
    const apiCallLoggedCallback = mockScormService.onScormApiCallLogged.mock.calls[0][0];

    // Simulate an API call event from ScormService
    const apiCallPayload = {
      method: 'Initialize',
      parameters: [''],
      result: 'true',
      errorCode: '0',
      errorMessage: '',
      timestamp: new Date().toISOString(),
      sessionId: 'test-session-id',
      durationMs: 10.5,
    };
    apiCallLoggedCallback(apiCallPayload);

    // Expect the broadcastScormApiCallLogged method to have been called
    expect(mockWebContents.send).toHaveBeenCalledTimes(1);
    expect(mockWebContents.send).toHaveBeenCalledWith('scorm-inspector-data-updated', apiCallPayload);
  });

  it('should broadcast scorm-api-call-logged to multiple open windows', () => {
    const mockWebContents1 = { send: jest.fn() };
    const mockWindow1 = { id: 1, isDestroyed: () => false, webContents: mockWebContents1 };
    mockWindowManager.windows.set(1, mockWindow1);

    const mockWebContents2 = { send: jest.fn() };
    const mockWindow2 = { id: 2, isDestroyed: () => false, webContents: mockWebContents2 };
    mockWindowManager.windows.set(2, mockWindow2);

    const apiCallLoggedCallback = mockScormService.onScormApiCallLogged.mock.calls[0][0];
    const apiCallPayload = { method: 'GetValue', parameters: ['cmi.core.lesson_status'], result: 'not attempted' };
    apiCallLoggedCallback(apiCallPayload);

    expect(mockWebContents1.send).toHaveBeenCalledTimes(1);
    expect(mockWebContents1.send).toHaveBeenCalledWith('scorm-inspector-data-updated', apiCallPayload);
    expect(mockWebContents2.send).toHaveBeenCalledTimes(1);
    expect(mockWebContents2.send).toHaveBeenCalledWith('scorm-inspector-data-updated', apiCallPayload);
  });

  it('should not broadcast to destroyed windows', () => {
    const mockWebContents1 = { send: jest.fn() };
    const mockWindow1 = { id: 1, isDestroyed: () => false, webContents: mockWebContents1 };
    mockWindowManager.windows.set(1, mockWindow1);

    const mockWebContents2 = { send: jest.fn() };
    const mockWindow2 = { id: 2, isDestroyed: () => true, webContents: mockWebContents2 }; // Destroyed window
    mockWindowManager.windows.set(2, mockWindow2);

    const apiCallLoggedCallback = mockScormService.onScormApiCallLogged.mock.calls[0][0];
    const apiCallPayload = { method: 'Commit', parameters: [''] };
    apiCallLoggedCallback(apiCallPayload);

    expect(mockWebContents1.send).toHaveBeenCalledTimes(1);
    expect(mockWebContents1.send).toHaveBeenCalledWith('scorm-inspector-data-updated', apiCallPayload);
    expect(mockWebContents2.send).not.toHaveBeenCalled(); // Should not send to destroyed window
  });

  it('should clear telemetry store on course:loaded event', () => {
    expect(mockScormService.eventEmitter.on).toHaveBeenCalledWith('course:loaded', expect.any(Function));
    const courseLoadedCallback = mockScormService.eventEmitter.on.mock.calls.find(call => call[0] === 'course:loaded')[1];

    // The mockTelemetryStore is already passed during the initial ipcHandler.initialize() in beforeEach
    // No need to re-initialize or set dependency again.
    // const mockTelemetryStore = { clear: jest.fn() }; // This line is also redundant if mockTelemetryStore is defined globally

    courseLoadedCallback({}); // Simulate course:loaded event

    expect(mockTelemetryStore.clear).toHaveBeenCalledTimes(1);
  });

  it('should clear telemetry store on session:reset event', () => {
    expect(mockScormService.eventEmitter.on).toHaveBeenCalledWith('session:reset', expect.any(Function));
    const sessionResetCallback = mockScormService.eventEmitter.on.mock.calls.find(call => call[0] === 'session:reset')[1];

    // The mockTelemetryStore is already passed during the initial ipcHandler.initialize() in beforeEach
    // No need to re-initialize or set dependency again.
    // const mockTelemetryStore = { clear: jest.fn() }; // This line is also redundant if mockTelemetryStore is defined globally

    sessionResetCallback({}); // Simulate session:reset event

    expect(mockTelemetryStore.clear).toHaveBeenCalledTimes(1);
  });
});