/**
 * SCORM Data Model State Management Unit Tests
 *
 * Comprehensive test suite for SCORM 2004 4th Edition Data Model state management
 * covering state persistence, validation, concurrent access, session isolation,
 * and memory management according to SCORM 2004 4th Edition RTE specification.
 *
 * @fileoverview Data Model state management unit tests
 */

const ScormDataModel = require('../../../../src/main/services/scorm/rte/data-model');
const { COMMON_ERRORS } = require('../../../../src/shared/constants/error-codes');

describe('SCORM Data Model State Management Tests', () => {
  let dataModel;
  let mockErrorHandler;
  let mockLogger;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock error handler
    mockErrorHandler = {
      setError: jest.fn(),
      getLastError: jest.fn().mockReturnValue('0'),
      clearError: jest.fn()
    };

    dataModel = new ScormDataModel(mockErrorHandler, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // State Initialization Tests
  // ============================================================================

  describe('State Initialization', () => {
    test('should initialize with all required SCORM 2004 4th Edition elements', () => {
      // Core CMI elements
      expect(dataModel.getValue('cmi.completion_status')).toBe('unknown');
      expect(dataModel.getValue('cmi.success_status')).toBe('unknown');
      expect(dataModel.getValue('cmi.score.scaled')).toBe('');
      expect(dataModel.getValue('cmi.score.raw')).toBe('');
      expect(dataModel.getValue('cmi.score.max')).toBe('');
      expect(dataModel.getValue('cmi.score.min')).toBe('');
      expect(dataModel.getValue('cmi.progress_measure')).toBe('');
      expect(dataModel.getValue('cmi.location')).toBe('');
      expect(dataModel.getValue('cmi.suspend_data')).toBe('');
      expect(dataModel.getValue('cmi.entry')).toBe('ab-initio');

      // cmi.exit is write-only, so getValue returns empty and sets error
      expect(dataModel.getValue('cmi.exit')).toBe('');
      expect(mockErrorHandler.setError).toHaveBeenCalled();
      mockErrorHandler.setError.mockClear();

      // cmi.session_time is write-only, so getValue returns empty and sets error
      expect(dataModel.getValue('cmi.session_time')).toBe('');
      expect(mockErrorHandler.setError).toHaveBeenCalled();
      mockErrorHandler.setError.mockClear();

      // cmi.total_time is read-only, should return default value
      expect(dataModel.getValue('cmi.total_time')).toBe('PT0H0M0S');

      // Collection counts - verify they exist in the data map
      // Note: These are currently being incorrectly treated as collection elements
      // but they should be regular data elements
      expect(dataModel.data.has('cmi.interactions._count')).toBe(true);
      expect(dataModel.data.has('cmi.objectives._count')).toBe(true);
      expect(dataModel.data.has('cmi.comments_from_learner._count')).toBe(true);
      expect(dataModel.data.has('cmi.comments_from_lms._count')).toBe(true);

      // Navigation elements - verify they exist in the data map
      expect(dataModel.data.has('adl.nav.request')).toBe(true);

      // Learner information
      expect(dataModel.getValue('cmi.learner_id')).toBe('');
      expect(dataModel.getValue('cmi.learner_name')).toBe('');
      expect(dataModel.getValue('cmi.credit')).toBe('credit');
      expect(dataModel.getValue('cmi.mode')).toBe('normal');
      expect(dataModel.getValue('cmi.launch_data')).toBe('');
      expect(dataModel.getValue('cmi.scaled_passing_score')).toBe('');
    });

    test('should initialize collections as empty arrays', () => {
      expect(dataModel.interactions).toEqual([]);
      expect(dataModel.objectives).toEqual([]);
      expect(dataModel.commentsFromLearner).toEqual([]);
      expect(dataModel.commentsFromLms).toEqual([]);
    });

    test('should use Map for core data storage', () => {
      expect(dataModel.data).toBeInstanceOf(Map);
      expect(dataModel.data.size).toBeGreaterThan(0);
    });

    test('should log initialization', () => {
      expect(mockLogger.debug).toHaveBeenCalledWith('ScormDataModel initialized');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Data model initialized with all SCORM 2004 4th Edition elements'
      );
    });
  });

  // ============================================================================
  // State Persistence Tests
  // ============================================================================

  describe('State Persistence', () => {
    test('should persist state changes across getValue/setValue operations', () => {
      // Set values
      expect(dataModel.setValue('cmi.completion_status', 'completed')).toBe(true);
      expect(dataModel.setValue('cmi.success_status', 'passed')).toBe(true);
      expect(dataModel.setValue('cmi.score.scaled', '0.85')).toBe(true);
      expect(dataModel.setValue('cmi.location', 'page-5')).toBe(true);

      // Verify persistence
      expect(dataModel.getValue('cmi.completion_status')).toBe('completed');
      expect(dataModel.getValue('cmi.success_status')).toBe('passed');
      expect(dataModel.getValue('cmi.score.scaled')).toBe('0.85');
      expect(dataModel.getValue('cmi.location')).toBe('page-5');
    });

    test('should persist suspend data correctly', () => {
      const suspendData = JSON.stringify({
        currentPage: 5,
        answers: { q1: 'A', q2: 'B' },
        progress: 0.75
      });

      expect(dataModel.setValue('cmi.suspend_data', suspendData)).toBe(true);
      expect(dataModel.getValue('cmi.suspend_data')).toBe(suspendData);

      // Verify data can be parsed back
      const parsed = JSON.parse(dataModel.getValue('cmi.suspend_data'));
      expect(parsed.currentPage).toBe(5);
      expect(parsed.answers.q1).toBe('A');
      expect(parsed.progress).toBe(0.75);
    });

    test('should persist collection data correctly', () => {
      // Add interaction
      expect(dataModel.setValue('cmi.interactions.0.id', 'interaction_1')).toBe(true);
      expect(dataModel.setValue('cmi.interactions.0.type', 'choice')).toBe(true);
      expect(dataModel.setValue('cmi.interactions.0.learner_response', 'A')).toBe(true);

      // Verify persistence
      expect(dataModel.getValue('cmi.interactions.0.id')).toBe('interaction_1');
      expect(dataModel.getValue('cmi.interactions.0.type')).toBe('choice');
      expect(dataModel.getValue('cmi.interactions.0.learner_response')).toBe('A');
      expect(dataModel.getValue('cmi.interactions._count')).toBe('1');
    });

    test('should maintain state consistency during complex operations', () => {
      // Perform multiple operations
      dataModel.setValue('cmi.completion_status', 'incomplete');
      dataModel.setValue('cmi.score.raw', '75');
      dataModel.setValue('cmi.score.max', '100');
      dataModel.setValue('cmi.progress_measure', '0.75');

      // Add objective
      dataModel.setValue('cmi.objectives.0.id', 'obj_1');
      dataModel.setValue('cmi.objectives.0.success_status', 'passed');
      dataModel.setValue('cmi.objectives.0.score.scaled', '0.8');

      // Verify all state is consistent
      expect(dataModel.getValue('cmi.completion_status')).toBe('incomplete');
      expect(dataModel.getValue('cmi.score.raw')).toBe('75');
      expect(dataModel.getValue('cmi.score.max')).toBe('100');
      expect(dataModel.getValue('cmi.progress_measure')).toBe('0.75');
      expect(dataModel.getValue('cmi.objectives.0.id')).toBe('obj_1');
      expect(dataModel.getValue('cmi.objectives.0.success_status')).toBe('passed');
      expect(dataModel.getValue('cmi.objectives.0.score.scaled')).toBe('0.8');
      expect(dataModel.getValue('cmi.objectives._count')).toBe('1');
    });
  });

  // ============================================================================
  // Data Validation Tests
  // ============================================================================

  describe('Data Validation', () => {
    test('should validate completion_status values', () => {
      // Valid values
      expect(dataModel.setValue('cmi.completion_status', 'completed')).toBe(true);
      expect(dataModel.setValue('cmi.completion_status', 'incomplete')).toBe(true);
      expect(dataModel.setValue('cmi.completion_status', 'not attempted')).toBe(true);
      expect(dataModel.setValue('cmi.completion_status', 'unknown')).toBe(true);

      // Invalid values should fail
      expect(dataModel.setValue('cmi.completion_status', 'invalid')).toBe(false);
      expect(dataModel.setValue('cmi.completion_status', '')).toBe(false);
      expect(dataModel.setValue('cmi.completion_status', 'COMPLETED')).toBe(false);
    });

    test('should validate success_status values', () => {
      // Valid values
      expect(dataModel.setValue('cmi.success_status', 'passed')).toBe(true);
      expect(dataModel.setValue('cmi.success_status', 'failed')).toBe(true);
      expect(dataModel.setValue('cmi.success_status', 'unknown')).toBe(true);

      // Invalid values should fail
      expect(dataModel.setValue('cmi.success_status', 'pass')).toBe(false);
      expect(dataModel.setValue('cmi.success_status', 'fail')).toBe(false);
      expect(dataModel.setValue('cmi.success_status', '')).toBe(false);
    });

    test('should validate score.scaled range (-1.0 to 1.0)', () => {
      // Valid values
      expect(dataModel.setValue('cmi.score.scaled', '0.85')).toBe(true);
      expect(dataModel.setValue('cmi.score.scaled', '-0.5')).toBe(true);
      expect(dataModel.setValue('cmi.score.scaled', '1.0')).toBe(true);
      expect(dataModel.setValue('cmi.score.scaled', '-1.0')).toBe(true);
      expect(dataModel.setValue('cmi.score.scaled', '0')).toBe(true);

      // Invalid values should fail
      expect(dataModel.setValue('cmi.score.scaled', '1.1')).toBe(false);
      expect(dataModel.setValue('cmi.score.scaled', '-1.1')).toBe(false);
      expect(dataModel.setValue('cmi.score.scaled', 'abc')).toBe(false);
      expect(dataModel.setValue('cmi.score.scaled', '85%')).toBe(false);
    });

    test('should validate progress_measure range (0.0 to 1.0)', () => {
      // Valid values
      expect(dataModel.setValue('cmi.progress_measure', '0.75')).toBe(true);
      expect(dataModel.setValue('cmi.progress_measure', '0')).toBe(true);
      expect(dataModel.setValue('cmi.progress_measure', '1.0')).toBe(true);

      // Invalid values should fail
      expect(dataModel.setValue('cmi.progress_measure', '1.1')).toBe(false);
      expect(dataModel.setValue('cmi.progress_measure', '-0.1')).toBe(false);
      expect(dataModel.setValue('cmi.progress_measure', 'half')).toBe(false);
    });

    test('should validate location string length (max 1000 characters)', () => {
      // Valid values
      const validLocation = 'page-' + 'x'.repeat(995); // 1000 chars total
      expect(dataModel.setValue('cmi.location', validLocation)).toBe(true);
      expect(dataModel.setValue('cmi.location', 'simple-location')).toBe(true);

      // Invalid values should fail
      const invalidLocation = 'page-' + 'x'.repeat(996); // 1001 chars total
      expect(dataModel.setValue('cmi.location', invalidLocation)).toBe(false);
    });

    test('should validate suspend_data string length (max 64000 characters)', () => {
      // Valid values
      const validSuspendData = 'x'.repeat(64000);
      expect(dataModel.setValue('cmi.suspend_data', validSuspendData)).toBe(true);

      // Invalid values should fail
      const invalidSuspendData = 'x'.repeat(64001);
      expect(dataModel.setValue('cmi.suspend_data', invalidSuspendData)).toBe(false);
    });

    test('should validate session_time format (ISO 8601 duration)', () => {
      // Valid values
      expect(dataModel.setValue('cmi.session_time', 'PT1H30M45S')).toBe(true);
      expect(dataModel.setValue('cmi.session_time', 'PT0H0M0S')).toBe(true);
      expect(dataModel.setValue('cmi.session_time', 'PT2H15M')).toBe(true);
      expect(dataModel.setValue('cmi.session_time', 'PT45S')).toBe(true);

      // Invalid values should fail
      expect(dataModel.setValue('cmi.session_time', '1:30:45')).toBe(false);
      expect(dataModel.setValue('cmi.session_time', '90 minutes')).toBe(false);
      expect(dataModel.setValue('cmi.session_time', 'PT-1H')).toBe(false);
    });

    test('should handle validation errors correctly', () => {
      // Attempt invalid value
      const result = dataModel.setValue('cmi.completion_status', 'invalid_status');

      expect(result).toBe(false);
      expect(mockErrorHandler.setError).toHaveBeenCalled();

      // Verify original value is unchanged
      expect(dataModel.getValue('cmi.completion_status')).toBe('unknown');
    });
  });

  // ============================================================================
  // Access Control Tests
  // ============================================================================

  describe('Access Control', () => {
    test('should prevent reading write-only elements', () => {
      // exit is write-only
      const result = dataModel.getValue('cmi.exit');

      expect(result).toBe('');
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        COMMON_ERRORS.WRITE_ONLY_ELEMENT,
        expect.stringContaining('Element is write-only: cmi.exit'),
        'getValue'
      );
    });

    test('should prevent writing to read-only elements', () => {
      // learner_id is read-only after initialization
      const result = dataModel.setValue('cmi.learner_id', 'new_learner');

      expect(result).toBe(false);
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        COMMON_ERRORS.READ_ONLY_ELEMENT,
        expect.stringContaining('Element is read-only: cmi.learner_id'),
        'setValue'
      );
    });

    test('should allow internal access to read-only elements', () => {
      // Internal method should bypass read-only check
      const result = dataModel._setInternalValue('cmi.learner_id', 'internal_learner');

      expect(result).toBe(true);
      expect(dataModel._getInternalValue('cmi.learner_id')).toBe('internal_learner');
    });

    test('should allow internal access to write-only elements', () => {
      // Internal method should bypass write-only check
      dataModel._setInternalValue('cmi.exit', 'suspend');
      const result = dataModel._getInternalValue('cmi.exit');

      expect(result).toBe('suspend');
    });

    test('should handle undefined elements', () => {
      const getValue = dataModel.getValue('cmi.nonexistent');
      const setValue = dataModel.setValue('cmi.nonexistent', 'value');

      expect(getValue).toBe('');
      expect(setValue).toBe(false);
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        COMMON_ERRORS.UNDEFINED_ELEMENT,
        expect.stringContaining('Invalid data model element'),
        expect.any(String)
      );
    });
  });

  // ============================================================================
  // Session Isolation Tests
  // ============================================================================

  describe('Session Isolation', () => {
    test('should create independent data model instances', () => {
      const dataModel2 = new ScormDataModel(mockErrorHandler, mockLogger);

      // Modify first instance
      dataModel.setValue('cmi.completion_status', 'completed');
      dataModel.setValue('cmi.location', 'page-10');

      // Modify second instance
      dataModel2.setValue('cmi.completion_status', 'incomplete');
      dataModel2.setValue('cmi.location', 'page-5');

      // Verify isolation
      expect(dataModel.getValue('cmi.completion_status')).toBe('completed');
      expect(dataModel.getValue('cmi.location')).toBe('page-10');
      expect(dataModel2.getValue('cmi.completion_status')).toBe('incomplete');
      expect(dataModel2.getValue('cmi.location')).toBe('page-5');
    });

    test('should isolate collection data between instances', () => {
      const dataModel2 = new ScormDataModel(mockErrorHandler, mockLogger);

      // Add interaction to first instance
      dataModel.setValue('cmi.interactions.0.id', 'interaction_1');
      dataModel.setValue('cmi.interactions.0.type', 'choice');

      // Add different interaction to second instance
      dataModel2.setValue('cmi.interactions.0.id', 'interaction_2');
      dataModel2.setValue('cmi.interactions.0.type', 'fill-in');

      // Verify isolation
      expect(dataModel.getValue('cmi.interactions.0.id')).toBe('interaction_1');
      expect(dataModel.getValue('cmi.interactions.0.type')).toBe('choice');
      expect(dataModel2.getValue('cmi.interactions.0.id')).toBe('interaction_2');
      expect(dataModel2.getValue('cmi.interactions.0.type')).toBe('fill-in');

      // Verify counts are independent
      expect(dataModel.getValue('cmi.interactions._count')).toBe('1');
      expect(dataModel2.getValue('cmi.interactions._count')).toBe('1');
    });

    test('should reset instance without affecting others', () => {
      const dataModel2 = new ScormDataModel(mockErrorHandler, mockLogger);

      // Set data in both instances
      dataModel.setValue('cmi.completion_status', 'completed');
      dataModel2.setValue('cmi.completion_status', 'incomplete');

      // Reset first instance
      dataModel.reset();

      // Verify first instance is reset
      expect(dataModel.getValue('cmi.completion_status')).toBe('unknown');

      // Verify second instance is unaffected
      expect(dataModel2.getValue('cmi.completion_status')).toBe('incomplete');
    });

    test('should handle concurrent access to different instances', () => {
      const dataModel2 = new ScormDataModel(mockErrorHandler, mockLogger);
      const dataModel3 = new ScormDataModel(mockErrorHandler, mockLogger);

      // Simulate concurrent operations
      const operations = [
        () => dataModel.setValue('cmi.score.raw', '85'),
        () => dataModel2.setValue('cmi.score.raw', '92'),
        () => dataModel3.setValue('cmi.score.raw', '78'),
        () => dataModel.setValue('cmi.completion_status', 'completed'),
        () => dataModel2.setValue('cmi.completion_status', 'incomplete'),
        () => dataModel3.setValue('cmi.completion_status', 'not attempted')
      ];

      // Execute operations
      operations.forEach(op => op());

      // Verify each instance maintains its own state
      expect(dataModel.getValue('cmi.score.raw')).toBe('85');
      expect(dataModel.getValue('cmi.completion_status')).toBe('completed');
      expect(dataModel2.getValue('cmi.score.raw')).toBe('92');
      expect(dataModel2.getValue('cmi.completion_status')).toBe('incomplete');
      expect(dataModel3.getValue('cmi.score.raw')).toBe('78');
      expect(dataModel3.getValue('cmi.completion_status')).toBe('not attempted');
    });
  });

  // ============================================================================
  // Memory Management Tests
  // ============================================================================

  describe('Memory Management', () => {
    test('should properly clean up data on reset', () => {
      // Add substantial data
      dataModel.setValue('cmi.suspend_data', 'x'.repeat(1000)); // Use smaller data
      dataModel.setValue('cmi.interactions.0.id', 'interaction_1');
      dataModel.setValue('cmi.interactions.1.id', 'interaction_2');
      dataModel.setValue('cmi.objectives.0.id', 'objective_1');

      // Verify data exists
      expect(dataModel.getValue('cmi.suspend_data')).toHaveLength(1000);
      expect(dataModel.getValue('cmi.interactions.0.id')).toBe('interaction_1');
      expect(dataModel.getValue('cmi.interactions.1.id')).toBe('interaction_2');
      expect(dataModel.getValue('cmi.objectives.0.id')).toBe('objective_1');

      // Reset and verify cleanup
      dataModel.reset();

      expect(dataModel.getValue('cmi.suspend_data')).toBe('');
      expect(dataModel.interactions).toEqual([]);
      expect(dataModel.objectives).toEqual([]);
      expect(dataModel.commentsFromLearner).toEqual([]);
      expect(dataModel.commentsFromLms).toEqual([]);
    });

    test('should handle large suspend data efficiently', () => {
      // Use smaller data that fits within SCORM limits
      const largeData = JSON.stringify({
        pages: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          visited: true,
          answers: Array.from({ length: 5 }, (_, j) => `answer_${j}`)
        }))
      });

      // Should handle reasonably large data without errors
      expect(dataModel.setValue('cmi.suspend_data', largeData)).toBe(true);
      expect(dataModel.getValue('cmi.suspend_data')).toBe(largeData);

      // Should be able to parse back
      const parsed = JSON.parse(dataModel.getValue('cmi.suspend_data'));
      expect(parsed.pages).toHaveLength(100);
      expect(parsed.pages[0].answers).toHaveLength(5);
    });

    test('should handle many collection items efficiently', () => {
      // Add many interactions
      for (let i = 0; i < 100; i++) {
        expect(dataModel.setValue(`cmi.interactions.${i}.id`, `interaction_${i}`)).toBe(true);
        expect(dataModel.setValue(`cmi.interactions.${i}.type`, 'choice')).toBe(true);
      }

      // Verify all interactions are stored
      expect(dataModel.getValue('cmi.interactions._count')).toBe('100');
      expect(dataModel.getValue('cmi.interactions.0.id')).toBe('interaction_0');
      expect(dataModel.getValue('cmi.interactions.99.id')).toBe('interaction_99');

      // Verify performance doesn't degrade significantly
      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        dataModel.getValue(`cmi.interactions.${i}.id`);
      }
      const endTime = Date.now();

      // Should complete within reasonable time (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  // ============================================================================
  // Utility and Export Tests
  // ============================================================================

  describe('Utility and Export Functions', () => {
    test('should export all data correctly', () => {
      // Set up test data
      dataModel.setValue('cmi.completion_status', 'completed');
      dataModel.setValue('cmi.score.scaled', '0.85');
      dataModel.setValue('cmi.interactions.0.id', 'interaction_1');
      dataModel.setValue('cmi.objectives.0.id', 'objective_1');
      dataModel.setValue('cmi.comments_from_learner.0.comment', 'test comment');

      const allData = dataModel.getAllData();

      // Verify structure
      expect(allData).toHaveProperty('coreData');
      expect(allData).toHaveProperty('interactions');
      expect(allData).toHaveProperty('objectives');
      expect(allData).toHaveProperty('commentsFromLearner');
      expect(allData).toHaveProperty('commentsFromLms');

      // Verify data content
      expect(allData.coreData['cmi.completion_status']).toBe('completed');
      expect(allData.coreData['cmi.score.scaled']).toBe('0.85');
      expect(allData.interactions).toHaveLength(1);
      expect(allData.objectives).toHaveLength(1);
      expect(allData.commentsFromLearner).toHaveLength(1);
    });

    test('should set learner information correctly', () => {
      const learnerInfo = {
        id: 'learner_123',
        name: 'John Doe'
      };

      dataModel.setLearnerInfo(learnerInfo);

      expect(dataModel.getValue('cmi.learner_id')).toBe('learner_123');
      expect(dataModel.getValue('cmi.learner_name')).toBe('John Doe');
      expect(mockLogger.debug).toHaveBeenCalledWith('Learner information set', learnerInfo);
    });

    test('should handle partial learner information', () => {
      // Only ID provided
      dataModel.setLearnerInfo({ id: 'learner_456' });
      expect(dataModel.getValue('cmi.learner_id')).toBe('learner_456');
      expect(dataModel.getValue('cmi.learner_name')).toBe(''); // Should remain empty

      // Only name provided
      dataModel.setLearnerInfo({ name: 'Jane Smith' });
      expect(dataModel.getValue('cmi.learner_name')).toBe('Jane Smith');
      expect(dataModel.getValue('cmi.learner_id')).toBe('learner_456'); // Should remain unchanged
    });
  });
});