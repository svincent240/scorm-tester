// @ts-check

/**
 * SCORM Data Model Validator for Renderer Process
 *
 * Lightweight ES6 module that provides the same interface as the shared validator
 * but works in the renderer process. Real validation happens in the main process
 * via IPC calls, so this provides basic validation to avoid blocking the UI.
 *
 * @fileoverview Renderer-compatible SCORM validation
 */

/**
 * Basic SCORM 2004 4th Edition element patterns for quick validation
 */
const ELEMENT_PATTERNS = [
  // Core CMI elements
  /^cmi\._version$/,
  /^cmi\.comments_from_learner\./,
  /^cmi\.comments_from_lms\./,
  /^cmi\.completion_status$/,
  /^cmi\.completion_threshold$/,
  /^cmi\.credit$/,
  /^cmi\.entry$/,
  /^cmi\.exit$/,
  /^cmi\.interactions\./,
  /^cmi\.launch_data$/,
  /^cmi\.learner_id$/,
  /^cmi\.learner_name$/,
  /^cmi\.learner_preference\./,
  /^cmi\.location$/,
  /^cmi\.max_time_allowed$/,
  /^cmi\.mode$/,
  /^cmi\.objectives\./,
  /^cmi\.progress_measure$/,
  /^cmi\.scaled_passing_score$/,
  /^cmi\.score\./,
  /^cmi\.session_time$/,
  /^cmi\.success_status$/,
  /^cmi\.suspend_data$/,
  /^cmi\.time_limit_action$/,
  /^cmi\.total_time$/,

  // ADL Navigation elements
  /^adl\.nav\.request$/,
  /^adl\.nav\.request_valid\./,

  // ADL Data elements (optional)
  /^adl\.data\./
];

/**
 * Check if element name follows basic SCORM patterns
 * Real validation happens in main process, this is just a quick check
 * @param {string} element - Element name to validate
 * @returns {boolean} True if valid (permissive for renderer)
 */
function isValidElement(element) {
  if (!element || typeof element !== 'string') {
    return false;
  }

  // Check against basic patterns
  const matchesPattern = ELEMENT_PATTERNS.some(pattern => pattern.test(element));

  // Be permissive in renderer - let main process handle detailed validation
  // Accept cmi.* and adl.* elements
  return matchesPattern || element.startsWith('cmi.') || element.startsWith('adl.');
}

/**
 * Basic value validation for renderer process
 * Real validation happens in main process, this is just a quick check
 * @param {string} element - Element name
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid (permissive for renderer)
 */
function isValidValue(element, value) {
  if (typeof value !== 'string') {
    return false;
  }

  // Basic length check to prevent obviously invalid values
  if (value.length > 4096) {
    return false;
  }

  // Be permissive in renderer - let main process handle detailed validation
  return true;
}

export {
  isValidElement,
  isValidValue
};