# Logging and Debugging Guide

This document outlines the structured approach to logging and debugging within the SCORM Tester application. All debug messages and errors must be written to the application's log file (`app.log`) to ensure they are captured and not missed, especially in production or deployed environments where console access may be limited.

**CRITICAL DISTINCTION**: This document covers app debugging/logging. For SCORM package inspection (end-user tool), see [architecture/scorm-inspector-architecture.md](../architecture/scorm-inspector-architecture.md).

## Renderer Logging Flow (Centralized)

Renderer logs are routed through a centralized adapter so nothing writes to the browser console.

- Use [`renderer-logger.js`](../../src/renderer/utils/renderer-logger.js) in the renderer for all logging:
  - Methods: `debug`, `info`, `warn`, `error`
  - These delegate to the shared logger which writes to the application log file.
- Do not use `console.*` in renderer code.

Example usage:
```js
import rendererLogger from '../../src/renderer/utils/renderer-logger.js';
rendererLogger.info('Renderer initialized');
rendererLogger.error('Something failed', error?.message || error);
```

## The Logger Utility (`src/shared/utils/logger.js`)

The application utilizes a singleton `Logger` utility to centralize all logging operations. This ensures consistent logging behavior across the entire application, directing output to a file and, conditionally, the console.

- The file is located at [`logger.js`](../../src/shared/utils/logger.js).
- The renderer adapter constructs the shared logger and avoids console usage.
- In development, the shared logger may still log to the console internally; production behavior writes to the file.

## Event Bus Logging (App UI Only)

**IMPORTANT**: EventBus is used ONLY for app UI events. SCORM package inspection data uses direct IPC (see SCORM Inspector architecture).

Event Bus logging for UI events is routed via the renderer logger. Default debug mode is disabled:

- See [`event-bus.js`](../../src/renderer/services/event-bus.js) where `setDebugMode(false)` is the default for UI event logging.
- UI debug mode can be enabled/disabled dynamically for troubleshooting app UI issues.

## Rate Limiting and Suppression Policy

To prevent log spam and IPC overload, the application enforces coordinated rate limiting across renderer and main:

- Renderer-side behavior:
  - [`renderer-logger.js`](../../src/renderer/utils/renderer-logger.js) coalesces identical messages within a 400ms window and enforces a rolling cap (e.g., max 20 debug logs per 400ms window). Rate-limit responses from main are handled with a silent backoff (BACKOFF_MS=1500). The renderer must not emit any rate-limit warnings to the log or console.
  - [`scorm-client.js`](../../src/renderer/services/scorm-client.js) throttles `cmi.session_time` SetValue updates to no more than once every 3 seconds, serializes Commit/Terminate to avoid overlap, and treats rate-limit responses as silent soft-ok. It must not produce rate-limit log entries.

- Main IPC behavior:
  - [`ipc-handler.js`](../../src/main/services/ipc-handler.js) logs a single INFO per channel the first time a rate limit engages:
    “rate-limit engaged on <channel>; further rate-limit logs suppressed for this session”
  - Subsequent rate-limited calls on these channels return soft-ok with no additional logs:
    - renderer-log-*
    - scorm-set-value
    - scorm-commit
    - scorm-terminate
  - Other channels retain strict enforcement.

- Soft-ok semantics:
  - Soft-ok means the call is acknowledged and safely ignored due to rate limiting or benign shutdown races, without emitting additional logs.

This policy ensures only one informative line per engaged channel per session while maintaining functional correctness.

## Error, Initialization, and Shutdown Handling

Inline HTML error injections in the renderer entry were replaced with centralized logging and UIState notifications.

- On initialization errors in [`app.js`](../../src/renderer/app.js):
  - `rendererLogger.error(...)` writes details
  - `uiState.setError(error)`
  - `uiState.showNotification({ type: 'error', duration: 0 })`
  - `eventBus.emit('app:error', { error })`

- Graceful shutdown:
  - [`ipc-handler.js`](../../src/main/services/ipc-handler.js) attempts to terminate SCORM sessions first (best-effort, soft-ok) before unregistering IPC handlers and closing windows. Benign “already terminated” or late-shutdown cases must not escalate to ERROR logs.

## Best Practices for Logging

1.  Always use the renderer adapter in the renderer; avoid `console.*`.
2.  Choose appropriate log levels (`info`, `warn`, `error`, `debug`).
3.  Provide context safely; avoid sensitive data.
4.  Keep messages actionable; include identifiers, event names, and state context where possible.
5.  Do not log repeated rate-limit warnings; rely on one-time main-side INFO engagement logs.

## Debugging Steps

When encountering issues, follow these steps:

1.  Enable debug logging with `LOG_LEVEL=debug` before launching to include `debug` messages in `app.log`.
2.  Reproduce the issue.
3.  Inspect `app.log` for a chronological record.
4.  Analyze entries around the failure point focusing on `error`/`warn`, supported by `info`/`debug`.

By adhering to these logging and debugging practices, we ensure issues can be efficiently identified, diagnosed, and resolved, maintaining the stability and reliability of the SCORM Tester application.