/**
 * SCORM 2004 4th Edition Error Handler
 * 
 * Handles all SCORM error management including:
 * - Error code tracking and validation
 * - Session state validation
 * - Error history and diagnostics
 * - SCORM-compliant error reporting
 * 
 * Based on SCORM 2004 4th Edition RTE specification requirements for
 * proper error handling and state management.
 * 
 * @fileoverview SCORM 2004 4th Edition compliant error handler
 */

const {
  SCORM_ERROR_CODES,
  ERROR_CATEGORIES,
  COMMON_ERRORS,
  getErrorCategory,
  isSuccess,
  isValidErrorCode,
  getErrorString
} = require('../../../../shared/constants/error-codes');

const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');

/**
 * SCORM Error Handler Class
 * 
 * Manages error state and provides SCORM-compliant error reporting
 * according to the RTE specification requirements.
 */
class ScormErrorHandler {
  /**
   * Initialize the error handler
   * @param {Object} logger - Logger instance for error tracking
   */
  constructor(logger) {
    this.logger = logger;
    
    // Current error state
    this.lastError = COMMON_ERRORS.NO_ERROR;
    this.lastDiagnostic = '';
    
    // Session state tracking
    this.sessionState = SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED;
    
    // Error history for debugging
    this.errorHistory = [];
    this.maxHistorySize = 100;
    
    // Diagnostic information
    this.diagnosticInfo = new Map();
    
    this.logger?.debug('ScormErrorHandler initialized');
  }

  /**
   * Set error code and optional diagnostic information
   * @param {string|number} errorCode - SCORM error code
   * @param {string} diagnostic - Optional diagnostic information
   * @param {string} context - Context where error occurred
   */
  setError(errorCode, diagnostic = '', context = '') {
    const code = String(errorCode);
    
    // Validate error code
    if (!isValidErrorCode(code)) {
      this.logger?.warn(`Invalid error code: ${code}, using general exception`);
      errorCode = COMMON_ERRORS.GENERAL_EXCEPTION;
    }
    
    // Update error state
    this.lastError = String(errorCode);
    this.lastDiagnostic = diagnostic;
    
    // Store diagnostic information
    if (diagnostic) {
      this.diagnosticInfo.set(this.lastError, diagnostic);
    }
    
    // Add to error history
    this.addToHistory(errorCode, diagnostic, context);
    
    // Log error (only log actual errors, not success)
    if (!isSuccess(errorCode)) {
      const errorString = getErrorString(errorCode);
      const category = getErrorCategory(errorCode);
      
      this.logger?.error(`SCORM Error [${category}]: ${errorCode} - ${errorString}`, {
        code: errorCode,
        diagnostic,
        context,
        sessionState: this.sessionState
      });
    }
  }

  /**
   * Get the last error code (SCORM GetLastError function)
   * @returns {string} Last error code as string
   */
  getLastError() {
    return this.lastError;
  }

  /**
   * Get error string for given error code (SCORM GetErrorString function)
   * @param {string|number} errorCode - Error code to get string for
   * @returns {string} Error string or empty string if invalid
   */
  getErrorString(errorCode) {
    const code = String(errorCode);
    
    if (!isValidErrorCode(code)) {
      this.logger?.warn(`Invalid error code requested: ${code}`);
      return '';
    }
    
    return getErrorString(code);
  }

  /**
   * Get diagnostic information for error code (SCORM GetDiagnostic function)
   * @param {string|number} errorCode - Error code to get diagnostic for
   * @returns {string} Diagnostic information or empty string
   */
  getDiagnostic(errorCode) {
    const code = String(errorCode);
    
    if (!isValidErrorCode(code)) {
      this.logger?.warn(`Invalid error code for diagnostic: ${code}`);
      return '';
    }
    
    // Return stored diagnostic info or default message
    const diagnostic = this.diagnosticInfo.get(code);
    if (diagnostic) {
      return diagnostic;
    }
    
    // Provide default diagnostic based on error category
    const category = getErrorCategory(code);
    switch (category) {
      case ERROR_CATEGORIES.GENERAL:
        return 'General SCORM runtime error occurred';
      case ERROR_CATEGORIES.INITIALIZATION:
        return 'Error during SCORM session initialization';
      case ERROR_CATEGORIES.TERMINATION:
        return 'Error during SCORM session termination';
      case ERROR_CATEGORIES.DATA_MODEL:
        return 'Error accessing SCORM data model element';
      default:
        return '';
    }
  }

