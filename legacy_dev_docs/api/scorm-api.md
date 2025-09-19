# SCORM API Reference

## Overview

This document provides a comprehensive reference for the SCORM 2004 4th Edition API implementation in the SCORM Tester application. The API follows the IEEE 1484.11.2 standard and provides full compliance with SCORM specifications.

## API Object

The SCORM API is exposed as a JavaScript object named `API_1484_11` in the content window hierarchy, following SCORM 2004 4th Edition conventions.

### API Discovery

Content must locate the API object using the standard discovery algorithm:

```javascript
function findAPI(win) {
  let API = null;
  let findAPITries = 0;
  
  while ((win != null) && (API == null) && (findAPITries < 500)) {
    findAPITries++;
    
    // Check current window
    if (win.API_1484_11) {
      API = win.API_1484_11;
    } else {
      // Check parent window
      if (win.parent != null && win.parent != win) {
        win = win.parent;
      }
      // Check opener window
      else if (win.opener != null && typeof(win.opener) != "undefined") {
        win = win.opener;
      } else {
        break;
      }
    }
  }
  
  return API;
}
```

## API Functions

### Initialize(parameter)

Initializes the communication session between the SCO and the LMS.

#### Syntax
```javascript
result = API_1484_11.Initialize("")
```

#### Parameters
- `parameter` (string): Must be an empty string `""`

#### Return Value
- `"true"`: Initialization successful
- `"false"`: Initialization failed

#### Behavior
- Must be called exactly once per session
- Must be the first API call made by the SCO
- Sets session state to "Running"
- Initializes data model with default values
- Loads any existing learner data for resume scenarios

#### Error Conditions
- **102**: General Initialization Failure
- **103**: Already Initialized (if called multiple times)
- **201**: General Argument Error (if parameter is not empty string)

#### Example
```javascript
const API = findAPI(window);
if (API) {
  const result = API.Initialize("");
  if (result === "true") {
    console.log("SCORM session initialized successfully");
  } else {
    console.error("Failed to initialize SCORM session");
    console.error("Error: " + API.GetLastError());
  }
}
```

### Terminate(parameter)

Terminates the communication session and persists all data.

#### Syntax
```javascript
result = API_1484_11.Terminate("")
```

#### Parameters
- `parameter` (string): Must be an empty string `""`

#### Return Value
- `"true"`: Termination successful
- `"false"`: Termination failed

#### Behavior
- Must be called exactly once per session
- Must be the last API call made by the SCO
- Automatically commits any unsaved data
- Processes any navigation requests
- Sets session state to "Terminated"

#### Error Conditions
- **111**: General Termination Failure
- **112**: Termination Before Initialization
- **113**: Termination After Termination
- **201**: General Argument Error

#### Example
```javascript
// Set exit status before terminating
API.SetValue("cmi.exit", "normal");

// Set navigation request if needed
API.SetValue("adl.nav.request", "continue");

// Terminate session
const result = API.Terminate("");
if (result === "true") {
  console.log("SCORM session terminated successfully");
} else {
  console.error("Failed to terminate SCORM session");
}
```

### GetValue(element)

Retrieves the value of a specified data model element.

#### Syntax
```javascript
value = API_1484_11.GetValue(element)
```

#### Parameters
- `element` (string): Data model element name (e.g., "cmi.completion_status")

#### Return Value
- String value of the element, or empty string `""` if error

#### Behavior
- Can only be called after Initialize and before Terminate
- Returns current value of the specified data model element
- Returns empty string and sets error code on failure

#### Error Conditions
- **122**: Retrieve Data Before Initialization
- **123**: Retrieve Data After Termination
- **401**: General Get Failure
- **404**: Undefined Data Model Element
- **406**: Data Model Element Value Not Initialized
- **408**: Data Model Element Is Write Only

#### Example
```javascript
// Get completion status
const completionStatus = API.GetValue("cmi.completion_status");
console.log("Completion status:", completionStatus);

// Get learner name
const learnerName = API.GetValue("cmi.learner_name");
console.log("Learner:", learnerName);

// Get previous bookmark
const bookmark = API.GetValue("cmi.location");
if (bookmark) {
  console.log("Resuming from:", bookmark);
}
```

### SetValue(element, value)

Sets the value of a specified data model element.

#### Syntax
```javascript
result = API_1484_11.SetValue(element, value)
```

#### Parameters
- `element` (string): Data model element name
- `value` (string): Value to set

#### Return Value
- `"true"`: Set operation successful
- `"false"`: Set operation failed

#### Behavior
- Can only be called after Initialize and before Terminate
- Validates value against element constraints
- Updates internal data model
- Does not automatically persist data (use Commit for immediate persistence)

#### Error Conditions
- **132**: Store Data Before Initialization
- **133**: Store Data After Termination
- **402**: General Set Failure
- **404**: Undefined Data Model Element
- **407**: Data Model Element Is Read Only
- **409**: Data Model Element Type Mismatch
- **410**: Data Model Element Value Out Of Range

