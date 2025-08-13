# SCORM Engine Module Documentation

## Overview

The SCORM Engine is the core module responsible for implementing SCORM 2004 4th Edition compliance across all three specification books: Content Aggregation Model (CAM), Run-Time Environment (RTE), and Sequencing and Navigation (SN).

## Architecture

```
SCORM Engine
├── CAM (Content Aggregation Model)
│   ├── ManifestParser - Parse and validate imsmanifest.xml
│   ├── ContentValidator - Validate SCORM package compliance
│   └── MetadataHandler - Process LOM metadata
├── RTE (Run-Time Environment)
│   ├── ApiHandler - Implement 8 SCORM API functions
│   ├── DataModel - Manage all cmi.* data elements
│   ├── SessionManager - Handle session lifecycle
│   └── ErrorHandler - SCORM error code management
└── SN (Sequencing and Navigation)
    ├── ActivityTree - Manage course structure at runtime
    ├── SequencingEngine - Process sequencing rules
    ├── NavigationHandler - Handle navigation requests
    └── RollupManager - Aggregate child activity results
```

## Content Aggregation Model (CAM)

### ManifestParser (`src/main/services/scorm/cam/manifest-parser.js`)

**Purpose**: Parse and validate SCORM manifest files (imsmanifest.xml)

#### Key Responsibilities
- XML parsing and schema validation
- Organization structure extraction
- Resource definition processing
- Sequencing definition parsing
- Application profile validation

#### API Interface
```javascript
class ManifestParser {
  /**
   * Parse SCORM manifest file
   * @param {string} manifestPath - Path to imsmanifest.xml
   * @returns {Promise<ScormManifest>} Parsed manifest object
   */
  async parseManifest(manifestPath)
  
  /**
   * Validate manifest against SCORM schema
   * @param {Document} manifestXml - XML document
   * @returns {ValidationResult} Validation results
   */
  validateSchema(manifestXml)
  
  /**
   * Extract organizations from manifest
   * @param {Document} manifest - Parsed XML document
   * @returns {Organization[]} Array of organizations
   */
  extractOrganizations(manifest)
  
  /**
   * Extract resources from manifest
   * @param {Document} manifest - Parsed XML document
   * @returns {Resource[]} Array of resources
   */
  extractResources(manifest)
}
```

#### Data Structures
```javascript
interface ScormManifest {
  identifier: string;
  version?: string;
  metadata: Metadata;
  organizations: Organization[];
  resources: Resource[];
  sequencingCollection?: SequencingCollection;
  packageType: 'content_aggregation' | 'resource';
}

interface Organization {
  identifier: string;
  title: string;
  items: Item[];
  sequencing?: SequencingDefinition;
}

interface Item {
  identifier: string;
  identifierref?: string;
  title: string;
  isvisible?: boolean;
  parameters?: string;
  children: Item[];
  sequencing?: SequencingDefinition;
  metadata?: Metadata;
}
```

### ContentValidator (`src/main/services/scorm/cam/content-validator.js`)

**Purpose**: Validate SCORM packages for compliance and integrity

#### Key Responsibilities
- Package structure validation
- File integrity checking
- SCORM application profile compliance
- Metadata validation
- Sequencing rule validation

#### API Interface
```javascript
class ContentValidator {
  /**
   * Validate complete SCORM package
   * @param {string} packagePath - Path to extracted package
   * @returns {Promise<ValidationReport>} Comprehensive validation report
   */
  async validatePackage(packagePath)
  
  /**
   * Validate manifest structure and content
   * @param {ScormManifest} manifest - Parsed manifest
   * @returns {ValidationResult[]} Array of validation results
   */
  validateManifest(manifest)
  
  /**
   * Check file integrity and references
   * @param {Resource[]} resources - Resource definitions
   * @param {string} packagePath - Package directory path
   * @returns {IntegrityResult} File integrity results
   */
  validateResources(resources, packagePath)
}
```

## Run-Time Environment (RTE)

### ApiHandler (`src/main/services/scorm/rte/api-handler.js`)

**Purpose**: Implement the 8 required SCORM API functions

#### Key Responsibilities
- Session state management
- API function implementation
- Error handling and validation
- Data persistence coordination

