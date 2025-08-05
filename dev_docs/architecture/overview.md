# Application Architecture Overview

> Footer progress display consolidation
>
> - The application footer is the single source of truth for compact progress indicators.
> - Footer composition:
>   - FooterProgressBar updates #footer-progress-fill and #footer-progress-percentage
>   - FooterStatusDisplay updates #footer-status, #footer-score, and #footer-time
> - The full ProgressTracking component is a standalone widget intended for non-footer contexts (e.g., sidebar or dedicated panels). It should not be mounted in the footer to avoid duplicate progress UIs.
> - The hidden #progress-tracking placeholder previously inside the footer was removed from index.html to enforce this pattern.

## System Architecture

The SCORM Tester is an Electron-based desktop application designed to simulate various Learning Management System (LMS) environments for testing SCORM 2004 4th Edition content packages locally.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SCORM Tester Application                 │
├─────────────────────────────────────────────────────────────┤
│  Main Process (Node.js)          │  Renderer Process (Web)  │
│  ┌─────────────────────────────┐  │  ┌─────────────────────┐ │
│  │     SCORM Engine            │  │  │   User Interface    │ │
│  │  ┌─────────────────────────┐│  │  │  ┌─────────────────┐│ │
│  │  │ Content Aggregation     ││  │  │  │ Content Viewer  ││ │
│  │  │ Model (CAM)             ││  │  │  │                 ││ │
│  │  │ - Manifest Parser       ││  │  │  │ - SCO Display   ││ │
│  │  │ - Content Validator     ││  │  │  │ - API Bridge    ││ │
│  │  │ - Metadata Handler      ││  │  │  │ - Debug Panel   ││ │
│  │  └─────────────────────────┘│  │  │  └─────────────────┘│ │
│  │  ┌─────────────────────────┐│  │  │  ┌─────────────────┐│ │
│  │  │ Run-Time Environment    ││  │  │  │ Navigation      ││ │
│  │  │ (RTE)                   ││  │  │  │ Controls        ││ │
│  │  │ - SCORM API Handler     ││  │  │  │                 ││ │
│  │  │ - Data Model Manager    ││  │  │  │ - Course Tree   ││ │
│  │  │ - Session Manager       ││  │  │  │ - Progress      ││ │
│  │  │ - Error Handler         ││  │  │  │ - Controls      ││ │
│  │  └─────────────────────────┘│  │  │  └─────────────────┘│ │
│  │  ┌─────────────────────────┐│  │  │  ┌─────────────────┐│ │
│  │  │ Sequencing &            ││  │  │  │ Configuration   ││ │
│  │  │ Navigation (SN)         ││  │  │  │ & Settings      ││ │
│  │  │ - Activity Tree         ││  │  │  │                 ││ │
│  │  │ - Sequencing Engine     ││  │  │  │ - LMS Profiles  ││ │
│  │  │ - Navigation Handler    ││  │  │  │ - Preferences   ││ │
│  │  │ - Rollup Manager        ││  │  │  │ - Debug Tools   ││ │
│  │  └─────────────────────────┘│  │  │  └─────────────────┘│ │
│  └─────────────────────────────┘  │  └─────────────────────┘ │
│  ┌─────────────────────────────┐  │                          │
│  │     System Services         │  │                          │
│  │ - File Manager              │  │                          │
│  │ - Window Manager            │  │                          │
│  │ - IPC Handler               │  │                          │
│  │ - Configuration Manager     │  │                          │
│  └─────────────────────────────┘  │                          │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### Main Process (Node.js Backend)

The main process handles all system-level operations and SCORM processing logic:

#### SCORM Engine
- **Content Aggregation Model (CAM)**: Handles SCORM package parsing, validation, and metadata extraction
- **Run-Time Environment (RTE)**: Implements the SCORM API and manages learner data
- **Sequencing & Navigation (SN)**: Processes sequencing rules and navigation requests

