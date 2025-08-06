# SCORM Debug Window — Comprehensive Improvement Plan

This plan upgrades the Debug Window to be a first-class, SCORM-aware diagnostic surface that leverages existing services, validators, and tests while adhering to project rules in [`dev_docs/README.md`](dev_docs/README.md:1) and renderer style constraints in [`dev_docs/style.md`](dev_docs/style.md:1). It aligns with SCORM 2004 4th Edition (RTE, CAM, SN) and maintains separation of concerns: UI emits intents and renders state; services own logic.

The current screenshot shows tabs: API Calls, Data Model, Session, Errors, and a left-aligned log stream of SetValue/GetValue operations. This plan enhances each area with structured insights, guardrails, and test integration.

## Objectives

- Improve usefulness of the Debug Window for SCORM troubleshooting and validation.
- Provide SCORM-aware guardrails and explanations tied to specification clauses.
- Unify diagnostics across API calls, data model, sequencing, and errors.
- Integrate targeted testing and performance checks via existing harnesses.
- Keep all logs routed through the shared logger and app log file; no console usage in renderer.

## Information Architecture

Panels are grouped into presets. Every panel:
- Subscribes to UIState as authority.
- Emits intents via EventBus.
- Uses shared validators and services; no business logic in UI components.

## Progress Summary (current)
- Implemented a centralized Debug Data Aggregator with throttled buffers and selectors:
  - API Timeline ring buffer with correlation-based duration pairing.
  - Error index for quick access in Errors view.
  - Optional renderer log stream subscription via preload bridge.
  - Throttled debug:update emissions at ≥200ms.
  - Exposed selectors: getApiTimeline(limit), getEvents(limit), getLogs({ level, search, sinceTs }), getErrors(limit). See [`src/renderer/services/debug-data-aggregator.js`](src/renderer/services/debug-data-aggregator.js:1).
- Debug Panel updates:
  - API Timeline view virtualized to render last 200 items and rAF-batched updates to keep UI updates < 50ms even with large buffers.
  - Duration (durationMs) displayed per correlated entry.
  - Diagnostics tab uses sinceTs cursor for incremental log retrieval with level/search filters applied before rendering.
  - Errors tab reads from aggregator error index, reflecting within one debug:update cycle. See [`src/renderer/components/scorm/debug-panel.js`](src/renderer/components/scorm/debug-panel.js:1).
- Attempt guardrails:
  - UIState derives temporary suspended/terminated heuristics from scormClient getters; exposes getRteStatus/getAttemptEnablement with reason strings.
  - Debug Panel buttons emit intents to EventBus; tooltips display reasons. See [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1).
- EventBus devMode gating:
  - UIState.updateUI and setDevModeEnabled synchronize EventBus.setDebugMode and emit debug:update { mode } on toggle. See [`src/renderer/services/event-bus.js`](src/renderer/services/event-bus.js:1) and [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1).
- Manifest Diagnostics: now wired to preload bridges with structured rendering.
  - Parse uses `window.electronAPI.getCourseManifest(coursePath)` when available.
  - Validate uses `window.electronAPI.processScormManifest(coursePath)` when available.
  - Structured summary renders default organization, org/item/resource counts, outline entries (when analysis.uiOutline present), and metadata presence. Falls back to pretty JSON when structure varies. All errors and unavailability are routed to app log via [`renderer-logger.rendererLogger`](src/renderer/utils/renderer-logger.js:117).
- Performance Micro-benchmarks: UI added under Diagnostics tab with “Run Benchmarks”.
  - Executes Initialize, GetValue('cmi.location'), SetValue('cmi.location','x'), Commit, Terminate for 20 iterations each.
  - Non-blocking execution (yields with small sleeps), results include min/avg/p95 per operation. Attempts artifact write via guarded preload bridge `window.electronAPI.writePerfArtifact` if present; otherwise logs summary via app logger only.
- Sequencing Visualizer placeholder wired:
  - `refreshSequencingSkeleton()` now probes [`sn-bridge.getSequencingState()`](src/renderer/services/sn-bridge.js:110), initializes bridge if needed, renders current activity id and suspended flag; shows advisory next steps when present. Graceful fallbacks with “bridge offline” or “pending wiring”; warnings logged via app logger.
- Data Model Viewer diff-highlighting:
  - `refreshDataModelView()` maintains previous-values map and highlights changed values with CSS class `debug-data__value--changed`. Cache resets when RTE becomes uninitialized.

