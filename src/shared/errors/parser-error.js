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

const ParserErrorCode = Object.freeze({
  PARSE_VALIDATION_ERROR: 'PARSE_VALIDATION_ERROR',
  PARSE_XML_ERROR: 'PARSE_XML_ERROR',
  PARSE_EMPTY_INPUT: 'PARSE_EMPTY_INPUT',
  PARSE_UNSUPPORTED_STRUCTURE: 'PARSE_UNSUPPORTED_STRUCTURE',
  PATH_RESOLUTION_ERROR: 'PATH_RESOLUTION_ERROR'
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
   * @param {boolean} [args.autoLog=false] - Whether to auto-log on construction (deprecated - use ErrorRouter)
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
    autoLog = false
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
      // Use the new handle() method instead of deprecated log()
      this.handle();
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

  /**
   * Handle error through ErrorHandler system
   * @param {Object} context - Additional context for error routing
   * @param {Object} handlers - Optional custom handlers
   */
  handle(context = {}, handlers = {}) {
    const ErrorHandler = require('../utils/error-handler');
    
    // Merge ParserError data into context
    const enrichedContext = {
      ...context,
      manifestParsing: true,
      phase: this.phase,
      manifestId: this.manifestId,
      defaultOrgId: this.defaultOrgId,
      stats: this.stats,
      packagePath: this.packagePath,
      severity: this.severity
    };
    
    ErrorHandler.handleError(this, enrichedContext, handlers);
  }
  
  /**
   * @deprecated Use handle() method instead for proper routing
   * Legacy method for direct logging - only use when ErrorHandler unavailable
   */
  log() {
    // This method is deprecated - errors should go through ErrorHandler
    // Kept for backward compatibility only
    const getLogger = require('../utils/logger');
    const logger = getLogger();
    const payload = this.toJSON();
    
    try {
      switch (this.severity) {
        case 'debug':
          logger.debug('ParserError (legacy)', payload);
          break;
        case 'info':
          logger.info('ParserError (legacy)', payload);
          break;
        case 'warn':
          logger.warn('ParserError (legacy)', payload);
          break;
        case 'error':
        default:
          logger.error('ParserError (legacy)', payload);
          break;
      }
    } catch {
      // Silently fail to avoid infinite error loops
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