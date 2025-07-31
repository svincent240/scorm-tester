# Logging and Debugging Guide

This document outlines the proper use of the logging and debugging functions in this application.

## Centralized Logging

All logging is now handled by a centralized logger that writes to a log file located at: `%APPDATA%/scorm-tool/app.log` on Windows and `~/.config/scorm-tool/app.log` on macOS/Linux.

### Backend Logging (`main.js`)

In the main process, the logger is available as a singleton instance from `utils/logger.js`. To use it, import the module and call the appropriate logging method:

```javascript
const logger = require('./utils/logger.js');

logger.info('This is an informational message.');
logger.warn('This is a warning message.');
logger.error('This is an error message.');
logger.debug('This is a debug message (only logged in development).');
```

### Frontend Logging (`app.js`)

In the renderer process, logging is bridged to the main process through the `electronAPI` object. All `console.log` calls have been replaced with the following:

```javascript
window.electronAPI.log('info', 'This is an informational message from the frontend.');
window.electronAPI.log('warn', 'This is a warning message from the frontend.');
window.electronAPI.log('error', 'This is an error message from the frontend.');
```

## Debugging

To enable debug logging, set the `LOG_LEVEL` environment variable to `debug` when running the application.

### Viewing Logs

The log file can be opened directly to view all log messages. In development, logs will also be output to the console.

### Debug Console

The SCORM Debug Console provides a real-time view of SCORM API calls and other session data. This is useful for debugging SCORM-specific issues.