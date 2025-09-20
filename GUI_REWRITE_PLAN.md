### **GUI Modernization Report & Action Plan**

**Part 1: Executive Summary**

This document outlines a strategic plan to modernize the SCORM Tester's Graphical User Interface (GUI). A thorough evaluation of the current codebase against the project's architectural specifications (`CORE_APP_SPEC.md` and `GUI_APP_SPEC.md`) reveals a critical disconnect. The GUI is implemented using outdated, imperative patterns that are in direct violation of the specified state-driven, event-based architecture.

The agreed-upon strategy is to **scrap and rewrite the GUI's view layer** while preserving and building upon the existing service layer and assets. This plan details a phased approach to systematically replace the legacy UI with modern, spec-compliant components, ensuring we retain and improve upon all valuable user-facing functionality.

**Part 2: Current State Analysis & Architectural Violations**

*   **1. Legacy Inspector Architecture:** The SCORM Inspector (`scorm-inspector.html`, `scorm-inspector-window.js`) is a standalone, monolithic application that violates the "Pure Consumer of State" and "Single Source of Truth" principles.
*   **2. Pervasive Direct DOM Manipulation:** The GUI is built with `document.getElementById` and `.innerHTML`, which is a direct anti-pattern against the required reactive, state-driven UI model.
*   **3. Static HTML Template:** `index.html` is a large, static file, preventing a dynamic, component-based architecture.
*   **4. Legacy Scripts & Code Style:** Scripts like `click-forwarders.js` and commented-out `console.log` statements violate the principles of component encapsulation and centralized logging.

**Part 3: The Path Forward - A Strategic Rewrite Plan**

**Guiding Principles for the Rewrite:**

*   **Pure Consumer of State:** Components will render UI based only on data from the `UIState` service.
*   **Event-Driven:** Components will communicate by emitting "intent" events to the `EventBus`.
*   **Single Source of Truth:** All application state originates from the main process.

---

#### **Phase 1: Foundation & Decommissioning**

1.  **Decommission Legacy Inspector:** Delete `scorm-inspector.html` and `scorm-inspector-window.js`.
2.  **Decommission Legacy Scripts:** Delete `src/renderer/boot/click-forwarders.js` and `src/renderer/boot/layout-init.js`.
3.  **Prepare the Application Shell:** Gut `index.html` to a minimal shell containing `<div id="app-root"></div>`.
4.  **Update `AppManager`:** Modify `app-manager.js` to initialize and mount the new root components into the `#app-root` element.

#### **Phase 2: Reimplementing Core Functionality with Components**

1.  **Course Loading (`HeaderControls.js`):** Implement controls that emit events like `loadCourseRequest` and subscribe to `UIState` to manage their own state (e.g., enabling a "Reload" button).
2.  **Course Navigation Tree (`CourseOutline.js`):** Create a component that renders the course structure from `UIState`. Clicks must trigger an authoritative `validateCourseOutlineChoice` IPC call before emitting a `navigationRequest` event.
3.  **Content Viewer & Navigation (`ContentViewer.js`, `NavigationControls.js`):** `ContentViewer` will update its `<iframe>` based on `navigation:completed` events. `NavigationControls` will derive its button states solely from `UIState.navigationState`.
4.  **Error Surfacing & Status (`FooterStatusDisplay.js`, `Notifications.js`):** Implement simple components that are pure consumers of progress, status, and error data from `UIState`.

#### **Phase 3: Rebuilding the SCORM Inspector as an Integrated Panel**

1.  **Component & Integration (`ScormInspectorPanel.js`):** Build as a new component that is toggled within the main UI.
2.  **Reimplement Inspector Features:**
    *   **API Traffic:** Listen for `scorm-inspector:api-call-logged` events pushed from the main process.
    *   **Data Model Viewer:** Use an IPC call (`get-scorm-data-model`) to fetch and render the complete data model.
    *   **SN State Viewer:** Use an IPC call (`get-sn-state`) to fetch and render the detailed sequencing state for debugging.

**Part 4: Low ROI / Problematic Features Evaluation**

