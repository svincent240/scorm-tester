# Renderer Simplification Plan — Preserve Functionality, Improve Reliability

Purpose
- Keep all existing renderer functions intact while removing risk and noise.
- Surface real course issues clearly to the user and app log; never hide defects.
- Reduce complexity and runtime overhead with minimal, low-risk changes that align with the other simplification plans.

Scope
- Applies to renderer files under src/renderer:
  - services: app-manager.js, course-loader.js, scorm-client.js, scorm-api-bridge.js, sn-bridge.js, event-bus.js, debug-data-aggregator.js
  - components: scorm/content-viewer.js, scorm/debug-panel.js (and other scorm components not functionally changed)
  - utils: renderer-logger.js, scorm-validator.js
- Complements:
  - dev_docs/ipc-simplification-plan.md
  - dev_docs/main-services-simplification-plan.md
  - dev_docs/services-simplification-checklist.md

Guiding principles
- Keep all functions and public behavior; do not remove features.
- Do not mask course problems; report them with clear messages and structured logs.
- No console.* in renderer; all logs route through renderer-logger to the app log.
- Prefer lazy activation and best-effort fallbacks to reduce noise and double-handling.

Changes (minimal-risk, concurrent with other plans)

1) CourseLoader — browser-safe base64 + logging normalization
- Why: nodeIntegration is false; Buffer may not exist in the renderer. Console usage violates style rules.
- Changes:
  - Add a browser-safe ArrayBuffer->Base64 helper and replace Buffer usage:
    function arrayBufferToBase64(buf) {
      try {
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      } catch (_) { return ''; }
    }
  - In createTempFileFromBlob, use arrayBufferToBase64(await file.arrayBuffer()).
  - Replace remaining console.error calls with rendererLogger.error and eventBus emissions already present; avoid double throw+emit: after notifying UI via uiState.showNotification and eventBus (course:loadError), return to prevent duplicate error propagation.
  - Keep all functions (handleCourseLoad, handleFolderLoad, loadCourseFromPath, loadCourseFromFolder, processCourseFile, loadCourse).

2) ScormAPIBridge — lazy activation
- Why: Today a window message handler is installed at construction even when we successfully inject a direct API. This can cause unnecessary message traffic or double-handling.
- Changes:
  - Add isEnabled=false; move setupMessageHandler() out of the constructor into a new enable() method.
  - Add disable() stub (optional), and early-return in handleScormAPICall when !isEnabled to be defensive.
  - Keep all external behavior the same; only installation timing changes.

3) ContentViewer — smarter fallback and reduced duplicate logs
- Why: Maintain clear diagnostics while avoiding repeated log lines.
- Changes:
  - In verifyScormApiPresence(), if neither API_1484_11 nor API are present, call scormAPIBridge.enable() before sending the postMessage probe. Keep the probe and timeout behavior unchanged.
  - Trim duplicate “SCORM API injected” info blocks; keep one concise injection log and the parent/top mirror diagnostics. Preserve all error logs.
  - Keep strict behavior: do not modify course discovery functions; inject canonical APIs and mirror where accessible. Continue to propagate APIs to same-origin descendant frames and intercept window.open only to set canonical APIs.
  - Optionally append a short help hint in the “SCORM API not found” error message (e.g., about popup windows or blocked contexts) while retaining the same error path.

4) ScormClient — keep transparency; fix import path if needed
- Why: Ensure ADL probes are handled with clarity and logging consistency.
- Changes:
  - Keep downgrading 401 on adl.data.* probes to WARN and do not emit scorm:error (prevents UI error loops but doesn’t hide the issue).
  - Ensure centralized logger import path used in setLastError guard is correct (../utils/renderer-logger.js).
  - Maintain synchronous API interface with async IPC under the hood; no behavior change for courses.

5) AppManager — keep SN polling controller; minor verbosity trims only
- Why: We will move to a main-owned SNSnapshotService later; for now keep renderer polling unchanged to avoid user-facing changes.
- Changes:
  - Optionally reduce some info logs in the polling controller to debug to limit log volume; no functional change.
  - Leave debounce on navigation requests and UI-state update logic as-is.

6) Debug Data Aggregator & Debug Panel — no structural changes
- Why: Current design is efficient and supports the Debug Window plan (throttles, rings, selectors).
- Changes:
  - None required. Continue to rely on debug:update events, ring buffers, and rAF-batched rendering for API timeline, diagnostics, and errors.

7) Logging normalization across renderer
- Why: Single logging funnel to the app log; no console.* in renderer.
- Changes:
  - Replace remaining console.* (primarily in course-loader) with rendererLogger.*. Avoid duplicate logs and rethrows after UI notification.

Tests (renderer)
- arrayBufferToBase64 helper encodes correctly for small payloads.
- ScormAPIBridge lazy enablement:
  - When direct API is present, ensure bridge is not enabled and no handlers are attached.
  - When fallback path triggers, enable() installs the handler, and a postMessage response is processed.
- ContentViewer verifyScormApiPresence:
  - Direct injection success path: no probe.
  - Missing APIs: probe path runs and user-facing error is shown if no response.
- Lint rule or unit check that no console.* exists in renderer paths (enforced by code search or eslint rule, if present).

Rollout
- These renderer changes are applied in the same increment as the IPC and main-services simplification plans.
- No feature flag required; behavior is backward-compatible.
- Coordinate with preload exposure to ensure electronAPI methods used here are stable (already in use).

