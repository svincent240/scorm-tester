const IpcHandler = require('../../../../src/main/services/ipc-handler');

// Minimal shared mocks
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

function makeScormServiceMock(map) {
  return {
    getValue: jest.fn(async (sessionId, element) => {
      if (!map.has(element)) return { success: false, value: '', errorCode: '404' };
      return { success: true, value: map.get(element), errorCode: '0' };
    }),
    onScormApiCallLogged: jest.fn(),
    eventEmitter: { on: jest.fn() },
  };
}

// Other deps required by IpcHandler.initialize
const mockWindowManager = {
  windows: new Map(),
  getWindow: jest.fn(),
  createDebugWindow: jest.fn(),
};
const mockTelemetryStore = {
  clear: jest.fn(),
  getHistory: jest.fn(() => ({ entries: [], errors: [] })),
  getErrors: jest.fn(() => ({ errors: [] })),
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

describe('IPC: scorm-get-progress-snapshot', () => {
  let ipcHandler;
  let mockScormService;

  beforeEach(async () => {
    const values = new Map([
      ['cmi.completion_status', 'completed'],
      ['cmi.success_status', 'passed'],
      ['cmi.score.scaled', '0.88'],
      ['cmi.score.raw', '88'],
      ['cmi.progress_measure', '0.9'],
      ['cmi.session_time', 'PT0H05M30S'],
      ['cmi.total_time', 'PT1H20M10S'],
      ['cmi.location', 'sco-2'],
      ['cmi.suspend_data', 'abc123'],
    ]);
    mockScormService = makeScormServiceMock(values);

    ipcHandler = new IpcHandler(mockErrorHandler, mockLogger, {
      IPC_REFACTOR_ENABLED: true,
    });

    await ipcHandler.initialize(new Map([
      ['scormService', mockScormService],
      ['windowManager', mockWindowManager],
      ['telemetryStore', mockTelemetryStore],
      ['fileManager', mockFileManager],
    ]));
  });

  afterEach(() => {
    ipcHandler.shutdown();
    jest.clearAllMocks();
  });

  it('returns consolidated progress fields mapped from getValue results', async () => {
    const res = await ipcHandler.handleScormGetProgressSnapshot({}, 'sess-1');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      completionStatus: 'completed',
      successStatus: 'passed',
      scoreScaled: '0.88',
      scoreRaw: '88',
      progressMeasure: '0.9',
      sessionTime: 'PT0H05M30S',
      totalTime: 'PT1H20M10S',
      location: 'sco-2',
      suspendData: 'abc123',
    });

    // Ensure scormService.getValue was asked for all the expected elements
    const expectedElements = [
      'cmi.completion_status',
      'cmi.success_status',
      'cmi.score.scaled',
      'cmi.score.raw',
      'cmi.progress_measure',
      'cmi.session_time',
      'cmi.total_time',
      'cmi.location',
      'cmi.suspend_data',
    ];
    for (const el of expectedElements) {
      expect(mockScormService.getValue).toHaveBeenCalledWith('sess-1', el);
    }
  });

  it('handles missing elements by returning empty strings', async () => {
    // Override: missing progress_measure and location
    mockScormService.getValue.mockImplementation(async (sessionId, element) => {
      if (element === 'cmi.progress_measure' || element === 'cmi.location') {
        return { success: false, value: '', errorCode: '404' };
      }
      return { success: true, value: 'ok', errorCode: '0' };
    });

    const res = await ipcHandler.handleScormGetProgressSnapshot({}, 'sess-2');
    expect(res.success).toBe(true);
    expect(res.data.progressMeasure).toBe('');
    expect(res.data.location).toBe('');
  });
});