*   **Handcrafted UI State Logic:** The legacy inspector's complex, manual state management (debouncing, `localStorage` for UI state) will be **excluded**. It is made redundant by a proper state management architecture.
*   **"Enhanced Log Viewer":** This will **not be reimplemented** as a separate logging system. Instead, the inspector will provide a rich, filtered **view** of the single, centralized application log, which is a higher-value, spec-compliant approach.

**Part 5: Ensuring Long-Term Architectural Integrity**

To prevent architectural drift in the future, we will implement the following guardrails:

*   **1. Automated Enforcement via Linting:** We will create custom ESLint rules to programmatically forbid architectural violations. This is the most effective way to maintain discipline.
    *   `no-direct-dom-access`: Ban `document.getElementById`, `querySelector`, etc., within component files.
    *   `no-direct-ipc`: Ban `window.electronAPI` calls from outside the `ScormClient` service.
    *   `no-console-log`: Enforce the use of the `rendererLogger`.

*   **2. Strict Typing with TypeScript:** We will migrate the renderer codebase (`src/renderer`) to TypeScript. This will enforce the data "contracts" for `UIState` and service interfaces, making the system more robust and preventing runtime errors.

*   **3. Architectural Validation Scripts:** We will create a new script, `scripts/validate-renderer-architecture.js`, that can be run as part of our CI/testing process to check for common architectural violations that are difficult to catch with linting alone.

*   **4. Documented Conventions:** These rules and the overall architecture will be clearly documented in a `CONTRIBUTING.md` file to guide future development.

**Part 6: Next Steps**

1.  Execute **Phase 1** to remove all legacy code and prepare the application shell.
2.  Begin **Phase 2** by creating the `HeaderControls.js` and `CourseOutline.js` components.
3.  Concurrently, begin **Phase 3** by creating the `ScormInspectorPanel.js` component, starting with the API Timeline feature.



---

### Part 7: Contracts & Acceptance Criteria (Implementation‑Ready)

This appendix makes the rewrite plan immediately actionable by defining IPC/UI state/EventBus contracts, acceptance criteria, linting/TS scope, file changes, and safety notes. It aligns with CORE_APP_SPEC (Sections 3–6) and GUI_APP_SPEC (Sections 2–7).

#### 7.1 IPC Contracts and Channel Constants

All channels are declared in `src/shared/constants/main-process-constants.js` and registered via `src/main/services/ipc/routes.js`. Error responses are structured via `ErrorHandler` with `code` and message; renderer displays errors without recovery.

Renderer → Main (invoke):
- `validateCourseOutlineChoice`
  - req: `{ activityId: string }`
  - res: `{ valid: boolean, reason?: string }`
  - errors: `NAV_UNSUPPORTED_ACTION`, `SN_NOT_INITIALIZED`
- `getScormDataModel`
  - req: `{}`
  - res: `{ cmi: object }`
  - errors: `RUNTIME_NOT_OPEN`
- `getSnState`
  - req: `{}`
  - res: `{ status: object /* implementation-defined snapshot */ }`
  - errors: `SN_BRIDGE_UNAVAILABLE`, `SN_NOT_INITIALIZED`

Main → Renderer (push/subscribe):
- `navigation:completed`
  - payload: `{ currentActivityId: string|null, availableNavigation: string[], launchUrl?: string /* scorm-app:// … */ }`
- `scorm-inspector:api-call-logged`
  - payload: `{ method: string, args: any[], result: string, errorCode: string, ts: number }`
- `app:error`
  - payload: `{ code: string, message: string, context?: object }`

Notes:
- Content loading URLs are resolved by main process; renderer treats them as opaque `scorm-app://` URLs.
- All IPC handlers are simple dispatchers (no debounce/throttle) per CORE_APP_SPEC 4.1.

#### 7.2 UIState Authoritative Schema (read-only for components)

Minimal initial shape (TypeScript style for clarity; may be implemented in JS first):
- `courseLoaded: boolean`
- `activityTree: { id: string, title: string, children?: Activity[] } | null`
- `navigationState: { currentActivityId: string|null, availableNavigation: ("continue"|"previous"|"choice")[] }`
- `progressState: { completedCount: number, totalCount: number, score?: number|null }`
- `sessionTime: string | null`
- `notifications: Array<{ id: string, level: "info"|"warn"|"error", message: string }>`

