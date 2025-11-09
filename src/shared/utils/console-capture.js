"use strict";

/**
 * Unified console capture utility for both GUI and MCP
 * Captures console messages, errors, and load failures from BrowserWindow instances
 *
 * This provides a single, reliable mechanism for capturing all console output
 * from SCORM content, avoiding duplicate code and timing issues.
 */

const getLogger = require('./logger');

// Session-level console message storage
const _consoleMessagesBySession = new Map();

/**
 * Map Chromium console level to logger level
 * @param {number} level - Chromium console level (0-3)
 * @returns {string} Logger level string
 */
function mapConsoleLevel(level) {
  switch (level) {
    case 0: return 'debug';  // verbose
    case 1: return 'info';   // info
    case 2: return 'warn';   // warning
    case 3: return 'error';  // error
    default: return 'info';
  }
}

/**
 * Categorize console error messages for better filtering
 * @param {string} message - The console message
 * @param {string} logLevel - The log level (error, warn, info, debug)
 * @returns {string} Category (scorm_api, syntax, runtime, network)
 */
function categorizeError(message, logLevel) {
  const msgStr = String(message || '');

  if (msgStr.includes('API') || msgStr.includes('SCORM')) {
    return 'scorm_api';
  } else if (msgStr.includes('SyntaxError')) {
    return 'syntax';
  } else if (msgStr.includes('network') || msgStr.includes('fetch') || msgStr.includes('XMLHttpRequest')) {
    return 'network';
  } else if (msgStr.includes('TypeError') || msgStr.includes('ReferenceError')) {
    return 'runtime';
  }

  return 'runtime';
}

/**
 * Set up console capture for a BrowserWindow
 * @param {BrowserWindow} win - The BrowserWindow to monitor
 * @param {Object} options - Configuration options
 * @param {string} options.session_id - Optional session ID for per-session buffering
 * @param {Function} options.onMessage - Optional callback for each message
 * @param {Function} options.logger - Optional logger instance
 * @returns {Function} Cleanup function to remove listeners
 */
function setupConsoleCapture(win, options = {}) {
  if (!win || !win.webContents) {
    throw new Error('Valid BrowserWindow with webContents required');
  }

  const { session_id, onMessage, logger: customLogger } = options;
  const logger = customLogger || getLogger();

  // Initialize per-session buffer if session_id provided
  if (session_id && !_consoleMessagesBySession.has(session_id)) {
    _consoleMessagesBySession.set(session_id, []);
    logger?.debug?.(`[Console Capture] Initialized buffer for session: ${session_id}`);
  } else if (session_id) {
    logger?.debug?.(`[Console Capture] Using existing buffer for session: ${session_id}`);
  } else {
    logger?.warn?.('[Console Capture] No session_id provided - console messages will not be buffered for MCP access');
  }

  /**
   * Handle console message from renderer
   */
  const handleConsoleMessage = (event, level, message, line, sourceId) => {
    let logLevel = mapConsoleLevel(level);
    const source = sourceId ? `${sourceId}:${line}` : 'scorm-content';

    try {
      const msgStr = String(message || '');

      // Store in session buffer for MCP tool access (capture EVERYTHING)
      if (session_id && _consoleMessagesBySession.has(session_id)) {
        const buffer = _consoleMessagesBySession.get(session_id);
        buffer.push({
          level: logLevel,
          message: msgStr,
          source: source,
          line: line || 0,
          timestamp: Date.now(),
          category: categorizeError(msgStr, logLevel)
        });

        // Keep only last 500 messages per session to prevent memory issues
        if (buffer.length > 500) {
          buffer.shift();
        }
      }

      // Demote known benign CSP violations from embedded SCORM content to warnings (for logging only)
      if (logLevel === 'error' && msgStr.includes("Refused to load the font") && msgStr.includes("data:application/font-woff")) {
        logLevel = 'warn';
      }

      // Filter out benign Chromium warnings from logs (but they're still in session buffer)
      const isBenignWarning = logLevel === 'warn' && (
        msgStr.includes("iframe which has both allow-scripts and allow-same-origin") ||
        msgStr.includes("can remove its sandboxing")
      );

      // Log to unified logging system (skip benign warnings)
      if (!isBenignWarning) {
        logger?.[logLevel]?.(`[Browser Console] ${message}`, { source, line });
      }

      // Invoke custom callback if provided
      if (onMessage && typeof onMessage === 'function') {
        onMessage({
          level: logLevel,
          message: msgStr,
          source,
          line: line || 0,
          timestamp: Date.now(),
          category: categorizeError(msgStr, logLevel)
        });
      }
    } catch (err) {
      logger?.warn?.('Console capture error', { error: err?.message });
    }
  };

  /**
   * Handle page load failures
   */
  const handleLoadError = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger?.error?.(`[Browser Load Error] ${errorDescription} (${errorCode})`, {
      url: validatedURL,
      isMainFrame
    });

    // Store in session buffer
    if (session_id && _consoleMessagesBySession.has(session_id)) {
      const buffer = _consoleMessagesBySession.get(session_id);
      buffer.push({
        level: 'error',
        message: `Load failed: ${errorDescription}`,
        source: validatedURL || 'unknown',
        line: 0,
        timestamp: Date.now(),
        category: 'network',
        errorCode: errorCode
      });
    }

    // Invoke custom callback if provided
    if (onMessage && typeof onMessage === 'function') {
      onMessage({
        level: 'error',
        message: `Load failed: ${errorDescription}`,
        source: validatedURL || 'unknown',
        line: 0,
        timestamp: Date.now(),
        category: 'network',
        errorCode
      });
    }
  };

  /**
   * Handle renderer crashes
   */
  const handleCrash = (event, killed) => {
    logger?.error?.(`[Browser Crash] Renderer process crashed`, { killed });

    // Store in session buffer
    if (session_id && _consoleMessagesBySession.has(session_id)) {
      const buffer = _consoleMessagesBySession.get(session_id);
      buffer.push({
        level: 'error',
        message: 'Renderer process crashed',
        source: 'electron',
        line: 0,
        timestamp: Date.now(),
        category: 'runtime'
      });
    }
  };

  // Attach event listeners
  win.webContents.on('console-message', handleConsoleMessage);
  win.webContents.on('did-fail-load', handleLoadError);
  win.webContents.on('crashed', handleCrash);

  // Return cleanup function
  return () => {
    try {
      win.webContents.off('console-message', handleConsoleMessage);
      win.webContents.off('did-fail-load', handleLoadError);
      win.webContents.off('crashed', handleCrash);
    } catch (err) {
      // Window may already be destroyed
    }
  };
}

