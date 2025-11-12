"use strict";

/**
 * MCP Tools for Template Automation API
 * 
 * These tools provide ergonomic access to the window.SCORMAutomation API
 * that is available in compatible SCORM templates. They wrap scorm_dom_evaluate
 * with structured error handling and type-safe interfaces.
 * 
 * All tools require an active runtime session and will check for API availability
 * before executing.
 */

const sessions = require("../session");
const { RuntimeManager } = require("../runtime-manager");
const getLogger = require('../../shared/utils/logger.js');

// Initialize logger
const logger = getLogger(process.env.SCORM_TESTER_LOG_DIR);

/**
 * Helper: Check if window.SCORMAutomation API is available
 * @param {string} session_id - Active runtime session ID
 * @returns {Promise<boolean>} - True if API is available
 */
async function checkAutomationAPI(session_id) {
  try {
    const result = await RuntimeManager.executeJS(
      null, 
      'typeof window.SCORMAutomation !== "undefined" && window.SCORMAutomation !== null',
      session_id
    );
    return result === true;
  } catch (err) {
    logger.debug('Error checking automation API availability', { session_id, error: err.message });
    return false;
  }
}

/**
 * Helper: Validate session and runtime status
 * @param {string} session_id - Session ID to validate
 * @throws {Error} - If session_id is invalid or runtime is not open
 */
async function validateRuntimeSession(session_id) {
  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }
}

/**
 * Helper: Create automation API not available error
 * @param {string} toolName - Name of the tool that requires the API
 * @returns {Error} - Structured error object
 */
function createAPINotAvailableError(toolName) {
  const e = new Error(
    `Template Automation API not available. The window.SCORMAutomation object is not present in this course. ` +
    `Use DOM manipulation tools (scorm_dom_*) as an alternative.`
  );
  e.code = 'AUTOMATION_API_NOT_AVAILABLE';
  e.name = 'AutomationAPIError';
  e.tool = toolName;
  return e;
}

/**
 * Helper: Get expected response format description for an interaction type
 * @param {string} type - Interaction type
 * @returns {string} - Human-readable description of expected format
 */
function getExpectedResponseFormat(type) {
  const formats = {
    'true-false': 'boolean (true or false)',
    'choice': 'string (single answer ID like "a") or array of strings (multiple answers like ["a", "c"])',
    'fill-in': 'string (the text answer)',
    'long-fill-in': 'string (the text answer)',
    'matching': 'array of objects with source/target pairs like [{source: "1", target: "a"}, {source: "2", target: "b"}]',
    'performance': 'string (the response text)',
    'sequencing': 'array of strings in order like ["step1", "step2", "step3"]',
    'likert': 'string (the selected scale value)',
    'numeric': 'number or string representing a numeric value',
    'other': 'format depends on the specific interaction implementation'
  };
  
  return formats[type] || 'unknown - consult the course template documentation';
}

/**
 * Helper: Validate response format matches interaction type
 * @param {any} response - The response value to validate
 * @param {string} type - The interaction type
 * @param {string} id - The interaction ID (for error messages)
 * @throws {Error} - If response format is invalid
 */
