/**
 * SCORM 2004 4th Edition Sequencing and Navigation Constants
 * 
 * SN-specific constants for sequencing rule processing, navigation handling,
 * and activity tree management according to SCORM 2004 4th Edition
 * Sequencing and Navigation specification.
 * 
 * @fileoverview SN-specific constants and definitions
 */

/**
 * SN Error Codes (450-599 range, following CAM pattern)
 */
const SN_ERROR_CODES = {
  // Activity Tree errors (450-469)
  INVALID_ACTIVITY_TREE: '450',
  ACTIVITY_NOT_FOUND: '451',
  INVALID_ACTIVITY_STATE: '452',
  CIRCULAR_ACTIVITY_REFERENCE: '453',
  MAX_DEPTH_EXCEEDED: '454',
  
  // Sequencing Engine errors (470-489)
  INVALID_SEQUENCING_RULE: '470',
  RULE_CONDITION_FAILED: '471',
  INVALID_CONTROL_MODE: '472',
  SEQUENCING_VIOLATION: '473',
  LIMIT_CONDITION_EXCEEDED: '474',
  
  // Navigation Handler errors (490-509)
  INVALID_NAVIGATION_REQUEST: '490',
  NAVIGATION_NOT_ALLOWED: '491',
  NO_VALID_NAVIGATION: '492',
  CHOICE_NOT_AVAILABLE: '493',
  NAVIGATION_SEQUENCE_ERROR: '494',
  
  // Rollup Manager errors (510-529)
  ROLLUP_PROCESSING_FAILED: '510',
  INVALID_OBJECTIVE_MAP: '511',
  GLOBAL_OBJECTIVE_ERROR: '512',
  ROLLUP_RULE_VIOLATION: '513',
  MEASURE_CALCULATION_ERROR: '514',
  
  // General SN errors (530-549)
  SN_SERVICE_UNAVAILABLE: '530',
  INVALID_SN_CONFIGURATION: '531',
  SN_INTEGRATION_ERROR: '532'
};

/**
 * Activity States (SCORM SN Specification)
 */
const ACTIVITY_STATES = {
  INACTIVE: 'inactive',
  ACTIVE: 'active',
  SUSPENDED: 'suspended'
};

/**
 * Activity Attempt States
 */
const ATTEMPT_STATES = {
  NOT_ATTEMPTED: 'not_attempted',
  INCOMPLETE: 'incomplete', 
  COMPLETED: 'completed',
  UNKNOWN: 'unknown'
};

/**
 * Objective Progress States
 */
const OBJECTIVE_PROGRESS_STATES = {
  SATISFIED: 'satisfied',
  NOT_SATISFIED: 'not_satisfied',
  UNKNOWN: 'unknown'
};

/**
 * Sequencing Rule Conditions
 */
const RULE_CONDITIONS = {
  SATISFIED: 'satisfied',
  OBJECTIVE_STATUS_KNOWN: 'objectiveStatusKnown',
  OBJECTIVE_MEASURE_KNOWN: 'objectiveMeasureKnown',
  COMPLETED: 'completed',
  ACTIVITY_PROGRESS_KNOWN: 'activityProgressKnown',
  ATTEMPTED: 'attempted',
  ATTEMPT_LIMIT_EXCEEDED: 'attemptLimitExceeded',
  TIME_LIMIT_EXCEEDED: 'timeLimitExceeded',
  OUTSIDE_AVAILABLE_TIME_RANGE: 'outsideAvailableTimeRange',
  ALWAYS: 'always'
};

/**
 * Sequencing Rule Actions
 */
const RULE_ACTIONS = {
  SKIP: 'skip',
  DISABLED: 'disabled',
  HIDDEN_FROM_CHOICE: 'hiddenFromChoice',
  STOP_FORWARD_TRAVERSAL: 'stopForwardTraversal',
  EXIT_PARENT: 'exitParent',
  EXIT_ALL: 'exitAll',
  RETRY: 'retry',
  RETRY_ALL: 'retryAll',
  CONTINUE: 'continue',
  PREVIOUS: 'previous',
  EXIT: 'exit'
};

/**
 * Control Mode Settings
 */
const CONTROL_MODES = {
  CHOICE: 'choice',
  CHOICE_EXIT: 'choiceExit', 
  FLOW: 'flow',
  FORWARD_ONLY: 'forwardOnly'
};

/**
 * Navigation Request Types
 */
const NAVIGATION_REQUESTS = {
  START: 'start',
  RESUME_ALL: 'resumeAll',
  CONTINUE: 'continue',
  PREVIOUS: 'previous',
  CHOICE: 'choice',
  EXIT: 'exit',
  EXIT_ALL: 'exitAll',
  ABANDON: 'abandon',
  ABANDON_ALL: 'abandonAll',
  SUSPEND_ALL: 'suspendAll'
};

/**
 * Navigation Request Validity States
 */
const NAVIGATION_VALIDITY = {
  VALID: 'true',
  INVALID: 'false',
  UNKNOWN: 'unknown'
};

/**
 * Rollup Actions
 */
const ROLLUP_ACTIONS = {
  SATISFIED: 'satisfied',
  NOT_SATISFIED: 'notSatisfied',
  COMPLETED: 'completed',
  INCOMPLETE: 'incomplete'
};

/**
 * Delivery Control Settings
 */
const DELIVERY_CONTROLS = {
  TRACKED: 'tracked',
  COMPLETION_SET_BY_CONTENT: 'completionSetByContent',
  OBJECTIVE_SET_BY_CONTENT: 'objectiveSetByContent'
};

/**
 * Sequencing Session States
 */
const SEQUENCING_SESSION_STATES = {
  NOT_STARTED: 'not_started',
  ACTIVE: 'active',
  ENDED: 'ended'
};

/**
 * Default Values for SN Operations
 */
const SN_DEFAULTS = {
  MAX_ACTIVITY_DEPTH: 10,
  DEFAULT_ATTEMPT_LIMIT: 0, // 0 = unlimited
  DEFAULT_OBJECTIVE_WEIGHT: 1.0,
  ROLLUP_THRESHOLD: 0.5,
  NAVIGATION_TIMEOUT: 5000 // 5 seconds
};

// Freeze all constants to prevent modification
Object.freeze(SN_ERROR_CODES);
Object.freeze(ACTIVITY_STATES);
Object.freeze(ATTEMPT_STATES);
Object.freeze(OBJECTIVE_PROGRESS_STATES);
Object.freeze(RULE_CONDITIONS);
Object.freeze(RULE_ACTIONS);
Object.freeze(CONTROL_MODES);
Object.freeze(NAVIGATION_REQUESTS);
Object.freeze(NAVIGATION_VALIDITY);
Object.freeze(ROLLUP_ACTIONS);
Object.freeze(DELIVERY_CONTROLS);
Object.freeze(SEQUENCING_SESSION_STATES);
Object.freeze(SN_DEFAULTS);

module.exports = {
  SN_ERROR_CODES,
  ACTIVITY_STATES,
  ATTEMPT_STATES,
  OBJECTIVE_PROGRESS_STATES,
  RULE_CONDITIONS,
  RULE_ACTIONS,
  CONTROL_MODES,
  NAVIGATION_REQUESTS,
  NAVIGATION_VALIDITY,
  ROLLUP_ACTIONS,
  DELIVERY_CONTROLS,
  SEQUENCING_SESSION_STATES,
  SN_DEFAULTS
};