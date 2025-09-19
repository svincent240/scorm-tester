"use strict";

/**
 * Standard MCP response envelope helpers.
 * Keeps responses uniform across all tools and attaches diagnostics.
 */
function successEnvelope({ data = {}, artifacts = [], message = "", startedAt = Date.now() }) {
  const duration_ms = Date.now() - startedAt;
  return {
    success: true,
    error_code: null,
    message,
    data,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    diagnostics: { duration_ms }
  };
}

function errorEnvelope({ error_code = "UNKNOWN_ERROR", message = "", data = null, artifacts = [], startedAt = Date.now() }) {
  const duration_ms = Date.now() - startedAt;
  return {
    success: false,
    error_code,
    message,
    data,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    diagnostics: { duration_ms }
  };
}

module.exports = {
  successEnvelope,
  errorEnvelope
};