Update sources:
- `navigation:completed` → updates `navigationState` and may set `launchUrl` for ContentViewer.
- Inspector/data APIs do not mutate UIState; they feed the Inspector panel directly.

#### 7.3 EventBus Taxonomy (renderer intents)

- `loadCourseRequest`
  - payload: `{}` (file selection orchestrated by services via IPC)
- `navigationRequest`
  - payload: `{ type: "continue"|"previous" }` OR `{ type: "choice", activityId: string }`
- `toggleInspectorRequest`
  - payload: `{ open?: boolean }`

Consumption:
- `AppManager` and services consume intents, perform IPC, and update UIState based on main-process responses/events.

#### 7.4 Component Responsibilities & Data Contracts

- `HeaderControls`
  - reads: `courseLoaded`
  - emits: `loadCourseRequest`, `toggleInspectorRequest`
- `CourseOutline`
  - reads: `activityTree`
  - on item click: calls `validateCourseOutlineChoice`; if `valid`, emits `navigationRequest({ type: "choice", activityId })`
- `NavigationControls`
  - reads: `navigationState.availableNavigation`
  - emits: `navigationRequest({ type: "continue"|"previous" })`
- `ContentViewer`
  - reacts to `navigation:completed` and loads provided `launchUrl` only; no path logic
- `FooterStatusDisplay`
  - reads: `progressState`, `sessionTime`, `notifications`
- `ScormInspectorPanel`
  - receives: `scorm-inspector:api-call-logged`
  - fetches on demand: `getScormDataModel`, `getSnState`

#### 7.5 Acceptance Criteria (Definition of Done)

Phase 1
- Legacy files removed; `index.html` contains only `<div id="app-root"></div>` and required base tags
- `AppManager` mounts root component into `#app-root`
- ESLint rules active: no `console.*`, no direct DOM access, no direct `window.electronAPI`

Phase 2
- `HeaderControls` emits intents; UI reflects `courseLoaded`
- `CourseOutline` validates via IPC before emitting `navigationRequest(choice)`
- `NavigationControls` enablement derives solely from `UIState.navigationState`
- `ContentViewer` loads only resolved `scorm-app://` from main event
- `FooterStatusDisplay` and `Notifications` display state; contain no business logic

Phase 3
- `ScormInspectorPanel` toggles within main UI (no separate window)
- Shows API timeline from push events; can fetch data model and SN state via IPC

#### 7.6 Logging, Errors, and Tests

- Renderer logging uses `renderer-logger.js` only; violations fail lint
- All IPC failures surface as notifications; no client-side recovery
- Tests in CI:
  - Unit: EventBus intent emission, UIState reducers/update flows, component enablement logic
  - Integration: IPC round‑trip for outline validation; error propagation and display
  - Lint/arch: enforce rules and disallow forbidden patterns

#### 7.7 TypeScript & ESLint Scope

- ESLint: enable custom rules immediately (Phase 1) via config update; implement via `no-restricted-globals`/`no-restricted-syntax` or custom plugin
- TypeScript: introduce minimal `.d.ts` types for `UIState` and EventBus payloads during Phase 2; full renderer migration can follow as a separate milestone without blocking

#### 7.8 Safety & MCP Coupling

- MCP offscreen runtime and tooling are unaffected by GUI decommissioning; no dependency on legacy inspector HTML/JS
- Preload/IPC surfaces remain unchanged; renderer must not call `window.electronAPI` directly (only via `ScormClient`)

#### 7.9 File Changes (explicit)

Remove (Phase 1):
- `scorm-inspector.html`
- `scorm-inspector-window.js`
- `src/renderer/boot/click-forwarders.js`
- `src/renderer/boot/layout-init.js`

Modify/Create:
- `index.html` → minimal shell with `#app-root`
- Update `src/renderer/services/app-manager.js` to mount root component and wire services
- Create components under `src/renderer/components/`:
  - `HeaderControls.js`
  - `CourseOutline.js`
  - `ContentViewer.js`
  - `NavigationControls.js`
  - `FooterStatusDisplay.js`
  - `ScormInspectorPanel.js`
- Add CI script `scripts/validate-renderer-architecture.js` (Phase 2/3)
- Update ESLint configuration to enforce architectural rules

This appendix completes the plan and makes it ready for implementation with clear contracts and checklists.
