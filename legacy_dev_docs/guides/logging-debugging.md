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
- **Debug level filtering**: Logger now respects `LOG_LEVEL` environment variable - debug messages only logged when `LOG_LEVEL=debug`.

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

## Error Handling System

The application uses a centralized error handling system that separates classification from routing for maintainability:

### Error Handler Architecture
- [`error-handler.js`](../../src/shared/utils/error-handler.js) - Main error routing logic with loose UI coupling
- [`error-classifier.js`](../../src/shared/utils/error-classifier.js) - Error classification and utilities
- [`error-context.js`](../../src/shared/types/error-context.js) - Standardized context structure

### Error Flow
```
Error → ErrorHandler.handleError() → ErrorClassifier.classifyError() → Event emission → UI handles
```

### Error Types and Routing
- **SCORM errors**: Routed to SCORM Inspector via `scorm:error` events
- **App errors**: Routed to UI notifications via `app:error` events  
- **Ambiguous errors**: Sent to both systems for investigation

### Using Error Handling
```js
const ErrorHandler = require('../../shared/utils/error-handler');
const { ErrorContexts } = require('../../shared/types/error-context');

// For SCORM API errors
const context = ErrorContexts.scormApi('GetValue', 'cmi.core.student_name', sessionId);
ErrorHandler.handleError(error, context);

// For manifest parsing errors
const context = ErrorContexts.manifestParsing(packagePath, manifestId);
ErrorHandler.handleError(error, context);
```

### ParserError Integration
```js
const parserError = new ParserError({
  code: 'PARSE_VALIDATION_ERROR',
  message: 'Invalid manifest structure'
});
// Use new handle() method instead of deprecated log()
parserError.handle(context, handlers);
```

## Error, Initialization, and Shutdown Handling

Inline HTML error injections in the renderer entry were replaced with centralized logging and UIState notifications.

- On initialization errors in [`app.js`](../../src/renderer/app.js):
  - `rendererLogger.error(...)` writes details
  - `uiState.setError(error)`
  - `uiState.showNotification({ type: 'error', duration: 0 })`
  - `eventBus.emit('app:error', { error })`

- Graceful shutdown:
  - [`ipc-handler.js`](../../src/main/services/ipc-handler.js) attempts to terminate SCORM sessions first (best-effort, soft-ok) before unregistering IPC handlers and closing windows. Benign "already terminated" or late-shutdown cases must not escalate to ERROR logs.

## Log Level Guidelines

### Error Level (`error`)
- **Always preserved**: System failures, IPC handler registration failures, security violations
- **Required for**: Any condition that prevents normal operation or indicates a bug
- **Examples**: Missing required dependencies, handler registration failures, file access errors

### Warning Level (`warn`) 
- **Always preserved**: Potential issues that don't prevent operation but indicate problems
- **Required for**: Degraded functionality, fallback behavior activation, deprecated usage
- **Examples**: Missing optional services, configuration issues, compatibility warnings

### Info Level (`info`)
- **Selective use**: Important application state changes and significant events
- **Avoid for**: Routine successful operations, repetitive confirmations
- **Keep for**: Service initialization completion, major workflow transitions, user-initiated actions
- **Remove**: Handler registration confirmations, routine event subscriptions

### Debug Level (`debug`)
- **Controlled by LOG_LEVEL**: Only logged when `LOG_LEVEL=debug` 
- **Avoid excessive**: Routine method entry/exit, repetitive status checks
- **Keep for**: Complex troubleshooting scenarios, rare code paths, detailed error context

## Best Practices for Logging

1.  Always use the renderer adapter in the renderer; avoid `console.*`.
2.  Choose appropriate log levels following the guidelines above.
3.  Provide context safely; avoid sensitive data.
4.  Keep messages actionable; include identifiers, event names, and state context where possible.
5.  Do not log repeated rate-limit warnings; rely on one-time main-side INFO engagement logs.
6.  Avoid logging successful routine operations (handler registrations, event subscriptions).
7.  Focus logging on failures, warnings, and significant state transitions.

## Debugging Steps

When encountering issues, follow these steps:

1.  Enable debug logging with `LOG_LEVEL=debug` before launching to include `debug` messages in `app.log`.
2.  Reproduce the issue.
3.  Inspect `app.log` for a chronological record.
4.  Analyze entries around the failure point focusing on `error`/`warn`, supported by `info`/`debug`.

By adhering to these logging and debugging practices, we ensure issues can be efficiently identified, diagnosed, and resolved, maintaining the stability and reliability of the SCORM Tester application.