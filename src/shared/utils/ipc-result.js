"use strict";

/**
 * ipc-result helpers
 * - success(data): returns a normalized success envelope
 * - failure(code, message, details): returns a normalized failure envelope
 */

function success(data = null) {
  if (data && typeof data === 'object' && data.success !== undefined) {
    // Already an envelope-ish object; return as-is to avoid double-wrapping
    return data;
  }
  return { success: true, data };
}

function failure(code = 'INTERNAL_ERROR', message = 'An error occurred', details = null, specRef = null) {
  const payload = {
    success: false,
    code: String(code),
    message: String(message)
  };
  if (details) payload.details = details;
  if (specRef) payload.specRef = specRef;
  return payload;
}

module.exports = {
  success,
  failure
};