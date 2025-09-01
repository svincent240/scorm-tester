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
   * @param {Object} options - Configuration options
   * @param {string} options.launchMode - Launch mode ('normal', 'browse', 'review')
   * @param {boolean} options.memoryOnlyStorage - Use memory-only storage (for browse mode)
   */
  constructor(errorHandler, logger, options = {}) {
    this.errorHandler = errorHandler;
    this.logger = logger;

    // Browse mode configuration
    this.launchMode = options.launchMode || 'normal';
    this.memoryOnlyStorage = options.memoryOnlyStorage || false;
    this.browseSession = null;

    // Main data storage
    this.data = new Map();

    // Collection storage
    this.interactions = [];
    this.objectives = [];
    this.commentsFromLearner = [];
    this.commentsFromLms = [];

    // Initialize with default values
    this.initializeDefaults();

    this.logger?.debug('ScormDataModel initialized', {
      launchMode: this.launchMode,
      memoryOnlyStorage: this.memoryOnlyStorage
    });
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

        // For elements with null default values, return empty string (SCORM standard)
        if (schema && schema.defaultValue === null) {
          this.errorHandler.clearError();
          return '';
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

      // Log browse mode operation if in browse mode
      if (this.isBrowseMode()) {
        this.logBrowseOperation('setValue', { element, value });
      }

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

        // For elements with null default values, return empty string (SCORM standard)
        if (schema && schema.defaultValue === null) {
          return '';
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
    this.data.set('cmi.score.scaled', null);
    this.data.set('cmi.score.raw', null);
    this.data.set('cmi.score.max', null);
    this.data.set('cmi.score.min', null);
    this.data.set('cmi.progress_measure', null);
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
    this.data.set('cmi.mode', this.launchMode); // Dynamic launch mode
    this.data.set('cmi.launch_data', '');
    this.data.set('cmi.scaled_passing_score', '');

    this.logger?.debug('Data model initialized with all SCORM 2004 4th Edition elements', {
      launchMode: this.launchMode
    });
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
    // Check interactions (including count elements)
    if (element.startsWith('cmi.interactions.')) {
      return true;
    }

    // Check objectives (including count elements)
    if (element.startsWith('cmi.objectives.')) {
      return true;
    }

    // Check comments from learner
    if (element.startsWith('cmi.comments_from_learner.')) {
      return true;
    }

    // Check comments from LMS
    if (element.startsWith('cmi.comments_from_lms.')) {
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
    if (element.startsWith('cmi.interactions.')) {
      // Handle count element
      if (element === 'cmi.interactions._count') {
        return String(this.interactions.length);
      }

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

      // Handle malformed interaction elements (e.g., "cmi.interactions.")
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid interaction element format: ${element}`, 'getCollectionValue');
      return '';
    }

    // Handle objectives
    if (element.startsWith('cmi.objectives.')) {
      // Handle count element
      if (element === 'cmi.objectives._count') {
        return String(this.objectives.length);
      }

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

      // Handle malformed objective elements (e.g., "cmi.objectives.")
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid objective element format: ${element}`, 'getCollectionValue');
      return '';
    }

    // Handle comments from learner
    if (element.startsWith('cmi.comments_from_learner.')) {
      // Handle count element
      if (element === 'cmi.comments_from_learner._count') {
        return String(this.commentsFromLearner.length);
      }

      const match = element.match(/^cmi\.comments_from_learner\.(\d+)\.(.+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const property = match[2];

        if (index >= this.commentsFromLearner.length) {
          this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
            `Comment from learner ${index} not found`, 'getCollectionValue');
          return '';
        }

        const comment = this.commentsFromLearner[index];
        return String(comment[property] || '');
      }

      // Handle malformed comment elements
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid comment from learner element format: ${element}`, 'getCollectionValue');
      return '';
    }

    // Handle comments from LMS
    if (element.startsWith('cmi.comments_from_lms.')) {
      // Handle count element
      if (element === 'cmi.comments_from_lms._count') {
        return String(this.commentsFromLms.length);
      }

      const match = element.match(/^cmi\.comments_from_lms\.(\d+)\.(.+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const property = match[2];

        if (index >= this.commentsFromLms.length) {
          this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
            `Comment from LMS ${index} not found`, 'getCollectionValue');
          return '';
        }

        const comment = this.commentsFromLms[index];
        return String(comment[property] || '');
      }

      // Handle malformed comment elements
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid comment from LMS element format: ${element}`, 'getCollectionValue');
      return '';
    }

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
    if (element.startsWith('cmi.interactions.')) {
      // Handle count element (read-only, cannot be set)
      if (element === 'cmi.interactions._count') {
        this.errorHandler.setError(COMMON_ERRORS.READ_ONLY_ELEMENT,
          `Cannot set read-only element: ${element}`, 'setCollectionValue');
        return false;
      }

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

      // Handle malformed interaction elements
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid interaction element format: ${element}`, 'setCollectionValue');
      return false;
    }

    // Handle objectives
    if (element.startsWith('cmi.objectives.')) {
      // Handle count element (read-only, cannot be set)
      if (element === 'cmi.objectives._count') {
        this.errorHandler.setError(COMMON_ERRORS.READ_ONLY_ELEMENT,
          `Cannot set read-only element: ${element}`, 'setCollectionValue');
        return false;
      }

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

      // Handle malformed objective elements
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid objective element format: ${element}`, 'setCollectionValue');
      return false;
    }

    // Handle comments from learner
    if (element.startsWith('cmi.comments_from_learner.')) {
      // Handle count element (read-only, cannot be set)
      if (element === 'cmi.comments_from_learner._count') {
        this.errorHandler.setError(COMMON_ERRORS.READ_ONLY_ELEMENT,
          `Cannot set read-only element: ${element}`, 'setCollectionValue');
        return false;
      }

      const match = element.match(/^cmi\.comments_from_learner\.(\d+)\.(.+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const property = match[2];

        // Ensure comment exists
        while (this.commentsFromLearner.length <= index) {
          this.commentsFromLearner.push({});
        }

        this.commentsFromLearner[index][property] = value;
        this.data.set('cmi.comments_from_learner._count', String(this.commentsFromLearner.length));
        return true;
      }

      // Handle malformed comment elements
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid comment from learner element format: ${element}`, 'setCollectionValue');
      return false;
    }

    // Handle comments from LMS
    if (element.startsWith('cmi.comments_from_lms.')) {
      // Handle count element (read-only, cannot be set)
      if (element === 'cmi.comments_from_lms._count') {
        this.errorHandler.setError(COMMON_ERRORS.READ_ONLY_ELEMENT,
          `Cannot set read-only element: ${element}`, 'setCollectionValue');
        return false;
      }

      const match = element.match(/^cmi\.comments_from_lms\.(\d+)\.(.+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const property = match[2];

        // Ensure comment exists
        while (this.commentsFromLms.length <= index) {
          this.commentsFromLms.push({});
        }

        this.commentsFromLms[index][property] = value;
        this.data.set('cmi.comments_from_lms._count', String(this.commentsFromLms.length));
        return true;
      }

      // Handle malformed comment elements
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid comment from LMS element format: ${element}`, 'setCollectionValue');
      return false;
    }

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
    // Handle count elements (read-only, cannot be validated for setting)
    if (element.endsWith('._count')) {
      this.errorHandler.setError(COMMON_ERRORS.READ_ONLY_ELEMENT,
        `Cannot validate read-only count element: ${element}`, 'validateCollectionValue');
      return false;
    }

    // Handle malformed collection elements
    if (element.endsWith('.') || !element.includes('.')) {
      this.errorHandler.setError(COMMON_ERRORS.UNDEFINED_ELEMENT,
        `Invalid collection element format: ${element}`, 'validateCollectionValue');
      return false;
    }

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
   * Get objectives data for event emission
   * @returns {Array} Array of objectives data
   */
  getObjectivesData() {
    return [...this.objectives];
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

  // ===== BROWSE MODE METHODS =====

  /**
   * Set launch mode (SCORM-compliant)
   * @param {string} mode - Launch mode ('normal', 'browse', 'review')
   */
  setLaunchMode(mode) {
    const validModes = ['normal', 'browse', 'review'];
    if (validModes.includes(mode)) {
      this.launchMode = mode;
      this.data.set('cmi.mode', mode);
      this.logger?.debug('Launch mode set to:', mode);
    } else {
      this.logger?.warn('Invalid launch mode:', mode);
    }
  }

  /**
   * Get current launch mode
   * @returns {string} Current launch mode
   */
  getLaunchMode() {
    return this.launchMode;
  }

  /**
   * Check if currently in browse mode
   * @returns {boolean} True if in browse mode
   */
  isBrowseMode() {
    return this.launchMode === 'browse';
  }

  /**
   * Create browse mode session data container
   * @param {Object} options - Session options
   * @param {number} options.timeoutMs - Session timeout in milliseconds (default: 30 minutes)
   * @returns {Object} Browse session data
   */
  createBrowseSessionData(options = {}) {
    if (this.isBrowseMode()) {
      const timeoutMs = options.timeoutMs || (30 * 60 * 1000); // 30 minutes default

      this.browseSession = {
        id: `browse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        startTime: new Date(),
        lastActivity: new Date(),
        launchMode: 'browse',
        temporaryData: new Map(),
        isolated: true,
        timeoutMs: timeoutMs,
        timeoutHandle: null,
        operations: []
      };

      // Set up session timeout
      this.setupSessionTimeout();

      this.logger?.debug('Browse session created:', {
        id: this.browseSession.id,
        timeoutMs: timeoutMs
      });

      return this.browseSession;
    }
    return null;
  }

  /**
   * Setup session timeout for browse mode
   * @private
   */
  setupSessionTimeout() {
    if (!this.browseSession) return;

    // Clear existing timeout
    if (this.browseSession.timeoutHandle) {
      clearTimeout(this.browseSession.timeoutHandle);
    }

    // Set new timeout
    this.browseSession.timeoutHandle = setTimeout(() => {
      this.logger?.info('Browse session timed out:', this.browseSession.id);
      this.destroyBrowseSessionData();
    }, this.browseSession.timeoutMs);
  }

  /**
   * Update browse session activity (resets timeout)
   */
  updateBrowseSessionActivity() {
    if (this.browseSession) {
      this.browseSession.lastActivity = new Date();
      this.setupSessionTimeout(); // Reset timeout
    }
  }

  /**
   * Log browse mode operation
   * @param {string} operation - Operation name
   * @param {Object} details - Operation details
   */
  logBrowseOperation(operation, details = {}) {
    if (this.browseSession) {
      this.browseSession.operations.push({
        operation,
        timestamp: new Date(),
        details
      });
      this.updateBrowseSessionActivity();
    }
  }

  /**
   * Destroy browse mode session data
   */
  destroyBrowseSessionData() {
    if (this.browseSession) {
      this.logger?.debug('Destroying browse session:', {
        id: this.browseSession.id,
        duration: Date.now() - this.browseSession.startTime.getTime(),
        operations: this.browseSession.operations.length
      });

      // Clear timeout
      if (this.browseSession.timeoutHandle) {
        clearTimeout(this.browseSession.timeoutHandle);
      }

      // Clear temporary data
      this.browseSession.temporaryData.clear();

      // Reset to normal mode
      this.browseSession = null;
    }
  }

  /**
   * Get browse session status
   * @returns {Object|null} Session status or null if not in browse mode
   */
  getBrowseSessionStatus() {
    if (!this.browseSession) return null;

    const now = new Date();
    const duration = now.getTime() - this.browseSession.startTime.getTime();
    const timeSinceActivity = now.getTime() - this.browseSession.lastActivity.getTime();

    return {
      id: this.browseSession.id,
      startTime: this.browseSession.startTime,
      lastActivity: this.browseSession.lastActivity,
      duration: duration,
      timeSinceActivity: timeSinceActivity,
      timeoutMs: this.browseSession.timeoutMs,
      operationsCount: this.browseSession.operations.length,
      temporaryDataSize: this.browseSession.temporaryData.size,
      active: timeSinceActivity < this.browseSession.timeoutMs
    };
  }

  /**
   * Check if data should be persisted (false for browse mode)
   * @returns {boolean} True if data should be persisted
   */
  shouldPersistData() {
    return !this.memoryOnlyStorage && !this.isBrowseMode();
  }
}

module.exports = ScormDataModel;