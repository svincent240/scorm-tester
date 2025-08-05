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

### Presets and Panels

1) API
- API Timeline
  - Chronological stream of SCORM API calls: Initialize, GetValue, SetValue, Commit, Terminate, GetLastError, GetErrorString, GetDiagnostic.
  - Show timestamp, sequence number, attempt ID, arguments (sanitized), return value, elapsed time, and error code if any.
  - Correlate with EventBus topics to stitch related actions.
  - Sources:
    - [`src/renderer/services/scorm-api-bridge.js`](src/renderer/services/scorm-api-bridge.js:1)
    - [`src/main/services/scorm/rte/api-handler.js`](src/main/services/scorm/rte/api-handler.js:1)
    - [`src/renderer/utils/renderer-logger.js`](src/renderer/utils/renderer-logger.js:1)

- Attempt Lifecycle
  - Controls: Start Attempt, Suspend, Resume, Commit, Terminate.
  - Enablement driven by UIState.rteState and attempt state; disabled actions show inline reason and spec clause.
  - Emits intents (e.g., `attempt:start`, `attempt:suspend`, `api:commit`, `attempt:terminate`) to EventBus for AppManager orchestration.
  - Sources:
    - [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1)
    - [`src/renderer/services/app-manager.js`](src/renderer/services/app-manager.js:1)
    - [`src/renderer/services/event-bus.js`](src/renderer/services/event-bus.js:1)

2) Data
- cmi Data Model Viewer
  - Expandable tree view of `cmi.*` with:
    - Live values
    - Change highlights (recent writes)
    - Last writer source (SCO vs LMS), timestamp
  - Read-only default; expose a Sandbox tab for safe SetValue trials:
    - Stage key-value pairs
    - Validate using shared validator
    - Apply atomically or rollback on failure with error details
  - Sources:
    - [`src/shared/utils/scorm-data-model-validator.js`](src/shared/utils/scorm-data-model-validator.js:1)
    - [`src/main/services/scorm/rte/data-model.js`](src/main/services/scorm/rte/data-model.js:1)
    - [`src/shared/constants/data-model-schema.js`](src/shared/constants/data-model-schema.js:1)

- Error Intelligence
  - Consolidated view: Last Error Code, Error String, Diagnostic
  - History of recent API errors with links to originating calls in the API Timeline
  - Quick references to spec clauses and local compliance docs
  - Sources:
    - [`src/main/services/scorm/rte/error-handler.js`](src/main/services/scorm/rte/error-handler.js:1)
    - [`src/shared/constants/error-codes.js`](src/shared/constants/error-codes.js:1)
    - [`dev_docs/architecture/scorm-compliance.md`](dev_docs/architecture/scorm-compliance.md:1)

3) Sequencing
- Activity Tree Visualizer
  - Live view of activity tree: current activity, suspended state, completion, success, and tracking status.
  - Rule evaluation outcomes for precondition, exit, post, selection rules with last evaluation result per rule.
  - Sources:
    - [`src/main/services/scorm/sn/sequencing-engine.js`](src/main/services/scorm/sn/sequencing-engine.js:1)
    - [`src/main/services/scorm/sn/activity-tree.js`](src/main/services/scorm/sn/activity-tree.js:1)
    - [`src/main/services/scorm/sn/navigation-handler.js`](src/main/services/scorm/sn/navigation-handler.js:1)

- Next-Step Advisor
  - Lists valid sequencing requests from current state: Continue, Previous, Choice to target
  - Disabled items display precise reason and SCORM SN rule reference
  - Action buttons emit navigation intents guarded by UIState

4) Tests
- Compliance Quick-Checks
  - Run curated subset of integration tests via IPC to Node harness; display pass/fail summary and link to logs
  - Suggested minimal set:
    - `tests/integration/scorm-compliance.test.js`
    - `tests/integration/renderer-integration.test.js`
    - `tests/integration/sn-workflow.test.js`
  - Sources:
    - IPC bridge in Main to execute scripts under `scripts/validate-*.js`
    - [`scripts/validate-scorm-compliance.js`](scripts/validate-scorm-compliance.js:1)
    - [`scripts/validate-renderer-integration.js`](scripts/validate-renderer-integration.js:1)

- Performance Micro-Benchmarks
  - Sample latency for 8 API functions
  - Compare vs baseline and flag regressions
  - Display min/avg/p95 and last N calls