#### System Services
- **File Manager**: Handles SCORM package extraction and file operations
- **Window Manager**: Manages Electron windows and their lifecycle
- **IPC Handler**: Facilitates communication between main and renderer processes
- **Configuration Manager**: Manages application settings and LMS profiles

### Renderer Process (Web Frontend)

The renderer process provides the user interface and content display:

#### Content Display
- **Content Viewer**: Displays SCO content with proper SCORM API integration
- **Debug Panel**: Shows SCORM API calls, data model state, and debugging information

#### User Interface
- **Navigation Controls**: Provides learner navigation (Next, Previous, Menu)
- **Course Tree**: Displays course structure and progress
- **Configuration UI**: Settings and LMS profile management

## Design Principles

### 1. SCORM 2004 4th Edition Compliance
- Full implementation of all three SCORM specification books (CAM, RTE, SN)
- Proper error handling with SCORM-defined error codes
- Complete data model support for all cmi.* elements
- Sequencing rule evaluation and navigation processing

### 2. Modular Architecture
- Clear separation of concerns between SCORM components
- Service-oriented design with well-defined interfaces
- Dependency injection for testability and flexibility
- Plugin architecture for extending LMS profiles

### 3. Security Model
- Sandboxed renderer process with limited Node.js access
- Input validation and sanitization for all SCORM data
- Path traversal protection for file operations
- XSS prevention in content display

### 4. Performance Optimization
- Lazy loading of SCORM packages and content
- Efficient memory management for large courses
- Background processing for manifest parsing
- Caching strategies for frequently accessed data

### 5. Developer Experience
- Comprehensive logging and debugging tools
- Hot reload support for development
- Extensive test coverage with SCORM compliance validation
- Clear documentation and API references

## Data Flow

### SCORM Package Loading
1. User selects SCORM package (IP file)
2. File Manager extracts package to temporary directory
3. CAM Manifest Parser validates and parses imsmanifest.xml
4. Content Validator checks package integrity and compliance
5. CAM builds a UI-focused static outline (analysis.uiOutline) from organizations; if organizations are missing/invalid, a resources-based fallback outline is generated.
6. Renderer consumes analysis.uiOutline and normalizes to items for CourseOutline; renderer must not reconstruct outline from raw manifest.
7. SN Activity Tree is constructed separately from organization structure for runtime sequencing (distinct from UI outline).
8. UI updates to show course structure and enable navigation

### Renderer Eventing and State Authority

The renderer uses an event-driven model with UIState as the authority for navigation state and notifications. Components emit intents and subscribe to normalized state.

Key patterns:
- UIState is the single source of truth for navigationState
- NavigationControls emit navigation:request intents; they bind to UIState.navigationState (normalized canNavigatePrevious/canNavigateNext)
- AppManager wires NavigationControls to ContentViewer explicitly
- Initialization and runtime errors are handled centrally: log via renderer logger, set UI error, show notifications, and emit app:error events
- EventBus debug mode is default off and synchronized with UIState.ui.devModeEnabled

References:
- [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:90)
- [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:177)
- [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:349)
- [src/renderer/services/ui-state.js](src/renderer/services/ui-state.js:240)
- [src/renderer/services/event-bus.js](src/renderer/services/event-bus.js:219)
- [src/renderer/app.js](src/renderer/app.js:31)

### Renderer Event Flow (Mermaid)

flowchart TD
  A[Course load] --> B[UIState.updateCourse]
  B --> C[ContentViewer injects or bridges SCORM API]
  B --> D[CourseOutline renders]
  C --> E[Progress updates via UIState.updateProgress]
  E --> F[Footer updates via progress:updated]
  B --> G[SNBridge provides availableNavigation]
  G --> H[UIState.navigationState normalized]
  H --> I[NavigationControls enable/disable]
  I --> J[navigation:request intents]
  J --> G
  C -. error .-> K[UIState notification + app log]
  A -. init error .-> L[Centralized notification + app:error]


