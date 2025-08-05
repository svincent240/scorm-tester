/**
 * Renderer Logger Adapter
 *
 * Final approach: call into preload-exposed IPC methods that log in main.
 * This avoids returning function objects over IPC (cannot be cloned).
 *
 * Usage: import { rendererLogger } from this module and use info/warn/error/debug.
 */
const safeNoop = () => {};

/**
 * Simple rate limiter for debug to avoid tripping IPC rate limit during bursts.
 * Allows up to MAX_PER_WINDOW debug calls per WINDOW_MS; excess are dropped.
 */
const DEBUG_RATE_LIMIT = {
  WINDOW_MS: 400,         // rolling window duration
  MAX_PER_WINDOW: 20      // max debug sends within window
};
let debugWindowStart = 0;
let debugCount = 0;

const getBridge = () => {
  try {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.logger) {
      return window.electronAPI.logger;
    }
  } catch (_) {}
  return null;
};

const callBridge = async (method, args) => {
  const bridge = getBridge();
  if (bridge && typeof bridge[method] === 'function') {
    try {
      await bridge[method](...args);
    } catch (_) {
      // swallow to keep renderer stable
    }
  }
};

// Specialized debug sender with lightweight rate limiting
const sendDebug = (...args) => {
  const now = Date.now();
  if (now - debugWindowStart > DEBUG_RATE_LIMIT.WINDOW_MS) {
    debugWindowStart = now;
    debugCount = 0;
  }
  if (debugCount < DEBUG_RATE_LIMIT.MAX_PER_WINDOW) {
    debugCount += 1;
    void callBridge('debug', args);
  } else {
    // drop silently to avoid IPC rate limit errors
  }
};

/**
 * Renderer logger surface
 * All methods forward to main logger via IPC. No console usage.
 */
const rendererLogger = {
  info: (...args) => { void callBridge('info', args); },
  warn: (...args) => { void callBridge('warn', args); },
  error: (...args) => { void callBridge('error', args); },
  debug: (...args) => { sendDebug(...args); },
};

export { rendererLogger };