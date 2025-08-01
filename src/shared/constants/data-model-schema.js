/**
 * SCORM 2004 4th Edition Data Model Schema
 * 
 * Complete data model element definitions based on:
 * - SCORM 2004 4th Edition Run-Time Environment specification
 * - IEEE 1484.11.1 Data Model standard
 * 
 * Defines all valid SCORM data model elements with their:
 * - Access permissions (read-only, write-only, read-write)
 * - Data types and validation rules
 * - Default values and initialization requirements
 * - Collection handling (interactions, objectives, etc.)
 * 
 * @fileoverview SCORM 2004 4th Edition data model schema
 */

const SCORM_CONSTANTS = require('./scorm-constants');

/**
 * Data model element access types
 */
const ACCESS_TYPES = {
  READ_ONLY: 'r',
  WRITE_ONLY: 'w', 
  READ_WRITE: 'rw'
};

/**
 * Data model element data types
 */
const DATA_TYPES = {
  STRING: 'string',
  BOOLEAN: 'boolean',
  INTEGER: 'integer',
  DECIMAL: 'decimal',
  TIME_INTERVAL: 'timeinterval',
  VOCABULARY: 'vocabulary',
  COLLECTION: 'collection'
};

/**
 * Complete SCORM 2004 4th Edition Data Model Schema
 */
