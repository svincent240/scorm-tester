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
 * Basic SCORM element patterns for quick validation
 */
const ELEMENT_PATTERNS = [
  /^cmi\.core\./,
  /^cmi\.suspend_data$/,
  /^cmi\.launch_data$/,
  /^cmi\.comments$/,
  /^cmi\.comments_from_lms$/,
  /^cmi\.interactions\.\d+\./,
  /^cmi\.objectives\.\d+\./,
  /^cmi\.student_data\./,
  /^cmi\.student_preference\./
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
  return matchesPattern || element.startsWith('cmi.');
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