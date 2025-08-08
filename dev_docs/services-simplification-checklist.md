# Main Services Simplification Checklist — Keep SCORM Coverage, Improve Clarity

Objective
- Preserve all current capabilities aligned with SCORM 2004 (RTE, CAM, SN) and the app’s goal of uncovering real course issues.
- Simplify the main-process services to reduce bugs, make behavior predictable, and communicate issues clearly to users and logs.
- This checklist is actionable and incremental; each step keeps the app working.

References
- IPC plan: [dev_docs/ipc-simplification-plan.md](dev_docs/ipc-simplification-plan.md:1)
- Services plan: [dev_docs/main-services-simplification-plan.md](dev_docs/main-services-simplification-plan.md:1)
- Current files:
  - [src/main/services/base-service.js](src/main/services/base-service.js:1)
  - [src/main/services/file-manager.js](src/main/services/file-manager.js:1)
  - [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:1)
  - [src/main/services/menu-builder.js](src/main/services/menu-builder.js:1)
  - [src/main/services/recent-courses-service.js](src/main/services/recent-courses-service.js:1)
  - [src/main/services/scorm-service.js](src/main/services/scorm-service.js:1)
  - [src/main/services/window-manager.js](src/main/services/window-manager.js:1)

SCORM-first messaging principles
- Never hide content defects. Detect, classify, and report with:
  - code: SCORM error code or internal code
  - message: human-readable summary
  - details: structured context (paths, element names, limits)
  - specRef: link text to spec section (human-friendly string)
- Log at info for user-impacting events, debug for internals. Prefer single-line structured entries.

Cross-cutting utilities to introduce
- ipc-result helpers: success(data), failure(code, message, details?, specRef?)
- ipc-validation guards for payload shape and path sanity
- DebugTelemetryStore (main) with API: store(event), clear(), getHistory(), flushTo(webContents)
- Optional: SNSnapshotService (main) for polling SN.getStatus() outside [IpcHandler](src/main/services/ipc-handler.js:1)
- Singleflight+debounce utility for coalescing UI-triggered actions

A) BaseService [src/main/services/base-service.js](src/main/services/base-service.js:1)
- [ ] Add emitError(code, message, origin) to centralize errorHandler + logging
- [ ] Ensure state change logs are debug-level to reduce log noise
- [ ] Keep metrics minimal: operationCount, errorCount, lastOperation, uptime

Why: Gives consistent error plumbing across services without duplicating patterns.

B) FileManager [src/main/services/file-manager.js](src/main/services/file-manager.js:1)
- [ ] Unify manifest checks behind getManifestPath(folderPath)
  - Replace repeated logic in:
    - [findScormEntry()](src/main/services/file-manager.js:267)
    - [getCourseInfo()](src/main/services/file-manager.js:304)
    - [getCourseManifest()](src/main/services/file-manager.js:342)
- [ ] Use one canonical temp root (prefer app.getPath('temp')/scorm-tester) instead of "../../../temp"
  - Affects:
    - [extractScorm() path creation](src/main/services/file-manager.js:221)
    - [saveTemporaryFile() temp dir](src/main/services/file-manager.js:400)
    - [ensureTempDirectory()](src/main/services/file-manager.js:582)
- [ ] Harden ZIP traversal and counting in [extractZipWithValidation()](src/main/services/file-manager.js:447)
  - Normalize each entry path
  - Resolve final target path and ensure it startsWith(extractPath)
  - Count skipped suspicious entries and log totals: extractedCount, skippedCount
- [ ] Prefer async fs ops in hot paths (stat, readFile, writeFile) to avoid blocking
- [ ] Return structured failure envelopes with user-facing context:
  - Missing manifest → message: imsmanifest.xml not found; details: { folderPath }; specRef: CAM: package structure
  - Size limit exceeded → message with formatted sizes; details: { totalBytes, limitBytes }
- [ ] Expose a helper formatLimitExceededMessage(bytes, limit) for consistent UX

Why: Reduces duplication, increases safety, and communicates issues clearly without masking them.

C) IpcHandler [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:1)
- [ ] Implement routes table + wrapperFactory per [dev_docs/ipc-simplification-plan.md](dev_docs/ipc-simplification-plan.md:1)
  - Replace per-channel branches inside [wrapHandler()](src/main/services/ipc-handler.js:248)
- [ ] Rate limiter with named profiles (default, rendererLogs soft-drop, snBypass, uiSparse)
  - Replace [checkRateLimit()](src/main/services/ipc-handler.js:529) channel-specific logic
- [ ] Singleflight+debounce for open-debug-window only; remove bespoke _openDebugGuards
- [ ] Move SN poller out of IpcHandler (optional if SNSnapshotService introduced)
- [ ] Move API call history to DebugTelemetryStore; remove:
  - [storeApiCall()](src/main/services/ipc-handler.js:971)
  - [sendBufferedApiCalls()](src/main/services/ipc-handler.js:989)
  - [clearApiCallHistory()](src/main/services/ipc-handler.js:1003)
  - [getApiCallHistory()](src/main/services/ipc-handler.js:1009)
