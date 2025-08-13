/**
 * Error Classifier - Centralized error classification logic
 * 
 * Separates classification logic from routing to improve maintainability
 */

const { ERROR_CATEGORIES } = require('../constants/error-codes');

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

class ErrorClassifier {
  /**
   * Classify error based on context clues
   * @param {Error} error - The error object
   * @param {Object} context - Context information
   * @returns {Object} Classification result
   */
  static classifyError(error, context = {}) {
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
ErrorClassifier.ERROR_SOURCE = ERROR_SOURCE;
ErrorClassifier.ERROR_CATEGORY = ERROR_CATEGORY;

module.exports = ErrorClassifier;