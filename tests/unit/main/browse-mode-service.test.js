/**
 * Browse Mode Service Tests
 * 
 * Tests for the SCORM-compliant browse mode functionality
 */

const BrowseModeService = require('../../../src/main/services/browse-mode-service');

describe('BrowseModeService', () => {
  let browseModeService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    browseModeService = new BrowseModeService(mockLogger, {
      defaultTimeout: 5000, // 5 seconds for testing
      maxSessions: 5
    });
  });

  afterEach(() => {
    if (browseModeService) {
      browseModeService.cleanup();
    }
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    test('should initialize with default settings', () => {
      expect(browseModeService.enabled).toBe(false);
      expect(browseModeService.currentSession).toBeNull();
      expect(browseModeService.sessions.size).toBe(0);
    });

    test('should initialize with custom options', () => {
      const customService = new BrowseModeService(mockLogger, {
        defaultTimeout: 10000,
        maxSessions: 20
      });

      expect(customService.options.defaultTimeout).toBe(10000);
      expect(customService.options.maxSessions).toBe(20);
      
      customService.cleanup();
    });
  });

  describe('enableBrowseMode', () => {
    test('should enable browse mode successfully', async () => {
      const result = await browseModeService.enableBrowseMode();

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.launchMode).toBe('browse');
      expect(browseModeService.enabled).toBe(true);
      expect(browseModeService.currentSession).toBeDefined();
    });

    test('should return existing session if already enabled', async () => {
      const firstResult = await browseModeService.enableBrowseMode();
      const secondResult = await browseModeService.enableBrowseMode();

      expect(secondResult.success).toBe(true);
      expect(secondResult.alreadyEnabled).toBe(true);
      expect(secondResult.session.id).toBe(firstResult.session.id);
    });

    test('should create session with custom options', async () => {
      const options = {
        navigationUnrestricted: true,
        trackingDisabled: true,
        sessionTimeout: 15000
      };

      const result = await browseModeService.enableBrowseMode(options);

      expect(result.success).toBe(true);
      expect(result.session.options.navigationUnrestricted).toBe(true);
      expect(result.session.options.trackingDisabled).toBe(true);
      expect(result.session.options.sessionTimeout).toBe(15000);
    });
  });

  describe('disableBrowseMode', () => {
    test('should disable browse mode successfully', async () => {
      await browseModeService.enableBrowseMode();
      const result = await browseModeService.disableBrowseMode();

      expect(result.success).toBe(true);
      expect(browseModeService.enabled).toBe(false);
      expect(browseModeService.currentSession).toBeNull();
    });

    test('should return success if already disabled', async () => {
      const result = await browseModeService.disableBrowseMode();

      expect(result.success).toBe(true);
      expect(result.alreadyDisabled).toBe(true);
    });
  });

  describe('getBrowseModeStatus', () => {
    test('should return disabled status when not enabled', () => {
      const status = browseModeService.getBrowseModeStatus();

      expect(status.enabled).toBe(false);
      expect(status.currentSession).toBeNull();
      expect(status.totalSessions).toBe(0);
    });

    test('should return enabled status with session info', async () => {
      await browseModeService.enableBrowseMode();
      const status = browseModeService.getBrowseModeStatus();

      expect(status.enabled).toBe(true);
      expect(status.currentSession).toBeDefined();
      expect(status.currentSession.id).toBeDefined();
      expect(status.totalSessions).toBe(1);
    });
  });

  describe('navigation override', () => {
    test('should allow navigation in browse mode', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = browseModeService.isNavigationAllowedInBrowseMode('activity1', 'activity2', 'choice');

      expect(result.allowed).toBe(true);
      expect(result.browseMode).toBe(true);
      expect(result.reason).toContain('Browse mode');
    });

    test('should deny navigation when browse mode not enabled', () => {
      const result = browseModeService.isNavigationAllowedInBrowseMode('activity1', 'activity2', 'choice');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Browse mode not enabled');
    });
  });

  describe('session management', () => {
    test('should create unique session IDs', async () => {
      const result1 = await browseModeService.enableBrowseMode();
      await browseModeService.disableBrowseMode();
      
      const result2 = await browseModeService.enableBrowseMode();

      expect(result1.session.id).not.toBe(result2.session.id);
    });

    test('should update session activity', async () => {
      await browseModeService.enableBrowseMode();
      const initialActivity = browseModeService.currentSession.lastActivity;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      browseModeService.updateSessionActivity('test-operation', { test: 'data' });

      expect(browseModeService.currentSession.lastActivity.getTime()).toBeGreaterThan(initialActivity.getTime());
      expect(browseModeService.currentSession.state.operations).toHaveLength(1);
      expect(browseModeService.currentSession.state.operations[0].operation).toBe('test-operation');
    });
  });

  describe('cleanup', () => {
    test('should clean up all sessions and state', async () => {
      await browseModeService.enableBrowseMode();
      
      browseModeService.cleanup();

      expect(browseModeService.enabled).toBe(false);
      expect(browseModeService.currentSession).toBeNull();
      expect(browseModeService.sessions.size).toBe(0);
    });
  });

  describe('event emission', () => {
    test('should emit browse-mode-enabled event', async () => {
      const enabledHandler = jest.fn();
      browseModeService.on('browse-mode-enabled', enabledHandler);

      await browseModeService.enableBrowseMode();

      expect(enabledHandler).toHaveBeenCalledWith({
        session: expect.objectContaining({
          launchMode: 'browse'
        })
      });
    });

    test('should emit browse-mode-disabled event', async () => {
      const disabledHandler = jest.fn();
      browseModeService.on('browse-mode-disabled', disabledHandler);

      await browseModeService.enableBrowseMode();
      const result = await browseModeService.disableBrowseMode();

      expect(disabledHandler).toHaveBeenCalledWith({
        sessionId: result.sessionId
      });
    });
  });
});
