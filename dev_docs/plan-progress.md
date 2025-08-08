# Plan Progress Tracking — IPC, Renderer, and Main Services Simplification

As of 2025-08-08 (updated 2025-08-08), progress across the three simplification plans is tracked in a centralized plan-progress document. This plan provides a concise status snapshot and concrete steps to realize the plans, with cross-references to the original plan documents. The repository has implemented Phase 0–6 artifacts (routes table, wrapper factory, profile-aware rate limiter, singleflight util, DebugTelemetryStore) and the main wiring to instantiate and inject those services. SNSnapshotService has been added and is now owned and started by main; main wires it into IpcHandler and ScormService. The remaining work now focuses on tests, a final pass on per-route opt-ins where needed, and documentation/rollout guidance.

## IPC Simplification Plan Progress

- Status: Largely implemented and rolled into the codebase — cleanup completed for legacy telemetry buffering; a small set of tests and docs remain.
- Completed items:
  - Phase 0 — Baseline and guardrails: Feature flag wiring scaffolded; structured IPC logs added.
  - Phase 1 — Routes table and unified wrapper: Implemented [`src/main/services/ipc/routes.js`](src/main/services/ipc/routes.js:1) and [`src/main/services/ipc/wrapper-factory.js`](src/main/services/ipc/wrapper-factory.js:1).
  - Phase 2 — Consolidated rate limiter: Implemented profile-aware limiter [`src/main/services/ipc/rate-limiter.js`](src/main/services/ipc/rate-limiter.js:1).
  - Phase 3 — Singleflight + debounce for open-debug-window: [`src/shared/utils/singleflight.js`](src/shared/utils/singleflight.js:1) and wrapper usage implemented (open-debug-window route declared). The declarative wrapper now owns singleflight/debounce behavior for that route.
  - Phase 4 — SNSnapshotService added and ownership migrated: [`src/main/services/scorm/sn/snapshot-service.js`](src/main/services/scorm/sn/snapshot-service.js:1) exists; main constructs and starts/owns it; IpcHandler no longer holds a persistent SN poller.
  - Phase 5 — Debug telemetry store: Implemented [`src/main/services/debug/debug-telemetry-store.js`](src/main/services/debug/debug-telemetry-store.js:1). IpcHandler and WindowManager now delegate storage/flush/clear to the telemetry store; legacy in-class buffering/fallbacks were removed as part of cleanup.
  - Phase 6 — Normalize sync to async: previously-sync channels (e.g., `log-message`, `debug-event`) have been registered as async handle() and the routes approach is in place.
  - Additional completed follow-ups:
    - Renderer CourseLoader now uses a browser-safe ArrayBuffer→Base64 helper and no longer relies on Node Buffer (`src/renderer/services/course-loader.js`).
    - ScormAPIBridge message handler is lazy (enable/disable) and exported for controlled initialization (`src/renderer/services/scorm-api-bridge.js`).
    - FileManager.extractScorm and extractZipWithValidation return extraction statistics (extractedCount, skippedCount, totalSize) and enforce resolved-path assertions (`src/main/services/file-manager.js`).
    - WindowManager no longer depends on IpcHandler internals for debug telemetry; it uses `telemetryStore.flushTo` and a singleflight guard for debug window creation (`src/main/services/window-manager.js`).
    - Initial unit test scaffolds added under `tests/unit/main/ipc/` and a focused wrapper-factory test was added (`tests/unit/main/ipc/wrapper-factory.spec.js`).

