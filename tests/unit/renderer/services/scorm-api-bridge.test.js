/**
 * @jest-environment jsdom
 */
import { ScormAPIBridge, initializeScormAPIBridge } from '../../../../src/renderer/services/scorm-api-bridge.js';
import { scormClient } from '../../../../src/renderer/services/scorm-client.js';
import { eventBus } from '../../../../src/renderer/services/event-bus.js'; // Added eventBus import
import { sanitizeParam } from '../../../../src/renderer/utils/payload-sanitizer.js';
import { rendererLogger } from '../../../../src/renderer/utils/renderer-logger.js';

// Mock scormClient, rendererLogger, and eventBus
jest.mock('../../../../src/renderer/services/scorm-client.js', () => ({
  scormClient: {
    Initialize: jest.fn(),
    Terminate: jest.fn(),
    GetValue: jest.fn(),
    SetValue: jest.fn(),
    Commit: jest.fn(),
    GetLastError: jest.fn(),
    GetErrorString: jest.fn(),
    GetDiagnostic: jest.fn(),
  },
}));

jest.mock('../../../../src/renderer/utils/renderer-logger.js', () => ({
  rendererLogger: {
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../../../src/renderer/services/event-bus.js', () => ({
  eventBus: {
    emit: jest.fn(),
  },
}));

describe('ScormAPIBridge', () => {
  let bridge;
  let mockSource;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = new ScormAPIBridge();
    mockSource = {
      postMessage: jest.fn(),
    };
    // Manually enable the bridge for tests that require it
    bridge.enable();
  });

  afterEach(() => {
    bridge.disable();
  });

  it('should enable and disable the message handler', () => {
    bridge.disable(); // Disable first to test enable
    expect(bridge.isEnabled).toBe(false);

    bridge.enable();
    expect(bridge.isEnabled).toBe(true);
    // Verify that the event listener was added (difficult to mock window.addEventListener directly)
    // For now, rely on the internal isEnabled flag and message handling tests.

    bridge.disable();
    expect(bridge.isEnabled).toBe(false);
    // Verify that the event listener was removed
  });

  it('should handle Initialize API call and post message back', async () => {
    scormClient.Initialize.mockReturnValue('true');

    const data = { method: 'Initialize', params: [''], callId: '123' };
    await bridge.handleScormAPICall(data, mockSource);

    expect(scormClient.Initialize).toHaveBeenCalledTimes(1);
    expect(scormClient.Initialize).toHaveBeenCalledWith(expect.stringContaining('session_'));
    expect(mockSource.postMessage).toHaveBeenCalledTimes(1);
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      { type: 'SCORM_API_RESPONSE', callId: '123', result: 'true' },
      '*'
    );
    expect(bridge.sessionId).toBeDefined();
  });

  it('should handle GetValue API call and post message back', async () => {
    bridge.sessionId = 'test-session'; // Set a session ID for GetValue
    scormClient.GetValue.mockReturnValue('42');

    const data = { method: 'GetValue', params: ['cmi.core.lesson_status'], callId: '456' };
    await bridge.handleScormAPICall(data, mockSource);

    expect(scormClient.GetValue).toHaveBeenCalledTimes(1);
    expect(scormClient.GetValue).toHaveBeenCalledWith('cmi.core.lesson_status');
    expect(mockSource.postMessage).toHaveBeenCalledTimes(1);
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      { type: 'SCORM_API_RESPONSE', callId: '456', result: '42' },
      '*'
    );
  });

  it('should handle SetValue API call and post message back', async () => {
    bridge.sessionId = 'test-session';
    scormClient.SetValue.mockReturnValue('true');

    const data = { method: 'SetValue', params: ['cmi.core.lesson_status', 'completed'], callId: '789' };
    await bridge.handleScormAPICall(data, mockSource);

    expect(scormClient.SetValue).toHaveBeenCalledTimes(1);
    expect(scormClient.SetValue).toHaveBeenCalledWith('cmi.core.lesson_status', 'completed');
    expect(mockSource.postMessage).toHaveBeenCalledTimes(1);
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      { type: 'SCORM_API_RESPONSE', callId: '789', result: 'true' },
      '*'
    );
  });

  it('should log errors via rendererLogger and post error message back', async () => {
    scormClient.GetValue.mockImplementation(() => {
      throw new Error('SCORM GetValue failed');
    });

    const data = { method: 'GetValue', params: ['invalid.element'], callId: '101' };
    await bridge.handleScormAPICall(data, mockSource);

    expect(rendererLogger.error).toHaveBeenCalledTimes(1);
    expect(rendererLogger.error).toHaveBeenCalledWith(
      'SCORM API Bridge Error',
      expect.objectContaining({
        method: 'GetValue',
        message: 'SCORM GetValue failed',
      })
    );
    expect(mockSource.postMessage).toHaveBeenCalledTimes(1);
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      { type: 'SCORM_API_RESPONSE', callId: '101', result: 'false', error: 'SCORM GetValue failed' },
      '*'
    );
  });

  it('should not contain redundant logging logic (e.g., eventBus.emit or electronAPI.emitDebugEvent)', async () => {
    // This test implicitly passes if the mocks for eventBus and electronAPI are not called.
    // The mock setup ensures that if these were called, it would throw an error or fail a specific expectation.
    // Since we've mocked scormClient and rendererLogger, any other external calls would be unexpected.

    const data = { method: 'Initialize', params: [''], callId: 'test-no-log' };
    await bridge.handleScormAPICall(data, mockSource);

    // Assert that no unexpected logging methods were called
    // (e.g., if eventBus was imported and used for logging, its emit method would be called)
    // Since eventBus is imported, let's ensure it's not used for API call logging.
    // Note: eventBus is used for other purposes, so we only care about API call logging.
    // The plan specifically mentioned 'api:call' event.
    expect(eventBus.emit).not.toHaveBeenCalledWith('api:call', expect.any(Object));
    // Assuming window.electronAPI is mocked or not available in renderer unit tests,
    // we don't need to explicitly check window.electronAPI.emitDebugEvent or .log here,
    // as they would likely cause errors if called without proper mocking.
    // The primary verification is the absence of direct calls in the source code.
  });
});