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
const PathUtils = require('../../../../shared/utils/path-utils');
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
  constructor(errorHandler, logger, options = {}, browseModeService = null, scormService = null) {
    this.errorHandler = errorHandler;
    this.logger = logger;
    this.browseModeService = browseModeService;
    this.scormService = scormService; // Reference to parent ScormService for IPC access
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
        // Debug: Log actual manifest organizations structure
        this.logger?.info('SN.init: manifest.organizations structure', {
          hasOrganizations: !!manifest?.organizations,
          orgKeys: manifest?.organizations ? Object.keys(manifest.organizations) : [],
          hasOrgProperty: !!manifest?.organizations?.organization,
          hasOrgsProperty: !!manifest?.organizations?.organizations,
          orgPropertyType: Array.isArray(manifest?.organizations?.organization) ? 'array' : typeof manifest?.organizations?.organization,
          orgsPropertyType: Array.isArray(manifest?.organizations?.organizations) ? 'array' : typeof manifest?.organizations?.organizations
        });

        // Get organizations array from ManifestParser output
        const orgs = manifest?.organizations?.organization || [];

        const countItems = (items) => (Array.isArray(items) ? items.reduce((n, it) => n + 1 + countItems(it?.item || []), 0) : 0);
        const hasExplicitSeq = orgs.some(org => {
          if (org?.sequencing) return true;
          const stack = Array.isArray(org?.item) ? [...org.item] : [];
          while (stack.length) {
            const it = stack.pop();
            if (!it) continue;
            if (it.sequencing) return true;
            const kids = Array.isArray(it.item) ? it.item : [];
            if (kids.length) stack.push(...kids);
          }
          return false;
        });

        const orgSummary = {
          orgs: orgs.length,
          items: orgs.reduce((sum, org) => sum + countItems(org?.item || []), 0),
          explicitSequencing: hasExplicitSeq,
          defaultOrg: manifest?.organizations?.default || null
        };
        this.logger?.info('SN.init: CAM manifest summary', orgSummary);
      } catch (_) { /* best-effort diagnostics */ }


      // Enforce canonical organizations shape strictly (no fallbacks)
      if (!manifest?.organizations || (manifest.organizations.organization === undefined)) {
        const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');
        throw new ParserError({
          code: ParserErrorCode.PARSE_VALIDATION_ERROR,
          message: 'SCORM compliance violation: organizations.organization required',
          detail: {
            reason: 'MISSING_ORGANIZATIONS_ORGANIZATION',
            hasOrganizations: !!manifest?.organizations,
            orgKeys: manifest?.organizations ? Object.keys(manifest.organizations) : []
          },
          phase: 'SN_INIT'
        });
      }

      // Validate manifest has sequencing information (or defaults allowed)
      if (!this.validateManifestForSequencing(manifest)) {
        // Strict policy: throw ParserError with actionable message (no auto-correction/fallback)
        const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');
        const defaultOrgId = manifest?.organizations?.default || null;
        const orgProp = manifest?.organizations?.organization;
        const orgs = Array.isArray(orgProp) ? orgProp : (orgProp ? [orgProp] : []);
        const defaultOrg = defaultOrgId
          ? orgs.find(o => o?.identifier === defaultOrgId)
          : orgs[0];
        const topItems = Array.isArray(defaultOrg?.item)
          ? defaultOrg.item
          : (defaultOrg?.item ? [defaultOrg.item] : []);
        const topCount = topItems.length;
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

        // Enrich target activity with final scorm-app:// launchUrl using centralized resolution
        try {
          const activity = navResult.targetActivity;
          const res = activity?.resource || null;
          const href = res?.href || null;
          const xmlBase = res?.['xml:base'] || res?.xmlBase || res?.xmlbase || '';
          const folderPath = this.sequencingSession?.packageInfo?.folderPath || this.currentPackage?.folderPath || null;
          if (href && folderPath) {
            const contentPath = PathUtils.combineXmlBaseHref(xmlBase, href);
            const manifestPath = PathUtils.join(folderPath, 'imsmanifest.xml');
            const appRoot = PathUtils.getAppRoot(__dirname);
            const resolved = PathUtils.resolveScormContentUrl(contentPath, folderPath, manifestPath, appRoot);
            if (resolved?.success && resolved.url) {
              activity.launchUrl = resolved.url;
            } else {
              throw new Error(resolved?.error || 'Unknown resolution failure');
            }
          } else {
            this.logger?.warn('SN: Missing href or folderPath for launch URL resolution', { hasHref: !!href, hasFolderPath: !!folderPath });
          }
        } catch (e) {
          this.logger?.error('SN: Failed to resolve final launch URL for target activity', e?.message || e);
          // Strict: do not override success, but downstream will enforce scorm-app:// requirement
        }

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

      // If in browse mode, also update browse mode service with current location
      if (this.browseModeService?.isBrowseModeEnabled()) {
        this.browseModeService.saveCurrentLocation(activity.identifier, {
          navigationType: 'sequencing',
          source: 'processActivitySequencing',
          activityTitle: activity.title
        });
        this.logger?.debug('SN Service: Updated browse mode location during sequencing', {
          activityId: activity.identifier,
          activityTitle: activity.title
        });
      }

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
          resource: activity.resource,
          parameters: activity.parameters
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

      // Update visibility of other activities after progress change
      const visibilityUpdateResult = this.updateActivityVisibilityAfterProgress(activityId);
      if (!visibilityUpdateResult.success) {
        this.logger?.warn('Failed to update activity visibility after progress:', visibilityUpdateResult.reason);
      } else if (visibilityUpdateResult.affectedActivities.length > 0) {
        this.logger?.info(`Updated visibility for ${visibilityUpdateResult.affectedActivities.length} activities after ${activityId} completion`);
      }

       this.logger?.debug(`Activity progress updated: ${activityId}`, progressData);

       return {
         success: true,
         reason: 'Activity progress updated',
         rollup: rollupResult,
         postCondition: postConditionResult,
         visibilityUpdate: visibilityUpdateResult // Include in response for debugging
      };

    } catch (error) {
      this.logger?.error('Error updating activity progress:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.ROLLUP_PROCESSING_FAILED,
        `Progress update failed: ${error.message}`, 'updateActivityProgress');
      return { success: false, reason: 'Progress update error', error: error.message };
    }
  }

  /**
   * Update activity visibility based on sequencing rules after progress changes
   * Uses intelligent evaluation to only update activities that should actually change
   * @param {string} completedActivityId - ID of the activity that just completed
   * @returns {Object} Update result with affected activities
   */
  updateActivityVisibilityAfterProgress(completedActivityId) {
    try {
      const completedActivity = this.activityTreeManager.getActivity(completedActivityId);
      if (!completedActivity) {
        return { success: false, reason: 'Completed activity not found' };
      }

      const affectedActivities = [];
      const activitiesToEvaluate = this.getActivitiesPotentiallyAffectedBy(completedActivity);

      for (const activity of activitiesToEvaluate) {
        // Skip the completed activity itself
        if (activity.identifier === completedActivityId) continue;

        // Evaluate current visibility based on ALL prerequisites
        const shouldBeVisible = this.evaluateActivityVisibility(activity);
        const wasVisible = activity.isVisible;

        if (shouldBeVisible !== wasVisible) {
          activity.isVisible = shouldBeVisible;
          affectedActivities.push({
            id: activity.identifier,
            title: activity.title,
            visibilityChanged: true,
            nowVisible: shouldBeVisible,
            reason: shouldBeVisible ? 'prerequisite-met' : 'prerequisite-blocked'
          });

          this.logger?.debug(`Activity ${activity.identifier} visibility updated: ${wasVisible} → ${shouldBeVisible} (reason: prerequisite change)`);

          // Emit visibility change event for enhanced debugging
          this.emitVisibilityChangeEvent(activity, wasVisible, shouldBeVisible, completedActivityId);
        }
      }

      return {
        success: true,
        reason: 'Activity visibility updated intelligently after progress change',
        affectedActivities,
        totalAffected: affectedActivities.length
      };

    } catch (error) {
      this.logger?.error('Error updating activity visibility after progress:', error);
      return { success: false, reason: 'Visibility update failed', error: error.message };
    }
  }

  /**
   * Evaluate if an activity should be visible based on ALL current prerequisites
   * @private
   * @param {ActivityNode} activity - Activity to evaluate
   * @returns {boolean} True if activity should be visible
   */
  evaluateActivityVisibility(activity) {
    try {
      // 1. Check if activity has explicit hide rules
      if (activity.sequencing?.sequencingRules?.preConditionRules) {
        for (const rule of activity.sequencing.sequencingRules.preConditionRules) {
          if (rule.action === 'hiddenFromChoice') {
            return false; // Explicitly hidden
          }
        }
      }

      // 2. Check prerequisite completion status
      const prerequisites = this.getActivityPrerequisites(activity);
      for (const prereq of prerequisites) {
        if (!this.isActivityCompleted(prereq)) {
          return false; // Prerequisite not met
        }
      }

      // 3. Check sequencing control modes
      if (activity.sequencing?.controlMode) {
        // Apply control mode restrictions if needed
        // For visibility, we mainly care about prerequisites
        // Control modes are more relevant for navigation than visibility
      }

      // 4. Default to visible if no restrictions apply
      return true;

    } catch (error) {
      this.logger?.error(`Error evaluating visibility for activity ${activity.identifier}:`, error);
      // On error, default to visible to avoid breaking existing state
      return true;
    }
  }

  /**
   * Get all activities that might be affected by a completion
   * @private
   * @param {ActivityNode} completedActivity - The activity that just completed
   * @returns {ActivityNode[]} Array of activities to evaluate
   */
  getActivitiesPotentiallyAffectedBy(completedActivity) {
    const affectedActivities = new Set();

    // Use tree traversal to find activities that could be affected
    this.activityTreeManager.traverseTree(this.activityTreeManager.root, (activity) => {
      // Include activities that:
      // 1. Have prerequisites referencing the completed activity
      // 2. Are siblings of the completed activity
      // 3. Are children of the completed activity
      // 4. Have sequencing rules that depend on the completed activity

      if (this.isAffectedByCompletion(activity, completedActivity)) {
        affectedActivities.add(activity);
      }
    });

    return Array.from(affectedActivities);
  }

  /**
   * Check if an activity is affected by another activity's completion
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @param {ActivityNode} completedActivity - Activity that completed
   * @returns {boolean} True if activity could be affected
   */
  isAffectedByCompletion(activity, completedActivity) {
    // Skip the completed activity itself
    if (activity.identifier === completedActivity.identifier) {
      return false;
    }

    // Check if activity has prerequisites that reference the completed activity
    const prerequisites = this.getActivityPrerequisites(activity);
    if (prerequisites.some(prereq => prereq.identifier === completedActivity.identifier)) {
      return true;
    }

    // Check if activity is a sibling of the completed activity
    if (activity.parent && completedActivity.parent &&
        activity.parent.identifier === completedActivity.parent.identifier) {
      return true;
    }

    // Check if activity is a child of the completed activity
    if (this.isDescendantOf(activity, completedActivity)) {
      return true;
    }

    // Check if activity has sequencing rules that depend on the completed activity
    if (this.hasSequencingDependencyOn(activity, completedActivity)) {
      return true;
    }

    // Only evaluate activities that actually have sequencing rules
    // This prevents unnecessary evaluation of activities without rules
    return !!(activity.sequencing?.sequencingRules?.preConditionRules?.length > 0);
  }

  /**
   * Get prerequisites for an activity
   * @private
   * @param {ActivityNode} activity - Activity to get prerequisites for
   * @returns {ActivityNode[]} Array of prerequisite activities
   */
  getActivityPrerequisites(activity) {
    const prerequisites = [];

    try {
      // Check pre-condition rules for referenced activities
      if (activity.sequencing?.sequencingRules?.preConditionRules) {
        for (const rule of activity.sequencing.sequencingRules.preConditionRules) {
          if (rule.conditions) {
            for (const condition of rule.conditions) {
              // Look for conditions that reference other activities
              if (condition.referencedObjective || condition.activity) {
                // This is a simplified check - in a full implementation,
                // we'd need to resolve the actual activity references
                const referencedActivity = this.activityTreeManager.getActivity(condition.activity);
                if (referencedActivity) {
                  prerequisites.push(referencedActivity);
                }
              }
            }
          }
        }
      }

      // Also check parent activity prerequisites (inheritance)
      if (activity.parent) {
        const parentPrerequisites = this.getActivityPrerequisites(activity.parent);
        prerequisites.push(...parentPrerequisites);
      }

    } catch (error) {
      this.logger?.error(`Error getting prerequisites for activity ${activity.identifier}:`, error);
    }

    return prerequisites;
  }

  /**
   * Check if an activity is completed
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean} True if activity is completed
   */
  isActivityCompleted(activity) {
    try {
      return activity.attemptState === 'completed' ||
             activity.activityState === 'completed';
    } catch (error) {
      this.logger?.error(`Error checking completion status for activity ${activity.identifier}:`, error);
      return false;
    }
  }

  /**
   * Check if an activity is a descendant of another activity
   * @private
   * @param {ActivityNode} potentialDescendant - Potential descendant activity
   * @param {ActivityNode} potentialAncestor - Potential ancestor activity
   * @returns {boolean} True if potentialDescendant is a descendant of potentialAncestor
   */
  isDescendantOf(potentialDescendant, potentialAncestor) {
    let current = potentialDescendant.parent;
    while (current) {
      if (current.identifier === potentialAncestor.identifier) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Check if an activity has sequencing dependency on another activity
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @param {ActivityNode} otherActivity - Activity to check dependency on
   * @returns {boolean} True if activity has sequencing dependency on otherActivity
   */
  hasSequencingDependencyOn(activity, otherActivity) {
    try {
      // Check if activity's sequencing rules reference the other activity
      if (activity.sequencing?.sequencingRules?.preConditionRules) {
        for (const rule of activity.sequencing.sequencingRules.preConditionRules) {
          if (rule.conditions) {
            for (const condition of rule.conditions) {
              // Check for direct activity references
              if (condition.activity === otherActivity.identifier) {
                return true;
              }
              // Check for objective references that might be satisfied by the other activity
              if (condition.referencedObjective) {
                // This is a simplified check - in practice, we'd need to resolve objective mappings
                const otherObjectives = otherActivity.objectives || new Map();
                if (otherObjectives.has(condition.referencedObjective)) {
                  return true;
                }
              }
            }
          }
        }
      }

      // Check if activity's sequencing rules reference objectives that the other activity satisfies
      if (activity.sequencing?.objectives) {
        const activityObjectives = activity.sequencing.objectives;
        const otherObjectives = otherActivity.objectives || new Map();

        // Check primary objective mapping
        if (activityObjectives.primaryObjective?.mapInfo) {
          const mapInfo = activityObjectives.primaryObjective.mapInfo;
          if (mapInfo.targetObjectiveID && otherObjectives.has(mapInfo.targetObjectiveID)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      this.logger?.error(`Error checking sequencing dependency for ${activity.identifier} on ${otherActivity.identifier}:`, error);
      return false;
    }
  }

  /**
   * Emit visibility change event for debugging and monitoring
   * @private
   * @param {ActivityNode} activity - Activity whose visibility changed
   * @param {boolean} wasVisible - Previous visibility state
   * @param {boolean} nowVisible - New visibility state
   * @param {string} triggerActivityId - Activity that triggered the change
   */
  emitVisibilityChangeEvent(activity, wasVisible, nowVisible, triggerActivityId) {
    try {
      // Use IPC broadcast instead of direct event-bus require to avoid main/renderer process mixing
      if (this.scormService) {
        const windowManager = this.scormService.getDependency('windowManager');
        if (windowManager?.broadcastToAllWindows) {
          windowManager.broadcastToAllWindows('activity-visibility-changed', {
            activityId: activity.identifier,
            activityTitle: activity.title,
            wasVisible,
            nowVisible,
            triggerActivityId,
            reason: nowVisible ? 'prerequisite-met' : 'prerequisite-blocked',
            timestamp: new Date().toISOString()
          });
          this.logger?.debug(`Broadcasted visibility change event for activity ${activity.identifier}`);
        } else {
          this.logger?.warn('WindowManager not available for visibility change broadcast');
        }
      } else {
        this.logger?.warn('ScormService reference not available for visibility change broadcast');
      }
    } catch (error) {
      this.logger?.error('Error emitting visibility change event:', error);
    }
  }

  /**
   * Get current sequencing state
   * @returns {Object} Current sequencing state
   */
  getSequencingState() {
    const currentActivity = this.activityTreeManager.currentActivity;
    const treeStats = this.activityTreeManager.getTreeStats();

    return {
      sessionState: this.sessionState,
      sessionId: this.sequencingSession?.sessionId || null,
      currentActivity: currentActivity ? {
        identifier: currentActivity.identifier,
        title: currentActivity.title,
        state: currentActivity.activityState,
        attemptCount: currentActivity.attemptCount,
        presentation: currentActivity.presentation || null
      } : null,
      availableNavigation: this.navigationHandler.getAvailableNavigation(),
      presentation: currentActivity?.presentation || null,
      hiddenControls: this.getHiddenControlsForCurrentActivity(),
      globalObjectives: this.rollupManager.getAllGlobalObjectives(),
      activityTreeStats: treeStats,
      isSingleSCO: treeStats.launchableActivities === 1
    };
  }

  /**
   * Get hidden LMS UI controls for current activity
   * @returns {Array<string>} Array of hidden control names
   */
  getHiddenControlsForCurrentActivity() {
    const currentActivity = this.activityTreeManager.currentActivity;
    if (!currentActivity?.presentation?.navigationInterface?.hideLMSUI) {
      return [];
    }
    return currentActivity.presentation.navigationInterface.hideLMSUI;
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

      // Get organizations array from ManifestParser output (support both properties)
      const orgProp = manifest.organizations?.organization;
      const orgs = Array.isArray(orgProp) ? orgProp : (orgProp ? [orgProp] : []);

      if (orgs.length === 0) {
        return false;
      }

      // If any explicit sequencing present at org or item level, accept.
      const hasExplicitSequencing =
        orgs.some(org => {
          if (org && org.sequencing) return true;
          const stack = Array.isArray(org?.item) ? [...org.item] : [];
          while (stack.length) {
            const it = stack.pop();
            if (!it) continue;
            if (it.sequencing) return true;
            const kids = Array.isArray(it.item) ? it.item : [];
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
          const items = Array.isArray(org?.item) ? org.item : [];
          return items.length > 0;
        });

      return hasAnyItems;
    } catch (e) {
      this.logger?.error('SN.validateManifestForSequencing: validation failed', { message: e?.message });
      return false;
    }
  }

  /**
   * Generate unique session ID
   * @private
   * @returns {string} Session ID
   */
  generateSessionId() {
    return `sn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
