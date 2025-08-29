/**
 * SCORM 2004 4th Edition Navigation Handler
 * 
 * Processes navigation requests and determines valid navigation options
 * based on sequencing rules, control modes, and activity tree state
 * according to SCORM 2004 4th Edition Sequencing and Navigation specification.
 * 
 * @fileoverview Navigation request processing and validation
 */

const {
  SN_ERROR_CODES,
  NAVIGATION_REQUESTS,
  ACTIVITY_STATES
} = require('../../../../shared/constants/sn-constants');

/**
 * Navigation Handler Class
 * Manages navigation requests and determines valid navigation paths
 */
class NavigationHandler {
  constructor(activityTreeManager, sequencingEngine, errorHandler, logger, browseModeService = null) {
    this.activityTreeManager = activityTreeManager;
    this.sequencingEngine = sequencingEngine;
    this.errorHandler = errorHandler;
    this.logger = logger;
    this.browseModeService = browseModeService;

    // Navigation state
    this.navigationSession = {
      active: false,
      currentActivity: null,
      availableNavigation: new Set()
    };

    this.logger?.debug('NavigationHandler initialized', {
      browseModeSupport: !!this.browseModeService
    });
  }

  /**
   * Process navigation request
   * @param {string} navigationRequest - Type of navigation request
   * @param {string} targetActivityId - Target activity ID (for choice requests)
   * @returns {Object} Navigation processing result
   */
  processNavigationRequest(navigationRequest, targetActivityId = null) {
    try {
      this.logger?.debug(`Processing navigation request: ${navigationRequest}`, {
        targetActivityId,
        browseMode: this.isBrowseModeEnabled()
      });

      // Validate navigation request type
      if (!Object.values(NAVIGATION_REQUESTS).includes(navigationRequest)) {
        this.errorHandler?.setError(SN_ERROR_CODES.INVALID_NAVIGATION_REQUEST,
          `Invalid navigation request: ${navigationRequest}`, 'processNavigationRequest');
        return { success: false, reason: 'Invalid navigation request type' };
      }

      // Check if browse mode is enabled - if so, use browse mode processing
      if (this.isBrowseModeEnabled()) {
        this.logger?.debug('Using browse mode navigation processing');
        return this.processBrowseModeNavigation(navigationRequest, targetActivityId);
      }

      // Standard SCORM navigation processing
      // Check if navigation is currently allowed
      const validityCheck = this.checkNavigationValidity(navigationRequest, targetActivityId);
      if (!validityCheck.valid) {
        this.errorHandler?.setError(SN_ERROR_CODES.NAVIGATION_NOT_ALLOWED,
          validityCheck.reason, 'processNavigationRequest');
        return { success: false, reason: validityCheck.reason };
      }

      // Process specific navigation request
      let result;
      switch (navigationRequest) {
        case NAVIGATION_REQUESTS.START:
          result = this.processStartRequest();
          break;
        case NAVIGATION_REQUESTS.RESUME_ALL:
          result = this.processResumeAllRequest();
          break;
        case NAVIGATION_REQUESTS.CONTINUE:
          result = this.processContinueRequest();
          break;
        case NAVIGATION_REQUESTS.PREVIOUS:
          result = this.processPreviousRequest();
          break;
        case NAVIGATION_REQUESTS.CHOICE:
          result = this.processChoiceRequest(targetActivityId);
          break;
        case NAVIGATION_REQUESTS.EXIT:
          result = this.processExitRequest();
          break;
        case NAVIGATION_REQUESTS.EXIT_ALL:
          result = this.processExitAllRequest();
          break;
        case NAVIGATION_REQUESTS.SUSPEND_ALL:
          result = this.processSuspendAllRequest();
          break;
        case NAVIGATION_REQUESTS.ABANDON:
          result = this.processAbandonRequest();
          break;
        case NAVIGATION_REQUESTS.ABANDON_ALL:
          result = this.processAbandonAllRequest();
          break;
        default:
          result = { success: false, reason: `Unhandled navigation request: ${navigationRequest}` };
      }

      // Update navigation session state
      if (result.success && result.targetActivity) {
        this.updateNavigationSession(result.targetActivity);
      }

      this.logger?.debug(`Navigation request processed:`, result);
      return result;

    } catch (error) {
      this.logger?.error('Error processing navigation request:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.NAVIGATION_SEQUENCE_ERROR,
        `Navigation processing failed: ${error.message}`, 'processNavigationRequest');
      return { success: false, reason: 'Navigation processing error', error: error.message };
    }
  }