- Next steps (priority order):
  - Phase 7 — Light validation and envelope (mostly completed):
    - `ipc-validation` and `ipc-result` helpers exist ([`src/shared/utils/ipc-validation.js`](src/shared/utils/ipc-validation.js:1), [`src/shared/utils/ipc-result.js`](src/shared/utils/ipc-result.js:1)).
    - Many critical routes opt into `useIpcResult`/`validateArgs` in the routes table; a final audit/opt-in pass was performed for the highest-risk channels (Initialize/GetValue/SetValue/Commit/Terminate, file selection/resolution). Any remaining per-route tweaks are small and tracked in TODOs.
    - Action: finish a short audit to ensure all critical channels have the intended `useIpcResult`/`validateArgs` flags (low-risk changes).
  - Phase 8 — Tests and docs (high priority):
    - Add tests for: limiter profiles, singleflight+debounce correctness for open-debug-window, SNSnapshotService passthrough behavior, telemetry trimming/flush, and FileManager traversal defenses (test stubs exist).
    - Update developer docs and README with rollout and feature-flag instructions, including the metrics to observe (`ipc.rate_limited`, `ipc.error`, `ipc.success`) and rollback guidance.
  - Integration verification: Run end-to-end checks with renderer micro-hardening enabled in dev builds and monitor telemetry/metrics before broader rollout.

- Rollout strategy: Ship behind IPC_REFACTOR_ENABLED (main wires it into IpcHandler). Enable in development builds and manual QA, collect metrics, and fallback if regressions observed.

- References: dev_docs/ipc-simplification-plan.md

- Target references:
  - [`src/main/services/ipc/wrapper-factory.js`](src/main/services/ipc/wrapper-factory.js:1)
  - [`src/main/services/ipc/routes.js`](src/main/services/ipc/routes.js:1)
  - [`src/main/services/ipc/rate-limiter.js`](src/main/services/ipc/rate-limiter.js:1)
  - [`src/shared/utils/singleflight.js`](src/shared/utils/singleflight.js:1)
  - [`src/main/services/scorm/sn/snapshot-service.js`](src/main/services/scorm/sn/snapshot-service.js:1)
  - [`src/main/services/debug/debug-telemetry-store.js`](src/main/services/debug/debug-telemetry-store.js:1)
  - [`src/shared/utils/ipc-validation.js`](src/shared/utils/ipc-validation.js:1)
  - [`src/shared/utils/ipc-result.js`](src/shared/utils/ipc-result.js:1)

## Renderer Simplification Plan Progress

- Status: Mostly implemented (renderer micro-hardening applied to critical paths; remaining tests and small trims).
- Completed items:
  - Renderer public surface required no breaking changes to support the IPC/main simplifications — the IPC surface remains compatible.
  - Renderer logging routes already unify logs to main via renderer-log-* channels handled by IpcHandler.
  - CourseLoader ArrayBuffer→Base64 helper implemented and console.* usages removed from touched modules.
  - ScormAPIBridge lazy enable/disable implemented to avoid unnecessary message handlers.
- Next steps (priority order):
  - Phase 3 — ContentViewer: call scormAPIBridge.enable() before probing and trim duplicate logs (`src/renderer/components/scorm/content-viewer.js`) — small code changes remain.
  - Phase 6/7 — Debug aggregation and logging normalization: ensure debug events still flow to DebugTelemetryStore via IPC channels; tests will validate this path.
- Rollout coordination: Apply renderer updates in the same increment as main/IPC work and run integration verification.

## Main Services Simplification Plan Progress

- Status: In progress (major refactor completed; follow-ups are tests and docs)
- Completed items:
  - Phase 0 — Foundations and utilities: `ipc-validation`/`ipc-result` and DebugTelemetryStore implemented and wired (`src/main/services/debug/debug-telemetry-store.js`).
  - Phase 1 — Routes table and unified wrapper: routes and wrapper-factory created and wired; IpcHandler registers routes from [`src/main/services/ipc/routes.js`](src/main/services/ipc/routes.js:1).
  - Phase 2 — Consolidated telemetry store & limiter: telemetry store implemented and IpcHandler delegates storage; rate limiter implemented at [`src/main/services/ipc/rate-limiter.js`](src/main/services/ipc/rate-limiter.js:1) and is wired in IpcHandler.
  - Phase 3 — SN status ownership: SNSnapshotService exists, is constructed by main and passed into IpcHandler and ScormService; IpcHandler no longer runs an internal SN poller; SNSnapshotService is authoritative (`src/main/services/scorm/sn/snapshot-service.js`).
  - Phase 4/5 — WindowManager decoupling & recent-courses hygiene: WindowManager now prefers `telemetryStore.flushTo` and no longer relies on IpcHandler internal buffers; RecentCoursesService atomic writes and exists-annotation implemented.
  - FileManager: many hardening steps implemented:
    - `getManifestPath(folderPath)` added.
    - canonical temp root using `app.getPath('temp')/scorm-tester` used for extraction and temp files.
    - ZIP entry scanning enforces traversal checks and size limits in `extractZipWithValidation()` (`src/main/services/file-manager.js`).
