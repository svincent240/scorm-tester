/**
 * SCORM 2004 4th Edition API Handler
 * 
 * Implements all 8 required SCORM API functions:
 * 1. Initialize("")
 * 2. Terminate("")
 * 3. GetValue(element)
 * 4. SetValue(element, value)
 * 5. Commit("")
 * 6. GetLastError()
 * 7. GetErrorString(errorCode)
 * 8. GetDiagnostic(errorCode)
 * 
 * Based on SCORM 2004 4th Edition RTE specification and
 * IEEE 1484.11.2 standard for API implementation.
 * 
 * @fileoverview SCORM 2004 4th Edition compliant API handler
 */

const ScormDataModel = require('./data-model');
const ScormErrorHandler = require('./error-handler');
const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');
const { COMMON_ERRORS } = require('../../../../shared/constants/error-codes');

/**
 * SCORM API Handler Class
 * 
 * Provides the complete SCORM 2004 4th Edition API implementation
 * with full compliance to the RTE specification.
 */
class ScormApiHandler {
  /**
   * Initialize the SCORM API handler
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} logger - Logger instance
   * @param {Object} options - Configuration options
   */
  constructor(sessionManager, logger, options = {}) {
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.options = {
      strictMode: true,
      maxCommitFrequency: 10000, // Max commits per 10 seconds
      ...options
    };

    // Initialize core components
    this.errorHandler = new ScormErrorHandler(logger);
    this.dataModel = new ScormDataModel(this.errorHandler, logger);
    
    // API state tracking
    this.isInitialized = false;
    this.isTerminated = false;
    this.lastCommitTime = 0;
    this.commitCount = 0;
    
    // Session information
    this.sessionId = null;
    this.startTime = null;
    
    this.logger?.debug('ScormApiHandler initialized');
  }

  /**
   * Initialize the SCORM session (SCORM API Function 1)
   * @param {string} parameter - Must be empty string per SCORM spec
   * @returns {string} "true" if successful, "false" if error
   */
  Initialize(parameter) {
    try {
      this.logger?.debug('Initialize called with parameter:', parameter);

      // Validate parameter (must be empty string)
      if (parameter !== "") {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Initialize parameter must be empty string', 'Initialize');
        return "false";
      }

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED, 'Initialize')) {
        return "false";
      }

      // Initialize session
      this.sessionId = this.generateSessionId();
      this.startTime = new Date();
      this.isInitialized = true;
      this.isTerminated = false;

      // Update session state
      this.errorHandler.setSessionState(SCORM_CONSTANTS.SESSION_STATES.RUNNING);

      // Initialize data model with session-specific data
      this.initializeSessionData();

      // Register with session manager (handle failures gracefully)
      if (this.sessionManager) {
        try {
          this.sessionManager.registerSession(this.sessionId, this);
        } catch (error) {
          this.logger?.warn('Session manager registration failed:', error.message);
          // Continue without session manager - this is not a fatal error
        }
      }

