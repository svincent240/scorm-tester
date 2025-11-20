const ScormService = require('../../../src/main/services/scorm-service');
const SessionStore = require('../../../src/main/services/session-store');

// Mock dependencies
jest.mock('../../../src/main/services/session-store');
jest.mock('../../../src/main/services/scorm/sn/index', () => ({
  ScormSNService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue({ success: true }),
    reset: jest.fn(),
    getSequencingState: jest.fn().mockReturnValue({
      sessionState: 'active',
      activityTreeStats: { totalActivities: 1 }
    }),
    processNavigation: jest.fn().mockResolvedValue({ success: true }),
    sequencingSession: {
      manifest: { identifier: 'course-1' }
    }
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

// Mock ScormApiHandler to verify hydration
const mockRteInstance = {
  Initialize: jest.fn(),
  dataModel: {
    _setInternalValue: jest.fn(),
    getAllData: jest.fn().mockReturnValue({ coreData: { 'cmi.suspend_data': 'test' } })
  },
  eventEmitter: {
    on: jest.fn()
  }
};

jest.mock('../../../src/main/services/scorm/rte/api-handler', () => {
  return jest.fn().mockImplementation(() => mockRteInstance);
});

describe('ScormService Resume Logic', () => {
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

    // Initialize service
    scormService = new ScormService(null, mockLogger, {
      sessionNamespace: 'gui'
    });
    
    // Mock getDependency for windowManager
    scormService.getDependency = jest.fn().mockReturnValue({
      broadcastToAllWindows: jest.fn()
    });

    await scormService.initialize();
    
    // Ensure SN service is set (mocked in constructor but we need to access it)
    scormService.snService = {
      sequencingSession: {
        manifest: { identifier: 'course-1' }
      },
      getSequencingState: jest.fn().mockReturnValue({
        sessionState: 'active',
        activityTreeStats: { totalActivities: 1 }
      }),
      processNavigation: jest.fn().mockResolvedValue({ success: true })
    };
  });

  describe('initializeSession with Resume', () => {
    it('should delete session if forceNew is true', async () => {
      await scormService.initializeSession('session-1', { forceNew: true });
      
      expect(mockSessionStore.deleteSession).toHaveBeenCalledWith('course-1', 'gui');
    });

    it('should resume session if cmi.exit is suspend', async () => {
      mockSessionStore.loadSession.mockResolvedValue({
        'cmi.exit': 'suspend',
        'cmi.suspend_data': 'some_data'
      });

      await scormService.initializeSession('session-1');

      // Verify data injection
      expect(mockRteInstance.dataModel._setInternalValue).toHaveBeenCalledWith('cmi.suspend_data', 'some_data');
      // Verify entry mode set to resume
      expect(mockRteInstance.dataModel._setInternalValue).toHaveBeenCalledWith('cmi.entry', 'resume');
      expect(mockRteInstance.dataModel._setInternalValue).toHaveBeenCalledWith('cmi.core.entry', 'resume');
    });

    it('should NOT resume session if cmi.exit is not suspend', async () => {
      mockSessionStore.loadSession.mockResolvedValue({
        'cmi.exit': 'logout',
        'cmi.suspend_data': 'some_data'
      });

      await scormService.initializeSession('session-1');

      // Verify data injection did NOT happen for suspend_data
      expect(mockRteInstance.dataModel._setInternalValue).not.toHaveBeenCalledWith('cmi.suspend_data', 'some_data');
      // Verify entry mode set to ab-initio
      expect(mockRteInstance.dataModel._setInternalValue).toHaveBeenCalledWith('cmi.entry', 'ab-initio');
      expect(mockRteInstance.dataModel._setInternalValue).toHaveBeenCalledWith('cmi.core.entry', 'ab-initio');
    });

    it('should handle SCORM 1.2 cmi.core.exit', async () => {
      mockSessionStore.loadSession.mockResolvedValue({
        'cmi.core.exit': 'suspend',
        'cmi.suspend_data': 'some_data'
      });

      await scormService.initializeSession('session-1');

      expect(mockRteInstance.dataModel._setInternalValue).toHaveBeenCalledWith('cmi.entry', 'resume');
    });
  });

  describe('Persistence on Commit', () => {
    it('should save session data on successful commit', async () => {
      // Setup active session
      scormService.sessions.set('session-1', {
        id: 'session-1',
        lastActivity: Date.now(),
        apiCalls: []
      });
      
      // Mock RTE instance for this session
      const rte = {
        Commit: jest.fn().mockReturnValue('true'),
        GetLastError: jest.fn().mockReturnValue('0'),
        dataModel: {
          getAllData: jest.fn().mockReturnValue({
            coreData: { 'cmi.suspend_data': 'new_data' }
          })
        }
      };
      scormService.rteInstances.set('session-1', rte);

      await scormService.commit('session-1');

      expect(mockSessionStore.saveSession).toHaveBeenCalledWith(
        'course-1',
        { 'cmi.suspend_data': 'new_data' },
        'gui'
      );
    });
  });
});