function validateResponseFormat(response, type, id) {
  const expectedFormat = getExpectedResponseFormat(type);
  
  switch (type) {
    case 'true-false':
      if (typeof response !== 'boolean') {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = typeof response;
        throw e;
      }
      break;
      
    case 'choice':
      if (typeof response !== 'string' && !Array.isArray(response)) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = typeof response;
        throw e;
      }
      if (Array.isArray(response) && !response.every(item => typeof item === 'string')) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: array containing non-string values (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = 'array with non-string items';
        throw e;
      }
      break;
      
    case 'fill-in':
    case 'long-fill-in':
    case 'performance':
    case 'likert':
      if (typeof response !== 'string') {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = typeof response;
        throw e;
      }
      break;
      
    case 'numeric':
      if (typeof response !== 'number' && typeof response !== 'string') {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = typeof response;
        throw e;
      }
      if (typeof response === 'string' && isNaN(Number(response))) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: non-numeric string (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = 'non-numeric string';
        throw e;
      }
      break;
      
    case 'matching': {
      if (!Array.isArray(response)) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = typeof response;
        throw e;
      }
      const invalidMatchItems = response.filter(item => 
        !item || typeof item !== 'object' || !('source' in item) || !('target' in item)
      );
      if (invalidMatchItems.length > 0) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: array with invalid matching pairs. Each item must have 'source' and 'target' properties.`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = 'array with invalid matching pairs';
        throw e;
      }
      break;
    }
      
    case 'sequencing':
      if (!Array.isArray(response)) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = typeof response;
        throw e;
      }
      if (!response.every(item => typeof item === 'string')) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: array containing non-string values (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = 'array with non-string items';
        throw e;
      }
      break;
      
    // For 'other' type, we can't validate - let the template handle it
    case 'other':
    default:
      // No validation for unknown types
      break;
  }
}

// ============================================================================
// CORE INTERACTION TOOLS
// ============================================================================

/**
 * Check if the Template Automation API is available
 * This is the entry point tool that should be called first to determine
 * if automation tools can be used with the current course.
 */
async function scorm_automation_check_availability(params = {}) {
  const session_id = params.session_id;

  await validateRuntimeSession(session_id);

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:check_availability', 
      payload: {} 
    });

    const available = await checkAutomationAPI(session_id);

    // If available, also get the API version if exposed
    let version = null;
    if (available) {
      try {
        const versionResult = await RuntimeManager.executeJS(
          null,
          'window.SCORMAutomation.version || null',
          session_id
        );
        version = versionResult;
      } catch (err) {
        // Version not available, not critical
      }
    }

    return {
      available,
      version,
      message: available 
        ? 'Template Automation API is available'
        : 'Template Automation API is not available. Use DOM tools as fallback.'
    };
  } catch (err) {
    logger.error('Error checking automation API availability', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    throw err;
  }
}

/**
 * List all registered interactive elements on the current slide
 */
async function scorm_automation_list_interactions(params = {}) {
  const session_id = params.session_id;

  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_list_interactions');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:list_interactions', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.listInteractions()',
      session_id
    );

    return {
      available: true,
      interactions: result || [],
      count: Array.isArray(result) ? result.length : 0
    };
  } catch (err) {
    logger.error('Error listing interactions', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to list interactions: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Set the response for a specific interaction
 */
async function scorm_automation_set_response(params = {}) {
  const session_id = params.session_id;
  const id = params.id;
  const response = params.response;

  await validateRuntimeSession(session_id);

  if (!id || typeof id !== 'string') {
    const e = new Error('id parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (response === undefined) {
    const e = new Error('response parameter is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_set_response');
  }

  try {
    // Get interaction metadata to validate response format
    let interactionType = null;
    try {
      const interactionsResult = await RuntimeManager.executeJS(
        null,
        'window.SCORMAutomation.listInteractions()',
        session_id
      );
      
      if (Array.isArray(interactionsResult)) {
        const interaction = interactionsResult.find(i => i.id === id);
        if (interaction && interaction.type) {
          interactionType = interaction.type;
          // Validate response format if we know the type
          validateResponseFormat(response, interactionType, id);
        }
      }
    } catch (validationErr) {
      // If validation failed, re-throw the validation error
      if (validationErr.code === 'INVALID_RESPONSE_FORMAT') {
        throw validationErr;
      }
      // If we couldn't get interaction metadata, log but continue
      // (the template will validate and provide its own error)
      logger.debug('Could not retrieve interaction metadata for validation', {
        session_id,
        id,
        error: validationErr.message
      });
    }

    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:set_response', 
      payload: { id, response, interactionType } 
    });

    // Use a more robust approach: pass response via closure to avoid string escaping issues
    // This ensures objects remain objects and aren't accidentally stringified
    const expression = `
      (function() {
        const responseValue = ${JSON.stringify(response)};
        return window.SCORMAutomation.setResponse(${JSON.stringify(id)}, responseValue);
      })()
    `;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      success: result,
      id,
      response,
      ...(interactionType && { interactionType })
    };
  } catch (err) {
    // If it's already a validation error, just re-throw with additional context
    if (err.code === 'INVALID_RESPONSE_FORMAT') {
      logger.error('Response format validation failed', {
        session_id,
        id,
        response,
        interactionType: err.interactionType,
        expectedFormat: err.expectedFormat,
        receivedType: err.receivedType
      });
      throw err;
    }

    logger.error('Error setting response', { 
      session_id, 
      id,
      response,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to set response for interaction '${id}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.originalError = err;
    throw e;
  }
}

/**
 * Check/evaluate the answer for a specific interaction
 */
async function scorm_automation_check_answer(params = {}) {
  const session_id = params.session_id;
  const id = params.id;

  await validateRuntimeSession(session_id);

  if (!id || typeof id !== 'string') {
    const e = new Error('id parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_check_answer');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:check_answer', 
      payload: { id } 
    });

    const expression = `window.SCORMAutomation.checkAnswer('${id.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      result,
      id
    };
  } catch (err) {
    logger.error('Error checking answer', { 
      session_id, 
      id,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to check answer for interaction '${id}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.originalError = err;
    throw e;
  }
}

/**
 * Get the current response value for a specific interaction
 */
async function scorm_automation_get_response(params = {}) {
  const session_id = params.session_id;
  const id = params.id;

  await validateRuntimeSession(session_id);

  if (!id || typeof id !== 'string') {
    const e = new Error('id parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_response');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_response', 
      payload: { id } 
    });

    const expression = `window.SCORMAutomation.getResponse('${id.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      response: result,
      id
    };
  } catch (err) {
    logger.error('Error getting response', { 
      session_id, 
      id,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get response for interaction '${id}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.originalError = err;
    throw e;
  }
}

// ============================================================================
// NAVIGATION TOOLS
// ============================================================================

/**
 * Get the course structure as defined in course-config.js
 */
async function scorm_automation_get_course_structure(params = {}) {
  const session_id = params.session_id;

  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_course_structure');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_course_structure', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.getCourseStructure()',
      session_id
    );

    return {
      available: true,
      structure: result
    };
  } catch (err) {
    logger.error('Error getting course structure', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get course structure: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Get the ID of the currently active slide
 */
async function scorm_automation_get_current_slide(params = {}) {
  const session_id = params.session_id;

  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_current_slide');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_current_slide', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.getCurrentSlide()',
      session_id
    );

    return {
      available: true,
      slideId: result
    };
  } catch (err) {
    logger.error('Error getting current slide', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get current slide: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Navigate to a specific slide
 */
async function scorm_automation_go_to_slide(params = {}) {
  const session_id = params.session_id;
  const slideId = params.slideId;

  await validateRuntimeSession(session_id);

  if (!slideId || typeof slideId !== 'string') {
    const e = new Error('slideId parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_go_to_slide');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:go_to_slide', 
      payload: { slideId } 
    });

    const expression = `window.SCORMAutomation.goToSlide('${slideId.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      success: result,
      slideId
    };
  } catch (err) {
    logger.error('Error navigating to slide', { 
      session_id, 
      slideId,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to navigate to slide '${slideId}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.slideId = slideId;
    e.originalError = err;
    throw e;
  }
}

// ============================================================================
// ADVANCED INTROSPECTION TOOLS
// ============================================================================

/**
 * Get the correct response for an interaction
 * Requires exposeCorrectAnswers to be enabled in course config
 */
async function scorm_automation_get_correct_response(params = {}) {
  const session_id = params.session_id;
  const id = params.id;

  await validateRuntimeSession(session_id);

  if (!id || typeof id !== 'string') {
    const e = new Error('id parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_correct_response');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_correct_response', 
      payload: { id } 
    });

    const expression = `window.SCORMAutomation.getCorrectResponse('${id.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      correctResponse: result,
      id
    };
  } catch (err) {
    logger.error('Error getting correct response', { 
      session_id, 
      id,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get correct response for interaction '${id}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.originalError = err;
    throw e;
  }
}

/**
 * Get the last evaluation result without re-triggering evaluation
 */
async function scorm_automation_get_last_evaluation(params = {}) {
  const session_id = params.session_id;
  const id = params.id;

  await validateRuntimeSession(session_id);

  if (!id || typeof id !== 'string') {
    const e = new Error('id parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_last_evaluation');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_last_evaluation', 
      payload: { id } 
    });

    const expression = `window.SCORMAutomation.getLastEvaluation('${id.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      evaluation: result,
      id
    };
  } catch (err) {
    logger.error('Error getting last evaluation', { 
      session_id, 
      id,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get last evaluation for interaction '${id}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.originalError = err;
    throw e;
  }
}

/**
 * Check answers for all interactions on a slide
 */
async function scorm_automation_check_slide_answers(params = {}) {
  const session_id = params.session_id;
  const slideId = params.slideId || null;

  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_check_slide_answers');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:check_slide_answers', 
      payload: { slideId } 
    });

    const expression = slideId 
      ? `window.SCORMAutomation.checkSlideAnswers('${slideId.replace(/'/g, "\\'")}')` 
      : 'window.SCORMAutomation.checkSlideAnswers()';
    
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      results: result,
      slideId: slideId || 'current'
    };
  } catch (err) {
    logger.error('Error checking slide answers', { 
      session_id, 
      slideId,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to check slide answers: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    if (slideId) e.slideId = slideId;
    e.originalError = err;
    throw e;
  }
}

// ============================================================================
// DEBUGGING & TRACING TOOLS
// ============================================================================

/**
 * Get the automation action trace log
 */
async function scorm_automation_get_trace(params = {}) {
  const session_id = params.session_id;

  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_trace');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_trace', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.getAutomationTrace()',
      session_id
    );

    return {
      available: true,
      trace: result || []
    };
  } catch (err) {
    logger.error('Error getting automation trace', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get automation trace: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Clear the automation action trace log
 */
async function scorm_automation_clear_trace(params = {}) {
  const session_id = params.session_id;

  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_clear_trace');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:clear_trace', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.clearAutomationTrace()',
      session_id
    );

    return {
      available: true,
      success: result !== false
    };
  } catch (err) {
    logger.error('Error clearing automation trace', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to clear automation trace: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  scorm_automation_check_availability,
  scorm_automation_list_interactions,
  scorm_automation_set_response,
  scorm_automation_check_answer,
  scorm_automation_get_response,
  scorm_automation_get_course_structure,
  scorm_automation_get_current_slide,
  scorm_automation_go_to_slide,
  scorm_automation_get_correct_response,
  scorm_automation_get_last_evaluation,
  scorm_automation_check_slide_answers,
  scorm_automation_get_trace,
  scorm_automation_clear_trace
};