- Next steps (priority order):
  - Finish Phase 3 follow-ups: confirm SNSnapshotService can accept IpcHandler if implementations require it; add unit tests for passthrough.
  - Phase 4: finalize FileManager extraction normalization tests:
    - Normalize each ZIP entry path (resolve and ensure extracted target path starts with the intended extract directory).
    - Count and assert skipped suspicious entries (extractedCount, skippedCount) in tests.
  - Phase 7: Rollout validation, envelopes, and per-route validation adoption across any remaining critical handlers (audit complete; only small opt-ins remain).
  - Phase 8: Add unit tests and update docs.
- Rollout strategy: Feature-flag guarded rollout (`IPC_REFACTOR_ENABLED` wired), metrics and monitoring to detect regressions; no UI changes expected.

## Rollout integration notes

- The three plans are designed to be rolled out in parallel phases, with consistent rollout mechanics and a shared emphasis on observability, safety, and public surface stability.
- Implementation has been intentionally incremental; infra-level artifacts are now in place and wired by `src/main/main.js`.
- Remaining items focus on tests, a final audit of per-route opt-ins, and documentation/rollout guidance.

References
- IPC Simplification Plan: dev_docs/ipc-simplification-plan.md
- Renderer Simplification Plan: dev_docs/renderer-simplification-plan.md
- Main Services Simplification Plan: dev_docs/main-services-simplification-plan.md

Next actions
- Chosen approach: A + incremental execution
  - Recent work (applied to repo):
    - Implemented profile-aware rate limiter, wrapper factory integration, singleflight util usage, DebugTelemetryStore, SNSnapshotService, and main wiring to construct and inject these services.
    - Removed legacy in-class API call buffers in IpcHandler and ensured WindowManager uses telemetryStore.flushTo; telemetry is now canonical in the main process when telemetryStore is present.
    - Replaced primary startup console.* usages in `src/main/main.js` with logger usage to enforce app-log-only policy.
    - Added focused unit tests for the wrapper-factory (`tests/unit/main/ipc/wrapper-factory.spec.js`).
  - Immediate next work (high priority):
    - Add unit tests for: limiter profiles, singleflight+debounce behavior for open-debug-window, SNSnapshotService passthrough, telemetry store trimming/flush, and FileManager traversal defenses.
    - Harden `extractZipWithValidation()` with additional resolved-path assertions in tests and add fixtures to validate skippedCount/extractedCount semantics.
    - Finish a short audit to ensure critical channels are opted into `useIpcResult`/`validateArgs` where desired.
  - Secondary work:
    - Update developer docs and README with rollout and feature-flag instructions, including the metrics to observe (`ipc.rate_limited`, `ipc.error`, `ipc.success`) and rollback guidance.
    - Add CI job or npm script to run new unit tests and enforce no console.* in renderer paths (lint or test).
    - Run integration verification with renderer micro-hardening enabled in dev builds and monitor telemetry/metrics before broader rollout.

References to plan documents for quick navigation:
- [`dev_docs/ipc-simplification-plan.md`](dev_docs/ipc-simplification-plan.md:1)
- [`dev_docs/renderer-simplification-plan.md`](dev_docs/renderer-simplification-plan.md:1)
- [`dev_docs/main-services-simplification-plan.md`](dev_docs/main-services-simplification-plan.md:1)