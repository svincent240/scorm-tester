/**
 * SCORM API Handler Unit Tests
 * 
 * Comprehensive test suite for SCORM 2004 4th Edition API Handler
 * covering all 8 required SCORM functions and compliance validation.
 * 
 * Tests based on SCORM 2004 4th Edition RTE specification requirements.
 * 
 * @fileoverview SCORM API Handler unit tests
 */

const ScormApiHandler = require('../../../src/main/services/scorm/rte/api-handler');
const { COMMON_ERRORS } = require('../../../src/shared/constants/error-codes');
const SCORM_CONSTANTS = require('../../../src/shared/constants/scorm-constants');

describe('ScormApiHandler', () => {
  let apiHandler;
  let mockSessionManager;
  let mockLogger;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock session manager
    mockSessionManager = {
      registerSession: jest.fn(),
      unregisterSession: jest.fn(),
      persistSessionData: jest.fn().mockResolvedValue(true),
      getLearnerInfo: jest.fn().mockReturnValue({
        id: 'learner123',
        name: 'Test Learner'
      })
    };

    // Create API handler instance
    apiHandler = new ScormApiHandler(mockSessionManager, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Initialize Function Tests (SCORM API Function 1)
  // ============================================================================

  describe('Initialize', () => {
    test('should initialize successfully with empty string parameter', () => {
      const result = apiHandler.Initialize('');
      
      expect(result).toBe('true');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
      expect(apiHandler.isInitialized).toBe(true);
      expect(mockSessionManager.registerSession).toHaveBeenCalled();
    });

    test('should fail with non-empty parameter', () => {
      const result = apiHandler.Initialize('invalid');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
      expect(apiHandler.isInitialized).toBe(false);
    });

    test('should fail if already initialized', () => {
      apiHandler.Initialize('');
      const result = apiHandler.Initialize('');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.ALREADY_INITIALIZED);
    });

    test('should fail if session is terminated', () => {
      apiHandler.Initialize('');
      apiHandler.Terminate('');
      const result = apiHandler.Initialize('');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.CONTENT_TERMINATED);
    });

    test('should set correct initial data model values', () => {
      apiHandler.Initialize('');
      
      expect(apiHandler.GetValue('cmi.completion_status')).toBe('unknown');
      expect(apiHandler.GetValue('cmi.success_status')).toBe('unknown');
      expect(apiHandler.GetValue('cmi.entry')).toBe('ab-initio');
      expect(apiHandler.GetValue('cmi.mode')).toBe('normal');
      expect(apiHandler.GetValue('cmi.credit')).toBe('credit');
    });
  });

  // ============================================================================
  // Terminate Function Tests (SCORM API Function 2)
  // ============================================================================

  describe('Terminate', () => {
    beforeEach(() => {
      apiHandler.Initialize('');
    });

    test('should terminate successfully with empty string parameter', () => {
      const result = apiHandler.Terminate('');
      
      expect(result).toBe('true');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
      expect(apiHandler.isTerminated).toBe(true);
      expect(mockSessionManager.unregisterSession).toHaveBeenCalled();
    });

    test('should fail with non-empty parameter', () => {
      const result = apiHandler.Terminate('invalid');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
      expect(apiHandler.isTerminated).toBe(false);
    });

    test('should fail if not initialized', () => {
      apiHandler.reset();
      const result = apiHandler.Terminate('');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.TERMINATION_BEFORE_INIT);
    });

    test('should fail if already terminated', () => {
      apiHandler.Terminate('');
      const result = apiHandler.Terminate('');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.TERMINATION_AFTER_TERMINATION);
    });

    test('should calculate and set session time', () => {
      // Mock start time to ensure predictable session time
      apiHandler.startTime = new Date(Date.now() - 5000); // 5 seconds ago
      
      // Test write-only behavior before termination
      const sessionTimeBeforeTerminate = apiHandler.GetValue('cmi.session_time');
      expect(sessionTimeBeforeTerminate).toBe('');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.WRITE_ONLY_ELEMENT);
      
      // Clear error and terminate
      apiHandler.errorHandler.clearError();
      apiHandler.Terminate('');
      
      // Verify that session time was calculated and stored internally
      // (we can check this through the data model's internal state)
      const allData = apiHandler.dataModel.getAllData();
      expect(allData.coreData['cmi.session_time']).toMatch(/^PT\d+H\d+M\d+S$/);
    });
  });

  // ============================================================================
  // GetValue Function Tests (SCORM API Function 3)
  // ============================================================================

  describe('GetValue', () => {
    beforeEach(() => {
      apiHandler.Initialize('');
    });

    test('should get valid data model element values', () => {
      const completionStatus = apiHandler.GetValue('cmi.completion_status');
      expect(completionStatus).toBe('unknown');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
    });

    test('should return empty string for undefined elements', () => {
      const result = apiHandler.GetValue('cmi.invalid_element');
      expect(result).toBe('');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.UNDEFINED_ELEMENT);
    });

    test('should return empty string for write-only elements', () => {
      const result = apiHandler.GetValue('cmi.exit');
      expect(result).toBe('');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.WRITE_ONLY_ELEMENT);
    });

    test('should fail if session not initialized', () => {
      apiHandler.reset();
      const result = apiHandler.GetValue('cmi.completion_status');
      
      expect(result).toBe('');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
    });

    test('should handle collection elements', () => {
      apiHandler.SetValue('cmi.interactions.0.id', 'interaction1');
      const result = apiHandler.GetValue('cmi.interactions.0.id');
      
      expect(result).toBe('interaction1');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
    });

    test('should return children and count for collections', () => {
      const interactionsChildren = apiHandler.GetValue('cmi.interactions._children');
      const interactionsCount = apiHandler.GetValue('cmi.interactions._count');
      
      expect(interactionsChildren).toBe('id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description');
      expect(interactionsCount).toBe('0');
    });
  });

  // ============================================================================
  // SetValue Function Tests (SCORM API Function 4)
  // ============================================================================

  describe('SetValue', () => {
    beforeEach(() => {
      apiHandler.Initialize('');
    });

    test('should set valid data model element values', () => {
      const result = apiHandler.SetValue('cmi.completion_status', 'completed');
      
      expect(result).toBe('true');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
      expect(apiHandler.GetValue('cmi.completion_status')).toBe('completed');
    });

    test('should fail for undefined elements', () => {
      const result = apiHandler.SetValue('cmi.invalid_element', 'value');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.UNDEFINED_ELEMENT);
    });

    test('should fail for read-only elements', () => {
      const result = apiHandler.SetValue('cmi.learner_id', 'newid');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.READ_ONLY_ELEMENT);
    });

    test('should validate vocabulary values', () => {
      const result = apiHandler.SetValue('cmi.completion_status', 'invalid_status');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.TYPE_MISMATCH);
    });

    test('should validate numeric ranges', () => {
      const result = apiHandler.SetValue('cmi.score.scaled', '2.0'); // Out of range (-1 to 1)
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.VALUE_OUT_OF_RANGE);
    });

    test('should handle collection elements', () => {
      const result = apiHandler.SetValue('cmi.interactions.0.id', 'interaction1');
      
      expect(result).toBe('true');
      expect(apiHandler.GetValue('cmi.interactions._count')).toBe('1');
    });

    test('should fail if session not initialized', () => {
      apiHandler.reset();
      const result = apiHandler.SetValue('cmi.completion_status', 'completed');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
    });
  });

  // ============================================================================
  // Commit Function Tests (SCORM API Function 5)
  // ============================================================================

  describe('Commit', () => {
    beforeEach(() => {
      apiHandler.Initialize('');
    });

    test('should commit successfully with empty string parameter', () => {
      const result = apiHandler.Commit('');
      
      expect(result).toBe('true');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
      expect(mockSessionManager.persistSessionData).toHaveBeenCalled();
    });

    test('should fail with non-empty parameter', () => {
      const result = apiHandler.Commit('invalid');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
    });

    test('should fail if session not initialized', () => {
      apiHandler.reset();
      const result = apiHandler.Commit('');
      
      expect(result).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
    });

    test('should handle commit frequency limits in strict mode', () => {
      apiHandler.options.strictMode = true;
      apiHandler.options.maxCommitFrequency = 1;
      
      // First commit should succeed
      expect(apiHandler.Commit('')).toBe('true');
      
      // Second immediate commit should fail
      expect(apiHandler.Commit('')).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
    });
  });

  // ============================================================================
  // Error Function Tests (SCORM API Functions 6, 7, 8)
  // ============================================================================

  describe('Error Functions', () => {
    test('GetLastError should return current error code', () => {
      apiHandler.Initialize('invalid'); // Cause an error
      
      const errorCode = apiHandler.GetLastError();
      expect(errorCode).toBe(COMMON_ERRORS.GENERAL_EXCEPTION);
    });

    test('GetErrorString should return error description', () => {
      const errorString = apiHandler.GetErrorString(COMMON_ERRORS.GENERAL_EXCEPTION);
      expect(errorString).toBe('General Exception');
    });

    test('GetErrorString should return empty string for invalid codes', () => {
      const errorString = apiHandler.GetErrorString('999999');
      expect(errorString).toBe('');
    });

    test('GetDiagnostic should return diagnostic information', () => {
      apiHandler.Initialize('invalid'); // Cause an error with diagnostic
      
      const diagnostic = apiHandler.GetDiagnostic(COMMON_ERRORS.GENERAL_EXCEPTION);
      expect(diagnostic).toContain('Initialize parameter must be empty string');
    });

    test('GetDiagnostic should return empty string for invalid codes', () => {
      const diagnostic = apiHandler.GetDiagnostic('999999');
      expect(diagnostic).toBe('');
    });
  });

  // ============================================================================
  // SCORM Compliance Tests
  // ============================================================================

  describe('SCORM Compliance', () => {
    test('should follow proper API call sequence', () => {
      // 1. Initialize
      expect(apiHandler.Initialize('')).toBe('true');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
      
      // 2. Set some data
      expect(apiHandler.SetValue('cmi.completion_status', 'completed')).toBe('true');
      expect(apiHandler.SetValue('cmi.success_status', 'passed')).toBe('true');
      expect(apiHandler.SetValue('cmi.score.scaled', '0.85')).toBe('true');
      
      // 3. Commit data
      expect(apiHandler.Commit('')).toBe('true');
      
      // 4. Terminate
      expect(apiHandler.Terminate('')).toBe('true');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
    });

    test('should maintain data integrity throughout session', () => {
      apiHandler.Initialize('');
      
      // Set various data types
      apiHandler.SetValue('cmi.completion_status', 'completed');
      apiHandler.SetValue('cmi.success_status', 'passed');
      apiHandler.SetValue('cmi.score.raw', '85');
      apiHandler.SetValue('cmi.score.max', '100');
      apiHandler.SetValue('cmi.score.scaled', '0.85');
      apiHandler.SetValue('cmi.location', 'page5');
      apiHandler.SetValue('cmi.suspend_data', 'test suspend data');
      
      // Verify all values are maintained
      expect(apiHandler.GetValue('cmi.completion_status')).toBe('completed');
      expect(apiHandler.GetValue('cmi.success_status')).toBe('passed');
      expect(apiHandler.GetValue('cmi.score.raw')).toBe('85');
      expect(apiHandler.GetValue('cmi.score.max')).toBe('100');
      expect(apiHandler.GetValue('cmi.score.scaled')).toBe('0.85');
      expect(apiHandler.GetValue('cmi.location')).toBe('page5');
      expect(apiHandler.GetValue('cmi.suspend_data')).toBe('test suspend data');
    });

    test('should handle interaction data correctly', () => {
      apiHandler.Initialize('');
      
      // Set interaction data
      apiHandler.SetValue('cmi.interactions.0.id', 'question1');
      apiHandler.SetValue('cmi.interactions.0.type', 'choice');
      apiHandler.SetValue('cmi.interactions.0.learner_response', 'a');
      apiHandler.SetValue('cmi.interactions.0.result', 'correct');
      
      // Verify interaction data
      expect(apiHandler.GetValue('cmi.interactions.0.id')).toBe('question1');
      expect(apiHandler.GetValue('cmi.interactions.0.type')).toBe('choice');
      expect(apiHandler.GetValue('cmi.interactions.0.learner_response')).toBe('a');
      expect(apiHandler.GetValue('cmi.interactions.0.result')).toBe('correct');
      expect(apiHandler.GetValue('cmi.interactions._count')).toBe('1');
    });

    test('should handle navigation requests', () => {
      apiHandler.Initialize('');
      
      // Set navigation request
      expect(apiHandler.SetValue('adl.nav.request', 'continue')).toBe('true');
      
      // Navigation requests are write-only
      expect(apiHandler.GetValue('adl.nav.request')).toBe('');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.WRITE_ONLY_ELEMENT);
    });

    test('should validate all required SCORM functions exist', () => {
      const requiredFunctions = [
        'Initialize', 'Terminate', 'GetValue', 'SetValue',
        'Commit', 'GetLastError', 'GetErrorString', 'GetDiagnostic'
      ];
      
      requiredFunctions.forEach(funcName => {
        expect(typeof apiHandler[funcName]).toBe('function');
      });
    });
  });

  // ============================================================================
  // Edge Cases and Error Conditions
  // ============================================================================

  describe('Edge Cases', () => {
    test('should handle null and undefined parameters gracefully', () => {
      apiHandler.Initialize('');
      
      expect(apiHandler.GetValue(null)).toBe('');
      expect(apiHandler.GetValue(undefined)).toBe('');
      expect(apiHandler.SetValue(null, 'value')).toBe('false');
      expect(apiHandler.SetValue('element', null)).toBe('false');
    });

    test('should handle very long strings within limits', () => {
      apiHandler.Initialize('');
      
      const longString = 'a'.repeat(1000); // Within suspend_data limit
      expect(apiHandler.SetValue('cmi.suspend_data', longString)).toBe('true');
      expect(apiHandler.GetValue('cmi.suspend_data')).toBe(longString);
    });

    test('should reject strings exceeding limits', () => {
      apiHandler.Initialize('');
      
      const tooLongString = 'a'.repeat(65000); // Exceeds suspend_data limit
      expect(apiHandler.SetValue('cmi.suspend_data', tooLongString)).toBe('false');
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.VALUE_OUT_OF_RANGE);
    });

    test('should handle concurrent access gracefully', async () => {
      apiHandler.Initialize('');
      
      // Simulate concurrent SetValue calls
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              const result = apiHandler.SetValue(`cmi.interactions.${i}.id`, `interaction${i}`);
              resolve(result);
            }, Math.random() * 10);
          })
        );
      }
      
      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(result => {
        expect(result).toBe('true');
      });
      
      // Count should be correct
      expect(apiHandler.GetValue('cmi.interactions._count')).toBe('10');
    });
  });

  // ============================================================================
  // State Management Tests
  // ============================================================================

  describe('State Management', () => {
    test('should maintain correct session state throughout lifecycle', () => {
      // Initial state
      expect(apiHandler.errorHandler.getSessionState()).toBe(SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED);
      
      // After initialize
      apiHandler.Initialize('');
      expect(apiHandler.errorHandler.getSessionState()).toBe(SCORM_CONSTANTS.SESSION_STATES.RUNNING);
      
      // After terminate
      apiHandler.Terminate('');
      expect(apiHandler.errorHandler.getSessionState()).toBe(SCORM_CONSTANTS.SESSION_STATES.TERMINATED);
    });

    test('should reset to initial state correctly', () => {
      apiHandler.Initialize('');
      apiHandler.SetValue('cmi.completion_status', 'completed');
      apiHandler.Terminate('');
      
      apiHandler.reset();
      
      expect(apiHandler.isInitialized).toBe(false);
      expect(apiHandler.isTerminated).toBe(false);
      expect(apiHandler.sessionId).toBe(null);
      expect(apiHandler.GetLastError()).toBe(COMMON_ERRORS.NO_ERROR);
      expect(apiHandler.errorHandler.getSessionState()).toBe(SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED);
    });
  });
});