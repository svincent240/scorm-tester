"use strict";

// Central catalog of MCP error codes for consistency across tools
const ERROR_CODES = Object.freeze({
  MCP_INVALID_PARAMS: 'MCP_INVALID_PARAMS',
  MCP_UNKNOWN_SESSION: 'MCP_UNKNOWN_SESSION',
  MCP_UNKNOWN_TOOL: 'MCP_UNKNOWN_TOOL',
  CONTENT_FILE_MISSING: 'CONTENT_FILE_MISSING',
  SECURITY_VIOLATION: 'SECURITY_VIOLATION',
  MANIFEST_NOT_FOUND: 'MANIFEST_NOT_FOUND',
  MCP_MANIFEST_NOT_FOUND: 'MCP_MANIFEST_NOT_FOUND',
  MANIFEST_LAUNCH_NOT_FOUND: 'MANIFEST_LAUNCH_NOT_FOUND',
  ELECTRON_REQUIRED: 'ELECTRON_REQUIRED',
  RUNTIME_NOT_OPEN: 'RUNTIME_NOT_OPEN',
  CAPTURE_FAILED: 'CAPTURE_FAILED',
  NAV_FLOW_ERROR: 'NAV_FLOW_ERROR',
  DEBUG_API_ERROR: 'DEBUG_API_ERROR',
  TRACE_SEQUENCING_ERROR: 'TRACE_SEQUENCING_ERROR',
  SN_BRIDGE_UNAVAILABLE: 'SN_BRIDGE_UNAVAILABLE',
  SN_NOT_INITIALIZED: 'SN_NOT_INITIALIZED',
  SN_BRIDGE_ERROR: 'SN_BRIDGE_ERROR',
  NAV_UNSUPPORTED_ACTION: 'NAV_UNSUPPORTED_ACTION',
  SN_INIT_FAILED: 'SN_INIT_FAILED',
  SN_RESET_FAILED: 'SN_RESET_FAILED',
  MCP_ARTIFACT_WRITE_FAILED: 'MCP_ARTIFACT_WRITE_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

// Light-weight mapping for ParserError and common tool errors to MCP error_code. Falls back to UNKNOWN_ERROR.
function mapError(err) {
  if (!err) return { error_code: ERROR_CODES.UNKNOWN_ERROR, message: "Unknown error" };

  // Prefer explicit error code strings when present
  if (typeof err.code === "string" && err.code) {
    return { error_code: err.code, message: err.message || String(err) };
  }

  // ParserError from src/shared/errors/parser-error.js
  if (err.name === "ParserError" && typeof err.code === "string") {
    return { error_code: err.code, message: err.message || String(err) };
  }

  // Common Node/EACCES/ENOENT → SECURITY_VIOLATION or CONTENT_FILE_MISSING semantics
  if (err.code === "ENOENT") {
    return { error_code: ERROR_CODES.CONTENT_FILE_MISSING, message: err.message };
  }
  if (err.code === "EACCES" || err.code === "EPERM") {
    return { error_code: ERROR_CODES.SECURITY_VIOLATION, message: err.message };
  }

  return { error_code: ERROR_CODES.UNKNOWN_ERROR, message: err.message || String(err) };
}

module.exports = { mapError, ERROR_CODES };

