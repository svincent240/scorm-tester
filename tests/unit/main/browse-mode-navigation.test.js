const SequencingEngine = require('../../../src/main/services/scorm/sn/sequencing-engine');
const NavigationHandler = require('../../../src/main/services/scorm/sn/navigation-handler');
const BrowseModeService = require('../../../src/main/services/browse-mode-service');
const { ActivityTreeManager } = require('../../../src/main/services/scorm/sn/activity-tree');
const ScormErrorHandler = require('../../../src/main/services/scorm/rte/error-handler');
const { NAVIGATION_REQUESTS } = require('../../../src/shared/constants/sn-constants');

describe('Browse Mode Navigation Integration', () => {
  let sequencingEngine;
  let navigationHandler;
  let browseModeService;
  let activityTreeManager;
  let errorHandler;
  let logger;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    errorHandler = new ScormErrorHandler(logger);
    activityTreeManager = new ActivityTreeManager(errorHandler, logger);
    browseModeService = new BrowseModeService(logger);

    sequencingEngine = new SequencingEngine(
      activityTreeManager,
      errorHandler,
      logger,
      browseModeService
    );

    navigationHandler = new NavigationHandler(
      activityTreeManager,
      sequencingEngine,
      errorHandler,
      logger,
      browseModeService
    );

    // Mock activity tree with test activities
    const mockActivity1 = {
      identifier: 'activity1',
      sequencing: {
        sequencingRules: {
          preConditionRules: [{
            conditions: [{ condition: 'attempted', operator: 'not' }],
            action: 'skip'
          }]
        },
        controlMode: {
          choice: true,
          flow: true
        }
      }
    };

    const mockActivity2 = {
      identifier: 'activity2',
      sequencing: {
        sequencingRules: {
          preConditionRules: []
        },
        controlMode: {
          choice: true,
          flow: true
        }
      }
    };

    activityTreeManager.findActivity = jest.fn((id) => {
      if (id === 'activity1') return mockActivity1;
      if (id === 'activity2') return mockActivity2;
      return null;
    });
  });

  afterEach(async () => {
    // Clean up browse mode sessions to prevent timeout handles
    if (browseModeService && browseModeService.enabled) {
      await browseModeService.disableBrowseMode();
    }
  });

  describe('SequencingEngine Browse Mode Integration', () => {
    test('should initialize with browse mode service', () => {
      expect(sequencingEngine.browseModeService).toBe(browseModeService);
      expect(sequencingEngine.isBrowseModeEnabled()).toBe(false);
    });

    test('should evaluate navigation request in browse mode when enabled', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.browseMode).toBe(true);
      expect(result.reason).toContain('Browse mode');
      expect(result.scormCompliant).toBe(true);
      expect(result.standardEvaluation).toBeDefined();
    });

    test('should deny navigation when browse mode not enabled', () => {
      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.success).toBe(false);
      expect(result.allowed).toBe(false);
      expect(result.browseMode).toBe(false);
      expect(result.reason).toContain('not enabled');
    });

    test('should include standard evaluation in browse mode result', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.standardEvaluation).toBeDefined();
      expect(result.standardEvaluation.preConditions).toBeDefined();
      expect(result.standardEvaluation.controlModes).toBeDefined();
      expect(typeof result.standardEvaluation.wouldAllowInNormalMode).toBe('boolean');
    });

    test('should handle errors gracefully during evaluation', async () => {
      await browseModeService.enableBrowseMode();
      
      // Mock error in activity tree manager
      activityTreeManager.findActivity = jest.fn(() => {
        throw new Error('Test error');
      });

      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.success).toBe(true); // Should still allow in browse mode
      expect(result.allowed).toBe(true);
      expect(result.standardEvaluation.error).toBeDefined();
    });
  });

  describe('NavigationHandler Browse Mode Integration', () => {
    test('should initialize with browse mode service', () => {
      expect(navigationHandler.browseModeService).toBe(browseModeService);
      expect(navigationHandler.isBrowseModeEnabled()).toBe(false);
    });

    test('should use browse mode processing when enabled', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = navigationHandler.processNavigationRequest(
        NAVIGATION_REQUESTS.CHOICE,
        'activity2'
      );

      expect(result.success).toBe(true);
      expect(result.browseMode).toBe(true);
      expect(result.targetActivity).toBeDefined();
      expect(result.targetActivity.identifier).toBe('activity2');
    });

    test('should use standard processing when browse mode disabled', () => {
      // Mock standard navigation validity check
      navigationHandler.checkNavigationValidity = jest.fn(() => ({
        valid: true,
        reason: 'Navigation allowed'
      }));
      
      navigationHandler.processChoiceRequest = jest.fn(() => ({
        success: true,
        reason: 'Choice processed',
        action: 'launch'
      }));

      const result = navigationHandler.processNavigationRequest(
        NAVIGATION_REQUESTS.CHOICE,
        'activity2'
      );

      expect(result.success).toBe(true);
      expect(result.browseMode).toBeUndefined();
      expect(navigationHandler.checkNavigationValidity).toHaveBeenCalled();
    });

    test('should handle choice navigation in browse mode', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = navigationHandler.processBrowseModeNavigation(
        NAVIGATION_REQUESTS.CHOICE,
        'activity2'
      );

      expect(result.success).toBe(true);
      expect(result.browseMode).toBe(true);
      expect(result.targetActivity.identifier).toBe('activity2');
      expect(result.action).toBe('launch');
      expect(result.sessionId).toBeDefined();
    });

    test('should handle non-choice navigation in browse mode', async () => {
      await browseModeService.enableBrowseMode();

      // Mock navigation session and root activity for START request
      navigationHandler.navigationSession.currentActivity = { identifier: 'activity1' };

      // Mock root activity and findFirstLaunchableActivity for START request
      const mockRootActivity = { identifier: 'root', children: [] };
      const mockFirstActivity = { identifier: 'first-activity' };
      activityTreeManager.root = mockRootActivity;
      navigationHandler.findFirstLaunchableActivity = jest.fn(() => mockFirstActivity);

      const result = navigationHandler.processBrowseModeNavigation(
        NAVIGATION_REQUESTS.START
      );

      expect(result.success).toBe(true);
      expect(result.browseMode).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    test('should reject navigation to non-existent activity in browse mode', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = navigationHandler.processBrowseModeNavigation(
        NAVIGATION_REQUESTS.CHOICE,
        'nonexistent'
      );

      expect(result.success).toBe(false);
      expect(result.browseMode).toBe(true);
      expect(result.reason).toContain('not found');
    });

    test('should handle errors in browse mode navigation', async () => {
      await browseModeService.enableBrowseMode();
      
      // Mock error in sequencing engine
      sequencingEngine.evaluateNavigationRequestInBrowseMode = jest.fn(() => {
        throw new Error('Test error');
      });

      const result = navigationHandler.processBrowseModeNavigation(
        NAVIGATION_REQUESTS.CHOICE,
        'activity2'
      );

      expect(result.success).toBe(false);
      expect(result.browseMode).toBe(true);
      expect(result.error).toBeDefined();
    });
  });

  describe('Browse Mode Navigation Bypass', () => {
    test('should bypass sequencing restrictions in browse mode', async () => {
      await browseModeService.enableBrowseMode();
      
      // Activity1 has pre-condition rule that would normally block navigation
      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        null,
        'activity1',
        'choice'
      );

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.standardEvaluation.preConditions.action).toBe('skip'); // Would block in normal mode
      expect(result.standardEvaluation.wouldAllowInNormalMode).toBe(false); // Would be blocked
    });

    test('should allow unrestricted choice navigation in browse mode', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = navigationHandler.processBrowseModeNavigation(
        NAVIGATION_REQUESTS.CHOICE,
        'activity1'
      );

      expect(result.success).toBe(true);
      expect(result.browseMode).toBe(true);
      expect(result.targetActivity.identifier).toBe('activity1');
    });

    test('should maintain SCORM compliance while bypassing restrictions', async () => {
      await browseModeService.enableBrowseMode();
      
      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.scormCompliant).toBe(true);
      expect(result.standardEvaluation).toBeDefined();
      expect(result.allowed).toBe(true); // Bypassed for browse mode
    });
  });

  describe('Browse Mode Session Integration', () => {
    test('should include session information in navigation results', async () => {
      const enableResult = await browseModeService.enableBrowseMode();

      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.sessionId).toBe(enableResult.session.id);
    });

    test('should handle session cleanup during navigation', async () => {
      await browseModeService.enableBrowseMode();
      await browseModeService.disableBrowseMode();

      const result = sequencingEngine.evaluateNavigationRequestInBrowseMode(
        'activity1',
        'activity2',
        'choice'
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not enabled');
    });
  });


});
