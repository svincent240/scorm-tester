/**
 * Error Router - Classifies and routes errors to appropriate systems
 * 
 * CRITICAL: This ensures app debugging and SCORM inspection are kept separate
 */

const ERROR_SOURCE = {
  APP: 'app',           // Application bug/issue
  SCORM: 'scorm',       // SCORM package content issue
  AMBIGUOUS: 'ambiguous' // Unclear source - needs investigation
};

const ERROR_CATEGORY = {
  // App Categories
  SYSTEM: 'system',         // File system, network, IPC
  UI: 'ui',                // User interface, rendering
  CONFIG: 'config',        // Settings, preferences
  
  // SCORM Categories  
  API: 'scorm-api',        // SCORM API compliance issues
  CONTENT: 'scorm-content', // Content loading, manifest issues
  DATA: 'scorm-data',      // Data model validation errors
  SEQUENCING: 'scorm-sequencing', // Navigation rule violations
  
  // Ambiguous Categories
  RUNTIME: 'runtime',      // Could be app or content issue
  INTEGRATION: 'integration' // App-content integration issues
};

class ErrorRouter {
  /**
   * Route error to appropriate system based on classification
   * @param {Error} error - The error object
   * @param {Object} context - Context information for classification
   */
  static routeError(error, context = {}) {
    const classification = this.classifyError(error, context);
    
    // Always log to app.log for developers (complete technical record)
    this.logToApp(error, classification, context);
    
    // Route to appropriate user interface
    switch (classification.source) {
      case ERROR_SOURCE.SCORM:
        this.routeToScormInspector(error, classification, context);
        break;
        
      case ERROR_SOURCE.APP:
        this.routeToAppErrorHandler(error, classification, context);
        break;
        
      case ERROR_SOURCE.AMBIGUOUS:
        this.routeToBoth(error, classification, context);
        break;
    }
  }
  
