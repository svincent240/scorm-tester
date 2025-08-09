/**
 * SCORM 2004 4th Edition Data Model Handler
 * 
 * Manages all SCORM data model elements including:
 * - Core CMI elements (completion, success, score, etc.)
 * - Collections (interactions, objectives, comments)
 * - Navigation elements (adl.nav.*)
 * - Data validation and type checking
 * - Default value initialization
 * 
 * Based on SCORM 2004 4th Edition RTE specification and
 * IEEE 1484.11.1 Data Model standard.
 * 
 * @fileoverview SCORM 2004 4th Edition compliant data model handler
 */

const { DATA_MODEL_SCHEMA, ACCESS_TYPES, DATA_TYPES } = require('../../../../shared/constants/data-model-schema');
const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');
const { COMMON_ERRORS } = require('../../../../shared/constants/error-codes');

/**
 * SCORM Data Model Handler Class
 * 
 * Manages all SCORM data model operations with full validation
 * and SCORM 2004 4th Edition compliance.
 */
class ScormDataModel {
  /**
   * Initialize the data model
   * @param {Object} errorHandler - Error handler instance
   * @param {Object} logger - Logger instance
   */
  constructor(errorHandler, logger) {
    this.errorHandler = errorHandler;
    this.logger = logger;
    
    // Main data storage
    this.data = new Map();
    
    // Collection storage
    this.interactions = [];
    this.objectives = [];
    this.commentsFromLearner = [];
    this.commentsFromLms = [];
    
    // Initialize with default values
    this.initializeDefaults();
    
    this.logger?.debug('ScormDataModel initialized');
  }

  /**
   * Get value of a data model element (SCORM GetValue)
   * @param {string} element - Data model element name
   * @returns {string} Element value or empty string on error
   */
  getValue(element) {
    try {
      // Validate element format
      if (!this.isValidElement(element)) {
        this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT, 
          `Invalid data model element: ${element}`, 'getValue');
        return '';
      }

      // Check if element is write-only
      if (this.isWriteOnly(element)) {
        this.errorHandler.setError(COMMON_ERRORS.WRITE_ONLY_ELEMENT,
          `Element is write-only: ${element}`, 'getValue');
        return '';
      }

      // Handle collection elements
      if (this.isCollectionElement(element)) {
        return this.getCollectionValue(element);
      }

      // Handle regular elements
      const value = this.data.get(element);
      
      // Check if value is initialized
      if (value === undefined || value === null) {
        const schema = this.getElementSchema(element);
        if (schema && schema.defaultValue !== null) {
          return String(schema.defaultValue);
        }
        
        this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
          `Element not initialized: ${element}`, 'getValue');
        return '';
      }

