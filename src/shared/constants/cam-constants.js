/**
 * SCORM 2004 4th Edition Content Aggregation Model Constants
 * 
 * CAM-specific constants for manifest parsing, validation, and processing
 * according to SCORM 2004 4th Edition Content Aggregation Model specification.
 * 
 * @fileoverview CAM-specific constants and definitions
 */

/**
 * CAM Error Codes (extending SCORM error codes for CAM operations)
 */
const CAM_ERROR_CODES = {
  // Manifest parsing errors (300-349)
  MANIFEST_NOT_FOUND: '301',
  INVALID_MANIFEST_XML: '302',
  MISSING_REQUIRED_ELEMENT: '303',
  INVALID_NAMESPACE: '304',
  SCHEMA_VALIDATION_FAILED: '305',
  
  // Content validation errors (350-399)
  FILE_NOT_FOUND: '351',
  INVALID_RESOURCE_REFERENCE: '352',
  CIRCULAR_DEPENDENCY: '353',
  INVALID_SCORM_TYPE: '354',
  MISSING_LAUNCH_FILE: '355',
  
  // Metadata errors (400-449)
  INVALID_LOM_METADATA: '401',
  MISSING_METADATA_SCHEMA: '402',
  UNSUPPORTED_METADATA_VERSION: '403'
};

/**
 * XML Namespaces used in SCORM manifests
 */
const XML_NAMESPACES = {
  IMSCP: 'http://www.imsglobal.org/xsd/imscp_v1p1',
  ADLCP: 'http://www.adlnet.org/xsd/adlcp_v1p3',
  IMSSS: 'http://www.imsglobal.org/xsd/imsss',
  ADLSEQ: 'http://www.adlnet.org/xsd/adlseq_v1p3',
  ADLNAV: 'http://www.adlnet.org/xsd/adlnav_v1p3',
  LOM: 'http://ltsc.ieee.org/xsd/LOM',
  XML: 'http://www.w3.org/XML/1998/namespace',
  XSI: 'http://www.w3.org/2001/XMLSchema-instance'
};

/**
 * Required manifest elements for SCORM 2004 4th Edition
 */
const REQUIRED_MANIFEST_ELEMENTS = {
  ROOT: 'manifest',
  IDENTIFIER: 'identifier',
  VERSION: 'version',
  METADATA: 'metadata',
  ORGANIZATIONS: 'organizations',
  RESOURCES: 'resources'
};

/**
 * Valid SCORM content types
 */
const SCORM_CONTENT_TYPES = {
  SCO: 'sco',
  ASSET: 'asset'
};

/**
 * Valid resource types
 */
const RESOURCE_TYPES = {
  WEBCONTENT: 'webcontent',
  IMSQTI: 'imsqti_xmlv1p2'
};

/**
 * LOM metadata categories
 */
const LOM_CATEGORIES = {
  GENERAL: 'general',
  LIFECYCLE: 'lifecycle',
  META_METADATA: 'metaMetadata',
  TECHNICAL: 'technical',
  EDUCATIONAL: 'educational',
  RIGHTS: 'rights',
  RELATION: 'relation',
  ANNOTATION: 'annotation',
  CLASSIFICATION: 'classification'
};

/**
 * LOM vocabulary sources
 */
