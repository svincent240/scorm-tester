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
const SCORM_CONSTANTS = require('../../shared/constants/scorm-constants');

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
    
    this.logger?.debug('BrowseModeService initialized', this.options);
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
          session: this.currentSession
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
      
      return {
        success: true,
        session: session
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
      currentSession: this.currentSession ? {
        id: this.currentSession.id,
        startTime: this.currentSession.startTime,
        lastActivity: this.currentSession.lastActivity,
        duration: Date.now() - this.currentSession.startTime.getTime(),
        options: this.currentSession.options
      } : null,
      totalSessions: this.sessions.size,
      navigationOverrides: this.navigationOverrides
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
