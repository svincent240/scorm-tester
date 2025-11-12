"use strict";

/**
 * Unit tests for MCP Template Automation tools
 * Tests error handling, parameter validation, and API availability checking
 */

// Mock RuntimeManager
jest.mock('../../../../src/mcp/runtime-manager', () => ({
  RuntimeManager: {
    getRuntimeStatus: jest.fn(),
    executeJS: jest.fn()
  }
}));

// Mock sessions
jest.mock('../../../../src/mcp/session', () => ({
  emit: jest.fn()
}));

const sessions = require('../../../../src/mcp/session');
const { RuntimeManager } = require('../../../../src/mcp/runtime-manager');

// Import tools to test
const {
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
} = require('../../../../src/mcp/tools/automation');

describe('MCP Template Automation Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock: runtime is open
    RuntimeManager.getRuntimeStatus = jest.fn().mockResolvedValue({
      open: true,
      url: 'http://localhost:8080/index.html'
    });
    
    sessions.emit = jest.fn();
  });

  describe('Parameter Validation', () => {
    test('all tools reject missing session_id', async () => {
      const tools = [
        scorm_automation_check_availability,
        scorm_automation_list_interactions,
        scorm_automation_get_course_structure,
        scorm_automation_get_current_slide,
        scorm_automation_get_trace,
        scorm_automation_clear_trace
      ];

      for (const tool of tools) {
        await expect(tool({})).rejects.toMatchObject({
          message: 'session_id is required',
          code: 'MCP_INVALID_PARAMS'
        });
      }
    });

    test('tools with id parameter reject missing id', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      const tools = [
        scorm_automation_set_response,
        scorm_automation_check_answer,
        scorm_automation_get_response,
        scorm_automation_get_correct_response,
        scorm_automation_get_last_evaluation
      ];

      for (const tool of tools) {
        await expect(tool({ session_id: 'test' })).rejects.toMatchObject({
          message: expect.stringContaining('id parameter is required'),
          code: 'MCP_INVALID_PARAMS'
        });
      }
    });

    test('scorm_automation_set_response rejects missing response', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_automation_set_response({ session_id: 'test', id: 'q1' })
      ).rejects.toMatchObject({
        message: 'response parameter is required',
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('scorm_automation_go_to_slide rejects missing slideId', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_automation_go_to_slide({ session_id: 'test' })
      ).rejects.toMatchObject({
        message: expect.stringContaining('slideId parameter is required'),
        code: 'MCP_INVALID_PARAMS'
      });
    });
  });

  describe('Runtime Status Validation', () => {
    test('all tools reject when runtime is not open', async () => {
      RuntimeManager.getRuntimeStatus = jest.fn().mockResolvedValue({
        open: false
      });

      const tools = [
        { fn: scorm_automation_check_availability, params: { session_id: 'test' } },
        { fn: scorm_automation_list_interactions, params: { session_id: 'test' } }
      ];

      for (const { fn, params } of tools) {
        await expect(fn(params)).rejects.toMatchObject({
          message: 'Runtime not open',
          code: 'RUNTIME_NOT_OPEN'
        });
      }
    });
  });

  describe('API Availability Checking', () => {
    test('scorm_automation_check_availability returns available when API present', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce('1.0.0'); // version check

      const result = await scorm_automation_check_availability({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        version: '1.0.0',
        message: 'Template Automation API is available'
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'typeof window.SCORMAutomation !== "undefined" && window.SCORMAutomation !== null',
        'test'
      );
    });

    test('scorm_automation_check_availability returns unavailable when API missing', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(false);

      const result = await scorm_automation_check_availability({ session_id: 'test' });

      expect(result).toEqual({
        available: false,
        version: null,
        message: 'Template Automation API is not available. Use DOM tools as fallback.'
      });
    });

    test('tools throw AUTOMATION_API_NOT_AVAILABLE when API is missing', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(false);

      await expect(
        scorm_automation_list_interactions({ session_id: 'test' })
      ).rejects.toMatchObject({
        code: 'AUTOMATION_API_NOT_AVAILABLE',
        name: 'AutomationAPIError',
        tool: 'scorm_automation_list_interactions'
      });
    });
  });

  describe('Core Interaction Tools', () => {
    beforeEach(() => {
      // Mock API as available
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('scorm_automation_list_interactions returns interaction list', async () => {
      const mockInteractions = [
        { id: 'q1', type: 'choice', label: 'Question 1' },
        { id: 'q2', type: 'text', label: 'Question 2' }
      ];

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockInteractions); // listInteractions call

      const result = await scorm_automation_list_interactions({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        interactions: mockInteractions,
        count: 2
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'window.SCORMAutomation.listInteractions()',
        'test'
      );
    });

    test('scorm_automation_set_response sets interaction response', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q1', type: 'choice' }]) // listInteractions call for validation
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'q1',
        response: 'answer-a'
      });

      expect(result).toEqual({
        available: true,
        success: true,
        id: 'q1',
        response: 'answer-a',
        interactionType: 'choice'
      });

      // Verify the JavaScript expression uses IIFE pattern and JSON.stringify
      const call = RuntimeManager.executeJS.mock.calls[2]; // Third call (0: API check, 1: listInteractions, 2: setResponse)
      const expression = call[1];
      
      expect(expression).toContain('(function()');
      expect(expression).toContain('const responseValue =');
      expect(expression).toContain('window.SCORMAutomation.setResponse');
      expect(expression).toContain('"q1"');
      expect(expression).toContain('"answer-a"');
    });

    test('scorm_automation_set_response properly escapes ID with special characters', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: "q'1", type: 'fill-in' }]) // listInteractions call for validation
        .mockResolvedValueOnce(true); // setResponse call

      await scorm_automation_set_response({
        session_id: 'test',
        id: "q'1",
        response: 'answer'
      });

      const call = RuntimeManager.executeJS.mock.calls[2]; // Third call
      const expression = call[1];
      
      // With JSON.stringify, quotes are properly escaped
      expect(expression).toContain('"q\'1"'); // JSON.stringify escapes the single quote
      expect(expression).toContain('window.SCORMAutomation.setResponse');
    });

    test('scorm_automation_set_response validates true-false interaction format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q1', type: 'true-false' }]); // listInteractions call

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'q1',
          response: 'true' // Should be boolean, not string
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        name: 'AutomationAPIError',
        interactionId: 'q1',
        interactionType: 'true-false'
      });
    });

    test('scorm_automation_set_response validates choice interaction format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q2', type: 'choice' }]); // listInteractions call

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'q2',
          response: 123 // Should be string or array of strings
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        name: 'AutomationAPIError',
        interactionId: 'q2',
        interactionType: 'choice'
      });
    });

    test('scorm_automation_set_response validates numeric interaction format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q3', type: 'numeric' }]); // listInteractions call

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'q3',
          response: true // Should be number or numeric string
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        name: 'AutomationAPIError',
        interactionId: 'q3',
        interactionType: 'numeric'
      });
    });

    test('scorm_automation_set_response validates matching interaction format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q4', type: 'matching' }]); // listInteractions call

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'q4',
          response: [{ source: '1' }] // Missing 'target' property
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        name: 'AutomationAPIError',
        interactionId: 'q4',
        interactionType: 'matching'
      });
    });

    test('scorm_automation_set_response accepts valid matching format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q4', type: 'matching' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'q4',
        response: [{ source: '1', target: 'a' }, { source: '2', target: 'b' }]
      });

      expect(result.success).toBe(true);
      expect(result.interactionType).toBe('matching');
    });

    test('scorm_automation_set_response properly serializes complex objects for drag-drop', async () => {
      const complexResponse = {
        drops: [
          { dropZoneId: 'zone1', itemId: 'item-a' },
          { dropZoneId: 'zone2', itemId: 'item-b' },
          { dropZoneId: 'zone3', itemId: 'item-c' }
        ]
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'dd-1', type: 'other' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'dd-1',
        response: complexResponse
      });

      expect(result.success).toBe(true);

      // Verify the expression uses IIFE and JSON.stringify to preserve object structure
      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      
      // Should use IIFE pattern
      expect(expression).toContain('(function()');
      expect(expression).toContain('const responseValue =');
      expect(expression).toContain('window.SCORMAutomation.setResponse');
      
      // Should contain the serialized object structure
      expect(expression).toContain('"drops"');
      expect(expression).toContain('"dropZoneId"');
      expect(expression).toContain('"itemId"');
    });

    test('scorm_automation_set_response handles nested objects correctly', async () => {
      const nestedResponse = {
        answers: {
          section1: ['a', 'b'],
          section2: ['c', 'd']
        },
        metadata: {
          attempts: 2,
          timestamp: 1234567890
        }
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'complex-q', type: 'other' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'complex-q',
        response: nestedResponse
      });

      expect(result.success).toBe(true);

      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      
      // Verify nested structure is properly serialized
      expect(expression).toContain('"section1"');
      expect(expression).toContain('"section2"');
      expect(expression).toContain('"metadata"');
      expect(expression).toContain('"attempts"');
    });

    test('scorm_automation_set_response handles array responses', async () => {
      const arrayResponse = ['choice-a', 'choice-c', 'choice-e'];

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'multi-choice', type: 'choice' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'multi-choice',
        response: arrayResponse
      });

      expect(result.success).toBe(true);

      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      
      // Verify array is properly serialized
      expect(expression).toContain('["choice-a","choice-c","choice-e"]');
    });

    test('scorm_automation_set_response handles boolean responses', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'tf-1', type: 'true-false' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'tf-1',
        response: true
      });

      expect(result.success).toBe(true);

      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      
      // Verify boolean is properly serialized
      expect(expression).toContain('const responseValue = true');
    });

    test('scorm_automation_set_response handles null and undefined edge cases', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'q-null', type: 'other' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'q-null',
        response: null
      });

      expect(result.success).toBe(true);

      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      
      // Verify null is properly serialized
      expect(expression).toContain('const responseValue = null');
    });

    test('scorm_automation_set_response escapes special characters in object values', async () => {
      const responseWithSpecialChars = {
        text: 'Answer with "quotes" and \'apostrophes\' and \n newlines'
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'special', type: 'other' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'special',
        response: responseWithSpecialChars
      });

      expect(result.success).toBe(true);

      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      
      // Verify JSON.stringify properly escapes special characters
      expect(expression).toContain('\\n'); // newline escaped
      expect(expression).toContain('\\"'); // quotes escaped
    });

    test('scorm_automation_set_response works when interaction metadata not available', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(null) // listInteractions returns null
        .mockResolvedValueOnce(true); // setResponse call succeeds anyway

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'q5',
        response: 'any-value'
      });

      // Should succeed even without validation when metadata not available
      expect(result.success).toBe(true);
      expect(result.interactionType).toBeUndefined();
    });

    test('scorm_automation_check_answer evaluates interaction', async () => {
      const mockResult = { correct: true, score: 1 };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockResult); // checkAnswer call

      const result = await scorm_automation_check_answer({
        session_id: 'test',
        id: 'q1'
      });

      expect(result).toEqual({
        available: true,
        result: mockResult,
        id: 'q1'
      });
    });

    test('scorm_automation_get_response retrieves current response', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce('answer-b'); // getResponse call

      const result = await scorm_automation_get_response({
        session_id: 'test',
        id: 'q1'
      });

      expect(result).toEqual({
        available: true,
        response: 'answer-b',
        id: 'q1'
      });
    });
  });

  describe('Navigation Tools', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('scorm_automation_get_course_structure returns structure', async () => {
      const mockStructure = {
        slides: [
          { id: 'slide-1', title: 'Introduction' },
          { id: 'slide-2', title: 'Content' }
        ]
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockStructure); // getCourseStructure call

      const result = await scorm_automation_get_course_structure({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        structure: mockStructure
      });
    });

    test('scorm_automation_get_current_slide returns slide ID', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce('slide-2'); // getCurrentSlide call

      const result = await scorm_automation_get_current_slide({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        slideId: 'slide-2'
      });
    });

    test('scorm_automation_go_to_slide navigates to slide', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(true); // goToSlide call

      const result = await scorm_automation_go_to_slide({
        session_id: 'test',
        slideId: 'slide-3'
      });

      expect(result).toEqual({
        available: true,
        success: true,
        slideId: 'slide-3'
      });

      const call = RuntimeManager.executeJS.mock.calls[1];
      expect(call[1]).toContain("window.SCORMAutomation.goToSlide('slide-3')");
    });
  });

  describe('Advanced Introspection Tools', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('scorm_automation_get_correct_response returns correct answer', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce('answer-c'); // getCorrectResponse call

      const result = await scorm_automation_get_correct_response({
        session_id: 'test',
        id: 'q1'
      });

      expect(result).toEqual({
        available: true,
        correctResponse: 'answer-c',
        id: 'q1'
      });
    });

    test('scorm_automation_get_last_evaluation returns cached result', async () => {
      const mockEvaluation = { correct: false, score: 0, attempt: 2 };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockEvaluation); // getLastEvaluation call

      const result = await scorm_automation_get_last_evaluation({
        session_id: 'test',
        id: 'q1'
      });

      expect(result).toEqual({
        available: true,
        evaluation: mockEvaluation,
        id: 'q1'
      });
    });

    test('scorm_automation_check_slide_answers checks all interactions', async () => {
      const mockResults = [
        { id: 'q1', correct: true },
        { id: 'q2', correct: false }
      ];

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockResults); // checkSlideAnswers call

      const result = await scorm_automation_check_slide_answers({
        session_id: 'test',
        slideId: 'slide-1'
      });

      expect(result).toEqual({
        available: true,
        results: mockResults,
        slideId: 'slide-1'
      });
    });

    test('scorm_automation_check_slide_answers works without slideId', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([]); // checkSlideAnswers call

      const result = await scorm_automation_check_slide_answers({
        session_id: 'test'
      });

      expect(result).toEqual({
        available: true,
        results: [],
        slideId: 'current'
      });

      // Verify call without slideId parameter
      const call = RuntimeManager.executeJS.mock.calls[1];
      expect(call[1]).toBe('window.SCORMAutomation.checkSlideAnswers()');
    });
  });

  describe('Debugging & Tracing Tools', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('scorm_automation_get_trace returns trace log', async () => {
      const mockTrace = [
        { timestamp: 1234567890, action: 'setResponse', id: 'q1', value: 'a' },
        { timestamp: 1234567891, action: 'checkAnswer', id: 'q1', result: true }
      ];

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockTrace); // getAutomationTrace call

      const result = await scorm_automation_get_trace({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        trace: mockTrace
      });
    });

    test('scorm_automation_clear_trace clears the log', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(true); // clearAutomationTrace call

      const result = await scorm_automation_clear_trace({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        success: true
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true); // API available
    });

    test('tools wrap JavaScript execution errors appropriately', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockRejectedValueOnce(new Error('Invalid interaction ID')); // API call fails

      await expect(
        scorm_automation_get_response({ session_id: 'test', id: 'invalid' })
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to get response for interaction 'invalid'"),
        code: 'AUTOMATION_API_ERROR',
        name: 'AutomationAPIError',
        interactionId: 'invalid'
      });
    });

    test('session events are emitted for all operations', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([]); // listInteractions

      await scorm_automation_list_interactions({ session_id: 'test-session' });

      expect(sessions.emit).toHaveBeenCalledWith({
        session_id: 'test-session',
        type: 'automation:list_interactions',
        payload: {}
      });
    });
  });

  describe('Response Format Validation Error Messages', () => {
    test('true-false validation error provides helpful guidance', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'tf-q', type: 'true-false' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'tf-q',
          response: 'yes' // Invalid: should be boolean
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        name: 'AutomationAPIError',
        interactionId: 'tf-q',
        interactionType: 'true-false',
        expectedFormat: 'boolean (true or false)',
        receivedValue: 'yes',
        receivedType: 'string',
        message: expect.stringContaining('Expected: boolean (true or false)')
      });
    });

    test('choice validation error shows expected string or array format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'choice-q', type: 'choice' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'choice-q',
          response: { answer: 'a' } // Invalid: should be string or array
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'choice-q',
        interactionType: 'choice',
        expectedFormat: expect.stringContaining('string (single answer ID'),
        message: expect.stringContaining('Expected: string')
      });
    });

    test('choice validation error detects non-string array items', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'mc-q', type: 'choice' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'mc-q',
          response: ['a', 2, 'c'] // Invalid: array contains number
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'mc-q',
        interactionType: 'choice',
        receivedType: 'array with non-string items',
        message: expect.stringContaining('array containing non-string values')
      });
    });

    test('numeric validation error shows number or string format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'num-q', type: 'numeric' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'num-q',
          response: [42] // Invalid: array instead of number
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'num-q',
        interactionType: 'numeric',
        expectedFormat: 'number or string representing a numeric value',
        message: expect.stringContaining('Expected: number or string')
      });
    });

    test('numeric validation error detects non-numeric strings', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'num-q', type: 'numeric' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'num-q',
          response: 'not-a-number'
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'num-q',
        interactionType: 'numeric',
        receivedType: 'non-numeric string',
        message: expect.stringContaining('non-numeric string')
      });
    });

    test('matching validation error shows required object structure', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'match-q', type: 'matching' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'match-q',
          response: 'a-1,b-2' // Invalid: should be array of objects
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'match-q',
        interactionType: 'matching',
        expectedFormat: expect.stringContaining('array of objects with source/target pairs'),
        message: expect.stringContaining('Expected: array of objects')
      });
    });

    test('matching validation error detects missing source/target properties', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'match-q', type: 'matching' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'match-q',
          response: [
            { source: '1', target: 'a' },
            { source: '2' }, // Missing target
            { target: 'c' }  // Missing source
          ]
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'match-q',
        interactionType: 'matching',
        receivedType: 'array with invalid matching pairs',
        message: expect.stringContaining("Each item must have 'source' and 'target' properties")
      });
    });

    test('sequencing validation error shows array of strings format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'seq-q', type: 'sequencing' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'seq-q',
          response: 'step1,step2,step3' // Invalid: should be array
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'seq-q',
        interactionType: 'sequencing',
        expectedFormat: expect.stringContaining('array of strings in order'),
        message: expect.stringContaining('Expected: array of strings')
      });
    });

    test('sequencing validation error detects non-string array items', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'seq-q', type: 'sequencing' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'seq-q',
          response: ['step1', 2, 'step3'] // Invalid: contains number
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'seq-q',
        interactionType: 'sequencing',
        receivedType: 'array with non-string items',
        message: expect.stringContaining('array containing non-string values')
      });
    });

    test('fill-in accepts string for single-blank', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }])
        .mockResolvedValueOnce({ success: true }); // setResponse

      await scorm_automation_set_response({
        session_id: 'test',
        id: 'fill-q',
        response: 'correct answer'
      });

      // Verify the IIFE pattern was used correctly
      const setResponseCall = RuntimeManager.executeJS.mock.calls[2];
      expect(setResponseCall[2]).toBe('test'); // session_id is third parameter
      expect(setResponseCall[1]).toContain('SCORMAutomation.setResponse("fill-q", responseValue)');
      expect(setResponseCall[1]).toContain('const responseValue = "correct answer"');
    });

    test('fill-in accepts object for multi-blank', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }])
        .mockResolvedValueOnce({ success: true }); // setResponse

      await scorm_automation_set_response({
        session_id: 'test',
        id: 'fill-q',
        response: { blank_0: 'answer1', blank_1: 'answer2' }
      });

      // Verify the IIFE pattern was used correctly
      const setResponseCall = RuntimeManager.executeJS.mock.calls[2];
      expect(setResponseCall[2]).toBe('test'); // session_id is third parameter
      expect(setResponseCall[1]).toContain('SCORMAutomation.setResponse("fill-q", responseValue)');
      expect(setResponseCall[1]).toContain('{"blank_0":"answer1","blank_1":"answer2"}');
    });

    test('fill-in rejects number', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'fill-q',
          response: 42
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'fill-q',
        interactionType: 'fill-in',
        receivedType: 'number'
      });
    });

    test('fill-in rejects array', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'fill-q',
          response: ['answer1', 'answer2']
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'fill-q',
        interactionType: 'fill-in',
        receivedType: 'array'
      });
    });

    test('fill-in rejects object with non-string values', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'fill-q',
          response: { blank_0: 'answer1', blank_1: 123 }
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'fill-q',
        interactionType: 'fill-in',
        receivedType: 'object with non-string values',
        message: expect.stringContaining('All blank answers must be strings')
      });
    });

    test('drag-drop validation error shows object format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'dd-q', type: 'drag-drop' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'dd-q',
          response: ['item1', 'item2'] // Invalid: should be object
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'dd-q',
        interactionType: 'drag-drop',
        expectedFormat: expect.stringContaining('object with {itemId: zoneId}'),
        receivedType: 'array',
        message: expect.stringContaining('Expected: object with {itemId: zoneId}')
      });
    });

    test('drag-drop validation error detects non-string zone IDs', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'dd-q', type: 'drag-drop' }]);

      await expect(
        scorm_automation_set_response({
          session_id: 'test',
          id: 'dd-q',
          response: { item1: 'zone-a', item2: 123 } // Invalid: zone ID must be string
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE_FORMAT',
        interactionId: 'dd-q',
        interactionType: 'drag-drop',
        receivedType: 'object with non-string values',
        message: expect.stringContaining('All zone IDs must be strings')
      });
    });

    test('drag-drop validation accepts valid object format', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'dd-q', type: 'drag-drop' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'dd-q',
        response: { 
          'user-interface': 'presentation',
          'business-logic': 'application',
          'data-access': 'data'
        }
      });

      expect(result.success).toBe(true);
      expect(result.interactionType).toBe('drag-drop');
    });

    test('scorm_automation_set_response parses stringified JSON objects', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'dd-q', type: 'drag-drop' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      // Simulate MCP client sending JSON as string
      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'dd-q',
        response: '{"user-interface": "presentation", "business-logic": "application"}'
      });

      expect(result.success).toBe(true);
      expect(result.interactionType).toBe('drag-drop');
      
      // Verify the expression contains the parsed object, not the string
      const call = RuntimeManager.executeJS.mock.calls[2];
      const expression = call[1];
      expect(expression).toContain('"user-interface"');
      expect(expression).toContain('"presentation"');
    });

    test('scorm_automation_set_response parses stringified JSON arrays', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'mc-q', type: 'choice' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      // Simulate MCP client sending JSON array as string
      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'mc-q',
        response: '["a", "c", "e"]'
      });

      expect(result.success).toBe(true);
      expect(result.interactionType).toBe('choice');
    });

    test('scorm_automation_set_response handles malformed JSON gracefully', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      // Malformed JSON should be treated as a regular string
      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'fill-q',
        response: '{not valid json}'
      });

      expect(result.success).toBe(true);
      expect(result.interactionType).toBe('fill-in');
    });

    test('scorm_automation_set_response preserves string responses that look like JSON', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: 'fill-q', type: 'fill-in' }]) // listInteractions call
        .mockResolvedValueOnce(true); // setResponse call

      // String that happens to look like JSON but is a legitimate answer
      const result = await scorm_automation_set_response({
        session_id: 'test',
        id: 'fill-q',
        response: '{"this is my answer"}'
      });

      expect(result.success).toBe(true);
      // Should remain as string since JSON.parse would fail
    });

    test('validation errors include all diagnostic information', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce([{ id: 'test-q', type: 'true-false' }]);

      try {
        await scorm_automation_set_response({
          session_id: 'test',
          id: 'test-q',
          response: 1
        });
        throw new Error('Expected validation error to be thrown');
      } catch (error) {
        // Verify all diagnostic properties are present
        expect(error).toHaveProperty('code', 'INVALID_RESPONSE_FORMAT');
        expect(error).toHaveProperty('name', 'AutomationAPIError');
        expect(error).toHaveProperty('interactionId', 'test-q');
        expect(error).toHaveProperty('interactionType', 'true-false');
        expect(error).toHaveProperty('expectedFormat');
        expect(error).toHaveProperty('receivedValue', 1);
        expect(error).toHaveProperty('receivedType', 'number');
        
        // Verify error message is comprehensive
        expect(error.message).toContain('test-q');
        expect(error.message).toContain('true-false');
        expect(error.message).toContain('Expected:');
        expect(error.message).toContain('Got:');
      }
    });
  });
});
