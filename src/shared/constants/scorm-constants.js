/**
 * SCORM 2004 4th Edition Constants
 * 
 * Complete implementation of SCORM constants based on:
 * - SCORM 2004 4th Edition Run-Time Environment specification
 * - Content Aggregation Model specification  
 * - Sequencing and Navigation specification
 * 
 * @fileoverview SCORM 2004 4th Edition compliant constants
 */

const SCORM_CONSTANTS = {
  // SCORM Version Information
  VERSION: {
    SCORM: '2004 4th Edition',
    API: '1.0'
  },

  // Session States (RTE Specification)
  SESSION_STATES: {
    NOT_INITIALIZED: 'not_initialized',
    RUNNING: 'running', 
    TERMINATED: 'terminated'
  },

  // Data Model Elements (Complete SCORM 2004 4th Ed Data Model)
  DATA_MODEL: {
    // Core CMI Elements
    COMPLETION_STATUS: ['completed', 'incomplete', 'not attempted', 'unknown'],
    SUCCESS_STATUS: ['passed', 'failed', 'unknown'],
    EXIT_STATUS: ['time-out', 'suspend', 'logout', 'normal', ''],
    ENTRY_STATUS: ['ab-initio', 'resume', ''],
    LESSON_MODE: ['normal', 'browse', 'review'],
    CREDIT: ['credit', 'no-credit'],
    
    // Interaction Types (for cmi.interactions.n.type)
    INTERACTION_TYPES: [
      'true-false', 'choice', 'fill-in', 'long-fill-in', 
      'matching', 'performance', 'sequencing', 'likert', 
      'numeric', 'other'
    ],
    
    // Interaction Results (for cmi.interactions.n.result)
    INTERACTION_RESULTS: [
      'correct', 'incorrect', 'unanticipated', 'neutral'
    ],

    // Time Interval Format (ISO 8601 Duration)
    TIME_FORMAT: 'PT[H]H[M]M[S]S',
    
    // String Length Limits (SPM - Smallest Permitted Maximum)
    LIMITS: {
      SHORT_IDENTIFIER: 4000,
      LONG_IDENTIFIER: 4000,
      FEEDBACK: 1024,
      REAL: 7,
      SUSPEND_DATA: 64000,
      COMMENTS: 4000,
      INTERACTION_ID: 4000,
      LEARNER_RESPONSE: 4000,
      CORRECT_RESPONSE: 4000
    }
  },

  // Navigation Elements (SCORM 2004 Navigation Data Model)
  NAVIGATION: {
    // Navigation Requests (adl.nav.request values)
    REQUESTS: [
      'continue', 'previous', 'exit', 'exitAll', 'abandon', 
      'abandonAll', 'suspendAll', 'start', 'resumeAll'
    ],
    
    // Navigation Request Valid Elements
    REQUEST_VALID: [
      'continue', 'previous', 'choice', 'exit', 'exitAll',
      'abandon', 'abandonAll', 'suspendAll'
    ],
    
    // Control Modes (Sequencing Control Modes)
    CONTROL_MODES: {
      CHOICE: 'choice',
      CHOICE_EXIT: 'choiceExit',
      FLOW: 'flow', 
      FORWARD_ONLY: 'forwardOnly'
    },
    
    // Sequencing Rule Actions
    RULE_ACTIONS: {
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
    }
  },

  // Content Aggregation Model Constants
  CAM: {
    // Manifest Elements
    MANIFEST_ELEMENTS: {
      MANIFEST: 'manifest',
      METADATA: 'metadata', 
      ORGANIZATIONS: 'organizations',
      ORGANIZATION: 'organization',
      ITEM: 'item',
      RESOURCES: 'resources',
      RESOURCE: 'resource',
      FILE: 'file'
    },
    
    // SCORM Types (adlcp:scormType values)
    SCORM_TYPES: {
      SCO: 'sco',
      ASSET: 'asset'
    },
    
    // Application Profiles
    PROFILES: {
      CONTENT_AGGREGATION: 'content_aggregation',
      RESOURCE_PACKAGE: 'resource_package'
    }
  },

  // Sequencing and Navigation Constants
  SN: {
    // Activity States
    ACTIVITY_STATES: {
      INACTIVE: 'inactive',
      ACTIVE: 'active', 
      SUSPENDED: 'suspended'
    },
    
    // Attempt States
    ATTEMPT_STATES: {
      NOT_ATTEMPTED: 'not_attempted',
      INCOMPLETE: 'incomplete',
      COMPLETED: 'completed',
      UNKNOWN: 'unknown'
    },
    
    // Objective States
    OBJECTIVE_STATES: {
      SATISFIED: 'satisfied',
      NOT_SATISFIED: 'not_satisfied',
      UNKNOWN: 'unknown'
    },
    
    // Rollup Actions
    ROLLUP_ACTIONS: {
      SATISFIED: 'satisfied',
      NOT_SATISFIED: 'notSatisfied',
      COMPLETED: 'completed',
      INCOMPLETE: 'incomplete'
    }
  },

  // LMS Profile Support (from archived implementation)
  LMS_PROFILES: {
    GENERIC: 'generic',
    LITMOS: 'litmos',
    MOODLE: 'moodle', 
    SCORM_CLOUD: 'scorm_cloud'
  },

  // API Function Names (for validation)
  API_FUNCTIONS: [
    'Initialize', 'Terminate', 'GetValue', 'SetValue',
    'Commit', 'GetLastError', 'GetErrorString', 'GetDiagnostic'
  ],

  // Regular Expressions for Validation
  REGEX: {
    // Data Model Element Pattern
    DATA_MODEL_ELEMENT: /^(cmi|adl)\./,
    
    // Interaction Element Pattern  
    INTERACTION_ELEMENT: /^cmi\.interactions\.(\d+)\./,
    
    // Objective Element Pattern
    OBJECTIVE_ELEMENT: /^cmi\.objectives\.(\d+)\./,
    
    // Time Interval Pattern (ISO 8601)
    TIME_INTERVAL: /^PT(\d+H)?(\d+M)?(\d+(\.\d+)?S)?$/,
    
    // Decimal Pattern
    DECIMAL: /^-?\d+(\.\d+)?$/,
    
    // Integer Pattern
    INTEGER: /^-?\d+$/
  }
};

// Freeze the constants to prevent modification
Object.freeze(SCORM_CONSTANTS);
Object.freeze(SCORM_CONSTANTS.SESSION_STATES);
Object.freeze(SCORM_CONSTANTS.DATA_MODEL);
Object.freeze(SCORM_CONSTANTS.NAVIGATION);
Object.freeze(SCORM_CONSTANTS.CAM);
Object.freeze(SCORM_CONSTANTS.SN);
Object.freeze(SCORM_CONSTANTS.API_FUNCTIONS);
Object.freeze(SCORM_CONSTANTS.REGEX);

module.exports = SCORM_CONSTANTS;