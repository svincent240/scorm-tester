# SCORM 2004 4th Edition Sequencing and Navigation (SN) Module

## Overview

The Sequencing and Navigation (SN) module provides complete SCORM 2004 4th Edition sequencing rule processing, navigation handling, and activity tree management. This module implements the complex sequencing logic required for advanced SCORM packages including remediation workflows, global objectives, and rollup processing.

## Architecture

### Core Components

The SN module consists of four core components working together:

1. **Activity Tree Manager** - Builds and manages hierarchical activity structures
2. **Sequencing Engine** - Processes sequencing rules and conditions
3. **Navigation Handler** - Handles navigation requests and validation
4. **Rollup Manager** - Manages objective and completion status aggregation

### Integration Points

- **Phase 1 RTE Integration**: Extends data model with navigation elements
- **Phase 2 CAM Integration**: Uses parsed manifest sequencing information
- **Error Handling**: Extends existing error handling with SN-specific codes (450-599)

## Module Structure

```
src/main/services/scorm/sn/
├── activity-tree.js      # Activity tree construction and management
├── sequencing-engine.js  # Sequencing rule processing
├── navigation-handler.js # Navigation request processing
├── rollup-manager.js     # Objective and completion rollup
└── index.js             # Unified SN service interface

src/shared/constants/
└── sn-constants.js      # SN-specific constants and error codes

tests/unit/scorm/sn/
└── activity-tree.test.js # Unit tests for SN modules

tests/integration/
└── sn-workflow.test.js   # End-to-end SN workflow tests
```

## Activity Tree Manager

### Purpose
Builds and maintains hierarchical activity structures from CAM manifest data, tracking activity states and attempt information.

### Key Features
- **Tree Construction**: Builds activity trees from organization/item structures
- **State Management**: Tracks activity states (inactive, active, suspended)
- **Attempt Tracking**: Manages attempt counts and completion status
- **Resource Linking**: Associates activities with launchable resources
- **Traversal Support**: Provides tree traversal and navigation utilities

### Usage Example
```javascript
const { ActivityTreeManager } = require('./src/main/services/scorm/sn/activity-tree');

const treeManager = new ActivityTreeManager(errorHandler, logger);
const success = treeManager.buildTree(camManifest);

if (success) {
  const activity = treeManager.getActivity('lesson1');
  treeManager.setCurrentActivity('lesson1');
  const stats = treeManager.getTreeStats();
}
```

### API Reference
- `buildTree(manifest)` - Build activity tree from CAM manifest
- `getActivity(identifier)` - Get activity by identifier
- `setCurrentActivity(identifier)` - Set current active activity
- `getLeafActivities()` - Get all leaf (launchable) activities
- `traverseTree(node, callback)` - Traverse tree with callback
- `getTreeStats()` - Get tree statistics and metrics

## Sequencing Engine

### Purpose
Processes SCORM sequencing rules, control modes, and conditions to determine activity flow and navigation paths.

### Key Features
- **Rule Evaluation**: Processes pre-condition and post-condition rules
- **Control Modes**: Enforces choice, flow, and forward-only restrictions
- **Condition Processing**: Evaluates satisfaction, completion, and attempt conditions
- **Action Processing**: Handles skip, retry, exit, and other sequencing actions
- **Limit Conditions**: Manages attempt limits and time restrictions

### Supported Rule Conditions
- `satisfied` - Activity objective is satisfied
- `completed` - Activity is completed
- `attempted` - Activity has been attempted
- `objectiveStatusKnown` - Objective status is known
- `attemptLimitExceeded` - Attempt limit has been exceeded
- `always` - Always true condition

### Supported Rule Actions
- `skip` - Skip the activity
- `disabled` - Disable the activity
- `hiddenFromChoice` - Hide from choice navigation
- `exitParent` - Exit parent activity
- `exitAll` - Exit all activities
- `retry` - Retry the activity

### Usage Example
```javascript
const sequencingEngine = new SequencingEngine(treeManager, errorHandler, logger);

const preResult = sequencingEngine.evaluatePreConditionRules(activity);
if (preResult.action === 'skip') {
  // Handle skip action
  const actionResult = sequencingEngine.processSequencingAction('skip', activity);
}
```

## Navigation Handler

### Purpose
Processes navigation requests and determines valid navigation options based on sequencing rules and activity tree state.

### Key Features
- **Request Processing**: Handles all SCORM navigation request types
- **Validity Checking**: Validates navigation requests against control modes
- **Path Finding**: Determines next/previous activities in sequence
- **Choice Navigation**: Manages choice-based navigation with validation
- **Session Management**: Tracks navigation session state and available options

### Supported Navigation Requests
- `start` - Start the learning experience
- `continue` - Continue to next activity
- `previous` - Return to previous activity
- `choice` - Navigate to specific activity
- `exit` - Exit current activity
- `exitAll` - Exit all activities
- `suspendAll` - Suspend all activities

### Usage Example
```javascript
const navHandler = new NavigationHandler(treeManager, sequencingEngine, errorHandler, logger);

const navResult = await navHandler.processNavigationRequest('continue');
if (navResult.success) {
  const targetActivity = navResult.targetActivity;
  const availableNav = navHandler.getAvailableNavigation();
}
```

## Rollup Manager

### Purpose
Handles objective and completion status aggregation up the activity tree according to SCORM rollup rules and global objective management.

### Key Features
- **Objective Rollup**: Aggregates satisfaction status from child activities
- **Completion Rollup**: Aggregates completion status with weighting
- **Measure Rollup**: Calculates weighted average scores
- **Global Objectives**: Manages shared objectives across activities
- **Rule Processing**: Applies rollup rules and requirements