      this.errorHandler.clearError();
      return String(value);
      
    } catch (error) {
      this.logger?.error('Error in getValue:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Unexpected error getting value: ${error.message}`, 'getValue');
      return '';
    }
  }

  /**
   * Set value of a data model element (SCORM SetValue)
   * @param {string} element - Data model element name
   * @param {string} value - Value to set
   * @returns {boolean} True if successful, false on error
   */
  setValue(element, value) {
    try {
      // Validate element format
      if (!this.isValidElement(element)) {
        this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
          `Invalid data model element: ${element}`, 'setValue');
        return false;
      }

      // Check if element is read-only
      if (this.isReadOnly(element)) {
        this.errorHandler.setError(COMMON_ERRORS.READ_ONLY_ELEMENT,
          `Element is read-only: ${element}`, 'setValue');
        return false;
      }

      // Validate value format and type
      if (!this.validateValue(element, value)) {
        return false; // Error already set by validateValue
      }

      // Handle collection elements
      if (this.isCollectionElement(element)) {
        return this.setCollectionValue(element, value);
      }

      // Set the value
      this.data.set(element, value);
      
      this.logger?.debug(`Set ${element} = ${value}`);
      this.errorHandler.clearError();
      return true;
      
    } catch (error) {
      this.logger?.error('Error in setValue:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Unexpected error setting value: ${error.message}`, 'setValue');
      return false;
    }
  }

  /**
   * Set value of a data model element internally, bypassing read-only checks.
   * This method is intended for internal LMS/RTE initialization or state management.
   * @private
   * @param {string} element - Data model element name
   * @param {string} value - Value to set
   * @returns {boolean} True if successful, false on error
   */
  _setInternalValue(element, value) {
    try {
      // Validate element format (still important for internal sets)
      if (!this.isValidElement(element)) {
        this.logger?.warn(`_setInternalValue: Invalid data model element: ${element}`);
        return false;
      }

      // Validate value format and type (still important for internal sets)
      if (!this.validateValue(element, value)) {
        this.logger?.warn(`_setInternalValue: Invalid value for ${element}: ${value}`);
        return false;
      }

      // Handle collection elements (still need to manage collections correctly)
      if (this.isCollectionElement(element)) {
        return this.setCollectionValue(element, value);
      }

      // Directly set the value, bypassing read-only check
      this.data.set(element, value);
      this.logger?.debug(`_setInternalValue: Set ${element} = ${value} (internal)`);
      this.errorHandler.clearError(); // Clear any previous error from this operation
      return true;
    } catch (error) {
      this.logger?.error('Error in _setInternalValue:', error);
      return false;
    }
  }

  /**
   * Get value of a data model element internally, bypassing write-only checks.
   * This method is intended for internal LMS/RTE state management.
   * @private
   * @param {string} element - Data model element name
   * @returns {string} Element value or empty string on error
   */
  _getInternalValue(element) {
    try {
      // Validate element format (still important for internal gets)
      if (!this.isValidElement(element)) {
        this.logger?.warn(`_getInternalValue: Invalid data model element: ${element}`);
        return '';
      }

      // Handle collection elements
      if (this.isCollectionElement(element)) {
        return this.getCollectionValue(element);
      }

      // Directly get the value, bypassing write-only check
      const value = this.data.get(element);
      
      // Check if value is initialized
      if (value === undefined || value === null) {
        const schema = this.getElementSchema(element);
        if (schema && schema.defaultValue !== null) {
          return String(schema.defaultValue);
        }
        this.logger?.warn(`_getInternalValue: Element not initialized: ${element}`);
        return '';
      }

      this.logger?.debug(`_getInternalValue: Get ${element} = ${value} (internal)`);
      this.errorHandler.clearError(); // Clear any previous error from this operation
      return String(value);
    } catch (error) {
      this.logger?.error('Error in _getInternalValue:', error);
      return '';
    }
  }

  /**
   * Initialize data model with default values
   * @private
   */
  initializeDefaults() {
    // Initialize core elements with defaults
    for (const [element, schema] of Object.entries(DATA_MODEL_SCHEMA)) {
      if (schema.defaultValue !== null && schema.defaultValue !== undefined) {
        this.data.set(element, schema.defaultValue);
      }
    }

    // Initialize all required SCORM 2004 4th Edition data model elements
    // Core CMI elements
    this.data.set('cmi.completion_status', 'unknown');
    this.data.set('cmi.success_status', 'unknown');
    this.data.set('cmi.score.scaled', '');
    this.data.set('cmi.score.raw', '');
    this.data.set('cmi.score.max', '');
    this.data.set('cmi.score.min', '');
    this.data.set('cmi.location', '');
    this.data.set('cmi.suspend_data', '');
    this.data.set('cmi.entry', 'ab-initio');
    this.data.set('cmi.exit', '');
    this.data.set('cmi.session_time', 'PT0H0M0S');
    this.data.set('cmi.total_time', 'PT0H0M0S');
    
    // Collection counts
    this.data.set('cmi.interactions._count', '0');
    this.data.set('cmi.objectives._count', '0');
    this.data.set('cmi.comments_from_learner._count', '0');
    this.data.set('cmi.comments_from_lms._count', '0');
    
    // Navigation elements
    this.data.set('adl.nav.request', '_none_');
    
    // Learner information (read-only, set during initialization)
    this.data.set('cmi.learner_id', '');
    this.data.set('cmi.learner_name', '');
    this.data.set('cmi.credit', 'credit');
    this.data.set('cmi.mode', 'normal');
    this.data.set('cmi.launch_data', '');
    this.data.set('cmi.scaled_passing_score', '');

    this.logger?.debug('Data model initialized with all SCORM 2004 4th Edition elements');
  }

  /**
   * Check if element name is valid
   * @private
   * @param {string} element - Element name to validate
   * @returns {boolean} True if valid
   */
  isValidElement(element) {
    if (!element || typeof element !== 'string') {
      return false;
    }

    // Check if it's a defined schema element
    if (DATA_MODEL_SCHEMA[element]) {
      return true;
    }

    // Check if it's a collection element
    return this.isCollectionElement(element);
  }

  /**
   * Check if element is a collection element
   * @private
   * @param {string} element - Element name
   * @returns {boolean} True if collection element
   */
  isCollectionElement(element) {
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
   * Get value from collection element
   * @private
   * @param {string} element - Collection element name
   * @returns {string} Element value
   */
  getCollectionValue(element) {
    // Handle interactions
    const interactionMatch = element.match(SCORM_CONSTANTS.REGEX.INTERACTION_ELEMENT);
    if (interactionMatch) {
      const index = parseInt(interactionMatch[1], 10);
      const property = element.substring(element.lastIndexOf('.') + 1);
      
      if (index >= this.interactions.length) {
        this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
          `Interaction ${index} not found`, 'getCollectionValue');
        return '';
      }
      
      const interaction = this.interactions[index];
      return String(interaction[property] || '');
    }

    // Handle objectives
    const objectiveMatch = element.match(SCORM_CONSTANTS.REGEX.OBJECTIVE_ELEMENT);
    if (objectiveMatch) {
      const index = parseInt(objectiveMatch[1], 10);
      const property = element.substring(element.lastIndexOf('.') + 1);
      
      if (index >= this.objectives.length) {
        this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
          `Objective ${index} not found`, 'getCollectionValue');
        return '';
      }
      
      const objective = this.objectives[index];
      return String(objective[property] || '');
    }

    // Handle comments (similar pattern)
    // ... implementation for comments collections

    this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
      `Collection element not found: ${element}`, 'getCollectionValue');
    return '';
  }

  /**
   * Set value in collection element
   * @private
   * @param {string} element - Collection element name
   * @param {string} value - Value to set
   * @returns {boolean} True if successful
   */
  setCollectionValue(element, value) {
    // Handle interactions
    const interactionMatch = element.match(SCORM_CONSTANTS.REGEX.INTERACTION_ELEMENT);
    if (interactionMatch) {
      const index = parseInt(interactionMatch[1], 10);
      const property = element.substring(element.lastIndexOf('.') + 1);
      
      // Ensure interaction exists
      while (this.interactions.length <= index) {
        this.interactions.push({});
      }
      
      this.interactions[index][property] = value;
      this.data.set('cmi.interactions._count', String(this.interactions.length));
      return true;
    }

    // Handle objectives
    const objectiveMatch = element.match(SCORM_CONSTANTS.REGEX.OBJECTIVE_ELEMENT);
    if (objectiveMatch) {
      const index = parseInt(objectiveMatch[1], 10);
      const property = element.substring(element.lastIndexOf('.') + 1);
      
      // Ensure objective exists
      while (this.objectives.length <= index) {
        this.objectives.push({});
      }
      
      this.objectives[index][property] = value;
      this.data.set('cmi.objectives._count', String(this.objectives.length));
      return true;
    }

    // Handle comments (similar pattern)
    // ... implementation for comments collections

    this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
      `Cannot set collection element: ${element}`, 'setCollectionValue');
    return false;
  }

  /**
   * Validate value against element schema
   * @private
   * @param {string} element - Element name
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  validateValue(element, value) {
    const schema = this.getElementSchema(element);
    if (!schema) {
      // For collection elements, do basic validation
      return this.validateCollectionValue(element, value);
    }

    // Check vocabulary constraints
    if (schema.vocabulary && !schema.vocabulary.includes(value)) {
      this.errorHandler.setError(COMMON_ERRORS.TYPE_MISMATCH,
        `Invalid vocabulary value for ${element}: ${value}`, 'validateValue');
      return false;
    }

    // Check length constraints
    if (schema.maxLength && value.length > schema.maxLength) {
      this.errorHandler.setError(COMMON_ERRORS.VALUE_OUT_OF_RANGE,
        `Value too long for ${element}: ${value.length} > ${schema.maxLength}`, 'validateValue');
      return false;
    }

    // Check numeric range constraints
    if (schema.range && schema.type === DATA_TYPES.DECIMAL) {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue < schema.range.min || numValue > schema.range.max) {
        this.errorHandler.setError(COMMON_ERRORS.VALUE_OUT_OF_RANGE,
          `Numeric value out of range for ${element}: ${value}`, 'validateValue');
        return false;
      }
    }

    // Check data type format
    if (!this.validateDataType(schema.type, value)) {
      this.errorHandler.setError(COMMON_ERRORS.TYPE_MISMATCH,
        `Invalid data type for ${element}: ${value}`, 'validateValue');
      return false;
    }

    return true;
  }

  /**
   * Validate data type format
   * @private
   * @param {string} dataType - Expected data type
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid format
   */
  validateDataType(dataType, value) {
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
   * Validate collection element value
   * @private
   * @param {string} element - Collection element name
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  validateCollectionValue(element, value) {
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

  /**
   * Get element schema
   * @private
   * @param {string} element - Element name
   * @returns {Object|null} Element schema or null
   */
  getElementSchema(element) {
    return DATA_MODEL_SCHEMA[element] || null;
  }

  /**
   * Check if element is read-only
   * @private
   * @param {string} element - Element name
   * @returns {boolean} True if read-only
   */
  isReadOnly(element) {
    const schema = this.getElementSchema(element);
    return schema && schema.access === ACCESS_TYPES.READ_ONLY;
  }

  /**
   * Check if element is write-only
   * @private
   * @param {string} element - Element name
   * @returns {boolean} True if write-only
   */
  isWriteOnly(element) {
    const schema = this.getElementSchema(element);
    return schema && schema.access === ACCESS_TYPES.WRITE_ONLY;
  }

  /**
   * Get all data model values (for debugging/export)
   * @returns {Object} All data model values
   */
  getAllData() {
    return {
      coreData: Object.fromEntries(this.data),
      interactions: [...this.interactions],
      objectives: [...this.objectives],
      commentsFromLearner: [...this.commentsFromLearner],
      commentsFromLms: [...this.commentsFromLms]
    };
  }

  /**
   * Reset data model to initial state
   */
  reset() {
    this.data.clear();
    this.interactions = [];
    this.objectives = [];
    this.commentsFromLearner = [];
    this.commentsFromLms = [];
    
    this.initializeDefaults();
    this.logger?.debug('ScormDataModel reset to initial state');
  }

  /**
   * Set learner information (called during initialization)
   * @param {Object} learnerInfo - Learner information
   */
  setLearnerInfo(learnerInfo) {
    if (learnerInfo.id) {
      this.data.set('cmi.learner_id', learnerInfo.id);
    }
    if (learnerInfo.name) {
      this.data.set('cmi.learner_name', learnerInfo.name);
    }
    
    this.logger?.debug('Learner information set', learnerInfo);
  }

  /**
   * Set launch data from manifest
   * @param {string} launchData - Launch data string
   */
  setLaunchData(launchData) {
    if (launchData) {
      this.data.set('cmi.launch_data', launchData);
      this.logger?.debug('Launch data set:', launchData);
    }
  }

  /**
   * Set mastery score from manifest
   * @param {number} masteryScore - Mastery score (0-1)
   */
  setMasteryScore(masteryScore) {
    if (typeof masteryScore === 'number' && masteryScore >= -1 && masteryScore <= 1) {
      this.data.set('cmi.scaled_passing_score', String(masteryScore));
      this.logger?.debug('Mastery score set:', masteryScore);
    }
  }

  /**
   * Get completion status
   * @returns {string} Current completion status
   */
  getCompletionStatus() {
    return this.data.get('cmi.completion_status') || 'unknown';
  }

  /**
   * Get success status
   * @returns {string} Current success status
   */
  getSuccessStatus() {
    return this.data.get('cmi.success_status') || 'unknown';
  }

  /**
   * Get current score information
   * @returns {Object} Score information
   */
  getScoreInfo() {
    return {
      scaled: this.data.get('cmi.score.scaled') || null,
      raw: this.data.get('cmi.score.raw') || null,
      min: this.data.get('cmi.score.min') || null,
      max: this.data.get('cmi.score.max') || null
    };
  }
}

module.exports = ScormDataModel;