Acceptance criteria
- All renderer functions remain and behave as before for valid courses.
- Drag-and-drop and temp-file paths function without Node Buffer; uploads succeed.
- No console.* usage in renderer; logs flow via renderer-logger.
- ScormAPIBridge only activates when needed; ContentViewer fallback is unchanged in outcome but less noisy.
- Users receive clear, actionable messages when the SCORM API is missing in the course context.

Files to touch (summary)
- src/renderer/services/course-loader.js
  - Add arrayBufferToBase64; remove Buffer usage; replace console.*; avoid rethrow after UI notify.
- src/renderer/services/scorm-api-bridge.js
  - Add isEnabled, enable(), (optional) disable(); move setupMessageHandler() accordingly; guard handleScormAPICall.
- src/renderer/components/scorm/content-viewer.js
  - In verifyScormApiPresence(), call scormAPIBridge.enable() before probing; trim duplicate logs.
- src/renderer/services/scorm-client.js
  - Ensure renderer-logger import path is correct in setLastError guard; no functional change otherwise.

Documentation cross-references
- Style rules: dev_docs/style.md (no console in renderer; centralized logging).
- Debug Window: dev_docs/debug-window-plan.md (Aggregator and Debug Panel behavior).
- IPC and main services: dev_docs/ipc-simplification-plan.md, dev_docs/main-services-simplification-plan.md.

Why this keeps issues visible
- We do not suppress or downgrade genuine SCORM errors beyond the ADL probe exception (which is logged as WARN and explained).
- Missing API contexts continue to present a clear, blocking error to the user, with hints for remediation.
- All telemetry still reaches the app log and Debug Window via existing channels and aggregators.
## App entrypoint (src/renderer/app.js) — micro-plan

Scope and intent
- Keep current behavior: dynamic import of AppManager, initialize on DOM ready, centralized error funnel via rendererLogger, uiState, and eventBus.
- No new features or visible UI changes. This is a micro-hardening plan to make startup idempotent, observable, and testable.

Why this is sufficient (no separate plan doc needed)
- app.js is intentionally thin and aligns with the renderer plan’s guardrails (no console, central logging, UI notifications, and event-driven flow).
- A small checklist here keeps the entrypoint stable without introducing another document or complexity.

Changes (low-risk, optional but recommended)
1) Idempotent and once-only startup
- Add a one-time guard to prevent double init in edge cases (e.g., multiple DOMContentLoaded or re-entrant calls):
  - Use a module-level flag (e.g., let hasStarted = false) and short-circuit if true.
  - Set { once: true } on DOMContentLoaded listener.
- Rationale: avoids duplicate appManager.initialize() in rare DOM timing conditions.

2) Export initialize for tests and instrumentation
- Export initializeApplication for integration tests or harnesses:
  - Example: export { initializeApplication }.
- Rationale: enables test runners to trigger startup deterministically without DOMContentLoaded coupling.

3) Lightweight performance markers (no console)
- Surround initialize with performance marks:
  - performance.mark('app:init:start') before dynamic import.
  - performance.mark('app:init:end') after await appManager.initialize().
  - Optionally performance.measure('app:init', 'app:init:start', 'app:init:end').
  - If eventBus is available post-init, emit a diagnostics event (e.g., eventBus.emit('debug:update', { perf: { appInitMs } })) or log via rendererLogger.info with a compact object.
- Rationale: helps diagnose long startups without console usage.

4) Safe-mode guard (optional; dev-only)
- Allow a URL param or global flag to skip initialize (e.g., ?safeMode=1 or window.__SCORM_TESTER_SAFE_MODE__ = true) for debugging renderer without loading services/components.
  - If present, log a single info entry and exit early.
- Rationale: simplifies renderer-only debugging; no behavior change for users.

5) Robust error funnel remains (already present)
- Keep current catch path:
  - Import rendererLogger, eventBus, uiState lazily.
  - Log two concise lines (message + stack); set uiState error; show persistent notification; emit app:error.
- Optional: If uiState cannot be imported, fall back to a single rendererLogger.error only (no alerts; no inline HTML).

6) Event listener hygiene
- Use addEventListener('DOMContentLoaded', initializeApplication, { once: true }) when in 'loading' state.
- If document is already ready, call initializeApplication directly.
- Rationale: aligns with idempotence and avoids orphan listeners.

7) Tests (renderer integration)
- Verify idempotence: calling initializeApplication twice initializes AppManager once (AppManager can report a state or a spy can assert single call).
- Verify perf markers are placed (if TestEnvironment supports performance APIs).
- Verify error funnel path sets an error notification when AppManager import fails (can simulate import failure with a stub).

Illustrative code sketch (non-binding)
- Guard + once-only:
  - let hasStarted = false;
  - async function initializeApplication() {
      if (hasStarted) return;
      hasStarted = true;
      performance.mark('app:init:start');
      // dynamic imports + await appManager.initialize()
      performance.mark('app:init:end');
      performance.measure('app:init', 'app:init:start', 'app:init:end');
    }
  - if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeApplication, { once: true });
    } else {
      initializeApplication();
    }

Acceptance
- No behavior changes to users; app still initializes on DOM ready, errors are surfaced via uiState and logs only.
- Startup is idempotent, measurable, and testable.