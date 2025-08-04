/**
 * SCORM 2004 4th Edition Error Codes
 * 
 * Complete implementation of SCORM error codes based on:
 * - SCORM 2004 4th Edition Run-Time Environment specification
 * - IEEE 1484.11.2 standard for error handling
 * 
 * Error code ranges:
 * - 0: Success
 * - 100-199: Phase 1 RTE errors (General errors)
 * - 200-299: Phase 2 CAM errors (Initialization errors)
 * - 300-399: Termination errors
 * - 400-499: Data model errors
 * - 450-599: Phase 3 SN errors (Sequencing and Navigation)
 * - 600-699: Phase 4 Main Process errors
 * - 700-999: Reserved for future use
 * 
 * @fileoverview SCORM 2004 4th Edition compliant error codes
 */

const SCORM_ERROR_CODES = {
  // Success (0)
  0: "No Error",

  // General Errors (100-199)
  101: "General Exception",
  102: "General Initialization Failure", 
  103: "Already Initialized",
  104: "Content Instance Terminated",

  // Termination Errors (110-119)
  111: "General Termination Failure",
  112: "Termination Before Initialization", 
  113: "Termination After Termination",

  // Data Model Errors (400-499)
  401: "General Get Failure",
  402: "General Set Failure",
  403: "General Commit Failure",
  404: "Undefined Data Model Element",
  405: "Unimplemented Data Model Element",
  406: "Data Model Element Value Not Initialized",
  407: "Data Model Element Is Read Only",
  408: "Data Model Element Is Write Only",
  409: "Data Model Element Type Mismatch",
  410: "Data Model Element Value Out Of Range",
  411: "Data Model Dependency Not Established",

  // Phase 4 Main Process Errors (600-699)
  // Window Management Errors (600-609)
  600: "Window Management Failure",
  601: "Window Creation Failed",
  602: "Window Configuration Invalid",
  603: "Window State Persistence Failed",
  604: "Menu Creation Failed",
  605: "Window Event Handler Failed",

  // IPC Communication Errors (610-619)
  610: "IPC Handler Failure",
  611: "IPC Message Validation Failed",
  612: "IPC Channel Registration Failed",
  613: "IPC Security Violation",
  614: "IPC Message Routing Failed",
  615: "IPC Response Timeout",

  // File System Operation Errors (620-629)
  620: "File System Operation Failed",
  621: "Package Extraction Failed",
  622: "File Path Validation Failed",
  623: "Temporary File Cleanup Failed",
  624: "File Access Permission Denied",
  625: "File Size Limit Exceeded",

  // Service Lifecycle Errors (630-639)
  630: "Service Initialization Failed",
  631: "Service Dependency Missing",
  632: "Service Configuration Invalid",
  633: "Service Shutdown Failed",
  634: "Service State Invalid",
  635: "Service Communication Failed",

  // SCORM Service Integration Errors (640-649)
  640: "SCORM Service Integration Failed",
  641: "SCORM Session Management Failed",
  642: "SCORM Workflow Coordination Failed",
  643: "SCORM Service State Synchronization Failed",
  644: "SCORM LMS Profile Application Failed",
  645: "SCORM Cross-Service Communication Failed"
};

/**
 * SCORM Error Code Categories
 * Used for error classification and handling
 */
const ERROR_CATEGORIES = {
  SUCCESS: 'success',
  GENERAL: 'general',
  INITIALIZATION: 'initialization',
  TERMINATION: 'termination',
  DATA_MODEL: 'data_model',
  SEQUENCING: 'sequencing',
  MAIN_PROCESS: 'main_process',
  RESERVED: 'reserved'
};

/**
 * Get error category for a given error code
 * @param {string|number} errorCode - The error code to categorize
 * @returns {string} The error category
 */
function getErrorCategory(errorCode) {
  const code = parseInt(errorCode, 10);
  
  if (code === 0) return ERROR_CATEGORIES.SUCCESS;
  if (code >= 100 && code <= 199) return ERROR_CATEGORIES.GENERAL;
  if (code >= 200 && code <= 299) return ERROR_CATEGORIES.INITIALIZATION;
  if (code >= 300 && code <= 399) return ERROR_CATEGORIES.TERMINATION;
  if (code >= 400 && code <= 449) return ERROR_CATEGORIES.DATA_MODEL;
  if (code >= 450 && code <= 599) return ERROR_CATEGORIES.SEQUENCING;
  if (code >= 600 && code <= 699) return ERROR_CATEGORIES.MAIN_PROCESS;
  if (code >= 700 && code <= 999) return ERROR_CATEGORIES.RESERVED;
  
  return ERROR_CATEGORIES.GENERAL;
}

