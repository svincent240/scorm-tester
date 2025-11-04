/**
 * Browse Mode Service
 * 
 * Provides SCORM-compliant browse mode functionality for testing and development.
 * Implements browse mode using SCORM 2004 4th Edition standard mechanisms:
 * - Uses cmi.mode='browse' for SCORM compliance
 * - Provides LMS-level navigation overrides
 * - Manages isolated browse mode sessions
 * - Maintains data isolation from production data
 * 
 * @fileoverview SCORM-compliant browse mode service
 */

const EventEmitter = require('events');

/**
 * Browse Mode Service Class
 * 
 * Manages browse mode sessions and provides SCORM-compliant
 * testing functionality without affecting production data.
 */
class BrowseModeService extends EventEmitter {
  /**
   * Initialize the browse mode service
   * @param {Object} logger - Logger instance
   * @param {Object} options - Configuration options
   */
  constructor(logger, options = {}) {
    super();
    
    this.logger = logger;
    this.options = {
      defaultTimeout: 30 * 60 * 1000, // 30 minutes
      maxSessions: 10, // Maximum concurrent browse sessions
      ...options
    };
    
    // Browse mode state
    this.enabled = false;
    this.currentSession = null;
    this.sessions = new Map();
    
    // Navigation override state
    this.navigationOverrides = {
      ignoreSequencingRules: true,
      allowUnrestrictedChoice: true,
      ignoreAttemptLimits: true,
      ignorePrerequisites: true
    };

    // Log initialization without circular references (scormService reference would serialize entire object tree)
    this.logger?.debug('BrowseModeService initialized', [{
      defaultTimeout: this.options.defaultTimeout,
      maxSessions: this.options.maxSessions
    }]);
  }

