/**
 * SCORM 2004 4th Edition Sequencing and Navigation Service
 * 
 * Unified interface for all SN operations including activity tree management,
 * sequencing rule processing, navigation handling, and rollup management.
 * Integrates with Phase 1 RTE and Phase 2 CAM services.
 * 
 * @fileoverview SN service main entry point and orchestration
 */

const { ActivityTreeManager } = require('./activity-tree');
const SequencingEngine = require('./sequencing-engine');
const NavigationHandler = require('./navigation-handler');
const RollupManager = require('./rollup-manager');
const { SN_ERROR_CODES, SEQUENCING_SESSION_STATES } = require('../../../../shared/constants/sn-constants');

/**
 * SCORM Sequencing and Navigation Service
 * 
 * Main service class that orchestrates all SN operations and provides
 * integration points with RTE and CAM services.
 */
class ScormSNService {
  constructor(errorHandler, logger, options = {}) {
    this.errorHandler = errorHandler;
    this.logger = logger;
    this.options = {
      enableGlobalObjectives: true,
      enableRollupProcessing: true,
      maxSequencingDepth: 10,
      ...options
    };

    // Initialize core SN components
    this.activityTreeManager = new ActivityTreeManager(errorHandler, logger);
    this.sequencingEngine = new SequencingEngine(this.activityTreeManager, errorHandler, logger);
    this.navigationHandler = new NavigationHandler(
      this.activityTreeManager, 
      this.sequencingEngine, 
      errorHandler, 
      logger
    );
    this.rollupManager = new RollupManager(this.activityTreeManager, errorHandler, logger);

    // Service state
    this.sessionState = SEQUENCING_SESSION_STATES.NOT_STARTED;
    this.currentPackage = null;
    this.sequencingSession = null;

    this.logger?.debug('ScormSNService initialized');
  }

  /**
   * Initialize SN service with CAM manifest data
   * @param {Object} manifest - Parsed CAM manifest
   * @param {Object} packageInfo - Package information from CAM
   * @returns {Promise<Object>} Initialization result
   */
  async initialize(manifest, packageInfo = {}) {
    try {
      this.logger?.info('Initializing SN service with manifest');

      // Validate manifest has sequencing information
      if (!this.validateManifestForSequencing(manifest)) {
        return { success: false, reason: 'Manifest does not contain valid sequencing information' };
      }

      // Build activity tree from manifest
      const treeResult = this.activityTreeManager.buildTree(manifest);
      if (!treeResult) {
        return { success: false, reason: 'Failed to build activity tree from manifest' };
      }

      // Initialize sequencing session
      this.sequencingSession = {
        sessionId: this.generateSessionId(),
        startTime: new Date(),
        manifest: manifest,
        packageInfo: packageInfo,
        activityAttempts: new Map(),
        globalObjectives: new Map()
      };

      this.currentPackage = packageInfo;
      this.sessionState = SEQUENCING_SESSION_STATES.ACTIVE;

      const stats = this.activityTreeManager.getTreeStats();
      this.logger?.info(`SN service initialized successfully`, stats);

      return {
        success: true,
        reason: 'SN service initialized successfully',
        sessionId: this.sequencingSession.sessionId,
        activityTree: stats
      };

    } catch (error) {
      this.logger?.error('Error initializing SN service:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.SN_SERVICE_UNAVAILABLE,
        `SN initialization failed: ${error.message}`, 'initialize');
      return { success: false, reason: 'SN initialization error', error: error.message };
    }
  }