### Rollup Rule Types
- `rollupObjectiveSatisfied` - Roll up objective satisfaction
- `rollupProgressCompletion` - Roll up completion progress
- `objectiveMeasureWeight` - Weight for measure calculations
- `requiredForSatisfied` - Requirements for satisfaction rollup
- `requiredForCompleted` - Requirements for completion rollup

### Usage Example
```javascript
const rollupManager = new RollupManager(treeManager, errorHandler, logger);

const rollupResult = rollupManager.processRollup(activity);
if (rollupResult.success) {
  const objectiveRollup = rollupResult.results[activity.identifier].objectiveRollup;
  const globalObjectives = rollupManager.getAllGlobalObjectives();
}
```

## Unified SN Service

### Purpose
Provides a unified interface for all SN operations, orchestrating the core components and managing sequencing sessions.

### Key Features
- **Service Orchestration**: Coordinates all SN components
- **Session Management**: Manages sequencing sessions and state
- **Integration Interface**: Provides clean API for RTE and CAM integration
- **Progress Tracking**: Handles activity progress updates and rollup
- **State Reporting**: Provides comprehensive sequencing state information

### Usage Example
```javascript
const { ScormSNService } = require('./src/main/services/scorm/sn');

const snService = new ScormSNService(errorHandler, logger);

// Initialize with CAM manifest
const initResult = await snService.initialize(camManifest, packageInfo);

// Process navigation
const navResult = await snService.processNavigation('start');

// Update activity progress
const progressResult = snService.updateActivityProgress('lesson1', {
  completed: true,
  satisfied: true,
  measure: 0.85
});

// Get current state
const state = snService.getSequencingState();
```

## Error Handling

### SN Error Codes (450-599)

The SN module extends the existing error handling system with specific error codes:

#### Activity Tree Errors (450-469)
- `450` - Invalid activity tree
- `451` - Activity not found
- `452` - Invalid activity state
- `453` - Circular activity reference
- `454` - Maximum depth exceeded

#### Sequencing Engine Errors (470-489)
- `470` - Invalid sequencing rule
- `471` - Rule condition failed
- `472` - Invalid control mode
- `473` - Sequencing violation
- `474` - Limit condition exceeded

#### Navigation Handler Errors (490-509)
- `490` - Invalid navigation request
- `491` - Navigation not allowed
- `492` - No valid navigation
- `493` - Choice not available
- `494` - Navigation sequence error

#### Rollup Manager Errors (510-529)
- `510` - Rollup processing failed
- `511` - Invalid objective map
- `512` - Global objective error
- `513` - Rollup rule violation
- `514` - Measure calculation error

## Testing

### Unit Tests
Comprehensive unit tests cover all SN modules:
- Activity tree construction and management
- Sequencing rule evaluation and processing
- Navigation request handling and validation
- Rollup processing and global objectives

### Integration Tests
End-to-end workflow tests validate:
- Complete sequencing scenarios
- Complex navigation patterns
- Remediation workflows
- Global objective management
- Error handling and edge cases

### Running Tests
```bash
# Run SN-specific tests
npm run test:sn

# Run all tests including SN
npm run test:all

# Run with coverage
npm run test:coverage
```

## Performance Considerations

### Optimization Features
- **Lazy Loading**: Activities loaded on-demand
- **Efficient Traversal**: Optimized tree traversal algorithms
- **Minimal Memory**: Compact activity representation
- **Fast Lookups**: Map-based activity indexing

### Performance Targets
- Activity tree construction: < 100ms for typical packages
- Navigation processing: < 50ms per request
- Rollup processing: < 100ms for complex hierarchies
- Memory usage: < 10MB for large packages

## SCORM Compliance

### SCORM 2004 4th Edition Features
- ✅ Complete sequencing rule processing
- ✅ All navigation request types supported
- ✅ Global objective management
- ✅ Rollup rule processing
- ✅ Control mode enforcement
- ✅ Limit condition handling

### Tested Scenarios
- Linear sequencing workflows
- Choice-based navigation
- Remediation and retry logic
- Complex hierarchical structures
- Global objective sharing
- Weighted rollup calculations

## Integration Examples

### With Phase 1 RTE
```javascript
// Extend RTE data model with navigation elements
const apiHandler = new ScormApiHandler(sessionManager, logger);
const snService = new ScormSNService(apiHandler.errorHandler, logger);

// Process navigation requests from content
apiHandler.SetValue('adl.nav.request', 'continue');
const navResult = await snService.processNavigation('continue');
```

### With Phase 2 CAM
```javascript
// Use CAM parsed manifest for SN initialization
const camService = new ScormCAMService(errorHandler);
const manifest = await camService.parseManifest(manifestPath);

const snService = new ScormSNService(errorHandler, logger);
await snService.initialize(manifest);
```

## Troubleshooting

### Common Issues

**Activity Tree Construction Fails**
- Verify manifest has valid organization structure
- Check for circular references in item hierarchy
- Ensure activity depth doesn't exceed limits

**Navigation Requests Rejected**
- Check control mode settings (choice, flow, forwardOnly)
- Verify sequencing rules don't block navigation
- Ensure target activities are visible and available

**Rollup Processing Errors**
- Validate rollup rule configuration
- Check objective mapping settings
- Ensure activity progress data is valid

### Debug Information
Enable detailed logging to trace:
- Activity tree construction process
- Sequencing rule evaluation steps
- Navigation request processing
- Rollup calculation details

The SN module provides comprehensive logging at debug, info, warn, and error levels to support troubleshooting and development.