#### API Interface
```javascript
class ScormApiHandler {
  /**
   * Initialize communication session
   * @param {string} parameter - Empty string as per SCORM spec
   * @returns {string} "true" if successful, "false" otherwise
   */
  Initialize(parameter)
  
  /**
   * Terminate communication session
   * @param {string} parameter - Empty string as per SCORM spec
   * @returns {string} "true" if successful, "false" otherwise
   */
  Terminate(parameter)
  
  /**
   * Get value of data model element
   * @param {string} element - Data model element name
   * @returns {string} Element value or empty string on error
   */
  GetValue(element)
  
  /**
   * Set value of data model element
   * @param {string} element - Data model element name
   * @param {string} value - Value to set
   * @returns {string} "true" if successful, "false" otherwise
   */
  SetValue(element, value)
  
  /**
   * Commit data to persistent storage
   * @param {string} parameter - Empty string as per SCORM spec
   * @returns {string} "true" if successful, "false" otherwise
   */
  Commit(parameter)
  
  /**
   * Get last error code
   * @returns {string} Error code as string (0-999)
   */
  GetLastError()
  
  /**
   * Get error message for error code
   * @param {string} errorCode - Error code as string
   * @returns {string} Human-readable error message
   */
  GetErrorString(errorCode)
  
  /**
   * Get diagnostic information for error
   * @param {string} errorCode - Error code as string
   * @returns {string} Diagnostic information
   */
  GetDiagnostic(errorCode)
}
```

#### Session States
```javascript
const SESSION_STATES = {
  NOT_INITIALIZED: 'not_initialized',  // Initial state
  RUNNING: 'running',                  // After successful Initialize
  TERMINATED: 'terminated'             // After successful Terminate
};
```

### DataModel (`src/main/services/scorm/rte/data-model.js`)

**Purpose**: Manage all SCORM data model elements with validation

#### Key Responsibilities
- Data element storage and retrieval
- Value validation and type checking
- Collection management (interactions, objectives)
- Navigation data model support

#### Core Data Elements
```javascript
// Completion and Success
'cmi.completion_status': CompletionStatus
'cmi.success_status': SuccessStatus

// Session Management  
'cmi.exit': ExitStatus
'cmi.entry': EntryStatus

// Location and Progress
'cmi.location': string (max 1000 chars)
'cmi.progress_measure': number (0.0-1.0)

// Scoring
'cmi.score.scaled': number (-1.0 to 1.0)
'cmi.score.raw': number
'cmi.score.min': number
'cmi.score.max': number

// Time Tracking
'cmi.session_time': ISO8601Duration
'cmi.total_time': ISO8601Duration (read-only)

// Suspend Data
'cmi.suspend_data': string (max 64k chars)

// Collections
'cmi.interactions._count': number (read-only)
'cmi.interactions.n.*': InteractionRecord
'cmi.objectives._count': number (read-only)
'cmi.objectives.n.*': ObjectiveRecord

// Navigation
'adl.nav.request': NavigationRequest
'adl.nav.request_valid.*': boolean (read-only)
```

## Sequencing and Navigation (SN)

### ActivityTree (`src/main/services/scorm/sn/activity-tree.js`)

**Purpose**: Manage the runtime activity tree structure

#### Key Responsibilities
- Activity tree construction from organization
- Activity state tracking
- Parent-child relationship management
- Global objective mapping

#### API Interface
```javascript
class ActivityTree {
  /**
   * Build activity tree from organization
   * @param {Organization} organization - Course organization
   * @returns {Activity} Root activity
   */
  buildTree(organization)
  
  /**
   * Find activity by identifier
   * @param {string} identifier - Activity identifier
   * @returns {Activity|null} Found activity or null
   */
  findActivity(identifier)
  
  /**
   * Update activity tracking status
   * @param {string} activityId - Activity identifier
   * @param {ActivityStatus} status - New status
   */
  updateActivityStatus(activityId, status)
  
  /**
   * Get available activities for navigation
   * @returns {Activity[]} Array of available activities
   */
  getAvailableActivities()
}
```

### SequencingEngine (`src/main/services/scorm/sn/sequencing-engine.js`)

**Purpose**: Process sequencing rules and navigation requests

