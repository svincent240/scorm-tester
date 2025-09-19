# GUI Application Specification

## 1. Overview

This document defines the architecture for the SCORM Tester's renderer process (GUI). It is the authoritative guide for creating predictable, maintainable, and secure user interface components. The GUI's primary role is to present state and forward user intentions to the main process.

## 2. Core Architectural Principles

All GUI code (components, services, etc.) **MUST** adhere to these non-negotiable principles.

### 2.1. Pure Consumer of State
The GUI **MUST NOT** contain its own business logic or source-of-truth state for core concepts like SCORM data or navigation availability. It is a "dumb" renderer of state provided by the main process. The `UIState` service is the only local cache of state, and it is read-only for components.

### 2.2. Event-Driven and Intent-Based
Components **MUST** be loosely coupled. They **MUST NOT** call methods on each other directly. 
- **Communication**: All interactions **MUST** happen via the `EventBus` service.
- **User Actions**: User interactions (e.g., button clicks) **MUST** be published as "intent" events (e.g., `navigationRequest`). They describe *what* the user wants to do, not *how* to do it.

### 2.3. No Fallbacks or Recovery Logic
In accordance with the core application principles, the GUI **MUST NOT** implement any fallback behaviors. If a feature's state is unavailable from the main process, the corresponding UI **MUST** be disabled or hidden. The UI does not attempt to recover from backend errors; it only displays them.

### 2.4. Strict, Centralized Logging
All logging **MUST** be directed through the `renderer-logger.js` utility. Direct use of `console.*` is strictly forbidden to ensure all diagnostic information is captured in the application's log file.

### 2.5. Systematic Security
All data that originates from an external source (e.g., SCORM package manifest) and is rendered as HTML **MUST** be properly escaped to prevent Cross-Site Scripting (XSS) attacks.

## 3. GUI Architecture

The GUI follows a service-oriented pattern with a clear separation between state, services, and components.

```
Renderer Process
├── Services
│   ├── AppManager       (Orchestrator)
│   ├── UIState          (Authoritative UI State Cache)
│   ├── EventBus         (Local Event Communication)
│   └── ScormClient      (IPC Client to Main Process)
│
└── Components
    ├── CourseOutline
    ├── NavigationControls
    ├── ContentViewer
    └── ScormInspectorPanel
```

### 3.1. Services
*   **`AppManager`**: The central orchestrator for the renderer. It wires services and components together on initialization. It is the primary handler for complex event sequences.
*   **`UIState`**: A read-only cache of the application's state (e.g., `navigationState`, `courseLoaded`). Components subscribe to `UIState` for updates but **MUST NOT** modify it directly. State is updated by services in response to events from the main process.
*   **`EventBus`**: The channel for all intra-renderer communication. 
*   **`ScormClient`**: A wrapper around the Electron `preload` API that handles all IPC communication with the main process.

### 3.2. Components
Components are self-contained UI elements that follow a consistent lifecycle.
*   **Inheritance**: All components **SHOULD** extend `BaseComponent` to inherit common functionality like event subscription management.
*   **Responsibilities**: A component is responsible for rendering its UI based on state from `UIState` and emitting user-intent events to the `EventBus`.
*   **State**: Components **MUST NOT** maintain their own complex internal state. They should be stateless renderings of the global `UIState`.

## 4. Key Component Contracts

### 4.1. `CourseOutline`
*   **Data Source**: Its structure and state (e.g., completion status, attempt counts, enabled/disabled status) **MUST** be driven exclusively by the activity tree data fetched from the main process's SN service.
*   **Navigation**: On item click, it **MUST** first perform an authoritative IPC call (`validateCourseOutlineChoice`) to the main process to verify the navigation is permitted by SCORM sequencing rules. If and only if the main process confirms the choice is valid, it may then emit a `navigationRequest` event.

### 4.2. `NavigationControls`
*   **State**: The `enabled`/`disabled` state of the "Previous" and "Next" buttons **MUST** be derived solely from the `availableNavigation` array within `UIState.navigationState`.
*   **Action**: On click, the buttons **MUST** emit a `navigationRequest` event with the appropriate type (`continue` or `previous`).

### 4.3. `ContentViewer`
*   **Content Loading**: It **MUST** only load content from a final, resolved `scorm-app://` URL provided to it. It **MUST NOT** perform any path resolution or manipulation itself.
*   **SCORM API**: It is responsible for injecting the SCORM API bridge (`API_1484_11`) into the content iframe's window *before* the content is loaded.

## 5. Error Handling

*   **Display, Don't Handle**: When the GUI receives an error event from the main process, its primary job is to display it to the user via the centralized notification system.
*   **No Recovery**: The GUI **MUST NOT** contain complex error recovery logic. For example, if a course fails to load, it displays the error. It does not attempt to parse the course differently or find a missing file.

## 6. Logging

*   **Mandatory Utility**: All logging **MUST** use the `renderer-logger.js` utility.
*   **Prohibited**: `console.log`, `console.warn`, `console.error`, etc., are forbidden. The linter enforces this.
*   **Purpose**: This ensures all diagnostic information, including from the renderer, is captured in the single `app.log` file for unified debugging.
