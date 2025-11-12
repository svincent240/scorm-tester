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

      // Verify the JavaScript expression was properly constructed and escaped
      const call = RuntimeManager.executeJS.mock.calls[2]; // Now third call (0: API check, 1: listInteractions, 2: setResponse)
      expect(call[1]).toContain("window.SCORMAutomation.setResponse('q1'");
      expect(call[1]).toContain('"answer-a"');
    });

    test('scorm_automation_set_response escapes single quotes in id', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce([{ id: "q'1", type: 'fill-in' }]) // listInteractions call for validation
        .mockResolvedValueOnce(true); // setResponse call

      await scorm_automation_set_response({
        session_id: 'test',
        id: "q'1",
        response: 'answer'
      });

      const call = RuntimeManager.executeJS.mock.calls[2]; // Now third call
      expect(call[1]).toContain("q\\'1");
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
});