      this.logger?.info(`SCORM session initialized: ${this.sessionId}`);
      this.errorHandler.clearError();
      return "true";

    } catch (error) {
      this.logger?.error('Error in Initialize:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Initialize failed: ${error.message}`, 'Initialize');
      return "false";
    }
  }

  /**
   * Terminate the SCORM session (SCORM API Function 2)
   * @param {string} parameter - Must be empty string per SCORM spec
   * @returns {string} "true" if successful, "false" if error
   */
  Terminate(parameter) {
    try {
      this.logger?.debug('Terminate called with parameter:', parameter);

      // Validate parameter (must be empty string)
      if (parameter !== "") {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Terminate parameter must be empty string', 'Terminate');
        return "false";
      }

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'Terminate')) {
        return "false";
      }

      // Perform final commit (but don't count it as a regular commit)
      try {
        // Get all data for final persistence without incrementing commit count
        const dataToCommit = {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          data: this.dataModel.getAllData(),
          errorState: this.errorHandler.getErrorState()
        };

        // Persist via session manager
        if (this.sessionManager) {
          const result = this.sessionManager.persistSessionData(this.sessionId, dataToCommit);
          if (!result) {
            this.logger?.warn('Final commit failed during termination');
          }
        }
      } catch (error) {
        this.logger?.warn('Final commit failed during termination:', error.message);
        // Continue with termination even if commit fails
      }

      // Calculate session time
      this.calculateSessionTime();

      // Update session state
      this.isTerminated = true;
      this.errorHandler.setSessionState(SCORM_CONSTANTS.SESSION_STATES.TERMINATED);

      // Unregister from session manager
      if (this.sessionManager && this.sessionId) {
        this.sessionManager.unregisterSession(this.sessionId);
      }

      this.logger?.info(`SCORM session terminated: ${this.sessionId}`);
      this.errorHandler.clearError();
      return "true";

    } catch (error) {
      this.logger?.error('Error in Terminate:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Terminate failed: ${error.message}`, 'Terminate');
      return "false";
    }
  }

  /**
   * Get value from data model (SCORM API Function 3)
   * @param {string} element - Data model element name
   * @returns {string} Element value or empty string on error
   */
  GetValue(element) {
    try {
      this.logger?.debug('GetValue called for element:', element);

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'GetValue')) {
        return "";
      }

      // Validate element parameter
      if (typeof element !== 'string') {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'GetValue element must be a string', 'GetValue');
        return "";
      }

      // Get value from data model
      const value = this.dataModel.getValue(element);
      
      // Log successful retrieval (only for non-empty values to reduce noise)
      if (value && !this.errorHandler.hasError()) {
        this.logger?.debug(`GetValue: ${element} = ${value}`);
      }

      return value;

    } catch (error) {
      this.logger?.error('Error in GetValue:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `GetValue failed: ${error.message}`, 'GetValue');
      return "";
    }
  }

  /**
   * Set value in data model (SCORM API Function 4)
   * @param {string} element - Data model element name
   * @param {string} value - Value to set
   * @returns {string} "true" if successful, "false" if error
   */
  SetValue(element, value) {
    try {
      this.logger?.debug('SetValue called:', { element, value });

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'SetValue')) {
        return "false";
      }

      // Validate parameters
      if (typeof element !== 'string') {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'SetValue element must be a string', 'SetValue');
        return "false";
      }

      if (typeof value !== 'string') {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'SetValue value must be a string', 'SetValue');
        return "false";
      }

      // Set value in data model
      const success = this.dataModel.setValue(element, value);
      
      if (success) {
        this.logger?.debug(`SetValue successful: ${element} = ${value}`);
        return "true";
      } else {
        return "false";
      }

    } catch (error) {
      this.logger?.error('Error in SetValue:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `SetValue failed: ${error.message}`, 'SetValue');
      return "false";
    }
  }

  /**
   * Commit data to persistent storage (SCORM API Function 5)
   * @param {string} parameter - Must be empty string per SCORM spec
   * @returns {string} "true" if successful, "false" if error
   */
  Commit(parameter) {
    try {
      this.logger?.debug('Commit called with parameter:', parameter);

      // Validate parameter (must be empty string)
      if (parameter !== "") {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Commit parameter must be empty string', 'Commit');
        return "false";
      }

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'Commit')) {
        return "false";
      }

      // Check commit frequency (prevent spam)
      if (this.options.strictMode && !this.canCommit()) {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Commit called too frequently', 'Commit');
        return "false";
      }

      // Perform the commit
      const success = this.performCommit();
      
      if (success) {
        this.logger?.debug('Commit successful');
        this.errorHandler.clearError();
        return "true";
      } else {
        return "false";
      }

    } catch (error) {
      this.logger?.error('Error in Commit:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Commit failed: ${error.message}`, 'Commit');
      return "false";
    }
  }

  /**
   * Get last error code (SCORM API Function 6)
   * @returns {string} Last error code as string
   */
  GetLastError() {
    const errorCode = this.errorHandler.getLastError();
    this.logger?.debug('GetLastError returned:', errorCode);
    return errorCode;
  }

  /**
   * Get error string for error code (SCORM API Function 7)
   * @param {string} errorCode - Error code to get string for
   * @returns {string} Error string or empty string if invalid
   */
  GetErrorString(errorCode) {
    const errorString = this.errorHandler.getErrorString(errorCode);
    this.logger?.debug('GetErrorString for', errorCode, ':', errorString);
    return errorString;
  }

  /**
   * Get diagnostic information for error code (SCORM API Function 8)
   * @param {string} errorCode - Error code to get diagnostic for
   * @returns {string} Diagnostic information or empty string
   */
  GetDiagnostic(errorCode) {
    const diagnostic = this.errorHandler.getDiagnostic(errorCode);
    this.logger?.debug('GetDiagnostic for', errorCode, ':', diagnostic);
    return diagnostic;
  }

  /**
   * Initialize session-specific data
   * @private
   */
  initializeSessionData() {
    // Set entry mode based on previous session state
    const entryMode = this.determineEntryMode();
    this.dataModel.setValue('cmi.entry', entryMode);

    // Set credit mode (could come from launch parameters)
    this.dataModel.setValue('cmi.credit', 'credit');

    // Set lesson mode
    this.dataModel.setValue('cmi.mode', 'normal');

    // Initialize learner information if available
    if (this.sessionManager) {
      const learnerInfo = this.sessionManager.getLearnerInfo();
      if (learnerInfo) {
        this.dataModel.setLearnerInfo(learnerInfo);
      }
    }

    this.logger?.debug('Session data initialized');
  }

  /**
   * Determine entry mode for the session
   * @private
   * @returns {string} Entry mode ('ab-initio' or 'resume')
   */
  determineEntryMode() {
    // Check if there's previous suspend data
    const suspendData = this.dataModel.getValue('cmi.suspend_data');
    const completionStatus = this.dataModel.getValue('cmi.completion_status');
    
    if (suspendData && completionStatus !== 'completed') {
      return 'resume';
    }
    
    return 'ab-initio';
  }

  /**
   * Calculate and set session time
   * @private
   */
  calculateSessionTime() {
    if (this.startTime) {
      const endTime = new Date();
      const sessionDuration = endTime - this.startTime;
      
      // Convert to ISO 8601 duration format (PT[H]H[M]M[S]S)
      const hours = Math.floor(sessionDuration / (1000 * 60 * 60));
      const minutes = Math.floor((sessionDuration % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((sessionDuration % (1000 * 60)) / 1000);
      
      const sessionTime = `PT${hours}H${minutes}M${seconds}S`;
      this.dataModel.setValue('cmi.session_time', sessionTime);
      
      this.logger?.debug('Session time calculated:', sessionTime);
    }
  }

  /**
   * Check if commit is allowed (rate limiting)
   * @private
   * @returns {boolean} True if commit is allowed
   */
  canCommit() {
    const now = Date.now();
    const timeSinceLastCommit = now - this.lastCommitTime;
    
    // Reset counter every 10 seconds
    if (timeSinceLastCommit > 10000) {
      this.commitCount = 0;
      this.lastCommitTime = now;
    }
    
    // Allow up to maxCommitFrequency commits per 10 seconds
    return this.commitCount < this.options.maxCommitFrequency;
  }

  /**
   * Perform the actual commit operation
   * @private
   * @returns {boolean} True if successful
   */
  performCommit() {
    try {
      // Update commit tracking
      this.commitCount++;
      this.lastCommitTime = Date.now();

      // Get all data for persistence
      const dataToCommit = {
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        data: this.dataModel.getAllData(),
        errorState: this.errorHandler.getErrorState()
      };

      // Persist via session manager
      if (this.sessionManager) {
        try {
          const result = this.sessionManager.persistSessionData(this.sessionId, dataToCommit);
          // Handle both sync and async results
          if (result && typeof result.then === 'function') {
            // Async result - for now return true and handle errors in background
            result.catch(error => {
              this.logger?.error('Async commit failed:', error);
              this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
                `Async commit failed: ${error.message}`, 'performCommit');
            });
            return true;
          }
          return result;
        } catch (error) {
          this.logger?.error('Sync commit failed:', error);
          this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
            `Sync commit failed: ${error.message}`, 'performCommit');
          return false;
        }
      }

      // If no session manager, just log the data
      this.logger?.info('Data committed (no persistence):', dataToCommit);
      return true;

    } catch (error) {
      this.logger?.error('Error in performCommit:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Commit operation failed: ${error.message}`, 'performCommit');
      return false;
    }
  }

  /**
   * Generate unique session ID
   * @private
   * @returns {string} Unique session ID
   */
  generateSessionId() {
    return `scorm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current API state (for debugging)
   * @returns {Object} Current API state
   */
  getApiState() {
    return {
      sessionId: this.sessionId,
      isInitialized: this.isInitialized,
      isTerminated: this.isTerminated,
      sessionState: this.errorHandler.getSessionState(),
      errorState: this.errorHandler.getErrorState(),
      startTime: this.startTime,
      commitCount: this.commitCount
    };
  }

  /**
   * Reset API to initial state
   */
  reset() {
    this.isInitialized = false;
    this.isTerminated = false;
    this.sessionId = null;
    this.startTime = null;
    this.lastCommitTime = 0;
    this.commitCount = 0;
    
    this.errorHandler.reset();
    this.dataModel.reset();
    
    this.logger?.debug('ScormApiHandler reset to initial state');
  }
}

module.exports = ScormApiHandler;