  /**
   * Clear current error state (reset to no error)
   */
  clearError() {
    this.lastError = COMMON_ERRORS.NO_ERROR;
    this.lastDiagnostic = '';
    this.logger?.debug('Error state cleared');
  }

  /**
   * Validate session state for API operations
   * @param {string} requiredState - Required session state
   * @param {string} operation - Operation being attempted
   * @returns {boolean} True if state is valid for operation
   */
  validateSessionState(requiredState, operation = '') {
    const currentState = this.sessionState;
    
    // Check if current state matches required state
    if (currentState === requiredState) {
      return true;
    }
    
    // Set appropriate error based on state mismatch
    if (operation === 'Initialize') {
      if (currentState === SCORM_CONSTANTS.SESSION_STATES.RUNNING) {
        this.setError(COMMON_ERRORS.ALREADY_INITIALIZED, 
          'Initialize called when session already initialized', 
          'validateSessionState');
        return false;
      }
      if (currentState === SCORM_CONSTANTS.SESSION_STATES.TERMINATED) {
        this.setError(COMMON_ERRORS.CONTENT_TERMINATED,
          'Initialize called after session terminated',
          'validateSessionState');
        return false;
      }
    }
    
    if (operation === 'Terminate') {
      if (currentState === SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED) {
        this.setError(COMMON_ERRORS.TERMINATION_BEFORE_INIT,
          'Terminate called before Initialize',
          'validateSessionState');
        return false;
      }
      if (currentState === SCORM_CONSTANTS.SESSION_STATES.TERMINATED) {
        this.setError(COMMON_ERRORS.TERMINATION_AFTER_TERMINATION,
          'Terminate called after session already terminated',
          'validateSessionState');
        return false;
      }
    }
    
    if (['GetValue', 'SetValue', 'Commit'].includes(operation)) {
      if (currentState !== SCORM_CONSTANTS.SESSION_STATES.RUNNING) {
        this.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          `${operation} called when session not running`,
          'validateSessionState');
        return false;
      }
    }
    
    return false;
  }

  /**
   * Update session state
   * @param {string} newState - New session state
   */
  setSessionState(newState) {
    const validStates = Object.values(SCORM_CONSTANTS.SESSION_STATES);
    
    if (!validStates.includes(newState)) {
      this.logger?.warn(`Invalid session state: ${newState}`);
      return;
    }
    
    const oldState = this.sessionState;
    this.sessionState = newState;
    
    this.logger?.debug(`Session state changed: ${oldState} -> ${newState}`);
  }

  /**
   * Get current session state
   * @returns {string} Current session state
   */
  getSessionState() {
    return this.sessionState;
  }

  /**
   * Check if there is currently an error
   * @returns {boolean} True if there is an error
   */
  hasError() {
    return !isSuccess(this.lastError);
  }

  /**
   * Add error to history for debugging
   * @private
   * @param {string} errorCode - Error code
   * @param {string} diagnostic - Diagnostic information
   * @param {string} context - Context where error occurred
   */
  addToHistory(errorCode, diagnostic, context) {
    const entry = {
      timestamp: new Date().toISOString(),
      errorCode: String(errorCode),
      errorString: getErrorString(errorCode),
      diagnostic,
      context,
      sessionState: this.sessionState
    };
    
    this.errorHistory.push(entry);
    
    // Limit history size
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Get error history for debugging
   * @returns {Array} Array of error history entries
   */
  getErrorHistory() {
    return [...this.errorHistory];
  }

  /**
   * Get current error state summary
   * @returns {Object} Current error state information
   */
  getErrorState() {
    return {
      lastError: this.lastError,
      lastErrorString: getErrorString(this.lastError),
      lastDiagnostic: this.lastDiagnostic,
      sessionState: this.sessionState,
      hasError: this.hasError(),
      errorCategory: getErrorCategory(this.lastError)
    };
  }

  /**
   * Reset error handler to initial state
   */
  reset() {
    this.lastError = COMMON_ERRORS.NO_ERROR;
    this.lastDiagnostic = '';
    this.sessionState = SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED;
    this.errorHistory = [];
    this.diagnosticInfo.clear();
    
    this.logger?.debug('ScormErrorHandler reset to initial state');
  }
}

module.exports = ScormErrorHandler;