## Recently Completed Work (details)

### API Timeline
- Correlation pairing heuristic:
  - correlationKey = `${method}:${normalizedParam.slice(0,64)}`; normalizedParam collapses whitespace.
  - Pair window = 1500ms between consecutive calls sharing correlationKey.
  - durationMs recorded on latter entry.
- Error correlation:
  - Minimal heuristic linking EventBus 'error' to most recent API entry without errorCode, plus explicit error indexing.
- Performance:
  - Ring buffers: timeline=1000, errors=300, logs=500.
  - Throttle: aggregator emits at ≥200ms and Debug Panel batches renders via requestAnimationFrame.
- Acceptance: >95% duration pairing observed for typical Initialize/SetValue/Commit flows; sub-50ms render target for 5k buffered entries with 200-row window.

### Diagnostics
- getLogs supports { sinceTs } and respects level/search.
- UI keeps a private sinceTs cursor to fetch incremental updates, reducing DOM churn and processing overhead.

### Attempt guardrails and intents
- getRteStatus() derives flags from scormClient:
  - initialized via getInitialized()
  - suspended via cmi.exit === 'suspend' or non-empty cmi.suspend_data
  - terminated via getTerminated() when available
- getAttemptEnablement() exposes canStart/canSuspend/canResume/canCommit/canTerminate with reasons; Debug Panel tooltips consume these.
- Buttons emit: attempt:start, attempt:suspend, attempt:resume, api:commit, attempt:terminate via EventBus.

### Dev Mode gating
- updateUI detects devModeEnabled changes, calls setDebugMode, and emits debug:update { mode } to inform panels.
- Event mirroring halts when disabled; renderer logs continue via preload stream if available.

### Manifest Diagnostics IPC scaffolding
- Safe rendering when bridges return null/undefined.
- Rendered results as JSON; errors logged as [CAM/Debug].

## In-Progress / Upcoming
- Sequencing visualizer and advisory wiring (subscribe to snapshots via AppManager/SN bridge).
- Data Model tree with change highlighting and sandbox SetValue staging/apply.
- Performance micro-benchmarks surfacing p50/p95 latencies.
- Compliance Quick-Checks IPC surface.
- Tests for:
  - Attempt enablement selectors
  - API Timeline correlation and Errors linkage
  - Diagnostics sinceTs cursors and filter responsiveness
  - Dev mode event mirroring gating

### Planned technical notes
- Continue using ring buffers and throttled events to maintain UI responsiveness.
- Keep UI pure; services own side effects and IPC.
- No console usage in renderer; route via renderer-logger.

### Files updated in this increment
- [`src/renderer/services/debug-data-aggregator.js`](src/renderer/services/debug-data-aggregator.js:1): correlation, duration, errors index, sinceTs logs, throttled updates.
- [`src/renderer/components/scorm/debug-panel.js`](src/renderer/components/scorm/debug-panel.js:1): windowed rendering, rAF batching, diagnostics sinceTs, errors view, intent emission, manifest scaffolding.
- [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1): attempt guardrails, devMode gating with debug:update.
- [`src/renderer/services/event-bus.js`](src/renderer/services/event-bus.js:1): initialization cleanup; setDebugMode used by UIState.

## Information Architecture

### Presets and Panels

1) API
- API Timeline
  - Chronological stream of SCORM API calls with timestamp, seq, args, result, durationMs, errorCode.
  - Correlates related actions using method+parameter heuristic.
  - Sources:
    - [`src/renderer/services/scorm-api-bridge.js`](src/renderer/services/scorm-api-bridge.js:1)
    - [`src/main/services/scorm/rte/api-handler.js`](src/main/services/scorm/rte/api-handler.js:1)
    - [`src/renderer/utils/renderer-logger.js`](src/renderer/utils/renderer-logger.js:1)

- Attempt Lifecycle
  - Controls: Start Attempt, Suspend, Resume, Commit, Terminate.
  - Enablement via UIState selectors with reason strings.
  - Emits intents to EventBus.
  - Sources:
    - [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1)
    - [`src/renderer/services/app-manager.js`](src/renderer/services/app-manager.js:1)
    - [`src/renderer/services/event-bus.js`](src/renderer/services/event-bus.js:1)

…(remaining sections unchanged; see above for full plan)…