  /**
   * Classify error based on context clues
   * @param {Error} error - The error object
   * @param {Object} context - Context information
   * @returns {Object} Classification result
   */
  static classifyError(error, context) {
    // SCORM-specific indicators
    if (context.scormApiMethod) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.API };
    }
    
    if (context.manifestParsing) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.CONTENT };
    }
    
    if (context.scormDataValidation) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.DATA };
    }
    
    if (context.scormSequencing) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.SEQUENCING };
    }
    
    // App-specific indicators
    if (context.fileSystem || context.operation?.includes('file')) {
      return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.SYSTEM };
    }
    
    if (context.component || context.ui || context.rendering) {
      return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.UI };
    }
    
    if (context.config || context.settings) {
      return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.CONFIG };
    }
    
    // Ambiguous indicators
    if (context.contentLoading || context.networkError) {
      return { source: ERROR_SOURCE.AMBIGUOUS, category: ERROR_CATEGORY.RUNTIME };
    }
    
    // Default to ambiguous for investigation
    return { source: ERROR_SOURCE.AMBIGUOUS, category: ERROR_CATEGORY.INTEGRATION };
  }
  
  /**
   * Log error to app debugging system
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static logToApp(error, classification, context) {
    const logger = context.logger || console;
    const logData = {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      classification,
      context: this.sanitizeContext(context),
      timestamp: new Date().toISOString()
    };
    
    // Always log to app debugging system
    logger.error('[ErrorRouter] Error classified and logged', logData);
  }
  
  /**
   * Route error to SCORM Inspector
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static routeToScormInspector(error, classification, context) {
    const scormInspectorStore = context.scormInspectorStore;
    
    if (scormInspectorStore && typeof scormInspectorStore.storeScormError === 'function') {
      // Adapt to existing storeScormError signature which expects an entry format
      const errorEntry = {
        id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        method: context.scormApiMethod || 'system',
        parameters: context.element ? [context.element] : [],
        result: 'false',
        errorCode: this.mapErrorToScormCode(error, classification),
        errorMessage: error.message,
        sessionId: context.sessionId || 'unknown',
        durationMs: 0,
        // Additional fields for error classification
        source: classification.source,
        category: classification.category,
        severity: this.determineSeverity(error, context),
        context: this.sanitizeContext(context),
        userActionable: true,
        troubleshootingSteps: this.generateTroubleshootingSteps(error, classification, context)
      };
      
      // Send to SCORM Inspector for user display
      try {
        scormInspectorStore.storeScormError(errorEntry);
      } catch (e) {
        // If storing to SCORM Inspector fails, log but don't throw
        const logger = context.logger || console;
        logger.warn('[ErrorRouter] Failed to store error in SCORM Inspector', e?.message || e);
      }
    }
  }
  
  /**
   * Route error to app error handling
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification  
   * @param {Object} context - Additional context
   */
  static routeToAppErrorHandler(error, classification, context) {
    const eventBus = context.eventBus;
    const uiState = context.uiState;
    
    // App errors go to UI notifications and app logging only
    if (eventBus && typeof eventBus.emit === 'function') {
      try {
        eventBus.emit('app:error', {
          error,
          classification,
          timestamp: Date.now(),
          userMessage: 'An application error occurred. Please check the logs.'
        });
      } catch (e) {
        // If EventBus fails, log but don't throw
        const logger = context.logger || console;
        logger.warn('[ErrorRouter] Failed to emit app error event', e?.message || e);
      }
    }
    
    if (uiState && typeof uiState.showNotification === 'function') {
      try {
        uiState.showNotification({
          type: 'error',
          message: 'Application error occurred',
          details: error.message,
          duration: 5000
        });
      } catch (e) {
        // If UI notification fails, log but don't throw
        const logger = context.logger || console;
        logger.warn('[ErrorRouter] Failed to show UI notification', e?.message || e);
      }
    }
  }
  
  /**
   * Route ambiguous error to both systems
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static routeToBoth(error, classification, context) {
    // Send to both systems with investigation guidance
    this.routeToScormInspector(error, {
      ...classification,
      message: `${error.message} (Investigation needed: Could be content or app issue)`
    }, context);
    
    this.routeToAppErrorHandler(error, classification, context);
  }
  
  /**
   * Determine error severity
   * @param {Error} error - The error object
   * @param {Object} context - Additional context
   * @returns {string} Severity level
   */
  static determineSeverity(error, context) {
    if (context.critical || error.name === 'CriticalError') return 'critical';
    if (context.scormApiMethod || context.manifestParsing) return 'high';
    if (error.name === 'ValidationError') return 'medium';
    return 'low';
  }
  
  /**
   * Generate context-appropriate troubleshooting steps
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   * @returns {Array} Array of troubleshooting steps
   */
  static generateTroubleshootingSteps(error, classification, context) {
    const steps = [];
    
    switch (classification.category) {
      case ERROR_CATEGORY.API:
        steps.push(
          'Verify SCORM API call sequence and parameters',
          'Check if Initialize() was called first',
          'Ensure session is not terminated'
        );
        break;
        
      case ERROR_CATEGORY.CONTENT:
        steps.push(
          'Validate manifest.xml syntax and structure',
          'Check all referenced files exist in package',
          'Verify SCORM version compatibility'
        );
        break;
        
      case ERROR_CATEGORY.RUNTIME:
        steps.push(
          'Check if this is a content issue by testing with different SCORM package',
          'Try reloading the application',
          'Check network connectivity if loading remote content'
        );
        break;
        
      default:
        steps.push(
          'Review the error details and context',
          'Check application logs for more information',
          'Try reproducing the error with minimal steps'
        );
    }
    
    return steps;
  }

  /**
   * Map error to appropriate SCORM error code
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @returns {string} SCORM error code
   */
  static mapErrorToScormCode(error, classification) {
    // Map classification to appropriate SCORM error codes
    switch (classification.category) {
      case ERROR_CATEGORY.API:
        return '101'; // General exception
      case ERROR_CATEGORY.CONTENT:
        return '201'; // Invalid argument error
      case ERROR_CATEGORY.DATA:
        return '401'; // Not implemented error
      case ERROR_CATEGORY.SEQUENCING:
        return '301'; // Not initialized
      case ERROR_CATEGORY.SYSTEM:
        return '101'; // General exception
      default:
        return '101'; // General exception
    }
  }
  
  /**
   * Remove sensitive information from context
   * @param {Object} context - Context object to sanitize
   * @returns {Object} Sanitized context
   */
  static sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Remove sensitive or large objects
    delete sanitized.logger;
    delete sanitized.eventBus;
    delete sanitized.uiState;
    delete sanitized.scormInspectorStore;
    
    return sanitized;
  }
}

// Export constants for use in other modules
ErrorRouter.ERROR_SOURCE = ERROR_SOURCE;
ErrorRouter.ERROR_CATEGORY = ERROR_CATEGORY;

module.exports = ErrorRouter;