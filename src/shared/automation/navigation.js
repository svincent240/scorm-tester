"use strict";

/**
 * Shared helpers for invoking template automation navigation APIs.
 * These helpers are imported by both the MCP runtime tools and the
 * renderer-facing automation bridge so that availability checks and
 * method invocations stay consistent across processes.
 */

const AUTOMATION_ERROR_CODES = {
  NOT_AVAILABLE: 'AUTOMATION_API_NOT_AVAILABLE',
  METHOD_ERROR: 'AUTOMATION_API_ERROR',
  METHOD_NOT_FOUND: 'AUTOMATION_METHOD_NOT_FOUND',
  FRAME_NOT_READY: 'AUTOMATION_FRAME_NOT_READY',
  FRAME_EXEC_ERROR: 'AUTOMATION_FRAME_EXEC_ERROR',
  FRAME_EXECUTOR_UNAVAILABLE: 'AUTOMATION_FRAME_EXECUTOR_UNAVAILABLE'
};

/**
 * Escape arguments for inline execution inside window.SCORMAutomation calls.
 * @param {any[]} args
 * @returns {string}
 */
function serializeArgs(args = []) {
  if (!Array.isArray(args)) {
    return '';
  }
  return args.map((arg) => JSON.stringify(arg)).join(', ');
}

/**
 * Build JS expression that safely calls a SCORMAutomation method.
 * @param {string} method
 * @param {any[]} args
 * @returns {string}
 */
function buildAutomationCallExpression(method, args = []) {
  const serializedArgs = serializeArgs(args);
  return `(() => {
    const automation = window.SCORMAutomation;
    if (!automation || typeof automation !== 'object') {
      return { __automationError: '${AUTOMATION_ERROR_CODES.NOT_AVAILABLE}' };
    }
    const fn = automation[${JSON.stringify(method)}];
    if (typeof fn !== 'function') {
      return { __automationError: '${AUTOMATION_ERROR_CODES.METHOD_NOT_FOUND}', method: ${JSON.stringify(method)} };
    }
    try {
      return fn.call(automation${serializedArgs ? `, ${serializedArgs}` : ''});
    } catch (error) {
      return {
        __automationError: '${AUTOMATION_ERROR_CODES.METHOD_ERROR}',
        method: ${JSON.stringify(method)},
        message: error?.message || String(error)
      };
    }
  })()`;
}

/**
 * Wrap errors returned from the automation execution layer.
 * @param {any} result
 * @param {string} method
 */
function normalizeAutomationResult(result, method) {
  if (result && typeof result === 'object' && '__automationError' in result) {
    const error = new Error(result.message || `Automation method '${method}' failed`);
    error.code = result.__automationError;
    error.method = method;
    throw error;
  }
  return result;
}

/**
 * Execute a SCORMAutomation method.
 * @param {Object} params
 * @param {Function} params.execute - Function that takes an expression string and returns Promise<any>
 * @param {string} params.method - Method name to invoke
 * @param {any[]} [params.args] - Arguments for the method
 * @param {Object} [params.logger] - Logger for debug output
 * @param {string} [params.sessionId] - Session identifier for logs
 */
async function automationCall({ execute, method, args = [], logger, sessionId }) {
  const expression = buildAutomationCallExpression(method, args);
  try {
    const result = await execute(expression);
    return normalizeAutomationResult(result, method);
  } catch (error) {
    logger?.error?.('Automation call failed', { method, sessionId, error: error?.message || error });
    throw error;
  }
}

/**
 * Check whether window.SCORMAutomation is available and expose version metadata.
 * @param {Object} params
 * @param {Function} params.execute
 * @param {Object} [params.logger]
 * @param {string} [params.sessionId]
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function automationCheckAvailability({ execute, logger, sessionId }) {
  const expression = `(() => {
    const automation = window.SCORMAutomation;
    if (!automation || typeof automation !== 'object') {
      return { available: false, version: null };
    }
    let version = null;
    if (typeof automation.version === 'string') {
      version = automation.version;
    } else if (typeof automation.getVersion === 'function') {
      try {
        const reported = automation.getVersion();
        if (reported && typeof reported === 'object') {
          version = reported.version || reported.api || null;
        } else if (typeof reported === 'string') {
          version = reported;
        }
      } catch (error) {
        // Non-critical; leave version null
      }
    }
    return { available: true, version: version || null };
  })()`;

  try {
    const result = await execute(expression);
    const available = !!(result && result.available);
    const version = result && typeof result.version === 'string' ? result.version : null;
    return { available, version };
  } catch (error) {
    logger?.warn?.('Automation availability check failed', { sessionId, error: error?.message || error });
    return { available: false, version: null };
  }
}

/**
 * Convenience helper used by both MCP and renderer bridges to build a
 * consistent "API not available" error.
 * @param {string} toolName
 * @returns {Error}
 */
function createAutomationNotAvailableError(toolName) {
  const error = new Error(
    'Template Automation API not available. The window.SCORMAutomation object is not present in this course. ' +
    'Use DOM manipulation tools (scorm_dom_*) as an alternative.'
  );
  error.code = AUTOMATION_ERROR_CODES.NOT_AVAILABLE;
  error.name = 'AutomationAPIError';
  error.tool = toolName;
  return error;
}

async function automationGetCourseStructure({ execute, logger, sessionId }) {
  const result = await automationCall({ execute, method: 'getCourseStructure', logger, sessionId });
  return { structure: result || null };
}

async function automationGetCurrentSlide({ execute, logger, sessionId }) {
  const result = await automationCall({ execute, method: 'getCurrentSlide', logger, sessionId });
  return { slideId: result || null };
}

async function automationGoToSlide({ execute, logger, sessionId, slideId, context }) {
  if (!slideId || typeof slideId !== 'string') {
    const error = new Error('slideId parameter is required and must be a string');
    error.code = 'MCP_INVALID_PARAMS';
    throw error;
  }
  const args = context ? [slideId, context] : [slideId];
  const result = await automationCall({ execute, method: 'goToSlide', args, logger, sessionId });
  return { success: result !== false, slideId };
}

module.exports = {
  AUTOMATION_ERROR_CODES,
  automationCheckAvailability,
  automationCall,
  automationGetCourseStructure,
  automationGetCurrentSlide,
  automationGoToSlide,
  createAutomationNotAvailableError,
  buildAutomationCallExpression
};
