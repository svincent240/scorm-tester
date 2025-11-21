# MCP JSON Persistence Flow

## Overview

The MCP (Model Context Protocol) tools implement SCORM session persistence using JSON files, exactly matching the GUI persistence pattern. This document describes the actual implementation as it works in the codebase.

## Architecture

### Three-Process Model

```text
┌─────────────────────┐
│   Node.js Server    │  (server.js, session.js)
│   MCP Protocol      │  - Handles stdio MCP communication
│   Session Manager   │  - Manages session lifecycle
└──────────┬──────────┘
           │ IPC
           ▼
┌─────────────────────┐
│   Node.js Bridge    │  (node-bridge.js)
│   Process Manager   │  - Spawns/manages Electron child
└──────────┬──────────┘
           │ IPC
           ▼
┌─────────────────────┐
│  Electron Child     │  (electron-entry.js)
│  ScormService       │  - Manages SCORM sessions
│  SessionStore       │  - Persists to JSON files
│  BrowserWindow      │  - Runs SCORM content
└─────────────────────┘
```

### Key Components

1. **ScormService** (`src/main/services/scorm-service.js`)
   - Single shared instance per MCP server (singleton via `getMcpScormService()`)
   - Manages SCORM API handlers (RTE instances)
   - Handles session initialization with JSON hydration
   - Handles session termination with JSON persistence
   - Uses namespace `'mcp'` to separate from GUI sessions

2. **SessionStore** (`src/main/services/session-store.js`)
   - Saves/loads JSON files to `~/Library/Application Support/scorm-tester/scorm-sessions/`
   - Filename pattern: `{namespace}_{sanitized_courseId}.json`
   - Example: `mcp_scorm_template.json`
   - Namespace isolation prevents MCP/GUI conflicts

3. **RuntimeAdapter** (`src/mcp/runtime-adapter.js`)
   - Bridges MCP tools to ScormService
   - Passes `courseId` from manifest to ScormService for proper JSON file naming
   - No longer manages persistence directly (delegated to ScormService)

4. **Session Manager** (`src/mcp/session.js`)
   - Manages workspace and session lifecycle
   - Coordinates close sequence to ensure data is saved before cleanup

## Complete Flow

### 1. Open Course (`scorm_open_course`)

**User Call:**
```javascript
scorm_open_course({
  package_path: "/path/to/course",
  viewport: { width: 1024, height: 768 },
  new_attempt: false  // Optional: true = skip JSON loading (hard reset)
})
```

**Implementation Flow:**

```
session.js::open()
  └─> Creates workspace directory
  └─> Stores new_attempt flag in session object
  └─> Returns session_id

runtime-manager.js::openPersistent()
  └─> Reads manifest to extract courseId
  └─> Creates adapterOptions with:
      - courseId: from manifest
      - forceNew: from session.new_attempt flag
  
runtime-adapter.js::installRealAdapterForWindow()
  └─> Gets shared ScormService via getMcpScormService()
  └─> Calls ScormService.initializeSession(sessionId, {
        courseId: courseId,           // From manifest
        forceNew: forceNew,           // From new_attempt flag
        launchMode: 'normal'
      })

ScormService.initializeSession()
  ├─> courseId = options.courseId || manifest.identifier || 'unknown_course'
  ├─> namespace = 'mcp'
  │
  ├─> IF forceNew == true:
  │   └─> Skip JSON loading entirely (hard reset without deletion)
  │
  ├─> ELSE IF forceNew == false:
  │   ├─> SessionStore.loadSession(courseId, namespace)
  │   ├─> IF savedData exists AND exit === 'suspend':
  │   │   ├─> Check if cmi.location is present (safety check)
  │   │   └─> IF hasLocation OR allowResumeWithoutLocation:
  │   │       └─> rte.dataModel.restoreData(savedData)
  │   │           - Restores complete data model snapshot
  │   │           - No manipulation, straight restore
  │   └─> ELSE:
  │       └─> Start fresh (ab-initio)
  │
  └─> RTE.Initialize('')
      - Sets cmi.entry based on restored data
      - 'resume' if data was restored
      - 'ab-initio' if fresh start
```

**Result:**
- Session created with runtime open
- SCORM API initialized
- Data restored if conditions met (exit=suspend, has location)
- Course content loaded in BrowserWindow

### 2. Modify Data

**User Calls:**
```javascript
scorm_api_call({
  session_id: "abc123",
  method: "SetValue",
  args: ["cmi.location", "slide_2"]
})
```

**Implementation Flow:**

