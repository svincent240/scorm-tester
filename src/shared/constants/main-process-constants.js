/**
 * SCORM Tester Main Process Constants
 * 
 * Constants for Phase 4 main process services including service states,
 * configuration options, and operational parameters.
 * 
 * @fileoverview Main process service constants and configuration
 */

/**
 * Service States
 */
const SERVICE_STATES = {
  NOT_INITIALIZED: 'not_initialized',
  INITIALIZING: 'initializing',
  READY: 'ready',
  RUNNING: 'running',
  SHUTTING_DOWN: 'shutting_down',
  SHUTDOWN: 'shutdown',
  ERROR: 'error'
};

/**
 * Service Types
 */
const SERVICE_TYPES = {
  WINDOW_MANAGER: 'window_manager',
  IPC_HANDLER: 'ipc_handler',
  FILE_MANAGER: 'file_manager',
  SCORM_SERVICE: 'scorm_service'
};

/**
 * Window Types
 */
const WINDOW_TYPES = {
  MAIN: 'main',
  SCORM_INSPECTOR: 'scorm-inspector'
};

/**
 * Window States
 */
const WINDOW_STATES = {
  CREATING: 'creating',
  READY: 'ready',
  FOCUSED: 'focused',
  MINIMIZED: 'minimized',
  MAXIMIZED: 'maximized',
  CLOSING: 'closing',
  CLOSED: 'closed'
};

/**
 * IPC Channel Categories
 */
const IPC_CHANNELS = {
  SCORM: 'scorm',
  FILE: 'file',
  WINDOW: 'window',
  SYSTEM: 'system',
  DEBUG: 'debug'
};

/**
 * File Operation Types
 */
const FILE_OPERATIONS = {
  EXTRACT: 'extract',
  VALIDATE: 'validate',
  ANALYZE: 'analyze',
  CLEANUP: 'cleanup'
};

/**
 * Service Configuration Defaults
 */
const SERVICE_DEFAULTS = {
  WINDOW_MANAGER: {
    mainWindow: {
      width: 1400,     // Increased to accommodate all sections without scrolling
      height: 1000,    // Increased to fit Learning Progress section comfortably
      minWidth: 1100,  // Increased minimum to ensure proper layout
      minHeight: 800,  // Increased to prevent section cut-off
      // Enable webSecurity by default to avoid insecure renderer warnings.
      // Feature flags and privileged scheme registration can be used to
      // allow storage-capable origins when needed (see USE_STORAGE_CAPABLE_ORIGIN).
      webSecurity: true,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Add responsive window options
      center: true,
      maximizable: true,
      resizable: true,
      // Set reasonable bounds based on screen size
      useContentSize: false,
      show: false // Will be shown after proper sizing
    },
    
    scormInspectorWindow: {
      width: 1000,     // Wider for inspection details
      height: 800,     // Taller for API timeline and error lists
      minWidth: 800,   // Minimum width for proper SCORM Inspector UI
      minHeight: 600,  // Minimum height for content visibility
      parent: null,    // Will be set to main window
      // Security configuration - same as main window for preload script compatibility
      webSecurity: true,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      center: true,
      maximizable: true,
      resizable: true,
      show: false      // Will be shown after loading content
    }
  },
  
  IPC_HANDLER: {
    maxMessageSize: 10 * 1024 * 1024, // 10MB
    requestTimeout: 30000, // 30 seconds
    maxConcurrentRequests: 50,
    enableRateLimiting: true,
    rateLimitWindow: 60000, // 1 minute
    rateLimitMax: 100 // requests per window
  },
  
  FILE_MANAGER: {
    maxPackageSize: 500 * 1024 * 1024, // 500MB
    maxExtractedSize: 1024 * 1024 * 1024, // 1GB
    tempDirCleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
    maxTempFiles: 100,
    allowedExtensions: ['.zip', '.scorm'],
    extractionTimeout: 300000 // 5 minutes
  },
  
  SCORM_SERVICE: {
    maxSessions: 10,
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    enableGlobalObjectives: true,
    enableRollupProcessing: true,
    maxSequencingDepth: 10
  }
};

/**
 * Debug Telemetry Defaults
 */
const DEBUG_TELEMETRY_DEFAULTS = {
  MAX_HISTORY_SIZE: 5000, // Max number of API calls to store in history
  MAX_ERROR_HISTORY_SIZE: 300, // Max number of errors to store
  MAX_LOG_HISTORY_SIZE: 500, // Max number of logs to store
  THROTTLE_INTERVAL_MS: 200 // Throttle interval for debug:update emissions
};

/**
 * Service Events
 */
