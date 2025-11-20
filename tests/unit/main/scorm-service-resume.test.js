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
    restoreData: jest.fn(),
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
    it('should NOT load session if forceNew is true', async () => {
      mockSessionStore.loadSession.mockResolvedValue({
        'cmi.exit': 'suspend',
        'cmi.suspend_data': 'some_data'
      });

      await scormService.initializeSession('session-1', { forceNew: true });
      
      // Verify loadSession was NOT called (forceNew skips loading)
      expect(mockSessionStore.loadSession).not.toHaveBeenCalled();
      // Verify data was NOT injected
      expect(mockRteInstance.dataModel._setInternalValue).not.toHaveBeenCalledWith('cmi.suspend_data', 'some_data');
    });

    it('should resume session if cmi.exit is suspend', async () => {
      const savedData = {
        coreData: {
          'cmi.exit': 'suspend',
          'cmi.suspend_data': 'some_data'
        },
        interactions: [],
        objectives: []
      };
      mockSessionStore.loadSession.mockResolvedValue(savedData);

      await scormService.initializeSession('session-1');

      // Verify restoreData was called with complete data object
      expect(mockRteInstance.dataModel.restoreData).toHaveBeenCalledWith(savedData);
    });

    it('should NOT resume session if cmi.exit is not suspend', async () => {
      const savedData = {
        coreData: {
          'cmi.exit': 'logout',
          'cmi.suspend_data': 'some_data'
        },
        interactions: [],
        objectives: []
      };
      mockSessionStore.loadSession.mockResolvedValue(savedData);

      await scormService.initializeSession('session-1');

      // Verify restoreData was NOT called (exit != suspend)
      expect(mockRteInstance.dataModel.restoreData).not.toHaveBeenCalled();
    });

    it('should handle SCORM 1.2 cmi.core.exit', async () => {
      const savedData = {
        coreData: {
          'cmi.core.exit': 'suspend',
          'cmi.suspend_data': 'some_data'
        },
        interactions: [],
        objectives: []
      };
      mockSessionStore.loadSession.mockResolvedValue(savedData);

      await scormService.initializeSession('session-1');

      // Verify restoreData was called
      expect(mockRteInstance.dataModel.restoreData).toHaveBeenCalledWith(savedData);
    });
  });

  describe('Reload Session', () => {
    it('should terminate existing session when reload option is true', async () => {
      // Setup active session
      scormService.sessions.set('session-reload', {
        id: 'session-reload',
        lastActivity: Date.now(),
        apiCalls: [],
        courseInfo: { identifier: 'course-1' }
      });
      
      const rte = {
        Terminate: jest.fn().mockReturnValue('true'),
        GetLastError: jest.fn().mockReturnValue('0'),
        dataModel: {
          getAllData: jest.fn().mockReturnValue({
            coreData: { 'cmi.exit': 'suspend' }
          }),
          _getInternalValue: jest.fn().mockReturnValue('suspend'),
          _setInternalValue: jest.fn()
        },
        Initialize: jest.fn().mockReturnValue('true'),
        eventEmitter: { on: jest.fn() }
      };
      scormService.rteInstances.set('session-reload', rte);
      
      scormService.getValue = jest.fn().mockResolvedValue({ value: '' });

      // Initialize with reload=true should terminate first
      await scormService.initializeSession('session-reload', { reload: true });

      // Verify terminate was called (data saved)
      expect(mockSessionStore.saveSession).toHaveBeenCalled();
      // Verify new session was created
      expect(scormService.sessions.has('session-reload')).toBe(true);
    });
  });

  describe('Persistence on Terminate - Always Save', () => {
    it('should always save session data on terminate (suspend exit)', async () => {
      // Setup active session
      scormService.sessions.set('session-1', {
        id: 'session-1',
        lastActivity: Date.now(),
        apiCalls: [],
        courseInfo: { identifier: 'course-1' }
      });
      
      // Mock RTE instance for this session
      const rte = {
        Terminate: jest.fn().mockReturnValue('true'),
        GetLastError: jest.fn().mockReturnValue('0'),
        dataModel: {
          getAllData: jest.fn().mockReturnValue({
            coreData: { 
              'cmi.suspend_data': 'test_data',
              'cmi.exit': 'suspend',
              'cmi.location': 'page5'
            }
          }),
          _getInternalValue: jest.fn((key) => {
            if (key === 'cmi.exit') return 'suspend';
            return '';
          })
        }
      };
      scormService.rteInstances.set('session-1', rte);
      
      // Mock getValue to return proper values
      scormService.getValue = jest.fn((sessionId, element) => {
        const values = {
          'cmi.completion_status': { value: 'incomplete' },
          'cmi.success_status': { value: 'unknown' },
          'cmi.score.raw': { value: null },
          'cmi.score.scaled': { value: null },
          'cmi.score.min': { value: null },
          'cmi.score.max': { value: null },
          'cmi.session_time': { value: 'PT0H0M0S' },
          'cmi.total_time': { value: 'PT0H0M0S' },
          'cmi.location': { value: 'page5' },
          'cmi.suspend_data': { value: 'test_data' }
        };
        return Promise.resolve(values[element] || { value: '' });
      });

      await scormService.terminate('session-1');

      // Should always save complete data object regardless of exit type
      expect(mockSessionStore.saveSession).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ 
          coreData: expect.objectContaining({ 'cmi.suspend_data': 'test_data' })
        }),
        'gui'
      );
    });
    
    it('should always save session data on terminate (normal exit)', async () => {
      // Setup active session
      scormService.sessions.set('session-2', {
        id: 'session-2',
        lastActivity: Date.now(),
        apiCalls: [],
        courseInfo: { identifier: 'course-1' }
      });
      
      // Mock RTE instance for this session - completed course
      const rte = {
        Terminate: jest.fn().mockReturnValue('true'),
        GetLastError: jest.fn().mockReturnValue('0'),
        dataModel: {
          getAllData: jest.fn().mockReturnValue({
            coreData: { 
              'cmi.completion_status': 'completed',
              'cmi.exit': 'normal'
            }
          }),
          _getInternalValue: jest.fn((key) => {
            if (key === 'cmi.exit') return 'normal';
            return '';
          })
        }
      };
      scormService.rteInstances.set('session-2', rte);
      
      // Mock getValue
      scormService.getValue = jest.fn((sessionId, element) => {
        const values = {
          'cmi.completion_status': { value: 'completed' },
          'cmi.success_status': { value: 'passed' },
          'cmi.score.raw': { value: null },
          'cmi.score.scaled': { value: null },
          'cmi.score.min': { value: null },
          'cmi.score.max': { value: null },
          'cmi.session_time': { value: 'PT0H0M0S' },
          'cmi.total_time': { value: 'PT0H0M0S' },
          'cmi.location': { value: '' },
          'cmi.suspend_data': { value: '' }
        };
        return Promise.resolve(values[element] || { value: '' });
      });

      await scormService.terminate('session-2');

      // Should always save complete data object - resume logic will check exit value
      expect(mockSessionStore.saveSession).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ 
          coreData: expect.objectContaining({ 'cmi.exit': 'normal' })
        }),
        'gui'
      );
    });
  });
});