  /**
   * Enable browse mode
   * @param {Object} browseOptions - Browse mode configuration
   * @returns {Promise<Object>} Result with session information
   */
  async enableBrowseMode(browseOptions = {}) {
    try {
      // Check if already enabled
      if (this.enabled && this.currentSession) {
        return {
          success: true,
          alreadyEnabled: true,
          session: this.serializeSession(this.currentSession)
        };
      }

      // Create browse mode session
      const session = this.createBrowseSession(browseOptions);
      
      // Enable browse mode
      this.enabled = true;
      this.currentSession = session;
      this.sessions.set(session.id, session);
      
      this.logger?.info('Browse mode enabled', {
        sessionId: session.id,
        options: browseOptions
      });
      
      // Emit browse mode enabled event
      this.emit('browse-mode-enabled', { session });

      // Trigger navigation availability refresh
      this.refreshNavigationAvailability();

      // Initialize navigation handler session if available
      this.initializeNavigationHandlerSession();

      return {
        success: true,
        session: this.serializeSession(session)
      };
      
    } catch (error) {
      this.logger?.error('Failed to enable browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Disable browse mode
   * @returns {Promise<Object>} Result of disable operation
   */
  async disableBrowseMode() {
    try {
      if (!this.enabled) {
        return {
          success: true,
          alreadyDisabled: true
        };
      }

      const sessionId = this.currentSession?.id;
      
      // Clean up current session
      if (this.currentSession) {
        this.destroyBrowseSession(this.currentSession.id);
      }
      
      // Disable browse mode
      this.enabled = false;
      this.currentSession = null;
      
      this.logger?.info('Browse mode disabled', { sessionId });
      
      // Emit browse mode disabled event
      this.emit('browse-mode-disabled', { sessionId });

      // Trigger navigation availability refresh
      this.refreshNavigationAvailability();

      return {
        success: true,
        sessionId: sessionId
      };
      
    } catch (error) {
      this.logger?.error('Failed to disable browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a new browse mode session
   * @param {Object} options - Session options
   * @returns {Object} Browse session object
   * @private
   */
  createBrowseSession(options = {}) {
    const sessionId = `browse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const session = {
      id: sessionId,
      startTime: new Date(),
      lastActivity: new Date(),
      launchMode: 'browse',
      options: {
        navigationUnrestricted: options.navigationUnrestricted !== false,
        trackingDisabled: options.trackingDisabled !== false,
        dataIsolation: options.dataIsolation !== false,
        sessionTimeout: options.sessionTimeout || this.options.defaultTimeout,
        preserveOriginalState: options.preserveOriginalState !== false,
        visualIndicators: options.visualIndicators !== false,
        ...options
      },
      state: {
        originalState: null,
        temporaryData: new Map(),
        operations: [],
        navigationOverrides: { ...this.navigationOverrides }
      },
      timeoutHandle: null
    };
    
    // Set up session timeout
    this.setupSessionTimeout(session);
    
    return session;
  }

  /**
   * Setup session timeout
   * @param {Object} session - Browse session
   * @private
   */
  setupSessionTimeout(session) {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }
    
    session.timeoutHandle = setTimeout(() => {
      this.logger?.info('Browse session timed out:', session.id);
      this.destroyBrowseSession(session.id);
      
      // If this was the current session, disable browse mode
      if (this.currentSession?.id === session.id) {
        this.disableBrowseMode();
      }
    }, session.options.sessionTimeout);
  }

  /**
   * Destroy a browse session
   * @param {string} sessionId - Session ID to destroy
   * @private
   */
  destroyBrowseSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Clear timeout
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }
    
    // Clear temporary data
    session.state.temporaryData.clear();
    
    // Remove from sessions
    this.sessions.delete(sessionId);
    
    this.logger?.debug('Browse session destroyed:', {
      sessionId,
      duration: Date.now() - session.startTime.getTime(),
      operations: session.state.operations.length
    });
  }

  /**
   * Check if browse mode is enabled
   * @returns {boolean} True if browse mode is enabled
   */
  isBrowseModeEnabled() {
    return this.enabled;
  }

  /**
   * Get current browse mode session
   * @returns {Object|null} Current session or null
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Get browse mode status
   * @returns {Object} Browse mode status information
   */
  getBrowseModeStatus() {
    return {
      enabled: this.enabled,
      currentSession: this.currentSession ? this.serializeSession(this.currentSession) : null,
      totalSessions: this.sessions.size,
      navigationOverrides: { ...this.navigationOverrides }
    };
  }

  /**
   * Serialize session for IPC communication
   * @param {Object} session - Session object to serialize
   * @returns {Object} Serializable session object
   * @private
   */
  serializeSession(session) {
    if (!session) return null;

    return {
      id: session.id,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      launchMode: session.launchMode,
      duration: Date.now() - session.startTime.getTime(),
      options: { ...session.options },
      state: {
        operationsCount: session.state?.operations?.length || 0,
        temporaryDataSize: session.state?.temporaryData?.size || 0,
        hasOriginalState: !!session.state?.originalState
      },
      active: session.timeoutHandle !== null
    };
  }

  /**
   * Check if navigation is allowed in browse mode
   * @param {string} from - Source activity ID
   * @param {string} to - Target activity ID
   * @param {string} requestType - Type of navigation request
   * @returns {Object} Navigation result
   */
  isNavigationAllowedInBrowseMode(from, to, requestType = 'choice') {
    if (!this.enabled || !this.currentSession) {
      return {
        allowed: false,
        reason: 'Browse mode not enabled'
      };
    }

    // In browse mode, allow all navigation by default
    if (this.currentSession.options.navigationUnrestricted) {
      return {
        allowed: true,
        reason: 'Browse mode - unrestricted navigation',
        browseMode: true,
        sessionId: this.currentSession.id
      };
    }

    // Check specific navigation overrides
    const overrides = this.currentSession.state.navigationOverrides;
    
    switch (requestType) {
      case 'choice':
        return {
          allowed: overrides.allowUnrestrictedChoice,
          reason: overrides.allowUnrestrictedChoice ? 
            'Browse mode - choice navigation allowed' : 
            'Browse mode - choice navigation restricted',
          browseMode: true
        };
        
      default:
        return {
          allowed: true,
          reason: 'Browse mode - default allow',
          browseMode: true
        };
    }
  }

  /**
   * Update session activity
   * @param {string} operation - Operation performed
   * @param {Object} details - Operation details
   */
  updateSessionActivity(operation, details = {}) {
    if (this.currentSession) {
      this.currentSession.lastActivity = new Date();
      this.currentSession.state.operations.push({
        operation,
        timestamp: new Date(),
        details
      });

      // Reset timeout
      this.setupSessionTimeout(this.currentSession);
    }
  }

  /**
   * Save current location for session resumption
   * @param {string} activityId - Current activity identifier
   * @param {Object} context - Additional context data
   */
  saveCurrentLocation(activityId, context = {}) {
    if (this.currentSession) {
      // Validate activityId is not null or empty
      if (!activityId || activityId.trim() === '') {
        this.logger?.error('Browse mode: Cannot save location with invalid activityId', {
          activityId,
          context
        });
        return;
      }

      this.currentSession.state.lastLocation = {
        activityId: activityId.trim(),
        timestamp: new Date(),
        context: { ...context }
      };

      // Update session activity
      this.updateSessionActivity('location_saved', { activityId, context });

      this.logger?.debug('Browse mode: Location saved', {
        sessionId: this.currentSession.id,
        activityId,
        context,
        timestamp: this.currentSession.state.lastLocation.timestamp
      });
    } else {
      this.logger?.warn('Browse mode: Cannot save location - no active session', {
        activityId,
        context
      });
    }
  }

  /**
   * Get last saved location for session resumption
   * @returns {Object|null} Last location data or null
   */
  getLastLocation() {
    if (this.currentSession && this.currentSession.state.lastLocation) {
      return { ...this.currentSession.state.lastLocation };
    }
    return null;
  }

  /**
   * Clear saved location
   */
  clearLastLocation() {
    if (this.currentSession) {
      this.currentSession.state.lastLocation = null;
      this.logger?.debug('Browse mode: Location cleared', {
        sessionId: this.currentSession.id
      });
    }
  }

  /**
   * Initialize navigation handler session when browse mode is enabled
   * @private
   */
  initializeNavigationHandlerSession() {
    try {
      if (this.options.scormService) {
        const snService = this.options.scormService.getSNService();
        if (snService && snService.navigationHandler) {
          const navHandler = snService.navigationHandler;

          // Initialize browse mode session in navigation handler
          if (typeof navHandler.initializeBrowseModeSession === 'function') {
            const initResult = navHandler.initializeBrowseModeSession();
            this.logger?.debug('Browse mode: Navigation handler session initialized', {
              success: initResult.success,
              reason: initResult.reason,
              currentActivity: navHandler.navigationSession?.currentActivity?.identifier
            });

            if (!initResult.success) {
              this.logger?.warn('Browse mode: Navigation handler session initialization failed', {
                reason: initResult.reason
              });
            }
          } else {
            this.logger?.warn('Browse mode: Navigation handler does not have initializeBrowseModeSession method');
          }
        } else {
          this.logger?.warn('Browse mode: SN service or navigation handler not available for session initialization');
        }
      } else {
        this.logger?.warn('Browse mode: SCORM service not available for navigation handler initialization');
      }
    } catch (error) {
      this.logger?.warn('Browse mode: Failed to initialize navigation handler session', error);
    }
  }

  /**
   * Refresh navigation availability when browse mode state changes
    * @private
    */
  refreshNavigationAvailability() {
    try {
      // Get the SN service from the SCORM service
      if (this.options.scormService) {
        const snService = this.options.scormService.getSNService();
        if (snService && typeof snService.refreshNavigationAvailability === 'function') {
          const result = snService.refreshNavigationAvailability();
          this.logger?.debug('Browse mode: Navigation availability refreshed', {
            success: result?.availableNavigation?.length || 0,
            browseMode: this.enabled
          });
        } else {
          this.logger?.warn('Browse mode: SN service not available for navigation refresh', {
            hasScormService: !!this.options.scormService,
            hasSNService: !!snService,
            hasRefreshMethod: typeof snService?.refreshNavigationAvailability === 'function'
          });
        }
      } else {
        this.logger?.warn('Browse mode: SCORM service not available for navigation refresh');
      }
    } catch (error) {
      this.logger?.warn('Browse mode: Failed to refresh navigation availability', error);
    }
  }

  /**
   * Clean up all browse mode sessions
   */
  cleanup() {
    this.logger?.debug('Cleaning up browse mode service');
    
    // Destroy all sessions
    for (const sessionId of this.sessions.keys()) {
      this.destroyBrowseSession(sessionId);
    }
    
    // Reset state
    this.enabled = false;
    this.currentSession = null;
    this.sessions.clear();
    
    // Remove all listeners
    this.removeAllListeners();
  }
}

module.exports = BrowseModeService;