5) Diagnostics
- EventBus Inspector
  - Shows last N events with topic, payload summary, handler count, handling latency
  - Filter and search by topic; optional “replay last event” in devModeEnabled only
  - Sources:
    - [`src/renderer/services/event-bus.js`](src/renderer/services/event-bus.js:1)
    - [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1)

- Unified Logger View
  - All renderer logs via renderer-logger and shared logger
  - Tag logs by subsystem: RTE, SN, CAM, UI
  - Search and level filters
  - Sources:
    - [`src/renderer/utils/renderer-logger.js`](src/renderer/utils/renderer-logger.js:1)
    - [`src/shared/utils/logger.js`](src/shared/utils/logger.js:1)

## Interaction Model and Guardrails

- UI emits intents to EventBus; no direct service calls from components.
- AppManager orchestrates requests to scorm-client, scorm-api-bridge, and sn-bridge; UIState remains source of truth.
- Control enablement rules:
  - Initialize enabled when not initialized and launch context valid.
  - SetValue/GetValue enabled only between Initialize and Terminate.
  - Commit disabled if not initialized or after Terminate.
  - Terminate guarded by confirmation and disabled after termination.
- All disabled controls show tooltip reason and SCORM clause.
- No console usage in renderer. Logs route through renderer-logger to app log (see [`dev_docs/style.md`](dev_docs/style.md:42)).

## SCORM Alignment

- RTE
  - Enforce lifecycle Initialize → operational → Commit → Terminate.
  - Show error codes and diagnostics aligned with [`src/shared/constants/error-codes.js`](src/shared/constants/error-codes.js:1).
  - Block writes after termination; explain via spec reference.

- CAM
  - Optional Manifest Diagnostics tab:
    - Manifest parse results, launchable SCOs, metadata checks, and CAM validation
    - Sources:
      - [`src/main/services/scorm/cam/manifest-parser.js`](src/main/services/scorm/cam/manifest-parser.js:1)
      - [`src/main/services/scorm/cam/content-validator.js`](src/main/services/scorm/cam/content-validator.js:1)
      - [`src/main/services/scorm/cam/package-analyzer.js`](src/main/services/scorm/cam/package-analyzer.js:1)

- SN
  - Visualize activity tree and rule evaluations.
  - Next-step advisor maps to valid sequencing requests and explains disallowed ones.

## Signals and Dependencies Diagram

mermaid
flowchart LR
  DebugUI[Debug Window UI] -- emits intents --> EventBus
  EventBus -- dispatch --> AppManager
  AppManager -- orchestrates --> UIState
  DebugUI -- subscribes --> UIState
  DebugUI -- read logs --> RendererLogger
  DebugUI -- run tests via IPC --> MainTestRunner
  AppManager -- uses --> SCORM_Client
  SCORM_Client -- via bridge --> RTE_API_Handler
  SCORM_Client -- sequencing --> SequencingEngine
  SCORM_Client -- cam --> CAM_Services
  RendererLogger -- writes --> AppLog

## Implementation Plan

The plan is incremental and non-breaking. Each step updates docs and adds tests where relevant.

1) Define Debug Window IA and Presets
- Add preset definitions and enablement rules based on UIState.rteState, attempt state, and navigation state.
- Update renderer constants describing panel routes and presets.

2) API Timeline
- Add a stream model fed by renderer-logger and scorm-api-bridge.
- Show request, response, duration, and error code.
- Link entries to Error Intelligence.

3) Attempt Lifecycle Controls
- Buttons bound to intents with guardrails and explanations.
- Confirmations for destructive actions.

4) cmi Data Model Viewer
- Read-only tree with change highlighting and metadata.
- Sandbox SetValue with validator; atomic apply and rollback.

5) Sequencing Visualizer and Next-Step Advisor
- Subscribe to activity tree snapshots and rule evaluations via AppManager.
- Show valid requests and reasons for disabled ones.

6) Error Intelligence
- Consolidate RTE errors and link back to API Timeline entries.
- Provide quick spec references and remediation guidance.

7) EventBus Inspector
- Filterable list of events with timing; devModeEnabled gates replay.

8) Performance Micro-Benchmarks
- Measure API latency with baseline comparison; surface regressions.

9) Compliance Quick-Checks
- IPC from renderer to invoke curated scripts; stream summary back to panel.
- Keep operationally safe; no effect on current learner session state.

10) Manifest Diagnostics (optional but recommended)
- Parse results, launchables, and metadata issues; connect to CAM services.