  /**
   * Check if navigation request is valid
   * @param {string} navigationRequest - Navigation request type
   * @param {string} targetActivityId - Target activity ID (optional)
   * @returns {Object} Validity check result
   */
  checkNavigationValidity(navigationRequest, targetActivityId = null) {
    const currentActivity = this.activityTreeManager.currentActivity;

    // Basic validation
    if (!currentActivity && navigationRequest !== NAVIGATION_REQUESTS.START) {
      return { valid: false, reason: 'No current activity for navigation request' };
    }

    // Check control mode permissions
    if (currentActivity) {
      const controlModeCheck = this.checkControlModePermissions(currentActivity, navigationRequest);
      if (!controlModeCheck.allowed) {
        return { valid: false, reason: controlModeCheck.reason };
      }
    }

    // Specific request validation
    switch (navigationRequest) {
      case NAVIGATION_REQUESTS.CHOICE:
        return this.validateChoiceRequest(targetActivityId);
      case NAVIGATION_REQUESTS.CONTINUE:
        return this.validateContinueRequest();
      case NAVIGATION_REQUESTS.PREVIOUS:
        return this.validatePreviousRequest();
      default:
        return { valid: true, reason: 'Navigation request is valid' };
    }
  }

  /**
   * Check control mode permissions for navigation
   * @private
   * @param {ActivityNode} activity - Current activity
   * @param {string} navigationRequest - Navigation request type
   * @returns {Object} Permission check result
   */
  checkControlModePermissions(activity, navigationRequest) {
    // Check parent activity control modes if current activity doesn't have them
    let checkActivity = activity;
    while (checkActivity) {
      if (checkActivity.sequencing && checkActivity.sequencing.controlMode) {
        const controlMode = checkActivity.sequencing.controlMode;

        switch (navigationRequest) {
          case NAVIGATION_REQUESTS.CHOICE:
            if (controlMode.choice === false) {
              return { allowed: false, reason: 'Choice navigation disabled by control mode' };
            }
            break;
          case NAVIGATION_REQUESTS.CONTINUE:
          case NAVIGATION_REQUESTS.PREVIOUS:
            if (controlMode.flow === false) {
              return { allowed: false, reason: 'Flow navigation disabled by control mode' };
            }
            if (controlMode.forwardOnly === true && navigationRequest === NAVIGATION_REQUESTS.PREVIOUS) {
              return { allowed: false, reason: 'Previous navigation disabled by forward-only mode' };
            }
            break;
        }
        break; // Found control mode, stop looking
      }
      checkActivity = checkActivity.parent;
    }

    return { allowed: true, reason: 'Navigation allowed by control mode' };
  }

  /**
   * Validate choice navigation request
   * @private
   * @param {string} targetActivityId - Target activity ID
   * @returns {Object} Validation result
   */
  validateChoiceRequest(targetActivityId) {
    if (!targetActivityId) {
      return { valid: false, reason: 'Choice request requires target activity ID' };
    }

    const targetActivity = this.activityTreeManager.getActivity(targetActivityId);
    if (!targetActivity) {
      return { valid: false, reason: `Target activity not found: ${targetActivityId}` };
    }

    if (!targetActivity.isVisible) {
      return { valid: false, reason: 'Target activity is hidden from choice' };
    }

    // Check if target activity is available for choice
    const preConditionResult = this.sequencingEngine.evaluatePreConditionRules(targetActivity);
    if (preConditionResult.action === 'disabled' || preConditionResult.action === 'hiddenFromChoice') {
      return { valid: false, reason: `Target activity not available: ${preConditionResult.reason}` };
    }

    return { valid: true, reason: 'Choice request is valid' };
  }