#### Example
```javascript
// Set completion status
let result = API.SetValue("cmi.completion_status", "completed");
if (result === "true") {
  console.log("Completion status set successfully");
}

// Set score
result = API.SetValue("cmi.score.raw", "85");
result = API.SetValue("cmi.score.max", "100");
result = API.SetValue("cmi.score.scaled", "0.85");

// Set success status based on score
result = API.SetValue("cmi.success_status", "passed");

// Save bookmark
result = API.SetValue("cmi.location", "page_5");
```

### Commit(parameter)

Forces immediate persistence of all data to permanent storage.

#### Syntax
```javascript
result = API_1484_11.Commit("")
```

#### Parameters
- `parameter` (string): Must be an empty string `""`

#### Return Value
- `"true"`: Commit successful
- `"false"`: Commit failed

#### Behavior
- Can only be called after Initialize and before Terminate
- Forces immediate write of all data to persistent storage
- Terminate automatically performs a commit, so explicit commits are optional
- Useful for long sessions to prevent data loss

#### Error Conditions
- **142**: Commit Before Initialization
- **143**: Commit After Termination
- **201**: General Argument Error
- **403**: General Commit Failure

#### Example
```javascript
// Periodically commit data during long sessions
setInterval(() => {
  const result = API.Commit("");
  if (result === "true") {
    console.log("Data committed successfully");
  }
}, 30000); // Commit every 30 seconds
```

### GetLastError()

Returns the error code from the last API call.

#### Syntax
```javascript
errorCode = API_1484_11.GetLastError()
```

#### Parameters
None

#### Return Value
- String representation of error code (0-999)
- `"0"` indicates no error

#### Behavior
- Can be called at any time
- Returns the error code from the most recent API call
- Error codes follow SCORM 2004 4th Edition specification

#### Example
```javascript
const result = API.SetValue("cmi.invalid_element", "test");
if (result === "false") {
  const errorCode = API.GetLastError();
  console.error("Error code:", errorCode);
  
  if (errorCode === "404") {
    console.error("Undefined data model element");
  }
}
```

### GetErrorString(errorCode)

Returns a human-readable description for an error code.

#### Syntax
```javascript
errorString = API_1484_11.GetErrorString(errorCode)
```

#### Parameters
- `errorCode` (string): Error code as string

#### Return Value
- Human-readable error message
- Empty string if error code is invalid

#### Example
```javascript
const errorCode = API.GetLastError();
if (errorCode !== "0") {
  const errorMessage = API.GetErrorString(errorCode);
  console.error(`Error ${errorCode}: ${errorMessage}`);
}
```

### GetDiagnostic(errorCode)

Returns detailed diagnostic information for an error code.

#### Syntax
```javascript
diagnostic = API_1484_11.GetDiagnostic(errorCode)
```

#### Parameters
- `errorCode` (string): Error code as string

#### Return Value
- Detailed diagnostic information
- Empty string if no diagnostic available

#### Example
```javascript
const errorCode = API.GetLastError();
if (errorCode !== "0") {
  const diagnostic = API.GetDiagnostic(errorCode);
  if (diagnostic) {
    console.error("Diagnostic info:", diagnostic);
  }
}
```

## Data Model Elements

### Core Elements

#### Completion and Success
```javascript
// Completion status
"cmi.completion_status"     // "completed", "incomplete", "not attempted", "unknown"
"cmi.success_status"        // "passed", "failed", "unknown"
```

#### Session Management
```javascript
"cmi.exit"                  // "time-out", "suspend", "logout", "normal", ""
"cmi.entry"                 // "ab-initio", "resume", "" (read-only)
```

#### Location and Progress
```javascript
"cmi.location"              // Bookmark string (max 1000 chars)
"cmi.progress_measure"      // Progress 0.0-1.0
```

#### Scoring
```javascript
"cmi.score.scaled"          // Normalized score -1.0 to 1.0
"cmi.score.raw"             // Raw score
"cmi.score.min"             // Minimum possible score
"cmi.score.max"             // Maximum possible score
"cmi.scaled_passing_score"  // Passing threshold 0.0-1.0 (read-only)
```

#### Time Tracking
```javascript
"cmi.session_time"          // Session duration (write-only, ISO8601)
"cmi.total_time"            // Total time across sessions (read-only, ISO8601)
```

#### Suspend Data
```javascript
"cmi.suspend_data"          // Arbitrary data for resume (max 64k chars)
```

#### Learner Information
```javascript
"cmi.learner_id"            // Unique learner identifier (read-only)
"cmi.learner_name"          // Learner display name (read-only)
"cmi.credit"                // "credit", "no-credit" (read-only)
"cmi.mode"                  // "normal", "review", "browse" (read-only)
"cmi.launch_data"           // Data from manifest (read-only)
```

### Collections