- [ ] Convert sync registrations to async handle() to unify routing
- [ ] Normalize handler return envelopes via ipc-result helpers

Why: Router becomes predictable and small, while keeping all channels intact.

D) ScormService [src/main/services/scorm-service.js](src/main/services/scorm-service.js:1)
- [ ] Delegate RTE operations to the RTE service layer
  - Replace session.data as system-of-record in:
    - [getValue()](src/main/services/scorm-service.js:214)
    - [setValue()](src/main/services/scorm-service.js:248)
    - [commit()](src/main/services/scorm-service.js:282)
    - [terminate()](src/main/services/scorm-service.js:313)
  - Maintain session metadata and API call traces here; let RTE map SCORM error codes
- [ ] Keep SN integration but remove duplicated logic; use explicit SN service APIs for:
  - updateActivityProgress, updateActivityLocation, handleActivityExit
  - See [processSpecialElement()](src/main/services/scorm-service.js:732)
- [ ] Move LMS profiles to a config JSON or separate module; load on init
  - Replace [initializeLmsProfiles()](src/main/services/scorm-service.js:642) with a loader
- [ ] Publish debug telemetry via DebugTelemetryStore instead of direct [notifyDebugWindow()](src/main/services/scorm-service.js:783)
- [ ] Structured envelopes with specRef and codes for validation/analysis:
  - [validateCompliance()](src/main/services/scorm-service.js:381)
  - [analyzeContent()](src/main/services/scorm-service.js:414)
  - [processScormManifest()](src/main/services/scorm-service.js:442)

Why: Aligns with SCORM layering, improves correctness, and keeps telemetry centralized.

E) RecentCoursesService [src/main/services/recent-courses-service.js](src/main/services/recent-courses-service.js:1)
- [ ] On retrieval ([getRecents()](src/main/services/recent-courses-service.js:51)), annotate items with exists boolean (non-destructive check)
- [ ] Make JSON writes atomic: write to temp file then rename
- [ ] Retain max list size and ordering logic

Why: Improves UX by signaling missing paths without deleting history.

F) WindowManager [src/main/services/window-manager.js](src/main/services/window-manager.js:1)
- [ ] Replace [sendBufferedApiCallsToDebugWindow()](src/main/services/window-manager.js:450) with DebugTelemetryStore.flushTo(debugWindow.webContents)
- [ ] Centralize webPreferences in a constant to keep main/debug consistent
- [ ] Keep custom protocol registration; enhance undefined-path messaging already present
- [ ] Guard [createDebugWindow()](src/main/services/window-manager.js:170) with a singleflight to prevent duplicates

Why: Decouples windowing from telemetry storage and ensures consistent, safe window config.

G) MenuBuilder [src/main/services/menu-builder.js](src/main/services/menu-builder.js:1)
- [ ] Optional: define accelerators and labels in a constants module for consistency
- [ ] Ensure all actions route through a single sendMenuAction path (already done)

Why: Keeps it simple and maintainable; no logic changes needed.

Error taxonomy and messaging
- Map common RTE errors: 0 ok, 101 general_exception, 103 already_initialized, 301 not_initialized, 401 invalid_argument_error
- CAM issues report as:
  - code: CAM_VALIDATION_ERROR or CAM_PARSE_ERROR
  - message: short, human-readable summary
  - specRef: “SCORM 2004 4th Ed — CAM”
- SN issues report as:
  - code: SN_UNAVAILABLE or SN_PROCESSING_ERROR
  - message: reason, including target activity id when relevant
  - details: { navigationRequest, targetActivityId }

Incremental rollout (each step leaves the app working)
1) Utilities: ipc-result, ipc-validation, DebugTelemetryStore (no behavior change; wire logs only)
2) IpcHandler consolidation: routes + wrapper + limiter + singleflight; migrate sync->async registrations
3) ScormService RTE delegation and telemetry publishing
4) FileManager hardening and manifest unification; temp root standardization
5) WindowManager telemetry decoupling and webPreferences constant
6) RecentCourses exists-annotation and atomic writes
7) Validation + envelope adoption across critical handlers
8) Tests: limiter, singleflight, RTE delegation, CAM traversal defense, telemetry flush; docs updated

Acceptance criteria
- All existing channels and service APIs continue to function; no renderer changes required.
- Clear, consistent error envelopes returned to renderer and logged in app log.
- Reduced complexity in IpcHandler and ScormService; fewer branches and timers in routing layer.
- FileManager protects against traversal and communicates limits clearly.
- Debug window receives telemetry via a single store with bounded memory.

Mermaid overview

```mermaid
flowchart LR
  Renderer -->|IPC| IpcHandler
  IpcHandler -->|routes/wrapper| ScormService
  IpcHandler -->|file ops| FileManager
  IpcHandler -->|logs| DebugTelemetryStore
  ScormService -->|RTE API| RTE
  ScormService -->|CAM| CAM
  ScormService -->|SN| SN
  WindowManager --> DebugWindow
  DebugTelemetryStore -->|flushTo| DebugWindow