  /**
   * Process navigation request
   * @param {string} navigationRequest - Type of navigation request
   * @param {string} targetActivityId - Target activity ID (for choice requests)
   * @returns {Promise<Object>} Navigation processing result
   */
  async processNavigation(navigationRequest, targetActivityId = null) {
    try {
      if (this.sessionState !== SEQUENCING_SESSION_STATES.ACTIVE) {
        this.errorHandler?.setError(SN_ERROR_CODES.SN_SERVICE_UNAVAILABLE,
          'SN service not active', 'processNavigation');
        return { success: false, reason: 'SN service not active' };
      }

      this.logger?.debug(`Processing navigation request: ${navigationRequest}`, { targetActivityId });

      // Process navigation through navigation handler
      const navResult = this.navigationHandler.processNavigationRequest(navigationRequest, targetActivityId);
      
      if (!navResult.success) {
        return navResult;
      }

      // If navigation resulted in a new target activity, process sequencing
      if (navResult.targetActivity) {
        const sequencingResult = await this.processActivitySequencing(navResult.targetActivity);
        
        return {
          ...navResult,
          sequencing: sequencingResult,
          availableNavigation: this.navigationHandler.getAvailableNavigation()
        };
      }

      return {
        ...navResult,
        availableNavigation: this.navigationHandler.getAvailableNavigation()
      };

    } catch (error) {
      this.logger?.error('Error processing navigation:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.NAVIGATION_SEQUENCE_ERROR,
        `Navigation processing failed: ${error.message}`, 'processNavigation');
      return { success: false, reason: 'Navigation processing error', error: error.message };
    }
  }

  /**
   * Process activity sequencing rules
   * @private
   * @param {ActivityNode} activity - Activity to process
   * @returns {Promise<Object>} Sequencing processing result
   */
  async processActivitySequencing(activity) {
    try {
      // Evaluate pre-condition rules
      const preConditionResult = this.sequencingEngine.evaluatePreConditionRules(activity);
      
      if (preConditionResult.action) {
        const actionResult = this.sequencingEngine.processSequencingAction(preConditionResult.action, activity);
        
        if (actionResult.success && actionResult.nextAction) {
          // Handle sequencing action results
          return await this.handleSequencingAction(actionResult, activity);
        }
      }

      // Set activity as current if no pre-condition actions triggered
      this.activityTreeManager.setCurrentActivity(activity.identifier);

      // Process rollup if enabled
      let rollupResult = null;
      if (this.options.enableRollupProcessing) {
        rollupResult = this.rollupManager.processRollup(activity);
      }

      return {
        success: true,
        reason: 'Activity sequencing processed',
        activity: {
          identifier: activity.identifier,
          title: activity.title,
          isLaunchable: activity.isLaunchable(),
          resource: activity.resource
        },
        preCondition: preConditionResult,
        rollup: rollupResult
      };

    } catch (error) {
      this.logger?.error('Error processing activity sequencing:', error);
      return { success: false, reason: 'Sequencing processing error', error: error.message };
    }
  }

  /**
   * Handle sequencing action results
   * @private
   * @param {Object} actionResult - Sequencing action result
   * @param {ActivityNode} activity - Current activity
   * @returns {Promise<Object>} Action handling result
   */
  async handleSequencingAction(actionResult, activity) {
    switch (actionResult.nextAction) {
      case 'continue':
        return this.processNavigation('continue');
      case 'previous':
        return this.processNavigation('previous');
      case 'restart':
        return this.processActivitySequencing(activity);
      case 'terminate':
        return this.terminateSequencing();
      case 'block':
        return { success: false, reason: 'Activity blocked by sequencing rules' };
      default:
        return { success: true, reason: `Sequencing action processed: ${actionResult.nextAction}` };
    }
  }