const LOM_VOCABULARIES = {
  INTERACTIVITY_TYPE: {
    ACTIVE: 'active',
    EXPOSITIVE: 'expositive',
    MIXED: 'mixed'
  },
  LEARNING_RESOURCE_TYPE: {
    EXERCISE: 'exercise',
    SIMULATION: 'simulation',
    QUESTIONNAIRE: 'questionnaire',
    DIAGRAM: 'diagram',
    FIGURE: 'figure',
    GRAPH: 'graph',
    INDEX: 'index',
    SLIDE: 'slide',
    TABLE: 'table',
    NARRATIVE_TEXT: 'narrative text',
    EXAM: 'exam',
    EXPERIMENT: 'experiment',
    PROBLEM_STATEMENT: 'problem statement',
    SELF_ASSESSMENT: 'self assessment',
    LECTURE: 'lecture'
  },
  INTERACTIVITY_LEVEL: {
    VERY_LOW: 'very low',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    VERY_HIGH: 'very high'
  },
  INTENDED_END_USER_ROLE: {
    TEACHER: 'teacher',
    AUTHOR: 'author',
    LEARNER: 'learner',
    MANAGER: 'manager'
  },
  CONTEXT: {
    SCHOOL: 'school',
    HIGHER_EDUCATION: 'higher education',
    TRAINING: 'training',
    OTHER: 'other'
  },
  DIFFICULTY: {
    VERY_EASY: 'very easy',
    EASY: 'easy',
    MEDIUM: 'medium',
    DIFFICULT: 'difficult',
    VERY_DIFFICULT: 'very difficult'
  }
};

/**
 * File extensions commonly found in SCORM packages
 */
const COMMON_FILE_EXTENSIONS = {
  HTML: ['.html', '.htm'],
  JAVASCRIPT: ['.js'],
  CSS: ['.css'],
  IMAGES: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp'],
  AUDIO: ['.mp3', '.wav', '.ogg', '.m4a'],
  VIDEO: ['.mp4', '.avi', '.mov', '.wmv', '.flv'],
  DOCUMENTS: ['.pdf', '.doc', '.docx', '.txt'],
  FLASH: ['.swf'],
  XML: ['.xml', '.xsd']
};

/**
 * Validation rules for manifest elements
 */
const VALIDATION_RULES = {
  IDENTIFIER: {
    REQUIRED: true,
    MAX_LENGTH: 4000,
    PATTERN: /^[a-zA-Z0-9_\-\.]+$/
  },
  VERSION: {
    REQUIRED: false,
    PATTERN: /^\d+\.\d+$/,
    DEFAULT: '1.0'
  },
  HREF: {
    REQUIRED_FOR_SCO: true,
    MAX_LENGTH: 4000
  },
  TITLE: {
    MAX_LENGTH: 1000
  }
};

/**
 * Package analysis thresholds
 */
const ANALYSIS_THRESHOLDS = {
  MAX_DEPTH: 10,
  MAX_ITEMS: 1000,
  MAX_RESOURCES: 500,
  COMPLEXITY_LEVELS: {
    SIMPLE: 50,
    MODERATE: 200,
    COMPLEX: 500,
    VERY_COMPLEX: 1000
  }
};

/**
 * Default values for manifest elements
 */
const DEFAULT_VALUES = {
  MANIFEST_VERSION: '1.0',
  ORGANIZATION_STRUCTURE: 'hierarchical',
  ITEM_VISIBILITY: true,
  RESOURCE_TYPE: 'webcontent'
};

// Freeze all constants to prevent modification
Object.freeze(CAM_ERROR_CODES);
Object.freeze(XML_NAMESPACES);
Object.freeze(REQUIRED_MANIFEST_ELEMENTS);
Object.freeze(SCORM_CONTENT_TYPES);
Object.freeze(RESOURCE_TYPES);
Object.freeze(LOM_CATEGORIES);
Object.freeze(LOM_VOCABULARIES);
Object.freeze(COMMON_FILE_EXTENSIONS);
Object.freeze(VALIDATION_RULES);
Object.freeze(ANALYSIS_THRESHOLDS);
Object.freeze(DEFAULT_VALUES);

module.exports = {
  CAM_ERROR_CODES,
  XML_NAMESPACES,
  REQUIRED_MANIFEST_ELEMENTS,
  SCORM_CONTENT_TYPES,
  RESOURCE_TYPES,
  LOM_CATEGORIES,
  LOM_VOCABULARIES,
  COMMON_FILE_EXTENSIONS,
  VALIDATION_RULES,
  ANALYSIS_THRESHOLDS,
  DEFAULT_VALUES
};