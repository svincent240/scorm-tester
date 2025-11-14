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
    'fill-in': 'string (single blank) or object (multi-blank like {"blank_0": "answer1", "blank_1": "answer2"})',
    'long-fill-in': 'string (the text answer)',
    'matching': 'array of objects with source/target pairs like [{source: "1", target: "a"}, {source: "2", target: "b"}]',
    'performance': 'string (the response text)',
    'sequencing': 'array of strings in order like ["step1", "step2", "step3"]',
    'likert': 'string (the selected scale value)',
    'numeric': 'number or string representing a numeric value',
    'drag-drop': 'object with {itemId: zoneId} pairs (e.g., {"item1": "zone-a", "item2": "zone-b"})',
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
      // Fill-in can be either string (single blank) or object (multi-blank)
      if (typeof response !== 'string' && (typeof response !== 'object' || response === null || Array.isArray(response))) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${Array.isArray(response) ? 'array' : typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = Array.isArray(response) ? 'array' : typeof response;
        throw e;
      }
      // If it's an object, validate that values are strings (blank IDs -> answers)
      if (typeof response === 'object' && !Array.isArray(response)) {
        const nonStringValues = Object.entries(response).filter(([_, value]) => typeof value !== 'string');
        if (nonStringValues.length > 0) {
          const e = new Error(
            `Invalid response format for interaction '${id}' (type: ${type}). ` +
            `Expected: ${expectedFormat}. ` +
            `Got: object with non-string values. All blank answers must be strings. ` +
            `Invalid entries: ${JSON.stringify(Object.fromEntries(nonStringValues))}`
          );
          e.code = 'INVALID_RESPONSE_FORMAT';
          e.name = 'AutomationAPIError';
          e.interactionId = id;
          e.interactionType = type;
          e.expectedFormat = expectedFormat;
          e.receivedValue = response;
          e.receivedType = 'object with non-string values';
          throw e;
        }
      }
      break;
      
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
      
    case 'drag-drop': {
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: ${Array.isArray(response) ? 'array' : typeof response} (${JSON.stringify(response)})`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = Array.isArray(response) ? 'array' : typeof response;
        throw e;
      }
      // Validate that all values are strings (zone IDs)
      const nonStringValues = Object.entries(response).filter(([_, value]) => typeof value !== 'string');
      if (nonStringValues.length > 0) {
        const e = new Error(
          `Invalid response format for interaction '${id}' (type: ${type}). ` +
          `Expected: ${expectedFormat}. ` +
          `Got: object with non-string values. All zone IDs must be strings. ` +
          `Invalid entries: ${JSON.stringify(Object.fromEntries(nonStringValues))}`
        );
        e.code = 'INVALID_RESPONSE_FORMAT';
        e.name = 'AutomationAPIError';
        e.interactionId = id;
        e.interactionType = type;
        e.expectedFormat = expectedFormat;
        e.receivedValue = response;
        e.receivedType = 'object with non-string values';
        throw e;
      }
      break;
    }
      
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
  let response = params.response;

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

  // Handle stringified JSON objects from MCP clients
  // Some MCP clients may send JSON objects as strings, especially for complex types
  if (typeof response === 'string' && (response.trim().startsWith('{') || response.trim().startsWith('['))) {
    try {
      const parsed = JSON.parse(response);
      logger.debug('Parsed stringified JSON response', {
        session_id,
        id,
        originalType: 'string',
        parsedType: Array.isArray(parsed) ? 'array' : typeof parsed
      });
      response = parsed;
    } catch (parseErr) {
      // If parsing fails, it might be a legitimate string response (e.g., for fill-in)
      // Continue with the original string value
      logger.debug('Response appears to be JSON but failed to parse, treating as string', {
        session_id,
        id,
        error: parseErr.message
      });
    }
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_set_response');
  }

  // Get interaction metadata to validate response format
  let interactionType = null;
  
  try {
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
    
    // Provide enhanced error message for drag-drop interactions
    let errorMessage = `Failed to set response for interaction '${id}': ${err.message}`;
    if (interactionType === 'drag-drop' && err.message.includes('expects an object')) {
      errorMessage += `\n\nDrag-drop troubleshooting:\n` +
        `- Your response format: ${JSON.stringify(response)}\n` +
        `- Expected format: {itemId: zoneId} (e.g., {"item1": "zone-a"})\n` +
        `- Common issues:\n` +
        `  1. Item IDs may be case-sensitive\n` +
        `  2. Zone IDs must match exactly as defined in the template\n` +
        `  3. The template may require all draggable items to be assigned\n` +
        `  4. Some templates expect a wrapper object like {items: {...}}\n` +
        `\nTry using scorm_automation_list_interactions to see the exact structure expected, ` +
        `or scorm_automation_get_correct_response to see the correct answer format.`;
    }
    
    const e = new Error(errorMessage);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.interactionType = interactionType;
    e.responseProvided = response;
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
// ENGAGEMENT TRACKING TOOLS
// ============================================================================

/**
 * Get engagement tracking state for current slide
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @returns {Promise<Object>} - Engagement state
 */
async function scorm_engagement_get_state({ session_id }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_engagement_get_state');
  }

  try {
    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.getEngagementState()',
      session_id
    );

    return {
      available: true,
      state: result
    };
  } catch (err) {
    logger.error('Error getting engagement state', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get engagement state: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Get user-friendly engagement progress for current slide
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @returns {Promise<Object>} - Engagement progress with percentage and items
 */
async function scorm_engagement_get_progress({ session_id }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_engagement_get_progress');
  }

  try {
    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.getEngagementProgress()',
      session_id
    );

    return {
      available: true,
      progress: result
    };
  } catch (err) {
    logger.error('Error getting engagement progress', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get engagement progress: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Manually mark a tab as viewed (for testing purposes)
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @param {string} params.tab_id - Tab identifier to mark as viewed
 * @returns {Promise<Object>} - Success indicator
 */
async function scorm_engagement_mark_tab_viewed({ session_id, tab_id }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_engagement_mark_tab_viewed');
  }

  if (!tab_id || typeof tab_id !== 'string') {
    const e = new Error('tab_id is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  try {
    const expression = `window.SCORMAutomation.markTabViewed('${tab_id.replace(/'/g, "\\'")}')`;
    await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      success: true,
      tab_id
    };
  } catch (err) {
    logger.error('Error marking tab as viewed', { 
      session_id, 
      tab_id,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to mark tab as viewed: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Manually set scroll depth percentage (for testing purposes)
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @param {number} params.percentage - Scroll depth percentage (0-100)
 * @returns {Promise<Object>} - Success indicator
 */
async function scorm_engagement_set_scroll_depth({ session_id, percentage }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_engagement_set_scroll_depth');
  }

  if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
    const e = new Error('percentage must be a number between 0 and 100');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  try {
    const expression = `window.SCORMAutomation.setScrollDepth(${percentage})`;
    await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      success: true,
      percentage
    };
  } catch (err) {
    logger.error('Error setting scroll depth', { 
      session_id, 
      percentage,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to set scroll depth: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Reset engagement tracking for current slide (for testing purposes)
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @returns {Promise<Object>} - Success indicator
 */
async function scorm_engagement_reset({ session_id }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_engagement_reset');
  }

  try {
    await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.resetEngagement()',
      session_id
    );

    return {
      available: true,
      success: true
    };
  } catch (err) {
    logger.error('Error resetting engagement', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to reset engagement: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

// ============================================================================
// INTERACTION METADATA & VERSION TOOLS
// ============================================================================

/**
 * Get metadata for a specific interaction
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @param {string} params.id - Interaction ID
 * @returns {Promise<Object>} - Interaction metadata
 */
async function scorm_automation_get_interaction_metadata({ session_id, id }) {
  await validateRuntimeSession(session_id);

  if (!id || typeof id !== 'string') {
    const e = new Error('id parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_interaction_metadata');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_interaction_metadata', 
      payload: { id } 
    });

    const expression = `window.SCORMAutomation.getInteractionMetadata('${id.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      metadata: result,
      id
    };
  } catch (err) {
    logger.error('Error getting interaction metadata', { 
      session_id, 
      id,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get metadata for interaction '${id}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.interactionId = id;
    e.originalError = err;
    throw e;
  }
}

/**
 * Get API version information
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @returns {Promise<Object>} - Version information including API version, phase, and features
 */
async function scorm_automation_get_version({ session_id }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_version');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_version', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.getVersion()',
      session_id
    );

    return {
      available: true,
      version: result
    };
  } catch (err) {
    logger.error('Error getting API version', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get API version: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

// ============================================================================
// LAYOUT & STYLE INTROSPECTION TOOLS
// ============================================================================

/**
 * Get a simplified layout tree of the current slide's structure
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @param {number} [params.max_depth=3] - Maximum depth to traverse (default: 3)
 * @returns {Promise<Object>} - Layout tree with key elements
 */
async function scorm_automation_get_layout_tree({ session_id, max_depth = 3 }) {
  await validateRuntimeSession(session_id);

  if (max_depth !== undefined && (typeof max_depth !== 'number' || max_depth < 1 || max_depth > 10)) {
    const e = new Error('max_depth must be a number between 1 and 10');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_layout_tree');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_layout_tree', 
      payload: { max_depth } 
    });

    const result = await RuntimeManager.executeJS(
      null,
      `window.SCORMAutomation.getLayoutTree()`,
      session_id
    );

    return {
      available: true,
      layout: result
    };
  } catch (err) {
    logger.error('Error getting layout tree', { 
      session_id, 
      max_depth,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get layout tree: ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.originalError = err;
    throw e;
  }
}

/**
 * Get detailed layout and style information for a specific element
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @param {string} params.testid - The data-testid attribute value
 * @returns {Promise<Object>} - Element details including bounding box and computed styles
 */
async function scorm_automation_get_element_details({ session_id, testid }) {
  await validateRuntimeSession(session_id);

  if (!testid || typeof testid !== 'string') {
    const e = new Error('testid parameter is required and must be a string');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_get_element_details');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:get_element_details', 
      payload: { testid } 
    });

    const expression = `window.SCORMAutomation.getElementDetails('${testid.replace(/'/g, "\\'")}')`;
    const result = await RuntimeManager.executeJS(null, expression, session_id);

    return {
      available: true,
      details: result,
      testid
    };
  } catch (err) {
    logger.error('Error getting element details', { 
      session_id, 
      testid,
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to get details for element with testid '${testid}': ${err.message}`);
    e.code = 'AUTOMATION_API_ERROR';
    e.name = 'AutomationAPIError';
    e.testid = testid;
    e.originalError = err;
    throw e;
  }
}

/**
 * Validate the current page layout and return potential issues
 * Returns issues categorized as errors or warnings, including:
 * - Off-screen content (partially or fully outside viewport)
 * - Overlapping interactive elements
 * - Text overflow (vertical/horizontal clipping)
 * - Low color contrast (WCAG AA violations)
 * - Zero-size visible elements
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.session_id - Session ID
 * @returns {Promise<Object>} - Array of layout issues with type, category, message, and affected elements
 */
async function scorm_automation_validate_page_layout({ session_id }) {
  await validateRuntimeSession(session_id);

  const available = await checkAutomationAPI(session_id);
  if (!available) {
    throw createAPINotAvailableError('scorm_automation_validate_page_layout');
  }

  try {
    sessions.emit && sessions.emit({ 
      session_id, 
      type: 'automation:validate_page_layout', 
      payload: {} 
    });

    const result = await RuntimeManager.executeJS(
      null,
      'window.SCORMAutomation.validatePageLayout()',
      session_id
    );

    const issues = result || [];
    const errorCount = issues.filter(i => i.type === 'error').length;
    const warningCount = issues.filter(i => i.type === 'warning').length;

    return {
      available: true,
      issues,
      summary: {
        total: issues.length,
        errors: errorCount,
        warnings: warningCount,
        categories: {
          layout: issues.filter(i => i.category === 'layout').length,
          content: issues.filter(i => i.category === 'content').length,
          accessibility: issues.filter(i => i.category === 'accessibility').length,
          structure: issues.filter(i => i.category === 'structure').length
        }
      }
    };
  } catch (err) {
    logger.error('Error validating page layout', { 
      session_id, 
      error: err.message,
      stack: err.stack 
    });
    
    const e = new Error(`Failed to validate page layout: ${err.message}`);
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
  scorm_automation_clear_trace,
  scorm_automation_get_interaction_metadata,
  scorm_automation_get_version,
  scorm_automation_get_layout_tree,
  scorm_automation_get_element_details,
  scorm_automation_validate_page_layout,
  scorm_engagement_get_state,
  scorm_engagement_get_progress,
  scorm_engagement_mark_tab_viewed,
  scorm_engagement_set_scroll_depth,
  scorm_engagement_reset
};