11) Wiring and Logging
- Ensure all panels read from UIState selectors and use EventBus intents.
- Verify logs flow through renderer-logger and shared logger to app log file.

12) Tests and Docs
- Integration tests for enablement logic, sandbox validation, and intent emissions.
- Update docs in:
  - [`dev_docs/guides/logging-debugging.md`](dev_docs/guides/logging-debugging.md:1)
  - [`dev_docs/architecture/overview.md`](dev_docs/architecture/overview.md:1)
  - This plan file as the single source for Debug UI scope.

## File and Module Changes

Renderer Components: [`src/renderer/components/scorm`](src/renderer/components/scorm:1)
- Extend [`debug-panel.js`](src/renderer/components/scorm/debug-panel.js:1) to host subpanels:
  - api-timeline.js
  - attempt-lifecycle.js
  - data-model-viewer.js
  - sequencing-visualizer.js
  - tests-runner.js
  - eventbus-inspector.js
  - error-intelligence.js
  - manifest-diagnostics.js

Renderer Services:
- UI selectors and derived state in [`src/renderer/services/ui-state.js`](src/renderer/services/ui-state.js:1)
- Debug data aggregator (new) subscribes to renderer-logger and EventBus
- Use [`src/renderer/services/scorm-api-bridge.js`](src/renderer/services/scorm-api-bridge.js:1) and [`src/renderer/services/sn-bridge.js`](src/renderer/services/sn-bridge.js:1)

Main Process:
- Optional IPC endpoints for test execution using:
  - [`scripts/validate-scorm-compliance.js`](scripts/validate-scorm-compliance.js:1)
  - [`scripts/validate-renderer-integration.js`](scripts/validate-renderer-integration.js:1)
  - [`scripts/validate-architecture.js`](scripts/validate-architecture.js:1)

Shared:
- Validators and constants:
  - [`src/shared/utils/scorm-data-model-validator.js`](src/shared/utils/scorm-data-model-validator.js:1)
  - [`src/shared/constants/data-model-schema.js`](src/shared/constants/data-model-schema.js:1)
  - [`src/shared/constants/error-codes.js`](src/shared/constants/error-codes.js:1)

## Enablement and Guardrail Matrix

- Initialize: Enabled when not initialized and course loaded; disabled with reason if API injection failed.
- GetValue: Enabled after Initialize, before Terminate; disabled otherwise.
- SetValue: Enabled after Initialize, before Terminate; sandbox available any time but apply disabled outside valid window.
- Commit: Enabled after Initialize; disabled after Terminate.
- Terminate: Enabled after Initialize, before Terminate; disabled otherwise.

Each disabled state explains why and references SCORM RTE clause; link to [`dev_docs/architecture/scorm-compliance.md`](dev_docs/architecture/scorm-compliance.md:1).

## Telemetry and Performance

- Throttle UI log/event updates to avoid degrading sub-ms API performance.
- Use batched rendering in panels with virtualization for long lists.
- Measure panel render costs and back off update frequency under load.

## Testing Strategy

- Renderer Integration:
  - Control enablement per RTE and attempt states.
  - Sandbox validation and rollback on SetValue failure.
  - EventBus Inspector visibility and filtering.
  - API Timeline entry correctness and linking to errors.

- Compliance:
  - Run full suites locally; Quick-Checks in UI are curated and read-only in effect on session state.

- Performance:
  - Guard sub-ms targets; alert on regression.

## Documentation Updates

- This plan: authoritative scope doc for Debug UI.
- Update:
  - [`dev_docs/guides/logging-debugging.md`](dev_docs/guides/logging-debugging.md:1) with panel usage and devModeEnabled behavior.
  - [`dev_docs/architecture/overview.md`](dev_docs/architecture/overview.md:1) with Debug UI signal flow.

## Acceptance Criteria

- All new panels respect renderer rules in [`dev_docs/style.md`](dev_docs/style.md:42) and route logs to app log.
- UI actions are fully guardrailed; no invalid SCORM operations possible from UI.
- Tests cover enablement, errors, sequencing advisories, and sandbox validation.
- Performance remains within sub-ms API targets.
- Documentation updated in same commit.

## Next Steps

- Approve this plan and the curated Quick-Checks list.
- Implement incrementally in Code mode starting with:
  1) API Timeline
  2) Attempt Lifecycle controls
  3) cmi Data Model Viewer
  4) Sequencing Visualizer skeleton
  5) EventBus Inspector and unified logger view
- Update docs and add tests alongside each increment.