/**
 * Standardized Error Context Types
 * 
 * Defines the standard context structure for error handling across the application
 */

/**
 * Standard error context structure
 * @typedef {Object} ErrorContext
 * @property {string} [sessionId] - Current SCORM session ID
 * @property {string} [operation] - Operation being performed when error occurred
 * @property {string} [component] - UI component where error occurred
 * @property {string} [phase] - Application phase (e.g., 'CAM_PARSE', 'RTE_INIT')
 * 
 * // SCORM-specific context
 * @property {string} [scormApiMethod] - SCORM API method being called
 * @property {string} [element] - SCORM data model element
 * @property {boolean} [manifestParsing] - Error occurred during manifest parsing
 * @property {boolean} [scormDataValidation] - Error occurred during data validation
 * @property {boolean} [scormSequencing] - Error occurred during sequencing
 * 
 * // App-specific context
 * @property {boolean} [fileSystem] - Error occurred during file system operation
 * @property {boolean} [ui] - Error occurred in UI rendering
 * @property {boolean} [rendering] - Error occurred during UI rendering
 * @property {boolean} [config] - Error occurred in configuration
 * @property {boolean} [settings] - Error occurred in settings management
 * 
 * // Ambiguous context
 * @property {boolean} [contentLoading] - Error occurred during content loading
 * @property {boolean} [networkError] - Network-related error
 * 
 * // Severity and handling
 * @property {boolean} [critical] - Critical error requiring immediate attention
 * @property {'debug'|'info'|'warn'|'error'} [severity] - Error severity level
 * 
 * // System context (provided by handlers, don't set manually)
 * @property {Object} [eventBus] - Event bus for UI notifications
 * @property {Object} [uiState] - UI state manager
 * @property {Object} [scormInspectorStore] - SCORM inspector store
 * @property {Function} [logger] - Logger instance
 */

/**
 * Create standardized error context
 * @param {Object} context - Context data
 * @returns {ErrorContext} Standardized context
 */
function createErrorContext(context = {}) {
  // Validate and normalize context
  const normalized = {
    sessionId: context.sessionId || undefined,
    operation: context.operation || undefined,
    component: context.component || undefined,
    phase: context.phase || undefined,
    
    // SCORM indicators
    scormApiMethod: context.scormApiMethod || undefined,
    element: context.element || undefined,
    manifestParsing: Boolean(context.manifestParsing),
    scormDataValidation: Boolean(context.scormDataValidation),
    scormSequencing: Boolean(context.scormSequencing),
    
    // App indicators
    fileSystem: Boolean(context.fileSystem),
    ui: Boolean(context.ui),
    rendering: Boolean(context.rendering),
    config: Boolean(context.config),
    settings: Boolean(context.settings),
    
    // Ambiguous indicators
    contentLoading: Boolean(context.contentLoading),
    networkError: Boolean(context.networkError),
    
    // Severity
    critical: Boolean(context.critical),
    severity: context.severity || 'error',
    
    // System context (preserve if provided)
    eventBus: context.eventBus,
    uiState: context.uiState,
    scormInspectorStore: context.scormInspectorStore,
    logger: context.logger
  };
  
  // Remove undefined values to keep context clean
  Object.keys(normalized).forEach(key => {
    if (normalized[key] === undefined) {
      delete normalized[key];
    }
  });
  
  return normalized;
}

/**
 * Pre-defined context creators for common scenarios
 */
const ErrorContexts = {
  scormApi: (method, element, sessionId) => createErrorContext({
    scormApiMethod: method,
    element,
    sessionId,
    operation: `scorm-${method}`
  }),
  
  manifestParsing: (packagePath, manifestId) => createErrorContext({
    manifestParsing: true,
    operation: 'manifest-parse',
    phase: 'CAM_PARSE',
    packagePath,
    manifestId
  }),
  
  fileSystem: (operation, path) => createErrorContext({
    fileSystem: true,
    operation,
    filePath: path
  }),
  
  uiComponent: (component, operation) => createErrorContext({
    ui: true,
    component,
    operation
  }),
  
  config: (configKey, operation) => createErrorContext({
    config: true,
    configKey,
    operation
  })
};

module.exports = {
  createErrorContext,
  ErrorContexts
};