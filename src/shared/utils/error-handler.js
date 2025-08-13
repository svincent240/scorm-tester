/**
 * Error Handler - Simplified error routing with loose UI coupling
 * 
 * Routes errors to appropriate destinations without tight coupling to specific UI stores
 */

const getLogger = require('./logger');
const ErrorClassifier = require('./error-classifier');
const { COMMON_ERRORS } = require('../constants/error-codes');

class ErrorHandler {
  /**
   * Handle error with classification and routing
   * @param {Error} error - The error object
   * @param {Object} context - Context information for classification
   * @param {Object} handlers - Optional handler overrides
   */
  static handleError(error, context = {}, handlers = {}) {
    const classification = ErrorClassifier.classifyError(error, context);
    
    // Always log to app system for developers
    this.logToApp(error, classification, context);
    
    // Route to appropriate handlers
    switch (classification.source) {
      case ErrorClassifier.ERROR_SOURCE.SCORM:
        this.handleScormError(error, classification, context, handlers);
        break;
        
      case ErrorClassifier.ERROR_SOURCE.APP:
        this.handleAppError(error, classification, context, handlers);
        break;
        
      case ErrorClassifier.ERROR_SOURCE.AMBIGUOUS:
        this.handleAmbiguousError(error, classification, context, handlers);
        break;
    }
  }
  
  /**
   * Log error to app debugging system
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static logToApp(error, classification, context) {
    const logger = getLogger();
    const logData = {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      classification,
      context: ErrorClassifier.sanitizeContext(context),
      timestamp: new Date().toISOString()
    };
    
    logger.error('[ErrorHandler] Error classified and logged', logData);
  }
  
  /**
   * Handle SCORM-related error
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   * @param {Object} handlers - Handler overrides
   */
  static handleScormError(error, classification, context, handlers) {
    // Use custom handler if provided
    if (handlers.scormError && typeof handlers.scormError === 'function') {
      try {
        handlers.scormError(error, classification, context);
        return;
      } catch (e) {
        const logger = getLogger();
        logger.warn('[ErrorHandler] Custom SCORM error handler failed', e?.message || e);
      }
    }
    
    // Default SCORM error handling - emit event for UI components to handle
    this.emitErrorEvent('scorm:error', {
      error,
      classification,
      context,
      errorEntry: this.createScormErrorEntry(error, classification, context)
    }, context);
  }
  
  /**
   * Handle application error
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   * @param {Object} handlers - Handler overrides
   */
  static handleAppError(error, classification, context, handlers) {
    // Use custom handler if provided
    if (handlers.appError && typeof handlers.appError === 'function') {
      try {
        handlers.appError(error, classification, context);
        return;
      } catch (e) {
        const logger = getLogger();
        logger.warn('[ErrorHandler] Custom app error handler failed', e?.message || e);
      }
    }
    
    // Default app error handling
    this.emitErrorEvent('app:error', {
      error,
      classification,
      timestamp: Date.now(),
      userMessage: 'An application error occurred. Please check the logs.'
    }, context);
  }
  
  /**
   * Handle ambiguous error (route to both systems)
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   * @param {Object} handlers - Handler overrides
   */
  static handleAmbiguousError(error, classification, context, handlers) {
    // Send to both systems with investigation guidance
    const enhancedError = {
      ...error,
      message: `${error.message} (Investigation needed: Could be content or app issue)`
    };
    
    this.handleScormError(enhancedError, classification, context, handlers);
    this.handleAppError(error, classification, context, handlers);
  }
  
  /**
   * Create SCORM error entry for inspector
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   * @returns {Object} SCORM error entry
   */
  static createScormErrorEntry(error, classification, context) {
    return {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      method: context.scormApiMethod || 'system',
      parameters: context.element ? [context.element] : [],
      result: 'false',
      errorCode: this.mapErrorToScormCode(error, classification),
      errorMessage: error.message,
      sessionId: context.sessionId || 'unknown',
      durationMs: 0,
      source: classification.source,
      category: classification.category,
      severity: ErrorClassifier.determineSeverity(error, context),
      context: ErrorClassifier.sanitizeContext(context),
      userActionable: true,
      troubleshootingSteps: ErrorClassifier.generateTroubleshootingSteps(error, classification, context)
    };
  }
  
  /**
   * Map error to appropriate SCORM error code
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @returns {string} SCORM error code
   */
  static mapErrorToScormCode(error, classification) {
    switch (classification.category) {
      case ErrorClassifier.ERROR_CATEGORY.API:
        return COMMON_ERRORS.GENERAL_EXCEPTION;
      case ErrorClassifier.ERROR_CATEGORY.CONTENT:
        return COMMON_ERRORS.UNDEFINED_ELEMENT;
      case ErrorClassifier.ERROR_CATEGORY.DATA:
        return COMMON_ERRORS.TYPE_MISMATCH;
      case ErrorClassifier.ERROR_CATEGORY.SEQUENCING:
        return COMMON_ERRORS.TERMINATION_BEFORE_INIT;
      case ErrorClassifier.ERROR_CATEGORY.SYSTEM:
        return COMMON_ERRORS.GENERAL_EXCEPTION;
      default:
        return COMMON_ERRORS.GENERAL_EXCEPTION;
    }
  }
  
  /**
   * Emit error event for UI components to handle
   * @param {string} eventType - Type of error event
   * @param {Object} errorData - Error data to emit
   * @param {Object} context - Additional context
   */
  static emitErrorEvent(eventType, errorData, context) {
    const eventBus = context.eventBus;
    
    if (eventBus && typeof eventBus.emit === 'function') {
      try {
        eventBus.emit(eventType, errorData);
      } catch (e) {
        const logger = getLogger();
        logger.warn(`[ErrorHandler] Failed to emit ${eventType} event`, e?.message || e);
      }
    }
    
    // Also try UI state notification for app errors
    if (eventType === 'app:error' && context.uiState && typeof context.uiState.showNotification === 'function') {
      try {
        context.uiState.showNotification({
          type: 'error',
          message: 'Application error occurred',
          details: errorData.error.message,
          duration: 5000
        });
      } catch (e) {
        const logger = getLogger();
        logger.warn('[ErrorHandler] Failed to show UI notification', e?.message || e);
      }
    }
  }
}

module.exports = ErrorHandler;