#### Key Responsibilities
- Navigation request processing
- Sequencing rule evaluation
- Limit condition checking
- Rollup processing coordination

#### API Interface
```javascript
class SequencingEngine {
  /**
   * Process navigation request
   * @param {NavigationRequest} request - Navigation request
   * @returns {SequencingResult} Processing result
   */
  processNavigationRequest(request)
  
  /**
   * Evaluate sequencing rules for activity
   * @param {Activity} activity - Target activity
   * @param {RuleType} ruleType - Type of rules to evaluate
   * @returns {RuleResult[]} Rule evaluation results
   */
  evaluateSequencingRules(activity, ruleType)
  
  /**
   * Check limit conditions for activity
   * @param {Activity} activity - Activity to check
   * @returns {boolean} True if limits allow access
   */
  checkLimitConditions(activity)
}
```

## Integration Patterns

### Direct API Communication
The SCORM Engine provides direct, synchronous API access through the renderer bridge:

```javascript
// Renderer Process - Direct API calls (no async IPC)
window.API_1484_11 = {
  Initialize: (param) => scormAPIBridge.executeScormMethod('Initialize', [param]),
  GetValue: (element) => scormAPIBridge.executeScormMethod('GetValue', [element]),
  SetValue: (element, value) => scormAPIBridge.executeScormMethod('SetValue', [element, value])
  // ... other methods
};

// SCORM Content calls API synchronously
const result = window.API_1484_11.Initialize('');  // Returns immediately
```

### IPC Rate Limiting and Soft-OK Semantics
To prevent log spam and IPC overload:
- The main IPC layer applies per-channel rate limiting. On first engagement per channel (renderer-log-*, scorm-set-value, scorm-commit, scorm-terminate), it logs a single INFO entry:
  "rate-limit engaged on <channel>; further rate-limit logs suppressed for this session".
- Subsequent rate-limited calls on these channels are treated as soft-ok with no additional logs.
- Renderer services must silently back off without generating rate-limit logs; session_time SetValue must be throttled (>=3s) and Commit/Terminate serialized.

### Event System
The engine uses an event-driven architecture for loose coupling:

```javascript
// Event emission
scormEngine.emit('session:initialized', { sessionId, learnerId });
scormEngine.emit('data:changed', { element, oldValue, newValue });
scormEngine.emit('navigation:requested', { request, currentActivity });

// Event handling
scormEngine.on('session:terminated', (data) => {
  // Perform cleanup and data persistence
});
```

### Error Propagation
Errors are handled consistently across all modules:

```javascript
try {
  const result = await scormOperation();
  return { success: true, data: result };
} catch (error) {
  logger.error('SCORM operation failed', { error, context });
  return {
    success: false,
    error: {
      code: error.scormCode || 101,
      message: error.message,
      diagnostic: error.diagnostic
    }
  };
}
```

### Graceful Shutdown
Shutdown sequence must:
1) Attempt to terminate SCORM sessions first (best-effort, soft-ok, timeout-guarded).
2) Unregister IPC handlers and clear histories.
3) Close windows and finalize services.

Benign "already terminated" or late-shutdown terminations must not escalate to ERROR logs.

## Testing Strategy

### Unit Tests
Each module has comprehensive unit tests covering:
- All public API methods
- Error conditions and edge cases
- SCORM compliance requirements
- Performance benchmarks

### Integration Tests
Cross-module integration tests verify:
- API to DataModel communication
- Sequencing Engine to Activity Tree interaction
- Error propagation across modules
- Event system functionality

### SCORM Compliance Tests
Specialized tests ensure:
- All SCORM 2004 4th Edition requirements met
- Proper error code implementation
- Correct session state management
- Data model element validation

## Performance Considerations

### Memory Management
- Lazy loading of large data structures
- Efficient collection handling for interactions/objectives
- Proper cleanup on session termination

### Processing Optimization
- Cached manifest parsing results
- Optimized sequencing rule evaluation
- Background processing for non-critical operations

### Scalability
- Support for large SCORM packages (>100MB)
- Efficient handling of complex sequencing scenarios
- Minimal memory footprint for long-running sessions

This SCORM Engine provides a robust, compliant, and maintainable foundation for SCORM 2004 4th Edition content testing while supporting modern development practices and AI-assisted development workflows.