  /**
   * Validate continue navigation request
   * @private
   * @returns {Object} Validation result
   */
  validateContinueRequest() {
    const nextActivity = this.findNextActivity();
    if (!nextActivity) {
      return { valid: false, reason: 'No next activity available for continue' };
    }
    return { valid: true, reason: 'Continue request is valid' };
  }

  /**
   * Validate previous navigation request
   * @private
   * @returns {Object} Validation result
   */
  validatePreviousRequest() {
    const previousActivity = this.findPreviousActivity();
    if (!previousActivity) {
      return { valid: false, reason: 'No previous activity available' };
    }
    return { valid: true, reason: 'Previous request is valid' };
  }

  /**
   * Process start navigation request
   * @private
   * @returns {Object} Processing result
   */
  processStartRequest() {
    const rootActivity = this.activityTreeManager.root;
    if (!rootActivity) {
      return { success: false, reason: 'No root activity available' };
    }

    const firstActivity = this.findFirstLaunchableActivity(rootActivity);
    if (!firstActivity) {
      return { success: false, reason: 'No launchable activity found' };
    }

    return {
      success: true,
      reason: 'Start navigation processed',
      targetActivity: firstActivity,
      action: 'launch'
    };
  }

  /**
   * Process continue navigation request
   * @private
   * @returns {Object} Processing result
   */
  processContinueRequest() {
    const nextActivity = this.findNextActivity();
    if (!nextActivity) {
      return { success: false, reason: 'No next activity available' };
    }

    return {
      success: true,
      reason: 'Continue navigation processed',
      targetActivity: nextActivity,
      action: 'launch'
    };
  }

  /**
   * Process previous navigation request
   * @private
   * @returns {Object} Processing result
   */
  processPreviousRequest() {
    const previousActivity = this.findPreviousActivity();
    if (!previousActivity) {
      return { success: false, reason: 'No previous activity available' };
    }

    return {
      success: true,
      reason: 'Previous navigation processed',
      targetActivity: previousActivity,
      action: 'launch'
    };
  }

  /**
   * Process choice navigation request
   * @private
   * @param {string} targetActivityId - Target activity ID
   * @returns {Object} Processing result
   */
  processChoiceRequest(targetActivityId) {
    const targetActivity = this.activityTreeManager.getActivity(targetActivityId);
    
    // Additional validation for choice navigation
    const currentActivity = this.activityTreeManager.currentActivity;
    if (currentActivity) {
      const controlModeCheck = this.checkControlModePermissions(currentActivity, NAVIGATION_REQUESTS.CHOICE);
      if (!controlModeCheck.allowed) {
        return { success: false, reason: controlModeCheck.reason };
      }
    }
    
    return {
      success: true,
      reason: 'Choice navigation processed',
      targetActivity: targetActivity,
      action: 'launch'
    };
  }

  /**
   * Process exit navigation request
   * @private
   * @returns {Object} Processing result
   */
  processExitRequest() {
    const currentActivity = this.activityTreeManager.currentActivity;
    if (currentActivity) {
      currentActivity.setState(ACTIVITY_STATES.INACTIVE);
    }

    return {
      success: true,
      reason: 'Exit navigation processed',
      action: 'exit'
    };
  }

  /**
   * Process suspend all navigation request
   * @private
   * @returns {Object} Processing result
   */
  processSuspendAllRequest() {
    const currentActivity = this.activityTreeManager.currentActivity;
    if (currentActivity) {
      currentActivity.setState(ACTIVITY_STATES.SUSPENDED);
      currentActivity.suspended = true;
    }

    return {
      success: true,
      reason: 'Suspend all navigation processed',
      action: 'suspend'
    };
  }