  /**
   * Update activity progress and trigger rollup
   * @param {string} activityId - Activity identifier
   * @param {Object} progressData - Progress data (completion, satisfaction, measure)
   * @returns {Object} Update result
   */
  updateActivityProgress(activityId, progressData) {
    try {
      const activity = this.activityTreeManager.getActivity(activityId);
      if (!activity) {
        this.errorHandler?.setError(SN_ERROR_CODES.ACTIVITY_NOT_FOUND,
          `Activity not found: ${activityId}`, 'updateActivityProgress');
        return { success: false, reason: 'Activity not found' };
      }

      // Update activity state
      if (progressData.completed !== undefined) {
        activity.attemptState = progressData.completed ? 'completed' : 'incomplete';
      }

      // Update objective information
      if (activity.primaryObjective) {
        if (progressData.satisfied !== undefined) {
          activity.primaryObjective.satisfied = progressData.satisfied;
        }
        if (progressData.measure !== undefined) {
          activity.primaryObjective.measure = progressData.measure;
        }
      }

      // Process rollup
      let rollupResult = null;
      if (this.options.enableRollupProcessing) {
        rollupResult = this.rollupManager.processRollup(activity);
      }

      // Evaluate post-condition rules on the activity and its parents
      let postConditionResult = this.sequencingEngine.evaluatePostConditionRules(activity);
      
      // If no post-condition action on current activity, check parent activities
      if (!postConditionResult.action && activity.parent) {
        postConditionResult = this.sequencingEngine.evaluatePostConditionRules(activity.parent);
      }

      this.logger?.debug(`Activity progress updated: ${activityId}`, progressData);

      return {
        success: true,
        reason: 'Activity progress updated',
        rollup: rollupResult,
        postCondition: postConditionResult
      };

    } catch (error) {
      this.logger?.error('Error updating activity progress:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.ROLLUP_PROCESSING_FAILED,
        `Progress update failed: ${error.message}`, 'updateActivityProgress');
      return { success: false, reason: 'Progress update error', error: error.message };
    }
  }

  /**
   * Get current sequencing state
   * @returns {Object} Current sequencing state
   */
  getSequencingState() {
    const currentActivity = this.activityTreeManager.currentActivity;
    
    return {
      sessionState: this.sessionState,
      sessionId: this.sequencingSession?.sessionId || null,
      currentActivity: currentActivity ? {
        identifier: currentActivity.identifier,
        title: currentActivity.title,
        state: currentActivity.activityState,
        attemptCount: currentActivity.attemptCount
      } : null,
      availableNavigation: this.navigationHandler.getAvailableNavigation(),
      globalObjectives: this.rollupManager.getAllGlobalObjectives(),
      activityTreeStats: this.activityTreeManager.getTreeStats()
    };
  }

  /**
   * Terminate sequencing session
   * @returns {Object} Termination result
   */
  terminateSequencing() {
    try {
      this.sessionState = SEQUENCING_SESSION_STATES.ENDED;
      
      const finalState = this.getSequencingState();
      
      this.logger?.info('Sequencing session terminated', {
        sessionId: this.sequencingSession?.sessionId,
        duration: this.sequencingSession ? Date.now() - this.sequencingSession.startTime : 0
      });

      return {
        success: true,
        reason: 'Sequencing session terminated',
        finalState
      };

    } catch (error) {
      this.logger?.error('Error terminating sequencing:', error);
      return { success: false, reason: 'Termination error', error: error.message };
    }
  }

  /**
   * Validate manifest contains sequencing information
   * @private
   * @param {Object} manifest - CAM manifest
   * @returns {boolean} True if valid for sequencing
   */
  validateManifestForSequencing(manifest) {
    return manifest && 
           manifest.organizations && 
           manifest.organizations.organizations && 
           manifest.organizations.organizations.length > 0;
  }

  /**
   * Generate unique session ID
   * @private
   * @returns {string} Session ID
   */
  generateSessionId() {
    return `sn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Reset SN service to initial state
   */
  reset() {
    this.activityTreeManager.reset();
    this.rollupManager.reset();
    this.sessionState = SEQUENCING_SESSION_STATES.NOT_STARTED;
    this.currentPackage = null;
    this.sequencingSession = null;
    
    this.logger?.debug('SN service reset');
  }

  /**
   * Get service status and capabilities
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      version: '1.0.0',
      sessionState: this.sessionState,
      capabilities: {
        activityTreeManagement: true,
        sequencingRuleProcessing: true,
        navigationHandling: true,
        rollupProcessing: this.options.enableRollupProcessing,
        globalObjectives: this.options.enableGlobalObjectives
      },
      supportedVersions: ['SCORM 2004 4th Edition'],
      lastError: this.errorHandler?.getLastError() || '0'
    };
  }
}

module.exports = {
  ScormSNService,
  ActivityTreeManager,
  SequencingEngine,
  NavigationHandler,
  RollupManager
};