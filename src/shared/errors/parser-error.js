/**
 * Shared ParserError and error codes for spec-compliant parsing failures.
 * Route all parse failures through this type so main/renderer can reason consistently.
 *
 * Logging contract for failures (approved):
 * {
 *   phase: "CAM_PARSE",
 *   code: "PARSE_VALIDATION_ERROR",
 *   message: string,
 *   detail: any,
 *   manifestId?: string,
 *   defaultOrgId?: string,
 *   stats?: { orgCount?: number, topCount?: number },
 *   packagePath?: string,
 *   severity: "error"
 * }
 */

const path = require('path');
const logger = require('../utils/logger');

const ParserErrorCode = Object.freeze({
  PARSE_VALIDATION_ERROR: 'PARSE_VALIDATION_ERROR',
  PARSE_XML_ERROR: 'PARSE_XML_ERROR',
  PARSE_EMPTY_INPUT: 'PARSE_EMPTY_INPUT',
  PARSE_UNSUPPORTED_STRUCTURE: 'PARSE_UNSUPPORTED_STRUCTURE'
});

class ParserError extends Error {
  /**
   * @param {Object} args
   * @param {string} args.code - One of ParserErrorCode
   * @param {string} args.message - Human-readable error
   * @param {any} [args.detail] - Structured diagnostic detail
   * @param {string} [args.phase="CAM_PARSE"] - Pipeline phase
   * @param {string} [args.manifestId] - Parsed manifest identifier if available
   * @param {string} [args.defaultOrgId] - Default organization id if available
   * @param {{ orgCount?: number, topCount?: number }} [args.stats] - Quick snapshot metrics
   * @param {string} [args.packagePath] - Absolute or workspace-relative path to package
   * @param {"error"|"warn"|"info"|"debug"} [args.severity="error"]
   * @param {boolean} [args.autoLog=true] - Whether to auto-log on construction
   */
  constructor({
    code,
    message,
    detail = null,
    phase = 'CAM_PARSE',
    manifestId,
    defaultOrgId,
    stats,
    packagePath,
    severity = 'error',
    autoLog = true
  }) {
    super(message);
    this.name = 'ParserError';
    this.code = code || ParserErrorCode.PARSE_VALIDATION_ERROR;
    this.detail = detail;
    this.phase = phase;
    this.manifestId = manifestId || undefined;
    this.defaultOrgId = defaultOrgId || undefined;
    this.stats = stats || undefined;
    this.packagePath = packagePath ? normalizePackagePath(packagePath) : undefined;
    this.severity = severity || 'error';

    // Ensure stack is captured correctly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ParserError);
    }

    if (autoLog) {
      this.log();
    }
  }

  toJSON() {
    return {
      phase: this.phase,
      code: this.code,
      message: this.message,
      detail: redactDetail(this.detail),
      manifestId: this.manifestId,
      defaultOrgId: this.defaultOrgId,
      stats: this.stats,
      packagePath: this.packagePath,
      severity: this.severity
    };
  }

  log() {
    const payload = this.toJSON();
    try {
      switch (this.severity) {
        case 'debug':
          logger.debug('ParserError', payload);
          break;
        case 'info':
          logger.info('ParserError', payload);
          break;
        case 'warn':
          logger.warn('ParserError', payload);
          break;
        case 'error':
        default:
          logger.error('ParserError', payload);
          break;
      }
    } catch {
      // As a last resort, attempt to avoid complete silence if logger fails
      try {
        // The project rules require writing to app log, not console;
        // we still avoid console usage here.
        // If the logger utility throws, we do nothing further.
      } catch (_) {}
    }
  }
}

function normalizePackagePath(p) {
  try {
    if (!p) return p;
    // Normalize separators to forward slashes for logs
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    return abs.replace(/\\/g, '/');
  } catch {
    return p;
  }
}

function redactDetail(detail) {
  // Ensure detail is JSON-serializable and avoids huge payloads
  try {
    if (detail == null) return null;
    // Drop DOM nodes or cyclic structures
    const safe = JSON.parse(JSON.stringify(detail, (_key, value) => {
      // Strip functions and large buffers
      if (typeof value === 'function') return undefined;
      if (value && typeof value === 'object') {
        // Best-effort cap arrays
        if (Array.isArray(value) && value.length > 1000) {
          return value.slice(0, 1000);
        }
      }
      return value;
    }));
    return safe;
  } catch {
    return { note: 'detail not serializable' };
  }
}

module.exports = {
  ParserError,
  ParserErrorCode
};