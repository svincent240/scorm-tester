/**
 * SCORM 2004 4th Edition Error Codes
 * 
 * Complete implementation of SCORM error codes based on:
 * - SCORM 2004 4th Edition Run-Time Environment specification
 * - IEEE 1484.11.2 standard for error handling
 * 
 * Error code ranges:
 * - 0: Success
 * - 100-199: General errors
 * - 200-299: Initialization errors  
 * - 300-399: Termination errors
 * - 400-499: Data model errors
 * - 500-999: Reserved for future use
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
  411: "Data Model Dependency Not Established"
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
  if (code >= 400 && code <= 499) return ERROR_CATEGORIES.DATA_MODEL;
  if (code >= 500 && code <= 999) return ERROR_CATEGORIES.RESERVED;
  
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

// Freeze objects to prevent modification
Object.freeze(SCORM_ERROR_CODES);
Object.freeze(ERROR_CATEGORIES);
Object.freeze(COMMON_ERRORS);

module.exports = {
  SCORM_ERROR_CODES,
  ERROR_CATEGORIES,
  COMMON_ERRORS,
  getErrorCategory,
  isSuccess,
  isValidErrorCode,
  getErrorString
};