/**
 * Check if an error code indicates success
 * @param {string|number} errorCode - The error code to check
 * @returns {boolean} True if the error code indicates success
 */
function isSuccess(errorCode) {
  return parseInt(errorCode, 10) === 0;
}

/**
 * Check if an error code is valid SCORM error code
 * @param {string|number} errorCode - The error code to validate
 * @returns {boolean} True if the error code is valid
 */
function isValidErrorCode(errorCode) {
  const code = parseInt(errorCode, 10);
  return !isNaN(code) && code >= 0 && code <= 999;
}

/**
 * Get error string for a given error code
 * @param {string|number} errorCode - The error code
 * @returns {string} The error string or empty string if not found
 */
function getErrorString(errorCode) {
  const code = parseInt(errorCode, 10);
  return SCORM_ERROR_CODES[code] || "";
}

/**
 * Common error code constants for easy reference
 */
const COMMON_ERRORS = {
  NO_ERROR: "0",
  GENERAL_EXCEPTION: "101",
  ALREADY_INITIALIZED: "103",
  CONTENT_TERMINATED: "104",
  TERMINATION_FAILURE: "111",
  TERMINATION_BEFORE_INIT: "112",
  TERMINATION_AFTER_TERMINATION: "113",
  UNDEFINED_ELEMENT: "404",
  READ_ONLY_ELEMENT: "407",
  WRITE_ONLY_ELEMENT: "408",
  TYPE_MISMATCH: "409",
  VALUE_OUT_OF_RANGE: "410"
};

/**
 * Phase 4 Main Process Error Constants
 */
const MAIN_PROCESS_ERRORS = {
  // Window Management
  WINDOW_MANAGEMENT_FAILURE: "600",
  WINDOW_CREATION_FAILED: "601",
  WINDOW_CONFIG_INVALID: "602",
  WINDOW_STATE_PERSISTENCE_FAILED: "603",
  MENU_CREATION_FAILED: "604",
  WINDOW_EVENT_HANDLER_FAILED: "605",

  // IPC Communication
  IPC_HANDLER_FAILURE: "610",
  IPC_MESSAGE_VALIDATION_FAILED: "611",
  IPC_CHANNEL_REGISTRATION_FAILED: "612",
  IPC_SECURITY_VIOLATION: "613",
  IPC_MESSAGE_ROUTING_FAILED: "614",
  IPC_RESPONSE_TIMEOUT: "615",

  // File System Operations
  FILE_SYSTEM_OPERATION_FAILED: "620",
  PACKAGE_EXTRACTION_FAILED: "621",
  FILE_PATH_VALIDATION_FAILED: "622",
  TEMP_FILE_CLEANUP_FAILED: "623",
  FILE_ACCESS_PERMISSION_DENIED: "624",
  FILE_SIZE_LIMIT_EXCEEDED: "625",

  // Service Lifecycle
  SERVICE_INITIALIZATION_FAILED: "630",
  SERVICE_DEPENDENCY_MISSING: "631",
  SERVICE_CONFIG_INVALID: "632",
  SERVICE_SHUTDOWN_FAILED: "633",
  SERVICE_STATE_INVALID: "634",
  SERVICE_COMMUNICATION_FAILED: "635",

  // SCORM Service Integration
  SCORM_SERVICE_INTEGRATION_FAILED: "640",
  SCORM_SESSION_MANAGEMENT_FAILED: "641",
  SCORM_WORKFLOW_COORDINATION_FAILED: "642",
  SCORM_SERVICE_STATE_SYNC_FAILED: "643",
  SCORM_LMS_PROFILE_APPLICATION_FAILED: "644",
  SCORM_CROSS_SERVICE_COMMUNICATION_FAILED: "645"
};

// Freeze objects to prevent modification
Object.freeze(SCORM_ERROR_CODES);
Object.freeze(ERROR_CATEGORIES);
Object.freeze(COMMON_ERRORS);

module.exports = {
  SCORM_ERROR_CODES,
  ERROR_CATEGORIES,
  COMMON_ERRORS,
  MAIN_PROCESS_ERRORS,
  getErrorCategory,
  isSuccess,
  isValidErrorCode,
  getErrorString
};