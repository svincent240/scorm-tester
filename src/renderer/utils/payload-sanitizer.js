// @ts-check

/**
 * Payload sanitizer for debug telemetry
 * - Truncates long strings
 * - Converts objects to safe JSON (catching circular refs)
 * - Returns a string or primitive safe for IPC transport and storage
 */

function safeStringify(obj, maxLen = 512) {
  try {
    if (obj === null || obj === undefined) return '';
    if (typeof obj === 'string') {
      return obj.length > maxLen ? obj.slice(0, maxLen) + '…' : obj;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

    // Try shallow stringify for objects/arrays
    const json = JSON.stringify(obj);
    if (json.length > maxLen) return json.slice(0, maxLen) + '…';
    return json;
  } catch (e) {
    try {
      // Fallback: toString
      const s = String(obj);
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    } catch (_) {
      return '';
    }
  }
}

/**
 * sanitizeParam
 * @param {any} param
 * @param {object} options { maxLen: number }
 * @returns {string}
 */
export function sanitizeParam(param, options = {}) {
  const maxLen = (options && options.maxLen) ? Number(options.maxLen) : 512;
  return safeStringify(param, maxLen);
}

export default sanitizeParam;