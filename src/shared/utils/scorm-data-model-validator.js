/**
 * SCORM Data Model Validator Utility
 * 
 * Provides shared validation logic for SCORM data model elements,
 * ensuring consistency between main and renderer processes.
 * 
 * @fileoverview Shared SCORM data model validation utilities
 */

const { DATA_MODEL_SCHEMA, DATA_TYPES } = require('../constants/data-model-schema');
const SCORM_CONSTANTS = require('../constants/scorm-constants');

/**
 * Check if element name is valid based on DATA_MODEL_SCHEMA or collection patterns.
 * @param {string} element - Element name to validate
 * @returns {boolean} True if valid
 */
function isValidElement(element) {
  if (!element || typeof element !== 'string') {
    return false;
  }

  // Check if it's a defined schema element
  if (DATA_MODEL_SCHEMA[element]) {
    return true;
  }

  // Check if it's a collection element
  return isCollectionElement(element);
}

/**
 * Check if element is a collection element.
 * @param {string} element - Element name
 * @returns {boolean} True if collection element
 */
function isCollectionElement(element) {
  // Check interactions
  if (SCORM_CONSTANTS.REGEX.INTERACTION_ELEMENT.test(element)) {
    return true;
  }

  // Check objectives
  if (SCORM_CONSTANTS.REGEX.OBJECTIVE_ELEMENT.test(element)) {
    return true;
  }

  // Check comments from learner
  if (element.startsWith('cmi.comments_from_learner.') && element.includes('.')) {
    return true;
  }

  // Check comments from LMS
  if (element.startsWith('cmi.comments_from_lms.') && element.includes('.')) {
    return true;
  }

  return false;
}

/**
 * Validate value against element schema or basic collection rules.
 * @param {string} element - Element name
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid
 */
function isValidValue(element, value) {
  const schema = DATA_MODEL_SCHEMA[element];
  if (!schema) {
    // For collection elements, do basic validation
    return validateCollectionValue(element, value);
  }

  // Check vocabulary constraints
  if (schema.vocabulary && !schema.vocabulary.includes(value)) {
    return false;
  }

  // Check length constraints
  if (schema.maxLength && value.length > schema.maxLength) {
    return false;
  }

  // Check numeric range constraints
  if (schema.range && schema.type === DATA_TYPES.DECIMAL) {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < schema.range.min || numValue > schema.range.max) {
      return false;
    }
  }

  // Check data type format
  if (!validateDataType(schema.type, value)) {
    return false;
  }

  return true;
}

/**
 * Validate data type format.
 * @param {string} dataType - Expected data type
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid format
 */
function validateDataType(dataType, value) {
  switch (dataType) {
    case DATA_TYPES.INTEGER:
      return SCORM_CONSTANTS.REGEX.INTEGER.test(value);
    case DATA_TYPES.DECIMAL:
      return SCORM_CONSTANTS.REGEX.DECIMAL.test(value);
    case DATA_TYPES.TIME_INTERVAL:
      return SCORM_CONSTANTS.REGEX.TIME_INTERVAL.test(value);
    case DATA_TYPES.BOOLEAN:
      return ['true', 'false', 'unknown'].includes(value);
    case DATA_TYPES.STRING:
    case DATA_TYPES.VOCABULARY:
    default:
      return true; // Strings are always valid format-wise
  }
}

/**
 * Validate collection element value.
 * @param {string} element - Collection element name
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid
 */
function validateCollectionValue(element, value) {
  // Basic validation for collection elements
  // More specific validation could be added based on element type
  
  if (element.includes('.id')) {
    // IDs should not be empty and within length limits
    return value.length > 0 && value.length <= SCORM_CONSTANTS.DATA_MODEL.LIMITS.INTERACTION_ID;
  }
  
  if (element.includes('.type')) {
    // Interaction types must be from valid vocabulary
    return SCORM_CONSTANTS.DATA_MODEL.INTERACTION_TYPES.includes(value);
  }
  
  if (element.includes('.result')) {
    // Interaction results must be from valid vocabulary
    return SCORM_CONSTANTS.DATA_MODEL.INTERACTION_RESULTS.includes(value);
  }
  
  return true; // Default to valid for other collection elements
}

module.exports = {
  isValidElement,
  isValidValue
};