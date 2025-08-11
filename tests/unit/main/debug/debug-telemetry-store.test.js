const DebugTelemetryStore = require('../../../../src/main/services/debug/debug-telemetry-store');
const { DEBUG_TELEMETRY_DEFAULTS } = require('../../../../src/shared/constants/main-process-constants');

describe('DebugTelemetryStore History Clearing', () => {
  let telemetryStore;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    telemetryStore = new DebugTelemetryStore({ logger: mockLogger });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should clear all API call history when clear() is called', () => {
    // Add some dummy API calls
    telemetryStore.storeApiCall({ method: 'Initialize', parameters: [''], result: 'true', timestamp: Date.now() });
    telemetryStore.storeApiCall({ method: 'GetValue', parameters: ['cmi.location'], result: 'page1', timestamp: Date.now() + 1 });
    telemetryStore.storeApiCall({ method: 'SetValue', parameters: ['cmi.location', 'page2'], result: 'true', timestamp: Date.now() + 2 });

    expect(telemetryStore.getHistory().length).toBe(3);

    telemetryStore.clear();

    expect(telemetryStore.getHistory().length).toBe(0);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/\[DebugTelemetryStore\] Cleared \d+ entries/));
  });

  it('should clear history and reset internal state on clear()', () => {
    // Add some dummy API calls
    telemetryStore.storeApiCall({ method: 'Initialize', parameters: [''], result: 'true', timestamp: Date.now() });
    telemetryStore.storeApiCall({ method: 'GetValue', parameters: ['cmi.location'], result: 'page1', timestamp: Date.now() + 1 });

    // Verify history is not empty before clearing
    expect(telemetryStore.getHistory().length).toBe(2);

    telemetryStore.clear();

    // Assert that history is empty after clearing
    expect(telemetryStore.getHistory().length).toBe(0);
    // Since _apiCallBuffer and _errorIndex are not direct properties, we only check the public API (getHistory)
  });

  it('should not throw error if clear() is called on an empty store', () => {
    expect(telemetryStore.getHistory().length).toBe(0);
    expect(() => telemetryStore.clear()).not.toThrow();
    expect(telemetryStore.getHistory().length).toBe(0);
  });

  it('should respect maxHistorySize after clearing and adding new calls', () => {
    // Fill the buffer to max size
    for (let i = 0; i < DEBUG_TELEMETRY_DEFAULTS.MAX_HISTORY_SIZE; i++) {
      telemetryStore.storeApiCall({ method: `Call${i}`, timestamp: Date.now() + i });
    }
    expect(telemetryStore.getHistory().length).toBe(DEBUG_TELEMETRY_DEFAULTS.MAX_HISTORY_SIZE);

    telemetryStore.clear();
    expect(telemetryStore.getHistory().length).toBe(0);

    // Add new calls, ensure it respects the max size again
    for (let i = 0; i < DEBUG_TELEMETRY_DEFAULTS.MAX_HISTORY_SIZE + 5; i++) {
      telemetryStore.storeApiCall({ method: `NewCall${i}`, timestamp: Date.now() + i });
    }
    expect(telemetryStore.getHistory().length).toBe(DEBUG_TELEMETRY_DEFAULTS.MAX_HISTORY_SIZE);
  });
});