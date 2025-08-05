# Logging and Debugging Guide

This document outlines the structured approach to logging and debugging within the SCORM Tester application. All debug messages and errors must be written to the application's log file (`app.log`) to ensure they are captured and not missed, especially in production or deployed environments where console access may be limited.

## Renderer Logging Flow (Centralized)

As part of the UI Improvement Plan (Step 1), the renderer now routes all logs through a centralized adapter so nothing writes to the browser console.

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

## Event Bus Debug Mode

Event Bus logging is routed via the renderer logger. Default debug mode is disabled:

- See [`event-bus.js`](../../src/renderer/services/event-bus.js) where `setDebugMode(false)` is the default now.
- Step 8 of the plan will bind this to UIState to enable/disable debug logs dynamically.

## Error and Initialization Handling

Inline HTML error injections in the renderer entry were replaced with centralized logging and UIState notifications.

- On initialization errors in [`app.js`](../../src/renderer/app.js):
  - `rendererLogger.error(...)` writes details
  - `uiState.setError(error)`
  - `uiState.showNotification({ type: 'error', duration: 0 })`
  - `eventBus.emit('app:error', { error })`

## Best Practices for Logging

1.  Always use the renderer adapter in the renderer; avoid `console.*`.
2.  Choose appropriate log levels (`info`, `warn`, `error`, `debug`).
3.  Provide context safely; avoid sensitive data.
4.  Keep messages actionable; include identifiers, event names, and state context where possible.

## Debugging Steps

When encountering issues, follow these steps:

1.  Enable debug logging with `LOG_LEVEL=debug` before launching to include `debug` messages in `app.log`.
2.  Reproduce the issue.
3.  Inspect `app.log` for a chronological record.
4.  Analyze entries around the failure point focusing on `error`/`warn`, supported by `info`/`debug`.

By adhering to these logging and debugging practices, we ensure issues can be efficiently identified, diagnosed, and resolved, maintaining the stability and reliability of the SCORM Tester application.