  /**
   * Find next activity in sequence
   * @private
   * @returns {ActivityNode|null} Next activity or null
   */
  findNextActivity() {
    const currentActivity = this.activityTreeManager.currentActivity;
    if (!currentActivity || !currentActivity.parent) {
      return null;
    }

    const siblings = currentActivity.parent.children;
    const currentIndex = siblings.indexOf(currentActivity);
    
    if (currentIndex < siblings.length - 1) {
      return siblings[currentIndex + 1];
    }

    return null;
  }

  /**
   * Find previous activity in sequence
   * @private
   * @returns {ActivityNode|null} Previous activity or null
   */
  findPreviousActivity() {
    const currentActivity = this.activityTreeManager.currentActivity;
    if (!currentActivity || !currentActivity.parent) {
      return null;
    }

    const siblings = currentActivity.parent.children;
    const currentIndex = siblings.indexOf(currentActivity);
    
    if (currentIndex > 0) {
      return siblings[currentIndex - 1];
    }

    return null;
  }

  /**
   * Find first launchable activity
   * @private
   * @param {ActivityNode} startActivity - Starting activity
   * @returns {ActivityNode|null} First launchable activity
   */
  findFirstLaunchableActivity(startActivity) {
    if (startActivity.isLaunchable()) {
      return startActivity;
    }

    for (const child of startActivity.children) {
      const launchable = this.findFirstLaunchableActivity(child);
      if (launchable) {
        return launchable;
      }
    }

    return null;
  }

  /**
   * Update navigation session state
   * @private
   * @param {ActivityNode} targetActivity - Target activity
   */
  updateNavigationSession(targetActivity) {
    this.navigationSession.currentActivity = targetActivity;
    this.navigationSession.active = true;
    this.updateAvailableNavigation();
  }

