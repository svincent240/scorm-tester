# Application Refactoring and Hardening Plan

## 1. Goal

The primary goal of this plan is to perform a definitive refactoring of the SCORM Tester application. This effort will resolve foundational architectural inconsistencies to create a stable, maintainable, and secure codebase.

This is not a minor bug-fixing pass; it is a targeted effort to address deep-seated architectural flaws. The successful completion of this plan will align the codebase with the newly established `CORE_APP_SPEC.md` and `GUI_APP_SPEC.md`, preventing the need for similar large-scale refactors in the future.

## 2. Architectural Flaws to Be Addressed

Our review has identified three significant architectural flaws that are the root cause of numerous bugs and development friction. This plan will eliminate them.

#### Flaw 1: Inconsistent Service Ownership & Interfacing
- **Description**: The boundary between the main and renderer processes is blurred. Core services are sometimes initialized or controlled from the UI, and the communication layer (IPC) has two competing, inconsistent implementation patterns (a modern declarative one and a legacy one).
- **Evidence**: `BUG-028` (redundant service initialization), `BUG-032` (inconsistent IPC routing).
- **Impact**: Unpredictable behavior, maintenance overhead, and developer confusion.

#### Flaw 2: Unenforced State Management Model
- **Description**: The architecture intends for the main process to be the single source of truth, but the GUI components do not consistently adhere to this. The UI often contains its own local state or makes decisions based on incomplete data.
- **Evidence**: `BUG-031` (UI allows invalid navigation clicks), `BUG-030` (duplicate UI logic for the same feature), and the entire history of the `course-outline-navigation-plan.md` refactor.
- **Impact**: UI bugs, race conditions, and a confusing user experience where the UI is out of sync with the application's actual state.

#### Flaw 3: Lack of a Systematic Security Policy for UI Rendering
- **Description**: The application lacks an enforced, architecture-level policy for safely rendering data that originates from external, untrusted sources (i.e., the SCORM packages).
- **Evidence**: `BUG-033` (potential HTML injection vulnerability). This is not a one-off bug but a symptom of a missing systemic safeguard.
- **Impact**: Significant security risk (XSS), which could allow a malicious SCORM package to execute code in the renderer.

## 3. Phased Implementation Plan

The plan is broken into four phases, starting with a foundational simplification of the interfacing layer and MCP, then moving from the core application outward to the GUI, and ending with a final verification and hardening phase.

---

### Phase 1: Simplify Interfacing & Consolidate MCP

**Goal**: Eliminate complex, defensive logic from the core by creating a well-behaved client. At the same time, bring the MCP tool in line with its strict, single-execution-model specification.

#### 1.1. Implement Intelligent Client-Side IPC Management
-   **What**: Modify the renderer's `ScormClient` service to be an intelligent adapter. It will implement batching for `SetValue` calls, throttling for frequent `cmi.session_time` updates, and debouncing for `Commit` calls. The main process IPC handlers will be updated to accept these batched requests.
-   **Why**: This makes the renderer a "well-behaved" client. It contains the complexity related to managing SCORM's chatty nature at the edge of the application, where it belongs.
-   **Affected Files**: `src/renderer/services/scorm-client.js`, `src/main/services/ipc-handler.js`.
-   **Success Criteria**: New batched endpoints (e.g., `scorm-set-values`) are defined in `routes.js` and implemented. The `ScormClient` handles all batching transparently.

#### 1.2. Remove and Validate Core IPC Logic
-   **What**: With the client now managing its own behavior, completely remove the rate-limiting logic from the main process's `IpcHandler`. Add a new integration stress test to verify that the new client-side throttling is effective.
-   **Why**: This dramatically simplifies the core application logic. The new test provides confidence that removing the core's defenses does not re-introduce performance problems.
-   **Affected Files**: `src/main/services/ipc-handler.js`, `src/main/services/ipc/rate-limiter.js`, `tests/integration/ipc-stress.test.js` (new).
-   **Success Criteria**: The `rate-limiter.js` file is deleted. The new stress test asserts that a `SetValue` flood from a mock SCO is reduced by >90% at the IPC layer and that `Commit` calls are debounced to <=1 per second.

#### 1.3. Consolidate MCP Execution & Remove Fallbacks
-   **What**: Deprecate and remove the alternative `mcp:*` scripts from `package.json`, leaving a single `mcp` script that launches Electron offscreen. Audit the MCP tool's implementation and remove any structured fallbacks (e.g., for when Electron is unavailable), returning a JSON-RPC error instead.
-   **Why**: This enforces the "single execution model" and "no fallbacks" principles from the `SCORM-MCP-SPECIFICATION.md`, reducing complexity and ensuring predictable behavior for AI clients.
-   **Affected Files**: `package.json`, `src/mcp/**`.
-   **Success Criteria**: Only a single `npm run mcp` script remains. A test confirms that invoking the MCP tool without Electron returns a specific `ELECTRON_REQUIRED` JSON-RPC error.

---

### Phase 2: Core Consolidation & Hardening

**Goal**: Enforce the main process as the single, authoritative source of truth, unify all communication, and harden core components through audits and standardized logging. This directly addresses **Flaw #1**.

#### 2.1. Unify Service Initialization
-   **What**: Refactor the application to ensure the SN service is initialized *only* once in the main process. Remove any code from the renderer that attempts this initialization.
-   **Why**: This resolves `BUG-028` and enforces the "Single Source of Truth" principle.
-   **Affected Files**: `src/main/services/scorm-service.js`, `src/renderer/components/scorm/navigation-controls.js`.
-   **Success Criteria**: The SN service is initialized exactly once per course load, exclusively within the main process.

