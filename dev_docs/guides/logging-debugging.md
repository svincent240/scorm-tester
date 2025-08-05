# Logging and Debugging Guide

This document outlines the structured approach to logging and debugging within the SCORM Tester application. All debug messages and errors must be written to the application's log file (`app.log`) to ensure they are captured and not missed, especially in production or deployed environments where console access may be limited.

## The Logger Utility (`src/shared/utils/logger.js`)

The application utilizes a singleton `Logger` utility to centralize all logging operations. This ensures consistent logging behavior across the entire application, directing output to both a file and, conditionally, the console.

### Key Features:

*   **Singleton Pattern**: Guarantees a single instance of the logger, preventing multiple log files or inconsistent logging behavior.
*   **File-Based Logging**: All messages are appended to `app.log`. This file is crucial for post-mortem analysis and debugging in environments without direct console access.
    *   The `app.log` file is located in the application's user data directory (e.g., `C:\Users\<username>\AppData\Roaming\scorm-tester\app.log` on Windows).
    *   **Important**: The `app.log` file is cleared every time the application starts to provide a fresh log for each session.
*   **Log Levels**: The logger supports the following standard log levels:
    *   `info`: General informational messages about application flow.
    *   `warn`: Potentially harmful situations or unexpected behavior.
    *   `error`: Error events that might still allow the application to continue running.
    *   `debug`: Detailed information, typically of interest only when diagnosing problems.
*   **Conditional Console Output**: Messages are logged to the browser/Node.js console *only* if the `NODE_ENV` environment variable is set to `'development'`. This prevents verbose console output in production builds.
*   **Debug Level Control**: `debug` messages are only written to the `app.log` file if the `LOG_LEVEL` environment variable is explicitly set to `'debug'`. Otherwise, they are ignored.

### Usage:

To use the logger, import the `Logger` class and instantiate it with the desired log directory. Since it's a singleton, subsequent instantiations will return the same instance.

```javascript
const Logger = require('../../src/shared/utils/logger');
const path = require('path');

// In the main process, typically in main.js or an initialization file:
const logDirectory = path.join(app.getPath('appData'), 'scorm-tester');
const logger = new Logger(logDirectory);

// To log messages:
logger.info('Application started successfully.');
logger.warn('Configuration file not found, using defaults.');
logger.error('Failed to load module X:', error);

// Debug messages are only logged if LOG_LEVEL is 'debug'
logger.debug('Processing data for user:', userId);
```

### Best Practices for Logging:

1.  **Always Use the `Logger` Utility**: Avoid direct `console.log`, `console.error`, etc., statements in production code. All diagnostic and error messages should go through the `Logger` to ensure they are consistently captured in `app.log`.
2.  **Choose Appropriate Log Levels**:
    *   Use `info` for significant application events (e.g., startup, major feature activation, successful completion of a task).
    *   Use `warn` for non-critical issues that might indicate a problem but don't halt execution (e.g., deprecated API usage, minor configuration issues).
    *   Use `error` for critical failures, exceptions, or unrecoverable issues.
    *   Use `debug` for detailed tracing, variable values, and step-by-step execution flow during development and troubleshooting. Remember to set `LOG_LEVEL=debug` to enable these.
3.  **Provide Contextual Information**: Include relevant variables, object states, and error details in your log messages to aid in debugging.
4.  **Avoid Sensitive Data**: Do not log sensitive user information or credentials.
5.  **Clean Up Temporary Debugging**: As noted in `dev_docs/refactoring-plan.md`, excessive `console.log` statements were removed. This emphasizes the importance of using the structured `Logger` for all debugging and troubleshooting, rather than temporary `console.log`s that might be left behind.

## Debugging Steps

When encountering issues, follow these steps:

1.  **Enable Debug Logging**:
    *   Set the `LOG_LEVEL` environment variable to `'debug'` before launching the application. This will enable `debug` messages to be written to `app.log`.
    *   Ensure `NODE_ENV` is set to `'development'` if you also want to see logs in the console during development.
2.  **Reproduce the Issue**: Perform the actions that lead to the problem.
3.  **Inspect `app.log`**: After reproducing the issue, open the `app.log` file. This file will contain a detailed chronological record of application events, including `debug` messages if enabled.
4.  **Analyze Log Entries**: Look for `error` and `warn` messages, and trace the flow of execution using `info` and `debug` messages around the time the issue occurred.
5.  **Use Developer Tools (Development Only)**: In development environments, the browser's developer console will also display logs (if `NODE_ENV='development'`). This can be useful for real-time inspection, but remember that `app.log` is the definitive source for all captured logs.

By adhering to these logging and debugging practices, we ensure that issues can be efficiently identified, diagnosed, and resolved, maintaining the stability and reliability of the SCORM Tester application.