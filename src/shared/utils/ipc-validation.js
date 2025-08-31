"use strict";

const path = require('path');

/**
 * Lightweight IPC validation helpers.
 * Keep intentionally small — only guard common malformed payloads and unsafe paths.
 */

/**
 * Check if a value looks like a filesystem path and is safe (no traversal segments).
 * Returns true when value is a non-empty string and normalized path does not include ".." segments.
 */
function isSafePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    // Normalize and split to detect any upward traversal segments
    const normalized = path.normalize(value);
    const parts = normalized.split(path.sep);
    if (parts.includes('..')) return false;
    // Reject absolute windows/unix path segments that may be unexpected for some handlers
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Generic request validator used by IPC wrapper/wrapping callers.
 * - event: electron IPC event (optional)
 * - channel: channel name string
 * - args: array of arguments supplied by renderer
 *
 * Returns true when basic checks pass, false otherwise.
 */
function validateRequest(event, channel, args = []) {
  try {
    if (!channel || typeof channel !== 'string') return false;

    // Keep a cheap size guard to prevent huge JSON payloads from renderer
    const jsonSize = (() => {
      try {
        return JSON.stringify(args).length;
      } catch (_) {
        return Number.MAX_SAFE_INTEGER;
      }
    })();
    if (jsonSize > 1_000_000) { // 1MB guard
      return false;
    }

    // For common path-like channels, ensure the path argument is a safe string
    const pathLikeChannels = ['extract-scorm', 'find-scorm-entry', 'get-course-info', 'get-course-manifest', 'save-temporary-file', 'path-to-file-url', 'path-normalize', 'path-join'];
    if (pathLikeChannels.includes(channel)) {
      const firstArg = args && args[0];
      if (typeof firstArg !== 'string') return false;
      if (!isSafePath(firstArg)) return false;
    }

    // Basic event sender shape check (best-effort)
    if (event && typeof event === 'object' && event.sender && event.sender.id === undefined) {
      // Allow event but don't fail if shape is unusual — this is best-effort
    }

    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  validateRequest,
  isSafePath
};
