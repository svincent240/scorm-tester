const ScormService = require('../../../src/main/services/scorm-service');
const SessionStore = require('../../../src/main/services/session-store');

// Mock dependencies
jest.mock('../../../src/main/services/session-store');
jest.mock('../../../src/main/services/scorm/sn/index', () => ({
  ScormSNService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue({ success: true }),
    reset: jest.fn(),
    getSequencingState: jest.fn().mockReturnValue({})
  }))
}));
jest.mock('../../../src/main/services/scorm/cam/index', () => ({
  ScormCAMService: jest.fn().mockImplementation(() => ({
    validatePackage: jest.fn(),
    analyzePackage: jest.fn(),
    processPackage: jest.fn()
  }))
}));
jest.mock('../../../src/main/services/browse-mode-service', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn()
  }));
});
jest.mock('../../../src/shared/utils/error-handler');

describe('ScormService Namespacing', () => {
  let scormService;
  let mockLogger;
  let mockSessionStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };

    // Setup SessionStore mock instance
    mockSessionStore = {
      initialize: jest.fn().mockResolvedValue(),
      loadSession: jest.fn().mockResolvedValue(null),
      saveSession: jest.fn().mockResolvedValue(true),
      deleteSession: jest.fn().mockResolvedValue(true),
      hasSession: jest.fn().mockReturnValue(false)
    };
    SessionStore.mockImplementation(() => mockSessionStore);

    // Initialize service with custom namespace
    scormService = new ScormService(null, mockLogger, {
      sessionNamespace: 'custom_ns'
    });
    
    // Mock getDependency for windowManager
    scormService.getDependency = jest.fn().mockReturnValue({
      broadcastToAllWindows: jest.fn()
    });

    await scormService.initialize();
  });

  it('should use configured namespace when initializing session', async () => {
    // Mock SN service to return a manifest identifier
    scormService.snService = {
      sequencingSession: {
        manifest: { identifier: 'course-1' }
      },
      getSequencingState: jest.fn().mockReturnValue({})
    };

    await scormService.initializeSession('session-1');

    // Check if loadSession was called with correct namespace
    expect(mockSessionStore.loadSession).toHaveBeenCalledWith('course-1', 'custom_ns');
  });

  it('should use configured namespace when saving session (commit)', async () => {
    // Setup active session
    scormService.sessions.set('session-1', {
      id: 'session-1',
      lastActivity: Date.now(),
      apiCalls: []
    });
    
    // Mock SN service
    scormService.snService = {
      sequencingSession: {
        manifest: { identifier: 'course-1' }
      }
    };

    await scormService.commit('session-1');

    expect(mockSessionStore.saveSession).toHaveBeenCalledWith(
      'course-1',
      expect.any(Object),
      'custom_ns'
    );
  });

  it('should use configured namespace when clearing saved session', async () => {
    await scormService.clearSavedSession('course-1');
    
    expect(mockSessionStore.deleteSession).toHaveBeenCalledWith('course-1', 'custom_ns');
  });

  it('should allow overriding namespace in clearSavedSession', async () => {
    await scormService.clearSavedSession('course-1', 'other_ns');
    
    expect(mockSessionStore.deleteSession).toHaveBeenCalledWith('course-1', 'other_ns');
  });

  it('should default to "gui" namespace if not configured', async () => {
    const defaultService = new ScormService(null, mockLogger);
    defaultService.getDependency = jest.fn().mockReturnValue({});
    
    // Manually inject session store mock since we can't easily await initialize again without full setup
    defaultService.sessionStore = mockSessionStore;
    
    await defaultService.clearSavedSession('course-1');
    
    expect(mockSessionStore.deleteSession).toHaveBeenCalledWith('course-1', 'gui');
  });
});