#### 2.2. Automate IPC Route & Naming Enforcement
-   **What**: Migrate any remaining legacy IPC handlers to the declarative system. Create an automated script or linter rule to enforce that all IPC channels are defined as constants and registered only via `routes.js`.
-   **Why**: This resolves `BUG-032` and prevents architectural drift by programmatically enforcing a single, consistent IPC pattern.
-   **Affected Files**: `src/main/services/ipc-handler.js`, `src/shared/constants/main-process-constants.js`, `scripts/validate-architecture.js` (or similar).
-   **Success Criteria**: The automated check passes, confirming no legacy IPC handlers exist and all channel names are imported from the constants file.

#### 2.3. Enforce Global Logging Standards
-   **What**: Add a lint rule to forbid all `console.*` calls in both the `main` and `renderer` source directories (with an exception for test files). Perform a one-time codebase sweep to remove any existing violations.
-   **Why**: This enforces the architectural rule that all diagnostics must go through the centralized logger, ensuring they are captured and managed consistently.
-   **Affected Files**: `.eslintrc.js`, all files in `src/main/` and `src/renderer/`.
-   **Success Criteria**: The linter fails on any PR that includes a `console.*` call in the application source code.

#### 2.4. Conduct Core Security Audit
-   **What**: Perform a security audit of `FileManager` and `PathUtils`, explicitly testing against the rules in `dev_docs/compatibility_requirements.md` (e.g., manifest must be at root, no path traversal).
-   **Why**: This proactively hardens the most security-sensitive part of the main process against vulnerabilities from untrusted SCORM packages.
-   **Affected Files**: `src/main/services/file-manager.js`, `src/shared/utils/path-utils.js`, `tests/security/path.test.js` (new).
-   **Success Criteria**: A new security test suite passes, confirming path traversal is blocked and manifest location rules are enforced.

---

### Phase 3: GUI & State Unification

**Goal**: Refactor the GUI to be a pure, event-driven consumer of state from the main process, with verifiable and consistent behavior. This directly addresses **Flaw #2**.

#### 3.1. Unify UI Control Logic & Event Naming
-   **What**: Refactor the sidebar toggle logic to use a single, event-driven mechanism. Audit all `eventBus` usage to ensure it conforms to documented naming conventions.
-   **Why**: This resolves `BUG-030` and enforces a consistent, predictable event-driven architecture across all UI components.
-   **Affected Files**: `src/renderer/services/app-manager.js`, `src/renderer/components/**`, `src/renderer/services/event-bus.js`.
-   **Success Criteria**: The sidebar is controlled by a single event type. The `GUI_APP_SPEC.md` is updated with the official event naming conventions.

#### 3.2. Enforce and Test Authoritative State
-   **What**: Modify the `CourseOutline` component to be disabled until it has received authoritative state. Add a new test to verify that `CourseOutline` *always* calls the `validateCourseOutlineChoice` IPC channel before emitting a `navigationRequest`.
-   **Why**: This resolves `BUG-031` and guarantees the UI cannot optimistically allow navigation, preventing a regression.
-   **Affected Files**: `src/renderer/components/scorm/course-outline.js`, `tests/integration/course-outline.test.js` (new).
-   **Success Criteria**: The UI correctly reflects a disabled state. The new integration test passes.

---

### Phase 4: Final Verification & Hardening

**Goal**: Address all remaining security, logic, and MCP issues, and perform a final, comprehensive verification of the entire application. This addresses **Flaw #3**.

#### 4.1. Implement Systematic Output Escaping
-   **What**: Create a single, standard utility function for HTML escaping. Audit all UI components and apply this utility wherever data from a SCORM package is rendered as HTML.
-   **Why**: This resolves `BUG-033` and closes a major security hole by establishing a systematic, enforceable pattern for safely rendering untrusted data.
-   **Affected Files**: `src/renderer/utils/escape.js` (new), `src/renderer/components/**`.
-   **Success Criteria**: Malicious HTML in a manifest title is rendered as inert text. A new test helper asserts that escaping is applied correctly.

#### 4.2. Harden and Test MCP stdout Purity
-   **What**: Create a new test that executes the `npm run mcp` command and asserts that its `stdout` stream contains *only* pure, well-formed JSON-RPC messages, with no other diagnostic text.
-   **Why**: This hardens the AI-facing interface, ensuring it is robust and strictly compliant with its specification, which is critical for reliable automation.
-   **Affected Files**: `tests/integration/mcp-purity.test.js` (new).
-   **Success Criteria**: The new `stdout` purity test passes.

#### 4.3. Final Polish and Verification
-   **What**: Correct the minor logic in the navigation fallback path (`BUG-029`). After all refactoring is complete, execute the entire test suite (unit, integration, E2E, security) to ensure full application functionality.
-   **Why**: This ensures the refactoring effort has increased quality without breaking existing functionality.
-   **Affected Files**: `src/renderer/components/scorm/navigation-controls.js`, `package.json`.
-   **Success Criteria**: All automated tests pass. The `ConsoleMonitor` helper in E2E tests reports no new critical errors.

## 4. Expected Outcome

Upon completion of this plan, the SCORM Tester application will have a stable and coherent architecture that is secure, maintainable, and free of its most significant structural flaws. The codebase will be fully aligned with the principles laid out in the `CORE_APP_SPEC.md` and `GUI_APP_SPEC.md`, providing a solid foundation for all future work.