```
runtime.js::scorm_api_call()
  └─> RuntimeManager.callAPI()
      └─> IPC to Electron child
          └─> ScormService.setValue(sessionId, element, value)
              └─> RTE handler updates data model in memory
```

**Note:** Data is only in memory at this point. Not saved until close/terminate.

### 3. Close Course (`scorm_close_course`)

**User Call:**
```javascript
scorm_close_course({
  session_id: "abc123"
})
```

**Implementation Flow:**

```
session.js::close()
  ├─> Sets session state to 'closing'
  ├─> RuntimeManager.getRuntimeStatus(session_id)
  ├─> IF runtime is open:
  │   ├─> Set cmi.exit = 'suspend' (if not already set)
  │   │   - Best effort, continues if fails
  │   │   - Enables resume on next open
  │   └─> RuntimeManager.closePersistent(session_id)
  │
  └─> Deletes session from memory

RuntimeManager.closePersistent()
  └─> IPC to Electron child
      └─> RuntimeManager._closePersistentImpl(session_id)

RuntimeManager._closePersistentImpl()
  ├─> Get BrowserWindow for session
  ├─> ScormService.terminate(session_id)
  │   └─> THIS IS WHERE PERSISTENCE HAPPENS
  ├─> win.destroy()
  └─> Clean up session tracking

ScormService.terminate()
  ├─> Get RTE handler for session
  ├─> RTE.Terminate('')
  │   - Validates data model
  │   - Finalizes session time
  │   - Returns 'true' if successful
  │
  ├─> courseId = session.courseId || manifest.identifier || 'unknown_course'
  ├─> namespace = 'mcp'
  ├─> allData = rte.dataModel.getAllData()
  │   - Returns complete data model snapshot:
  │     {
  │       coreData: { "cmi.location": "...", "cmi.exit": "suspend", ... },
  │       interactions: [...],
  │       objectives: [...],
  │       commentsFromLearner: [...],
  │       commentsFromLms: [...]
  │     }
  │
  └─> SessionStore.saveSession(courseId, allData, namespace)
      └─> Writes to: ~/Library/Application Support/scorm-tester/scorm-sessions/mcp_{courseId}.json
```

**Critical Implementation Details:**

1. **Exit Status:** `cmi.exit = 'suspend'` is set in `session.js::close()` BEFORE calling terminate
2. **Persistence Trigger:** ScormService.terminate() ALWAYS saves the complete data model
3. **Resume Logic:** On next open, resume happens only if `exit === 'suspend'` in saved JSON
4. **No Manipulation:** Data model is saved and restored as-is, no filtering or transformation
5. **Every Time:** JSON is written on EVERY close/terminate, regardless of exit value

### 4. Reload Course (`scorm_reload_course`)

**User Call:**
```javascript
scorm_reload_course({
  session_id: "abc123",
  package_path: "/path/to/course",
  force_new: false  // Optional: true = skip JSON loading
})
```

**Implementation Flow:**

```
PHASE 1: SHUTDOWN (Identical to scorm_close_course)
  └─> session.js::close(session_id)
      - Sets exit='suspend'
      - Calls ScormService.terminate()
      - Saves JSON with current data

PHASE 2: STARTUP (Identical to scorm_open_course)
  └─> session.js::open({ package_path, new_attempt: force_new })
      - Creates NEW session with NEW session_id
      - If force_new=false: loads JSON if exit='suspend'
      - If force_new=true: skips JSON loading entirely
```

**Key Points:**
- Two sequential operations: close then open
- New session ID generated (not reused)
- `force_new` flag controls JSON loading in Phase 2
- Default behavior (force_new=false): resume from saved state
- Hard reset (force_new=true): fresh start without deleting JSON file

### 5. Clear Saved Data (`scorm_clear_saved_data`)

**User Call:**
```javascript
scorm_clear_saved_data({
  package_path: "/path/to/course"
})
```

**Implementation Flow:**

```
session.js::scorm_clear_saved_data()
  ├─> Read manifest to extract courseId
  ├─> Send IPC to Electron child:
  │   {
  │     type: 'session_clear_saved_data',
  │     params: { course_id: courseId, namespace: 'mcp' }
  │   }
  │
  └─> Electron receives and processes:

RuntimeManager.handleIPCMessage()
  └─> ScormService.sessionStore.deleteSession(courseId, namespace)
      └─> Deletes file: mcp_{courseId}.json
```

**Important:** This is a MANUAL CLEANUP tool only. Normal hard reset should use `force_new` flag which skips loading without deletion.

## Data Flow Summary

