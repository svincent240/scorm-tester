/**
 * Renderer Logger Adapter
 *
 * Routes all renderer logs to the shared logger which writes to the app log file.
 * Provides safe no-op fallbacks during early startup to avoid console usage.
 *
 * This adapter MUST be used instead of console.* anywhere in the renderer.
 */

let internal = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// Initialize shared logger asynchronously; do not throw on failure
(async () => {
  try {
    const shared = await import('../../shared/utils/logger.js');
    if (shared && shared.logger) {
      internal = shared.logger;
    }
  } catch {
    // keep no-op fallbacks
  }
})();

/**
 * Renderer logger surface
 * All methods forward to the shared logger (app log).
 */
const rendererLogger = {
  info: (...args) => {
    try { internal.info(...args); } catch (_) {}
  },
  warn: (...args) => {
    try { internal.warn(...args); } catch (_) {}
  },
  error: (...args) => {
    try { internal.error(...args); } catch (_) {}
  },
  debug: (...args) => {
    try { internal.debug(...args); } catch (_) {}
  },
};

export { rendererLogger };