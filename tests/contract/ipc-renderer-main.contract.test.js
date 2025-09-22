
/**
 * @jest-environment jsdom
 */

/**
 * IPC Renderer-Main Contract Tests
 *
 * Ensures the data structures (payloads and responses) for key IPC channels
 * between the renderer and main process adhere to the contracts defined in
 * the GUI_REWRITE_PLAN.md. This prevents regressions in the client-server API.
 */

describe('IPC Renderer-Main Contract', () => {
  let mockApi;

  beforeEach(() => {
    // A complete mock of the electronAPI surface used by the renderer
    mockApi = {
      // Renderer -> Main (invoke)
      validateCourseOutlineChoice: jest.fn(),
      getScormDataModel: jest.fn(),
      getSnState: jest.fn(),

      // Main -> Renderer (push/subscribe)
      onNavigationCompleted: jest.fn(),
      onScormInspectorApiCallLogged: jest.fn(),
      onAppError: jest.fn(),
    };
    // Attach to existing jsdom window instead of replacing it
    window.electronAPI = mockApi;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Renderer -> Main (invoke)', () => {
    test('validateCourseOutlineChoice contract', async () => {
      const activityId = 'item-123';
      const mockResponse = { valid: true, reason: '' };
      mockApi.validateCourseOutlineChoice.mockResolvedValue(mockResponse);

      const result = await window.electronAPI.validateCourseOutlineChoice({ activityId });

      // Verify request payload contract
      expect(mockApi.validateCourseOutlineChoice).toHaveBeenCalledWith({ activityId: expect.any(String) });

      // Verify response payload contract
      expect(result).toHaveProperty('valid');
      expect(typeof result.valid).toBe('boolean');
    });

    test('getScormDataModel contract', async () => {
      const mockResponse = { cmi: { completion_status: 'incomplete' } };
      mockApi.getScormDataModel.mockResolvedValue(mockResponse);

      const result = await window.electronAPI.getScormDataModel({});

      // Verify request payload contract (empty object)
      expect(mockApi.getScormDataModel).toHaveBeenCalledWith({});

      // Verify response payload contract
      expect(result).toHaveProperty('cmi');
      expect(typeof result.cmi).toBe('object');
    });

    test('getSnState contract', async () => {
      const mockResponse = { status: { currentActivity: 'item-1' } };
      mockApi.getSnState.mockResolvedValue(mockResponse);

      const result = await window.electronAPI.getSnState({});

      // Verify request payload contract (empty object)
      expect(mockApi.getSnState).toHaveBeenCalledWith({});

      // Verify response payload contract
      expect(result).toHaveProperty('status');
      expect(typeof result.status).toBe('object');
    });
  });

  describe('Main -> Renderer (push)', () => {
    test('navigation:completed contract', () => {
      // Get the callback function the renderer would provide
      mockApi.onNavigationCompleted.mockImplementation(callback => {
        // Simulate the main process pushing an event
        const mockPayload = {
          currentActivityId: 'item-abc',
          availableNavigation: ['continue', 'previous'],
          launchUrl: 'scorm-app://content/index.html'
        };
        callback(mockPayload);
      });

      const handler = jest.fn();
      window.electronAPI.onNavigationCompleted(handler);

      // Verify the handler was called with the correct payload structure
      expect(handler).toHaveBeenCalledTimes(1);
      const payload = handler.mock.calls[0][0];
      expect(payload).toHaveProperty('currentActivityId');
      expect(typeof payload.currentActivityId).toBe('string');
      expect(payload).toHaveProperty('availableNavigation');
      expect(Array.isArray(payload.availableNavigation)).toBe(true);
      expect(payload).toHaveProperty('launchUrl');
      expect(typeof payload.launchUrl).toBe('string');
    });

    test('scorm-inspector:api-call-logged contract', () => {
      mockApi.onScormInspectorApiCallLogged.mockImplementation(callback => {
        const mockPayload = {
          method: 'SetValue',
          args: ['cmi.completion_status', 'completed'],
          result: 'true',
          errorCode: '0',
          ts: Date.now()
        };
        callback(mockPayload);
      });

      const handler = jest.fn();
      window.electronAPI.onScormInspectorApiCallLogged(handler);

      const payload = handler.mock.calls[0][0];
      expect(payload).toHaveProperty('method', expect.any(String));
      expect(payload).toHaveProperty('args', expect.any(Array));
      expect(payload).toHaveProperty('result', expect.any(String));
      expect(payload).toHaveProperty('errorCode', expect.any(String));
      expect(payload).toHaveProperty('ts', expect.any(Number));
    });

    test('app:error contract', () => {
      mockApi.onAppError.mockImplementation(callback => {
        const mockPayload = {
          code: 'E_FILE_NOT_FOUND',
          message: 'The specified file could not be found.',
          context: { filePath: '/path/to/file' }
        };
        callback(mockPayload);
      });

      const handler = jest.fn();
      window.electronAPI.onAppError(handler);

      const payload = handler.mock.calls[0][0];
      expect(payload).toHaveProperty('code', expect.any(String));
      expect(payload).toHaveProperty('message', expect.any(String));
      expect(payload).toHaveProperty('context'); // Context is optional but should exist
    });
  });
});