### What Gets Saved
```json
{
  "coreData": {
    "cmi.exit": "suspend",
    "cmi.location": "slide_2",
    "cmi.suspend_data": "{...course state...}",
    "cmi.completion_status": "incomplete",
    "cmi.success_status": "unknown",
    "cmi.score.scaled": null,
    // ... all other CMI elements
  },
  "interactions": [],
  "objectives": [],
  "commentsFromLearner": [],
  "commentsFromLms": []
}
```

### Resume Conditions

Data is restored ONLY when ALL conditions are met:

1. ✅ JSON file exists for courseId
2. ✅ `cmi.exit === 'suspend'` in saved data
3. ✅ `cmi.location` is not empty (safety check)
4. ✅ `forceNew === false` (not a hard reset)

If ANY condition fails: Fresh start (ab-initio)

### Namespace Isolation

```
GUI Sessions:  ~/scorm-sessions/gui_{courseId}.json
MCP Sessions:  ~/scorm-sessions/mcp_{courseId}.json
```

Same course can have separate saved states for GUI and MCP without conflicts.

## Key Implementation Files

### Core Persistence
- `src/main/services/scorm-service.js` - Session initialization and termination
- `src/main/services/session-store.js` - File I/O for JSON persistence
- `src/mcp/runtime-adapter.js` - Bridges MCP to ScormService
- `src/mcp/runtime-manager.js` - Manages BrowserWindow lifecycle
- `src/mcp/session.js` - Session lifecycle coordination

### MCP Tools
- `src/mcp/tools/session.js` - Implements all course lifecycle tools
- `src/mcp/tools/runtime.js` - Implements SCORM API tools

### Configuration
- `src/mcp/electron-entry.js` - **CRITICAL:** Sets `app.setName('scorm-tester')` for correct userData path

## Critical Fixes Applied

1. **app.setName('scorm-tester')** - Must be called BEFORE app.whenReady() to set correct userData path
2. **courseId Propagation** - Passed from manifest → RuntimeAdapter → ScormService.initializeSession()
3. **session.courseId Storage** - Stored in session object so terminate() can find correct courseId
4. **No Double Terminate** - Removed duplicate API.Terminate() call from session.js::close()
5. **Shared ScormService** - Single instance per MCP server via getMcpScormService() singleton

## Testing

See `tests/integration/mcp-course-lifecycle-json.real-course.test.js` for complete validation:
- ✅ Complete lifecycle: open → navigate → close → verify JSON → reopen → verify resume
- ✅ Reload preserves data by default
- ✅ Reload with force_new starts fresh
- ✅ All data correctly saved and restored

## Usage Examples

### Basic Open/Close with Auto-Resume
```javascript
// First time - fresh start
const { session_id } = await scorm_open_course({ 
  package_path: "/path/to/course" 
});

// Make changes
await scorm_api_call({ 
  session_id, 
  method: "SetValue", 
  args: ["cmi.location", "slide_5"] 
});

// Close (saves with exit=suspend)
await scorm_close_course({ session_id });

// Reopen - automatically resumes from slide_5
const { session_id: new_session } = await scorm_open_course({ 
  package_path: "/path/to/course" 
});
```

### Hard Reset (Skip Resume)
```javascript
// Open with new_attempt flag
const { session_id } = await scorm_open_course({ 
  package_path: "/path/to/course",
  new_attempt: true  // Skips JSON loading - fresh start
});
```

### Reload with Resume
```javascript
// Reload (closes and reopens - preserves data)
const { session_id: new_session } = await scorm_reload_course({ 
  session_id: current_session,
  package_path: "/path/to/course"
});
```

### Reload with Hard Reset
```javascript
// Reload with force_new (fresh start)
const { session_id: new_session } = await scorm_reload_course({ 
  session_id: current_session,
  package_path: "/path/to/course",
  force_new: true  // Skips JSON loading
});
```

### Manual Cleanup
```javascript
// Physically delete saved JSON file
await scorm_clear_saved_data({ 
  package_path: "/path/to/course" 
});

// Next open will be fresh start
const { session_id } = await scorm_open_course({ 
  package_path: "/path/to/course" 
});
```

## Design Principles

1. **Unified with GUI** - MCP persistence works exactly like GUI persistence
2. **Explicit Control** - Clear flags (new_attempt, force_new) for hard reset vs resume
3. **Safe Defaults** - Resume only when confident (has location, exit=suspend)
4. **No Data Loss** - Always save on close, regardless of exit type
5. **Namespace Isolation** - MCP and GUI sessions don't interfere
6. **No Manipulation** - Data model saved and restored as-is
7. **Proper Lifecycle** - Close always: set exit → terminate → save → destroy window

