const ScormApiHandler = require('../../../../../src/main/services/scorm/rte/api-handler');
const EventEmitter = require('events');

describe('ScormApiHandler Event Emission', () => {
  let apiHandler;
  let mockSessionManager;
  let mockLogger;

  beforeEach(() => {
    mockSessionManager = {
      registerSession: jest.fn(),
      unregisterSession: jest.fn(),
      persistSessionData: jest.fn(),
      getLearnerInfo: jest.fn()
    };
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    apiHandler = new ScormApiHandler(mockSessionManager, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should emit "scorm-api-call-logged" event on Initialize call with correct payload', () => {
    const expectedPayload = expect.objectContaining({
      method: 'Initialize',
      parameters: [''],
      result: expect.any(String),
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.Initialize('');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on Terminate call with correct payload', () => {
    apiHandler.Initialize(''); // Initialize first to allow termination
    const expectedPayload = expect.objectContaining({
      method: 'Terminate',
      parameters: [''],
      result: expect.any(String),
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.Terminate('');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on GetValue call with correct payload', () => {
    apiHandler.Initialize('');
    const expectedPayload = expect.objectContaining({
      method: 'GetValue',
      parameters: ['cmi.core.lesson_status'],
      result: expect.any(String),
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.GetValue('cmi.core.lesson_status');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on SetValue call with correct payload', () => {
    apiHandler.Initialize('');
    const expectedPayload = expect.objectContaining({
      method: 'SetValue',
      parameters: ['cmi.core.lesson_status', 'completed'],
      result: expect.any(String),
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.SetValue('cmi.core.lesson_status', 'completed');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on Commit call with correct payload', () => {
    apiHandler.Initialize('');
    const expectedPayload = expect.objectContaining({
      method: 'Commit',
      parameters: [''],
      result: expect.any(String),
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.Commit('');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on GetLastError call with correct payload', () => {
    apiHandler.Initialize('');
    const expectedPayload = expect.objectContaining({
      method: 'GetLastError',
      parameters: [],
      result: expect.any(String),
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.GetLastError();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on GetErrorString call with correct payload', () => {
    apiHandler.Initialize('');
    const expectedPayload = expect.objectContaining({
      method: 'GetErrorString',
      parameters: ['101'],
      result: expect.any(String),
      errorCode: '101',
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.GetErrorString('101');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });

  it('should emit "scorm-api-call-logged" event on GetDiagnostic call with correct payload', () => {
    apiHandler.Initialize('');
    const expectedPayload = expect.objectContaining({
      method: 'GetDiagnostic',
      parameters: ['101'],
      result: expect.any(String),
      errorCode: '101',
      errorMessage: expect.any(String),
      timestamp: expect.any(String),
      sessionId: expect.any(String),
      durationMs: expect.any(Number)
    });

    const listener = jest.fn();
    apiHandler.eventEmitter.on('scorm-api-call-logged', listener);

    apiHandler.GetDiagnostic('101');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedPayload);
  });
});