const SERVICE_EVENTS = {
  // Lifecycle events
  INITIALIZING: 'service:initializing',
  READY: 'service:ready',
  ERROR: 'service:error',
  SHUTTING_DOWN: 'service:shutting_down',
  SHUTDOWN: 'service:shutdown',
  
  // Window events
  WINDOW_CREATED: 'window:created',
  WINDOW_READY: 'window:ready',
  WINDOW_CLOSED: 'window:closed',
  WINDOW_FOCUS_CHANGED: 'window:focus_changed',
  
  // IPC events
  IPC_MESSAGE_RECEIVED: 'ipc:message_received',
  IPC_MESSAGE_SENT: 'ipc:message_sent',
  IPC_ERROR: 'ipc:error',
  
  // File events
  FILE_OPERATION_STARTED: 'file:operation_started',
  FILE_OPERATION_COMPLETED: 'file:operation_completed',
  FILE_OPERATION_FAILED: 'file:operation_failed',
  
  // SCORM events
  SCORM_SESSION_CREATED: 'scorm:session_created',
  SCORM_SESSION_TERMINATED: 'scorm:session_terminated',
  SCORM_WORKFLOW_STARTED: 'scorm:workflow_started',
  SCORM_WORKFLOW_COMPLETED: 'scorm:workflow_completed'
};

/**
 * Performance Thresholds
 */
const PERFORMANCE_THRESHOLDS = {
  SERVICE_INITIALIZATION: 1000, // 1 second
  WINDOW_CREATION: 2000, // 2 seconds
  IPC_RESPONSE: 5000, // 5 seconds
  FILE_EXTRACTION: 30000, // 30 seconds
  SCORM_WORKFLOW: 10000 // 10 seconds
};

/**
 * Security Configuration
 */
const SECURITY_CONFIG = {
  IPC: {
    validateOrigin: true,
    sanitizeInputs: true,
    maxMessageSize: 10 * 1024 * 1024, // 10MB
    allowedChannels: [
      'scorm-initialize',
      'scorm-get-value',
      'scorm-set-value',
      'scorm-commit',
      'scorm-terminate',
      'select-scorm-package',
      'select-scorm-folder',
      'extract-scorm',
      'prepare-course-source',
      'save-temporary-file',
      'find-scorm-entry',
      'get-course-info',
      'get-course-manifest',
      'process-scorm-manifest',
      'validate-scorm-compliance',
      'analyze-scorm-content',
      'get-session-data',
      'reset-session',
      'apply-lms-profile',
      'get-lms-profiles',
      'run-test-scenario',
      'get-all-sessions',
      'open-external',
      'path-to-file-url',
      'get-app-root',
      'path-normalize',
      'path-join',
      'log-message',
      'load-module', // Added new channel
      'load-shared-logger-adapter', // Renderer logger IPC fallback
      'renderer-log-info', // Direct renderer logging channels
      'renderer-log-warn',
      'renderer-log-error',
      'renderer-log-debug',
      // SN channels
      'sn:getStatus',
      'sn:getSequencingState',
      'sn:initialize',
      'sn:processNavigation',
      'sn:refreshNavigation',
      'sn:updateActivityProgress',
      'sn:reset',
      // Browse Mode channels (robustness even with declarative routes)
      'browse-mode-enable',
      'browse-mode-disable',
      'browse-mode-status',
      // Recent Courses channels
      'recent:get',
      'recent:addOrUpdate',
      'recent:remove',
      'recent:clear',
      // SCORM Inspector channels
      'open-scorm-inspector-window',
      'scorm-inspector-get-history',
      // App control channels
      'quit-app'
    ]
  },
  
  FILE_SYSTEM: {
    allowedPaths: ['temp', 'extracted', 'packages'],
    preventTraversal: true,
    maxPathLength: 260,
    sanitizeFilenames: true
  }
};

// Freeze all objects to prevent modification
Object.freeze(SERVICE_STATES);
Object.freeze(SERVICE_TYPES);
Object.freeze(WINDOW_TYPES);
Object.freeze(WINDOW_STATES);
Object.freeze(IPC_CHANNELS);
Object.freeze(FILE_OPERATIONS);
Object.freeze(SERVICE_DEFAULTS);
Object.freeze(SERVICE_EVENTS);
Object.freeze(PERFORMANCE_THRESHOLDS);
Object.freeze(SECURITY_CONFIG);
Object.freeze(DEBUG_TELEMETRY_DEFAULTS); // Freeze the new constant
 
module.exports = {
  SERVICE_STATES,
  SERVICE_TYPES,
  WINDOW_TYPES,
  WINDOW_STATES,
  IPC_CHANNELS,
  FILE_OPERATIONS,
  SERVICE_DEFAULTS,
  SERVICE_EVENTS,
  PERFORMANCE_THRESHOLDS,
  SECURITY_CONFIG,
  DEBUG_TELEMETRY_DEFAULTS // Export the new constant
};
