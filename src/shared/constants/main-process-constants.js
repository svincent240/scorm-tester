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
  DEBUG: 'debug'
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
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      webSecurity: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    debugWindow: {
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      parent: null // Will be set to main window
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
      'extract-scorm',
      'save-temporary-file',
      'find-scorm-entry',
      'get-course-info',
      'get-course-manifest',
      'validate-scorm-compliance',
      'analyze-scorm-content',
      'get-session-data',
      'reset-session',
      'apply-lms-profile',
      'get-lms-profiles',
      'run-test-scenario',
      'get-all-sessions',
      'open-external',
      'path-utils-to-file-url',
      'log-message'
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
  SECURITY_CONFIG
};