const DATA_MODEL_SCHEMA = {
  // Core CMI Elements
  'cmi._version': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: '1.0',
    description: 'Version of the data model'
  },

  'cmi.comments_from_learner._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'comment,location,timestamp',
    description: 'Children of comments_from_learner'
  },

  'cmi.comments_from_learner._count': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.INTEGER,
    defaultValue: '0',
    description: 'Count of comments from learner'
  },

  'cmi.comments_from_lms._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'comment,location,timestamp',
    description: 'Children of comments_from_lms'
  },

  'cmi.comments_from_lms._count': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.INTEGER,
    defaultValue: '0',
    description: 'Count of comments from LMS'
  },

  'cmi.completion_status': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.DATA_MODEL.COMPLETION_STATUS,
    defaultValue: 'unknown',
    description: 'Completion status of the SCO'
  },

  'cmi.completion_threshold': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.DECIMAL,
    defaultValue: null,
    description: 'Completion threshold for progress measure'
  },

  'cmi.credit': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.DATA_MODEL.CREDIT,
    defaultValue: 'credit',
    description: 'Credit mode for the attempt'
  },

  'cmi.entry': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.DATA_MODEL.ENTRY_STATUS,
    defaultValue: 'ab-initio',
    description: 'Entry mode for the attempt'
  },

  'cmi.exit': {
    access: ACCESS_TYPES.WRITE_ONLY,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.DATA_MODEL.EXIT_STATUS,
    defaultValue: '',
    description: 'Exit mode for the attempt'
  },

  'cmi.interactions._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description',
    description: 'Children of interactions'
  },

  'cmi.interactions._count': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.INTEGER,
    defaultValue: '0',
    description: 'Count of interactions'
  },

  'cmi.launch_data': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    maxLength: SCORM_CONSTANTS.DATA_MODEL.LIMITS.SUSPEND_DATA,
    defaultValue: '',
    description: 'Launch data from manifest'
  },

  'cmi.learner_id': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    maxLength: SCORM_CONSTANTS.DATA_MODEL.LIMITS.LONG_IDENTIFIER,
    defaultValue: '',
    description: 'Unique learner identifier'
  },

  'cmi.learner_name': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    maxLength: SCORM_CONSTANTS.DATA_MODEL.LIMITS.LONG_IDENTIFIER,
    defaultValue: '',
    description: 'Learner name'
  },

  'cmi.learner_preference._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'audio_level,language,delivery_speed,audio_captioning',
    description: 'Children of learner_preference'
  },

  'cmi.learner_preference.audio_level': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    range: { min: 0, max: 100 },
    defaultValue: null,
    description: 'Audio level preference'
  },

  'cmi.learner_preference.language': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.STRING,
    maxLength: 250,
    defaultValue: '',
    description: 'Language preference'
  },

  'cmi.learner_preference.delivery_speed': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    range: { min: 0, max: 100 },
    defaultValue: null,
    description: 'Delivery speed preference'
  },

  'cmi.learner_preference.audio_captioning': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.INTEGER,
    range: { min: -1, max: 1 },
    defaultValue: '0',
    description: 'Audio captioning preference'
  },

  'cmi.location': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.STRING,
    maxLength: 1000,
    defaultValue: '',
    description: 'Bookmark location in content'
  },

  'cmi.max_time_allowed': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.TIME_INTERVAL,
    defaultValue: null,
    description: 'Maximum time allowed for attempt'
  },

  'cmi.mode': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.DATA_MODEL.LESSON_MODE,
    defaultValue: 'normal',
    description: 'Mode of the attempt'
  },

  'cmi.objectives._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'id,score,success_status,completion_status,description',
    description: 'Children of objectives'
  },

  'cmi.objectives._count': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.INTEGER,
    defaultValue: '0',
    description: 'Count of objectives'
  },

  'cmi.progress_measure': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    range: { min: 0, max: 1 },
    defaultValue: null,
    description: 'Progress measure for completion'
  },

  'cmi.scaled_passing_score': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.DECIMAL,
    range: { min: -1, max: 1 },
    defaultValue: null,
    description: 'Scaled passing score threshold'
  },

  'cmi.score._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'scaled,raw,min,max',
    description: 'Children of score'
  },

  'cmi.score.scaled': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    range: { min: -1, max: 1 },
    defaultValue: null,
    description: 'Scaled score (-1 to 1)'
  },

  'cmi.score.raw': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    defaultValue: null,
    description: 'Raw score'
  },

  'cmi.score.min': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    defaultValue: null,
    description: 'Minimum possible raw score'
  },

  'cmi.score.max': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.DECIMAL,
    defaultValue: null,
    description: 'Maximum possible raw score'
  },

  'cmi.session_time': {
    access: ACCESS_TYPES.WRITE_ONLY,
    type: DATA_TYPES.TIME_INTERVAL,
    defaultValue: 'PT0H0M0S',
    description: 'Session time for current attempt'
  },

  'cmi.success_status': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.DATA_MODEL.SUCCESS_STATUS,
    defaultValue: 'unknown',
    description: 'Success status of the attempt'
  },

  'cmi.suspend_data': {
    access: ACCESS_TYPES.READ_WRITE,
    type: DATA_TYPES.STRING,
    maxLength: SCORM_CONSTANTS.DATA_MODEL.LIMITS.SUSPEND_DATA,
    defaultValue: '',
    description: 'Suspend data for resuming'
  },

  'cmi.time_limit_action': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: ['exit,message', 'exit,no message', 'continue,message', 'continue,no message'],
    defaultValue: 'continue,no message',
    description: 'Action when time limit exceeded'
  },

  'cmi.total_time': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.TIME_INTERVAL,
    defaultValue: 'PT0H0M0S',
    description: 'Total time across all attempts'
  },

  // ADL Navigation Elements
  'adl.nav.request': {
    access: ACCESS_TYPES.WRITE_ONLY,
    type: DATA_TYPES.VOCABULARY,
    vocabulary: SCORM_CONSTANTS.NAVIGATION.REQUESTS,
    defaultValue: '_none_',
    description: 'Navigation request'
  },

  'adl.nav.request_valid._children': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.STRING,
    defaultValue: 'continue,previous,choice,exit,exitAll,abandon,abandonAll,suspendAll',
    description: 'Children of request_valid'
  },

  'adl.nav.request_valid.continue': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'Continue request validity'
  },

  'adl.nav.request_valid.previous': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'Previous request validity'
  },

  'adl.nav.request_valid.choice': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'Choice request validity'
  },

  'adl.nav.request_valid.exit': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'Exit request validity'
  },

  'adl.nav.request_valid.exitAll': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'ExitAll request validity'
  },

  'adl.nav.request_valid.abandon': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'Abandon request validity'
  },

  'adl.nav.request_valid.abandonAll': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'AbandonAll request validity'
  },

  'adl.nav.request_valid.suspendAll': {
    access: ACCESS_TYPES.READ_ONLY,
    type: DATA_TYPES.BOOLEAN,
    defaultValue: 'unknown',
    description: 'SuspendAll request validity'
  }
};

// Freeze the schema to prevent modification
Object.freeze(DATA_MODEL_SCHEMA);
Object.freeze(ACCESS_TYPES);
Object.freeze(DATA_TYPES);

module.exports = {
  DATA_MODEL_SCHEMA,
  ACCESS_TYPES,
  DATA_TYPES
};