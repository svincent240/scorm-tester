# IPC Simplification Plan — Keep Full Surface, Reduce Complexity

## Purpose
This document defines a minimal‑risk refactor of the IPC layer that keeps every existing channel and behavior while significantly reducing sources of bugs and complexity. It aligns with project rules in [dev_docs/README.md](dev_docs/README.md:1) and style guidance in [dev_docs/style.md](dev_docs/style.md:1).

## Scope and non‑goals
- Keep all IPC channels and handlers. No removals; public surface remains stable.
- Preserve functional behavior and return shapes unless explicitly noted as normalization.
- No UI changes. Renderer integrations continue to work unchanged.
- Security posture and allowedChannels policy remain enforced via constants.

## Why this is necessary
The current IpcHandler combines routing, policy, timers, caching, telemetry, and ad‑hoc exceptions, making it hard to reason about and easy to break. Hot spots include:
- Large wrapper with per‑channel branches [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:248).
- Scattered rate‑limit and exception logic across wrapper and limiter [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:315) and [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:529).
- Complex open‑debug‑window debounce/coalescing in multiple blocks [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:265) [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:365) [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:429).
- Stateful SN poller owned by IpcHandler [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:597).
- Telemetry buffering inside IpcHandler [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:970).
- Mixed sync/async channels [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:233).
Simplifying these areas reduces defect surface, improves observability, and aligns with separation of concerns.

## Guiding principles
- Declarative: describe channel policy in one routes table.
- Single responsibility: IpcHandler routes; services own state and logic.
- Consistency: one wrapper, one limiter, one error envelope.
- Backward compatible: channels preserved; renderer code unaffected.

## Plan overview (phased, low‑risk)
### Phase 0 — Baseline and guardrails
- Add feature flag IPC_REFACTOR_ENABLED to allow staged rollout.
- Add structured logs for IPC timing and errors to app log (no console).

### Phase 1 — Routes table and unified wrapper
- Introduce a declarative routes module (proposed path: src/main/services/ipc/routes.js) that lists channel, handler, and options.
- Options include: rateLimitProfile, debounceMs, singleFlight, schema, sync=false, softDropOnLimit.
- Replace ad‑hoc special casing in [wrapHandler()](src/main/services/ipc-handler.js:248) with wrapperFactory(routeOptions).

### Phase 2 — Consolidated rate limiter
- Implement a token‑bucket limiter keyed by senderId+channel with named profiles:
  - default: window 1000ms, max 20
  - rendererLogs (soft drop): window 1000ms, max 100, softDropOnLimit=true
  - snBypass: no limit (used for sn:getStatus, sn:initialize, sn:processNavigation, sn:updateActivityProgress, sn:reset)
  - uiSparse (open‑debug‑window): window 1000ms, max 3
- Move SCORM grace logic for scorm-get-value into the profile layer; remove channel checks from wrapper.

### Phase 3 — Singleflight + debounce for open‑debug‑window
- Create a tiny utility: singleflightWithDebounce(key, fn, debounceMs).
- Apply only to open‑debug‑window. Remove bespoke _openDebugGuards branches in wrapper.

### Phase 4 — SN status ownership
- Extract SN polling/cache into SNSnapshotService (proposed path: src/main/services/scorm/sn/snapshot-service.js).
- IpcHandler calls snapshotService.getStatus() in [handleSNGetStatus()](src/main/services/ipc-handler.js:1034).
- Behavior preserved; IpcHandler no longer owns timers/state.

### Phase 5 — Debug telemetry store
- Extract API call history, buffering, and flush into DebugTelemetryStore (proposed path: src/main/services/debug/debug-telemetry-store.js).
- IpcHandler’s [handleDebugEvent()](src/main/services/ipc-handler.js:930) delegates to store; debug window fetches from the store on open.

### Phase 6 — Normalize sync to async
- Convert sync registrations via [registerSyncHandler()](src/main/services/ipc-handler.js:233) to async handle() calls.
- Channel names preserved; renderer can still fire‑and‑forget without awaiting the promise.

### Phase 7 — Light validation and envelope
- Add minimal per‑channel argument validation for critical routes (Initialize/GetValue/SetValue/Commit/Terminate, file selection, URL resolution).
- Standardize result envelope helpers: success(data) and failure(code, message, details).

### Phase 8 — Tests and docs
- Add unit tests for limiter profiles, open‑debug singleflight, schema rejections, SN snapshot passthrough, telemetry buffering.
- Update docs and diagrams as needed; ensure dev_docs stays the single source of truth.

## Detailed steps
### 1) Create routes table
- File: src/main/services/ipc/routes.js
- Export an array of { channel, handler, options } for every existing channel currently registered in [registerHandlers()](src/main/services/ipc-handler.js:133).
- Set options:
  - SCORM RTE: rateLimitProfile 'default'
  - Renderer logs: 'rendererLogs', softDropOnLimit true
  - SN channels: 'snBypass'
  - open-debug-window: singleFlight true, debounceMs 500, rateLimitProfile 'uiSparse'
  - Path/URL helpers and file ops: 'default'

### 2) Implement wrapperFactory
- File: src/main/services/ipc/wrapper-factory.js
- Exports createWrappedHandler(route, ctx) that:
  - Validates size using [validateRequest()](src/main/services/ipc-handler.js:505) logic.
  - Applies limiter.allow(senderId, channel, profile, context) with optional softDrop behavior.
  - Applies singleflightWithDebounce when route.options.singleFlight is true.
  - Calls the handler and captures timing; logs structured success/error entries to app log.
  - Returns original handler result to preserve compatibility.