  /**
   * Update available navigation options
   * @private
   */
  updateAvailableNavigation() {
    this.navigationSession.availableNavigation.clear();

    const currentActivity = this.navigationSession.currentActivity;
    if (!currentActivity) return;

    // In browse mode, enable unrestricted navigation
    if (this.isBrowseModeEnabled()) {
      // Add all navigation types in browse mode
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.CONTINUE);
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.PREVIOUS);
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.EXIT);
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.CHOICE);

      this.logger?.debug('NavigationHandler: Browse mode - all navigation enabled');
      return;
    }

    // Standard SCORM navigation processing
    // Check each navigation type
    if (this.checkNavigationValidity(NAVIGATION_REQUESTS.CONTINUE).valid) {
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.CONTINUE);
    }
    if (this.checkNavigationValidity(NAVIGATION_REQUESTS.PREVIOUS).valid) {
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.PREVIOUS);
    }
    if (this.checkNavigationValidity(NAVIGATION_REQUESTS.EXIT).valid) {
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.EXIT);
    }

    // Check if choice navigation is enabled
    const controlModeCheck = this.checkControlModePermissions(currentActivity, NAVIGATION_REQUESTS.CHOICE);
    if (controlModeCheck.allowed) {
      this.navigationSession.availableNavigation.add(NAVIGATION_REQUESTS.CHOICE);
    }
  }

  /**
   * Get available navigation options
   * @returns {Array} Array of available navigation requests
   */
  getAvailableNavigation() {
    return Array.from(this.navigationSession.availableNavigation);
  }

  /**
   * Refresh navigation availability (useful when browse mode state changes)
   * @public
   */
  refreshNavigationAvailability() {
    this.updateAvailableNavigation();
    this.logger?.debug('NavigationHandler: Navigation availability refreshed', {
      browseMode: this.isBrowseModeEnabled(),
      availableNavigation: this.getAvailableNavigation()
    });
  }

  /**
   * Process browse mode navigation request
   * Handles unrestricted activity selection and choice navigation in browse mode
   * @param {string} navigationRequest - Type of navigation request
   * @param {string} targetActivityId - Target activity ID (for choice requests)
   * @returns {Object} Browse mode navigation processing result
   */
  processBrowseModeNavigation(navigationRequest, targetActivityId = null) {
    try {
      // Check if browse mode is available and enabled
      if (!this.browseModeService || !this.browseModeService.isBrowseModeEnabled()) {
        return {
          success: false,
          reason: 'Browse mode not available or not enabled',
          browseMode: false
        };
      }

      this.logger?.debug('Processing browse mode navigation request', {
        navigationRequest,
        targetActivityId
      });

      // For choice navigation, validate target activity exists
      if (navigationRequest === NAVIGATION_REQUESTS.CHOICE && targetActivityId) {
        const targetActivity = this.activityTreeManager.getActivity(targetActivityId);
        if (!targetActivity) {
          return {
            success: false,
            reason: `Target activity not found: ${targetActivityId}`,
            browseMode: true
          };
        }

        // Use sequencing engine's browse mode evaluation
        const currentActivityId = this.navigationSession.currentActivity?.identifier;
        const evaluationResult = this.sequencingEngine.evaluateNavigationRequestInBrowseMode(
          currentActivityId,
          targetActivityId,
          'choice'
        );

        if (!evaluationResult.success || !evaluationResult.allowed) {
          return {
            success: false,
            reason: evaluationResult.reason,
            browseMode: true,
            evaluationResult
          };
        }

        // Save current location before navigating to choice
        if (this.browseModeService) {
          this.browseModeService.saveCurrentLocation(targetActivityId, {
            navigationType: 'choice',
            previousActivity: currentActivityId,
            targetActivity: targetActivityId
          });
        }

        return {
          success: true,
          reason: 'Browse mode choice navigation processed',
          targetActivity: targetActivity,
          action: 'launch',
          browseMode: true,
          sessionId: evaluationResult.sessionId,
          standardEvaluation: evaluationResult.standardEvaluation
        };
      }

      // For other navigation types, use browse mode specific logic instead of SCORM sequencing
      let result;
      switch (navigationRequest) {
        case NAVIGATION_REQUESTS.START:
          result = this.processBrowseModeStart();
          break;
        case NAVIGATION_REQUESTS.CONTINUE:
          result = this.processBrowseModeContinue();
          break;
        case NAVIGATION_REQUESTS.PREVIOUS:
          result = this.processBrowseModePrevious();
          break;
        case NAVIGATION_REQUESTS.EXIT:
          result = this.processExitRequest();
          break;
        default:
          result = {
            success: true,
            reason: `Browse mode ${navigationRequest} processed`,
            action: navigationRequest
          };
      }

      // Get browse mode session information
      const currentSession = this.browseModeService?.getCurrentSession();

      // Enhance result with browse mode information
      return {
        ...result,
        browseMode: true,
        sessionId: currentSession?.id,
        standardEvaluation: null // Not applicable for non-choice navigation
      };

    } catch (error) {
      this.logger?.error('Error processing browse mode navigation:', error);
      return {
        success: false,
        reason: `Browse mode navigation processing failed: ${error.message}`,
        browseMode: true,
        error: error.message
      };
    }
  }

  /**
   * Check if browse mode is enabled
   * @returns {boolean} True if browse mode is enabled
   */
  isBrowseModeEnabled() {
    return this.browseModeService?.isBrowseModeEnabled() || false;
  }

  /**
   * Process browse mode start - find first launchable activity or resume from saved location
   */
  processBrowseModeStart() {
    // Check if there's a saved location to resume from
    if (this.browseModeService) {
      const lastLocation = this.browseModeService.getLastLocation();
      if (lastLocation && lastLocation.activityId) {
        const resumeActivity = this.activityTreeManager.getActivity(lastLocation.activityId);
        if (resumeActivity && resumeActivity.isLaunchable()) {
          this.logger?.info('Browse mode: Resuming from saved location', {
            activityId: lastLocation.activityId,
            timestamp: lastLocation.timestamp
          });

          return {
            success: true,
            reason: 'Browse mode start - resuming from saved location',
            targetActivity: resumeActivity,
            action: 'launch',
            browseMode: true,
            resumed: true,
            lastLocation: lastLocation
          };
        }
      }
    }

    // No saved location or invalid, start from first activity
    const firstActivity = this.findFirstLaunchableActivity(this.activityTreeManager.root);
    if (firstActivity) {
      // Save this as the starting location
      if (this.browseModeService) {
        this.browseModeService.saveCurrentLocation(firstActivity.identifier, {
          navigationType: 'start',
          isFirstActivity: true
        });
      }

      return {
        success: true,
        reason: 'Browse mode start - first activity found',
        targetActivity: firstActivity,
        action: 'launch',
        browseMode: true
      };
    }
    return {
      success: false,
      reason: 'Browse mode start - no launchable activities found',
      browseMode: true
    };
  }

  /**
   * Process browse mode continue - find next available activity
   */
  processBrowseModeContinue() {
    const currentActivity = this.navigationSession.currentActivity;
    if (!currentActivity) {
      // No current activity, start from beginning
      return this.processBrowseModeStart();
    }

    // Get all launchable activities
    const allActivities = this.getAllLaunchableActivities(this.activityTreeManager.root);
    const currentIndex = allActivities.findIndex(act => act.identifier === currentActivity.identifier);

    if (currentIndex >= 0 && currentIndex < allActivities.length - 1) {
      // Found next activity
      const nextActivity = allActivities[currentIndex + 1];

      // Save current location before moving to next
      if (this.browseModeService) {
        this.browseModeService.saveCurrentLocation(nextActivity.identifier, {
          navigationType: 'continue',
          previousActivity: currentActivity.identifier
        });
      }

      return {
        success: true,
        reason: 'Browse mode continue - next activity found',
        targetActivity: nextActivity,
        action: 'launch',
        browseMode: true
      };
    }

    // No next activity, stay on current or wrap to first
    const fallbackActivity = allActivities[0] || currentActivity;
    return {
      success: true,
      reason: 'Browse mode continue - wrapping to first activity (end reached)',
      targetActivity: fallbackActivity,
      action: 'launch',
      browseMode: true,
      wrapped: true
    };
  }

  /**
   * Process browse mode previous - find previous available activity
   */
  processBrowseModePrevious() {
    const currentActivity = this.navigationSession.currentActivity;
    if (!currentActivity) {
      // No current activity, start from beginning
      return this.processBrowseModeStart();
    }

    // Get all launchable activities
    const allActivities = this.getAllLaunchableActivities(this.activityTreeManager.root);
    const currentIndex = allActivities.findIndex(act => act.identifier === currentActivity.identifier);

    if (currentIndex > 0) {
      // Found previous activity
      const previousActivity = allActivities[currentIndex - 1];

      // Save current location before moving to previous
      if (this.browseModeService) {
        this.browseModeService.saveCurrentLocation(previousActivity.identifier, {
          navigationType: 'previous',
          previousActivity: currentActivity.identifier
        });
      }

      return {
        success: true,
        reason: 'Browse mode previous - previous activity found',
        targetActivity: previousActivity,
        action: 'launch',
        browseMode: true
      };
    }

    // No previous activity, stay on current or wrap to last
    const fallbackActivity = allActivities[allActivities.length - 1] || currentActivity;
    return {
      success: true,
      reason: 'Browse mode previous - wrapping to last activity (beginning reached)',
      targetActivity: fallbackActivity,
      action: 'launch',
      browseMode: true,
      wrapped: true
    };
  }

  /**
   * Get all launchable activities in tree order
   */
  getAllLaunchableActivities(rootActivity) {
    const activities = [];
    
    function collectActivities(activity) {
      if (activity.isLaunchable()) {
        activities.push(activity);
      }
      for (const child of activity.children || []) {
        collectActivities(child);
      }
    }
    
    collectActivities(rootActivity);
    return activities;
  }

  // Placeholder methods for remaining navigation requests
  processResumeAllRequest() { return { success: true, reason: 'Resume all processed', action: 'resume' }; }
  processExitAllRequest() { return { success: true, reason: 'Exit all processed', action: 'exitAll' }; }
  processAbandonRequest() { return { success: true, reason: 'Abandon processed', action: 'abandon' }; }
  processAbandonAllRequest() { return { success: true, reason: 'Abandon all processed', action: 'abandonAll' }; }
}

module.exports = NavigationHandler;