#### Interactions
```javascript
"cmi.interactions._count"                    // Number of interactions (read-only)
"cmi.interactions.n.id"                      // Interaction identifier
"cmi.interactions.n.type"                    // Interaction type
"cmi.interactions.n.objectives._count"       // Number of objectives
"cmi.interactions.n.objectives.n.id"        // Objective identifier
"cmi.interactions.n.timestamp"              // Interaction timestamp
"cmi.interactions.n.correct_responses._count" // Number of correct responses
"cmi.interactions.n.correct_responses.n.pattern" // Correct response pattern
"cmi.interactions.n.weighting"              // Interaction weight
"cmi.interactions.n.learner_response"       // Learner's response
"cmi.interactions.n.result"                 // Result: "correct", "incorrect", etc.
"cmi.interactions.n.latency"                // Response time
"cmi.interactions.n.description"            // Interaction description
```

#### Objectives
```javascript
"cmi.objectives._count"                      // Number of objectives (read-only)
"cmi.objectives.n.id"                        // Objective identifier
"cmi.objectives.n.score.scaled"             // Objective scaled score
"cmi.objectives.n.score.raw"                // Objective raw score
"cmi.objectives.n.score.min"                // Objective minimum score
"cmi.objectives.n.score.max"                // Objective maximum score
"cmi.objectives.n.success_status"           // Objective success status
"cmi.objectives.n.completion_status"        // Objective completion status
"cmi.objectives.n.progress_measure"         // Objective progress measure
"cmi.objectives.n.description"              // Objective description
```

### Navigation Elements

#### Navigation Requests
```javascript
"adl.nav.request"                           // Navigation request (write-only)
// Values: "continue", "previous", "exit", "exitAll", "abandon", 
//         "abandonAll", "suspendAll", "start", "resume"
```

#### Navigation Validation
```javascript
"adl.nav.request_valid.continue"           // Continue available (read-only)
"adl.nav.request_valid.previous"           // Previous available (read-only)
"adl.nav.request_valid.choice"             // Choice available (read-only)
"adl.nav.request_valid.exit"               // Exit available (read-only)
"adl.nav.request_valid.exitAll"            // Exit all available (read-only)
"adl.nav.request_valid.abandon"            // Abandon available (read-only)
"adl.nav.request_valid.abandonAll"         // Abandon all available (read-only)
"adl.nav.request_valid.suspendAll"         // Suspend all available (read-only)
```

## Error Codes

### Success
- **0**: No Error

### General Errors (100-199)
- **101**: General Exception
- **102**: General Initialization Failure
- **103**: Already Initialized
- **104**: Content Instance Terminated
- **111**: General Termination Failure
- **112**: Termination Before Initialization
- **113**: Termination After Termination
- **122**: Retrieve Data Before Initialization
- **123**: Retrieve Data After Termination
- **132**: Store Data Before Initialization
- **133**: Store Data After Termination
- **142**: Commit Before Initialization
- **143**: Commit After Termination

### Syntax Errors (200-299)
- **201**: General Argument Error

### Data Model Errors (400-499)
- **401**: General Get Failure
- **402**: General Set Failure
- **403**: General Commit Failure
- **404**: Undefined Data Model Element
- **405**: Unimplemented Data Model Element
- **406**: Data Model Element Value Not Initialized
- **407**: Data Model Element Is Read Only
- **408**: Data Model Element Is Write Only
- **409**: Data Model Element Type Mismatch
- **410**: Data Model Element Value Out Of Range
- **411**: Data Model Dependency Not Established

## Best Practices

### Session Management
```javascript
// Always check for API availability
const API = findAPI(window);
if (!API) {
  console.error("SCORM API not found");
  return;
}

// Initialize session
if (API.Initialize("") === "true") {
  // Check if resuming
  const entry = API.GetValue("cmi.entry");
  if (entry === "resume") {
    const bookmark = API.GetValue("cmi.location");
    // Resume from bookmark
  }
  
  // Set initial status
  API.SetValue("cmi.completion_status", "incomplete");
} else {
  console.error("Failed to initialize SCORM session");
}
```

### Error Handling
```javascript
function scormSetValue(element, value) {
  const result = API.SetValue(element, value);
  if (result === "false") {
    const errorCode = API.GetLastError();
    const errorMessage = API.GetErrorString(errorCode);
    console.error(`Failed to set ${element}: ${errorMessage}`);
    return false;
  }
  return true;
}
```

### Session Termination
```javascript
function terminateSession() {
  // Set final status
  API.SetValue("cmi.completion_status", "completed");
  API.SetValue("cmi.success_status", "passed");
  
  // Set session time
  const sessionTime = calculateSessionTime(); // Your implementation
  API.SetValue("cmi.session_time", sessionTime);
  
  // Set exit status
  API.SetValue("cmi.exit", "normal");
  
  // Set navigation request if needed
  API.SetValue("adl.nav.request", "continue");
  
  // Terminate
  const result = API.Terminate("");
  if (result === "false") {
    console.error("Failed to terminate session");
  }
}
```

This API reference provides comprehensive documentation for implementing SCORM-compliant content that works seamlessly with the SCORM Tester application.