### SCO Launch and Execution
1. User selects SCO from course tree
2. Sequencing Engine evaluates preconditions and availability
3. RTE Session Manager initializes new attempt
4. Content Viewer loads SCO in sandboxed iframe
5. SCORM API bridge is established between SCO and main process
6. SCO calls Initialize() to begin session
7. Data exchange occurs via GetValue/SetValue calls
8. SCO calls Terminate() to end session
9. Sequencing Engine processes navigation requests and postconditions

### Navigation and Sequencing
1. Navigation request triggered (Continue, Previous, Choice)
2. Sequencing Engine evaluates current activity state
3. Sequencing rules are processed (preconditions, postconditions)
4. Target activity is determined based on rules and tree structure
5. Rollup processing updates parent activity statuses
6. UI updates to reflect new current activity and available navigation

## Technology Stack

### Core Technologies
- **Electron**: Cross-platform desktop application framework
- **Node.js**: Backend runtime for main process
- **Chromium**: Web engine for renderer process
- **JavaScript/ES6+**: Primary programming language

### Key Libraries
- **xml2js**: XML parsing for SCORM manifests
- **archiver/yauzl**: ZIP/archival handling for SCORM packages
- **winston**: Structured logging
- **joi**: Data validation and schema enforcement
- **electron-builder**: Application packaging and distribution

### Development Tools
- **Jest**: Testing framework with SCORM compliance tests
- **ESLint**: Code quality and style enforcement
- **JSDoc**: API documentation generation
- **TypeScript**: Type definitions for better AI tool support

## Configuration Management

### LMS Profiles
The application supports multiple LMS simulation profiles:
- **Generic SCORM**: Standard SCORM 2004 4th Edition behavior
- **Moodle**: Moodle-specific behaviors and quirks
- **Litmos**: Litmos LMS simulation
- **SCORM Cloud**: Rustici SCORM Cloud compatibility

### Settings Hierarchy
1. **Default Settings**: Built-in application defaults
2. **Global Settings**: User preferences stored in app data
3. **Project Settings**: Per-SCORM package configurations
4. **Runtime Settings**: Temporary session-specific overrides

## Error Handling Strategy

### SCORM Error Codes
- Complete implementation of SCORM-defined error codes (0-999)
- Proper error state management and recovery
- Detailed diagnostic information for debugging

### Application Error Handling
- Graceful degradation for non-critical failures
- Comprehensive logging with structured error information
- User-friendly error messages with technical details available
- Automatic error reporting and crash recovery

### IPC Rate Limiting and Suppression
- Main IPC layer applies per-channel rate limiting.
- On first engagement per session and channel (renderer-log-*, scorm-set-value, scorm-commit, scorm-terminate), log a single INFO line: “rate-limit engaged on <channel>; further rate-limit logs suppressed for this session”.
- Subsequent rate-limited calls on these channels return soft-ok with no additional logs.
- Renderer logger coalesces duplicates and applies silent backoff; renderer must not emit rate-limit warnings.

### Graceful Shutdown Sequence
1. Attempt SCORM session termination (best-effort, soft-ok, timeout-guarded) before unregistering IPC handlers.
2. Unregister IPC handlers and clear IPC histories.
3. Close windows/menus and finalize services.
- Benign “already terminated” or late shutdown scenarios must not escalate to ERROR logs.

## Testing Strategy

### Test Categories
1. **Unit Tests**: Individual module and function testing
2. **Integration Tests**: Component interaction validation
3. **SCORM Compliance Tests**: Specification adherence verification
4. **End-to-End Tests**: Complete workflow validation
5. **Performance Tests**: Load testing with large SCORM packages

### Compliance Validation
- Automated testing against SCORM 2004 4th Edition requirements
- Integration with ADL test suites where possible
- Continuous validation during development
- Regression testing for SCORM compatibility

This architecture provides a solid foundation for a maintainable, extensible, and fully SCORM-compliant testing application while supporting modern development practices and AI-assisted development workflows.