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
const { SN_ERROR_CODES, SEQUENCING_SESSION_STATES, ACTIVITY_STATES } = require('../../../../shared/constants/sn-constants');

/**
 * SCORM Sequencing and Navigation Service
 * 
 * Main service class that orchestrates all SN operations and provides
 * integration points with RTE and CAM services.
 */
class ScormSNService {
  constructor(errorHandler, logger, options = {}, browseModeService = null) {
    this.errorHandler = errorHandler;
    this.logger = logger;
    this.browseModeService = browseModeService;
    this.options = {
      enableGlobalObjectives: true,
      enableRollupProcessing: true,
      maxSequencingDepth: 10,
      ...options
    };

    // Initialize core SN components
    this.activityTreeManager = new ActivityTreeManager(errorHandler, logger);
    this.sequencingEngine = new SequencingEngine(
      this.activityTreeManager,
      errorHandler,
      logger,
      this.browseModeService
    );
    this.navigationHandler = new NavigationHandler(
      this.activityTreeManager,
      this.sequencingEngine,
      errorHandler,
      logger,
      this.browseModeService
    );
    this.rollupManager = new RollupManager(this.activityTreeManager, errorHandler, logger);

    // Service state
    this.sessionState = SEQUENCING_SESSION_STATES.NOT_STARTED;
    this.currentPackage = null;
    this.sequencingSession = null;

    this.logger?.debug('ScormSNService initialized', {
      browseModeSupport: !!this.browseModeService
    });
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
 
      // Diagnostics: summarize orgs/items/sequencing presence prior to validation
      try {
        // Normalize organizations to a single array regardless of shape
        const orgs = (Array.isArray(manifest?.organizations?.organization) && manifest.organizations.organization)
          || (Array.isArray(manifest?.organizations?.organizations) && manifest.organizations.organizations)
          || [];
 
        const countItems = (items) => (Array.isArray(items) ? items.reduce((n, it) => n + 1 + countItems(it?.children || it?.items || []), 0) : 0);
        const hasExplicitSeq = orgs.some(org => {
          if (org?.sequencing) return true;
          const stack = Array.isArray(org?.items) ? [...org.items] : [];
          while (stack.length) {
            const it = stack.pop();
            if (!it) continue;
            if (it.sequencing) return true;
            const kids = (Array.isArray(it.children) ? it.children : (Array.isArray(it.items) ? it.items : []));
            if (kids.length) stack.push(...kids);
          }
          return false;
        });
 
        const orgSummary = {
          orgs: orgs.length,
          items: orgs.reduce((sum, org) => sum + countItems(org?.items || []), 0),
          explicitSequencing: hasExplicitSeq,
          defaultOrg: manifest?.organizations?.default || null
        };
        this.logger?.info('SN.init: CAM manifest summary', orgSummary);
      } catch (_) { /* best-effort diagnostics */ }
 
      // Validate manifest has sequencing information (or defaults allowed)
      if (!this.validateManifestForSequencing(manifest)) {
        // Strict policy: throw ParserError with actionable message (no auto-correction/fallback)
        const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');
        const defaultOrgId = manifest?.organizations?.default || null;
        const orgs = (Array.isArray(manifest?.organizations?.organizations) && manifest.organizations.organizations)
          || (Array.isArray(manifest?.organizations?.organization) && manifest.organizations.organization)
          || [];
        const defaultOrg = defaultOrgId
          ? orgs.find(o => o?.identifier === defaultOrgId)
          : orgs[0];
        const topCount = Array.isArray(defaultOrg?.items) ? defaultOrg.items.length : 0;
        throw new ParserError({
          code: ParserErrorCode.PARSE_VALIDATION_ERROR,
          message: topCount === 0
            ? 'No items in default organization'
            : 'Manifest does not contain valid sequencing information',
          detail: {
            reason: 'EMPTY_ACTIVITY_TREE',
            defaultOrgId,
            orgCount: orgs.length,
            topCount
          },
          phase: 'SN_INIT'
        });
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
      // Strict policy: propagate ParserError so callers/tests can assert specific codes
      if (error && (error.name === 'ParserError' || error.code)) {
        this.logger?.error('Error initializing SN service (ParserError):', {
          name: error.name,
          code: error.code,
          message: error.message,
          detail: error.detail,
          phase: 'SN_INIT'
        });
        throw error;
      }

      // Legacy generic errors: map to SN error handler and return structured failure
      this.logger?.error('Error initializing SN service:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.SN_SERVICE_UNAVAILABLE,
        `SN initialization failed: ${error.message}`, 'initialize');
      throw error;
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

      // Synchronize navigation handler session with current activity
      // This ensures browse mode navigation works correctly
      this.navigationHandler.updateNavigationSession(activity);

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
   * Refresh navigation availability (useful when browse mode state changes)
   * @returns {Object} Updated sequencing state with refreshed navigation
   */
  refreshNavigationAvailability() {
    this.navigationHandler.refreshNavigationAvailability();
    return this.getSequencingState();
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
   * Validate manifest contains sufficient information to build an activity tree
   * and apply SCORM 2004 sequencing defaults.
   *
   * SCORM 2004 (3rd/4th Ed.) does NOT require every item to have explicit
   * imsss:sequencing. Default sequencing behaviors apply when sequencing is
   * omitted. Therefore, SN should initialize if at least one organization
   * with items exists, even if explicit sequencing elements are absent.
   *
   * Accept when:
   *  - There is at least one organization with at least one item
   *  - OR organizations exist and any org/item has imsss sequencing
   *
   * Reject only when no organizations exist or organizations have no items.
   *
   * @private
   * @param {Object} manifest - CAM manifest (parsed by CAM)
   * @returns {boolean} True if valid for sequencing/session initialization
   */
  validateManifestForSequencing(manifest) {
    try {
      if (!manifest || !manifest.organizations) return false;

      // Accept both shapes: { organizations: { organizations: [] } } and canonical { organizations: { organization: [] } }
      const orgs =
        (Array.isArray(manifest.organizations.organizations) && manifest.organizations.organizations)
        || (Array.isArray(manifest.organizations.organization) && manifest.organizations.organization)
        || [];

      if (!Array.isArray(orgs) || orgs.length === 0) {
        return false;
      }

      // If any explicit sequencing present at org or item level, accept.
      const hasExplicitSequencing =
        orgs.some(org => {
          if (org && org.sequencing) return true;
          const stack = Array.isArray(org?.items) ? [...org.items] : [];
          while (stack.length) {
            const it = stack.pop();
            if (!it) continue;
            if (it.sequencing) return true;
            const kids = (Array.isArray(it.children) ? it.children : (Array.isArray(it.items) ? it.items : []));
            if (kids.length) stack.push(...kids);
          }
          return false;
        });

      if (hasExplicitSequencing) {
        return true;
      }

      // Otherwise ensure at least one item exists to apply default sequencing.
      const hasAnyItems =
        orgs.some(org => {
          const items = Array.isArray(org?.items) ? org.items : [];
          return items.length > 0;
        });

      return hasAnyItems;
    } catch (e) {
      this.logger?.warn('SN.validateManifestForSequencing: permissive accept due to error', { message: e?.message });
      // On parser irregularities, be permissive and allow defaults to apply
      return true;
    }
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

  /**
   * Update activity location in the SN service.
   * This method would typically update the current activity's location property.
   * @param {string} activityId - The ID of the activity to update.
   * @param {string} location - The new location string.
   * @returns {Object} Result indicating success or failure.
   */
  updateActivityLocation(activityId, location) {
    try {
      const activity = this.activityTreeManager.getActivity(activityId);
      if (!activity) {
        this.errorHandler?.setError(SN_ERROR_CODES.ACTIVITY_NOT_FOUND,
          `Activity not found: ${activityId}`, 'updateActivityLocation');
        return { success: false, reason: 'Activity not found' };
      }
      
      activity.location = location; // Update the location property on the ActivityNode
      this.logger?.debug(`SN Service: Updated location for activity ${activityId} to ${location}`);
      return { success: true, reason: 'Activity location updated' };
    } catch (error) {
      this.logger?.error('Error updating activity location:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.SN_SERVICE_UNAVAILABLE,
        `Update activity location failed: ${error.message}`, 'updateActivityLocation');
      return { success: false, reason: 'Update activity location error', error: error.message };
    }
  }

  /**
   * Handle activity exit type in the SN service.
   * This method triggers sequencing rules based on the exit type.
   * @param {string} activityId - The ID of the activity that is exiting.
   * @param {string} exitType - The exit type (e.g., 'normal', 'suspend', 'logout').
   * @returns {Object} Result indicating success or failure.
   */
  handleActivityExit(activityId, exitType) {
    try {
      const activity = this.activityTreeManager.getActivity(activityId);
      if (!activity) {
        this.errorHandler?.setError(SN_ERROR_CODES.ACTIVITY_NOT_FOUND,
          `Activity not found: ${activityId}`, 'handleActivityExit');
        return { success: false, reason: 'Activity not found' };
      }

      this.logger?.debug(`SN Service: Handling exit for activity ${activityId} with type ${exitType}`);

      let navigationResult = { success: true, reason: 'Exit handled' };

      switch (exitType) {
        case 'suspend':
          // Trigger suspend all navigation request
          navigationResult = this.navigationHandler.processSuspendAllRequest();
          break;
        case 'normal':
        case 'logout':
          // Trigger exit navigation request
          navigationResult = this.navigationHandler.processExitRequest();
          break;
        case 'time-out':
        case 'uninitialized':
          // These might not trigger explicit navigation, but could update activity state
          activity.setState(ACTIVITY_STATES.INACTIVE); // Or a more specific state
          break;
        default:
          this.logger?.warn(`SN Service: Unhandled exit type: ${exitType} for activity ${activityId}`);
          break;
      }

      return navigationResult;
    } catch (error) {
      this.logger?.error('Error handling activity exit:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.SN_SERVICE_UNAVAILABLE,
        `Handle activity exit failed: ${error.message}`, 'handleActivityExit');
      return { success: false, reason: 'Handle activity exit error', error: error.message };
    }
  }
}

module.exports = {
  ScormSNService,
  ActivityTreeManager,
  SequencingEngine,
  NavigationHandler,
  RollupManager
};