### 3) Build rate limiter
- File: src/main/services/ipc/rate-limiter.js
- Token bucket per senderId+channel storing timestamps; periodic cleanup interval equals the longest profile window.
- Profiles implemented as simple objects; optional hook to consult scormService for short grace after Initialize when channel === 'scorm-get-value'.

### 4) Singleflight + debounce util
- File: src/shared/utils/singleflight.js
- Map from key to { inFlightPromise, lastCallTs, timer }, coalesce and guarantee trailing call within debounceMs.

### 5) Extract SN snapshot service
- File: src/main/services/scorm/sn/snapshot-service.js
- Responsibilities:
  - Start/stop periodic polling of snService.getStatus() if available.
  - Maintain last good snapshot { success, initialized, sessionState, availableNavigation }.
  - Provide getStatus() instantly without IPC timing sensitivity.
- Remove poller code from IpcHandler [startSnMainPoller()](src/main/services/ipc-handler.js:597) [stopSnMainPoller()](src/main/services/ipc-handler.js:650); wire IpcHandler to the new service.

### 6) Debug telemetry store
- File: src/main/services/debug/debug-telemetry-store.js
- Responsibilities:
  - storeApiCall(data), clear(), getHistory(), flushTo(webContents).
  - Enforce a max size (e.g., 5000) and warn when trimming.
- Replace in‑class methods [storeApiCall()](src/main/services/ipc-handler.js:971), [sendBufferedApiCalls()](src/main/services/ipc-handler.js:989), [clearApiCallHistory()](src/main/services/ipc-handler.js:1003), [getApiCallHistory()](src/main/services/ipc-handler.js:1009).

### 7) Migrate sync to async registration
- Replace [registerSyncHandler()](src/main/services/ipc-handler.js:233) usage with regular [registerHandler()](src/main/services/ipc-handler.js:218).
- Keep channel names (e.g., 'log-message', 'debug-event') identical; handler implementations remain functionally the same.

### 8) Validation and envelope helpers
- File: src/shared/utils/ipc-validation.js — small guards (e.g., typeof checks, path string checks).
- File: src/shared/utils/ipc-result.js — export success(data), failure(code, message, details).
- Adopt in wrapper; migrate handlers incrementally without changing public payload shapes.

### 9) Tests
- Add unit tests under tests/unit/main/ipc/ for:
  - rate-limiter profiles behavior and softDrop for renderer logs
  - open-debug-window singleflight+debounce correctness
  - validation guards rejecting malformed args for a few critical channels
  - SN snapshot passthrough from service to handler
  - telemetry store trimming and flush

## Rollout strategy
- Ship behind IPC_REFACTOR_ENABLED=false by default for one release.
- Enable in development builds and manual QA.
- Add metric logs: 'ipc.rate_limited', 'ipc.error', 'ipc.success' with channel and durationMs.
- Fall back to legacy path with an env toggle if any regression is observed.

## Acceptance criteria
- All existing IPC channels remain registered and functional.
- No renderer code changes required.
- App logs show structured IPC success/error entries with durations.
- Sequencing status and navigation behave as before (when SN features are enabled).
- Debug window continues to receive events; history persists with enforced cap.
- No regressions in tests; new unit tests passing.

## Risk mitigation
- Strictly incremental: each phase leaves the system in a working state.
- Feature flag for rapid rollback.
- Minimal external dependencies; prefer small internal utilities.

## Files to touch (summary)
- [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:1) — simplify wrapper, delegate to routes+services, remove internal poller/telemetry once extracted.
- src/main/services/ipc/routes.js — new.
- src/main/services/ipc/wrapper-factory.js — new.
- src/main/services/ipc/rate-limiter.js — new.
- src/shared/utils/singleflight.js — new.
- src/main/services/scorm/sn/snapshot-service.js — new.
- src/main/services/debug/debug-telemetry-store.js — new.
- src/shared/utils/ipc-validation.js — new.
- src/shared/utils/ipc-result.js — new.
- tests/unit/main/ipc/... — new tests.

## Keeping all functions
- All existing handlers remain exported and registered under the same channel names as defined today in [registerHandlers()](src/main/services/ipc-handler.js:133).
- No public IPC contract changes; renderer callers and preload bridges are unaffected.
- Any deprecations (e.g., optional logger adapter) are kept for compatibility unless explicitly removed in a later decision; warnings may be logged but behavior remains.

## Appendix — Notes on specific hot spots
- open‑debug‑window: Replacing bespoke guards with singleflight+debounce removes multiple timing branches and reduces race risk.
- SN status: Moving polling into a dedicated service avoids coupling timers to the router, improving shutdown behavior and error isolation.
- Rate limiting: Named profiles make intent explicit and end ad‑hoc channel checks, reducing surprises when adding new routes.
- Telemetry: A small store module enables future persistence or export without touching routing logic.

## References
- Architecture rules: [dev_docs/README.md](dev_docs/README.md:1)
- Style and cohesion: [dev_docs/style.md](dev_docs/style.md:1)
- Current IpcHandler implementation: [src/main/services/ipc-handler.js](src/main/services/ipc-handler.js:1)