/**
 * Get captured console messages for a session
 * @param {string} session_id - Session ID
 * @param {Object} filters - Optional filters
 * @param {number} filters.since_ts - Only return messages after this timestamp
 * @param {string[]} filters.severity - Only return these severity levels
 * @returns {Array} Array of console messages
 */
function getConsoleMessages(session_id, filters = {}) {
  if (!session_id) {
    throw new Error('session_id is required');
  }

  const buffer = _consoleMessagesBySession.get(session_id) || [];
  const { since_ts = 0, severity } = filters;

  // Apply filters
  let filtered = buffer;

  if (since_ts > 0) {
    filtered = filtered.filter(msg => msg.timestamp >= since_ts);
  }

  if (severity && Array.isArray(severity) && severity.length > 0) {
    const severitySet = new Set(severity);
    filtered = filtered.filter(msg => severitySet.has(msg.level));
  }

  return filtered;
}

/**
 * Clear console messages for a session
 * @param {string} session_id - Session ID
 */
function clearConsoleMessages(session_id) {
  if (session_id) {
    _consoleMessagesBySession.delete(session_id);
  }
}

/**
 * Get statistics about captured console messages for a session
 * @param {string} session_id - Session ID
 * @returns {Object} Statistics object
 */
function getConsoleStats(session_id) {
  const messages = getConsoleMessages(session_id);

  return {
    total: messages.length,
    by_level: {
      error: messages.filter(m => m.level === 'error').length,
      warn: messages.filter(m => m.level === 'warn').length,
      info: messages.filter(m => m.level === 'info').length,
      debug: messages.filter(m => m.level === 'debug').length
    },
    by_category: {
      scorm_api: messages.filter(m => m.category === 'scorm_api').length,
      syntax: messages.filter(m => m.category === 'syntax').length,
      runtime: messages.filter(m => m.category === 'runtime').length,
      network: messages.filter(m => m.category === 'network').length
    }
  };
}

module.exports = {
  setupConsoleCapture,
  getConsoleMessages,
  clearConsoleMessages,
  getConsoleStats,
  mapConsoleLevel,
  categorizeError
};
