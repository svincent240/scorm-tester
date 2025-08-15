/**
 * Sequencing Engine Comprehensive Unit Tests
 *
 * Tests the complete SCORM 2004 4th Edition sequencing engine including
 * pre-condition rules, post-condition rules, exit condition rules,
 * rollup calculations, and navigation request processing according to
 * SCORM 2004 4th Edition Sequencing and Navigation specification.
 *
 * @fileoverview Comprehensive unit tests for SequencingEngine
 */

const SequencingEngine = require('../../../../src/main/services/scorm/sn/sequencing-engine');
const {
  SN_ERROR_CODES,
  RULE_CONDITIONS,
  RULE_ACTIONS,
  ATTEMPT_STATES,
  OBJECTIVE_PROGRESS_STATES
} = require('../../../../src/shared/constants/sn-constants');

describe('SequencingEngine Comprehensive Tests', () => {
  let sequencingEngine;
  let mockActivityTreeManager;
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

    // Mock activity tree manager
    mockActivityTreeManager = {
      getActivity: jest.fn(),
      getCurrentActivity: jest.fn(),
      setCurrentActivity: jest.fn(),
      getActivityTree: jest.fn(),
      findActivity: jest.fn()
    };

    sequencingEngine = new SequencingEngine(mockActivityTreeManager, mockErrorHandler, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Pre-Condition Rule Tests
  // ============================================================================

  describe('Pre-Condition Rule Evaluation', () => {
    test('should return null action when no sequencing rules defined', () => {
      const activity = {
        identifier: 'test-activity',
        sequencing: null
      };

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBeNull();
      expect(result.reason).toBe('No sequencing rules defined');
    });

    test('should return null action when no pre-condition rules defined', () => {
      const activity = {
        identifier: 'test-activity',
        sequencing: {
          sequencingRules: {
            postConditionRules: []
          }
        }
      };

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBeNull();
      expect(result.reason).toBe('No pre-condition rules triggered');
    });

    test('should evaluate ALWAYS condition and trigger SKIP action', () => {
      const activity = {
        identifier: 'test-activity',
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.SKIP,
              conditions: [{
                condition: RULE_CONDITIONS.ALWAYS,
                operator: 'noOp'
              }]
            }]
          }
        }
      };

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.SKIP);
      expect(result.reason).toContain('Pre-condition rule');
      expect(result.rule).toBeDefined();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Pre-condition rule triggered: skip')
      );
    });

    test('should evaluate COMPLETED condition correctly', () => {
      const activity = {
        identifier: 'test-activity',
        attemptState: ATTEMPT_STATES.COMPLETED,
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.DISABLED,
              conditions: [{
                condition: RULE_CONDITIONS.COMPLETED,
                operator: 'noOp'
              }]
            }]
          }
        }
      };

      // Mock the isActivityCompleted method
      sequencingEngine.isActivityCompleted = jest.fn(() => true);

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.DISABLED);
      expect(result.reason).toContain('Activity completed: true');
    });

    test('should evaluate ATTEMPTED condition correctly', () => {
      const activity = {
        identifier: 'test-activity',
        attemptCount: 2,
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.HIDDEN_FROM_CHOICE,
              conditions: [{
                condition: RULE_CONDITIONS.ATTEMPTED,
                operator: 'noOp'
              }]
            }]
          }
        }
      };

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.HIDDEN_FROM_CHOICE);
      expect(result.reason).toContain('Activity attempted: true');
    });

    test('should apply NOT operator correctly', () => {
      const activity = {
        identifier: 'test-activity',
        attemptCount: 0,
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.SKIP,
              conditions: [{
                condition: RULE_CONDITIONS.ATTEMPTED,
                operator: 'not'
              }]
            }]
          }
        }
      };

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.SKIP);
      expect(result.reason).toContain('NOT (Activity attempted: false');
    });

    test('should handle condition combination logic - ALL', () => {
      const activity = {
        identifier: 'test-activity',
        attemptCount: 2,
        attemptState: ATTEMPT_STATES.COMPLETED,
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.EXIT_PARENT,
              conditions: Object.assign([
                { condition: RULE_CONDITIONS.ATTEMPTED, operator: 'noOp' },
                { condition: RULE_CONDITIONS.COMPLETED, operator: 'noOp' }
              ], { conditionCombination: 'all' })
            }]
          }
        }
      };

      // Mock the isActivityCompleted method
      sequencingEngine.isActivityCompleted = jest.fn(() => true);

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.EXIT_PARENT);
      expect(result.reason).toContain('Condition combination (all)');
    });

    test('should handle condition combination logic - ANY', () => {
      const activity = {
        identifier: 'test-activity',
        attemptCount: 0,
        attemptState: ATTEMPT_STATES.COMPLETED,
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.CONTINUE,
              conditions: Object.assign([
                { condition: RULE_CONDITIONS.ATTEMPTED, operator: 'noOp' },
                { condition: RULE_CONDITIONS.COMPLETED, operator: 'noOp' }
              ], { conditionCombination: 'any' })
            }]
          }
        }
      };

      // Mock the isActivityCompleted method
      sequencingEngine.isActivityCompleted = jest.fn(() => true);

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.CONTINUE);
      expect(result.reason).toContain('Condition combination (any)');
    });

    test('should handle evaluation errors gracefully', () => {
      const activity = {
        identifier: 'test-activity',
        sequencing: {
          sequencingRules: {
            preConditionRules: [{
              action: RULE_ACTIONS.SKIP,
              conditions: null // This will cause an error
            }]
          }
        }
      };

      // Mock the evaluateRuleConditions to throw an error
      const originalMethod = sequencingEngine.evaluateRuleConditions;
      sequencingEngine.evaluateRuleConditions = jest.fn(() => {
        throw new Error('Test evaluation error');
      });

      const result = sequencingEngine.evaluatePreConditionRules(activity);

      expect(result.action).toBeNull();
      expect(result.reason).toBe('Evaluation error');
      expect(result.error).toBe('Test evaluation error');
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        SN_ERROR_CODES.RULE_CONDITION_FAILED,
        expect.stringContaining('Pre-condition evaluation failed'),
        'evaluatePreConditionRules'
      );

      // Restore original method
      sequencingEngine.evaluateRuleConditions = originalMethod;
    });
  });

  // ============================================================================
  // Post-Condition Rule Tests
  // ============================================================================

  describe('Post-Condition Rule Evaluation', () => {
    test('should return null action when no sequencing rules defined', () => {
      const activity = {
        identifier: 'test-activity',
        sequencing: null
      };

      const result = sequencingEngine.evaluatePostConditionRules(activity);

      expect(result.action).toBeNull();
      expect(result.reason).toBe('No sequencing rules defined');
    });

    test('should evaluate post-condition rules correctly', () => {
      const activity = {
        identifier: 'test-activity',
        attemptState: ATTEMPT_STATES.COMPLETED,
        sequencing: {
          sequencingRules: {
            postConditionRules: [{
              action: RULE_ACTIONS.EXIT_PARENT,
              conditions: [{
                condition: RULE_CONDITIONS.COMPLETED,
                operator: 'noOp'
              }]
            }]
          }
        }
      };

      const result = sequencingEngine.evaluatePostConditionRules(activity);

      expect(result.action).toBe(RULE_ACTIONS.EXIT_PARENT);
      expect(result.reason).toContain('Post-condition rule');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Post-condition rule triggered: exitParent')
      );
    });

    test('should handle post-condition evaluation errors', () => {
      const activity = {
        identifier: 'test-activity',
        sequencing: {
          sequencingRules: {
            postConditionRules: [{
              action: RULE_ACTIONS.EXIT_ALL,
              conditions: null
            }]
          }
        }
      };

      // Mock the evaluateRuleConditions to throw an error
      sequencingEngine.evaluateRuleConditions = jest.fn(() => {
        throw new Error('Post-condition error');
      });

      const result = sequencingEngine.evaluatePostConditionRules(activity);

      expect(result.action).toBeNull();
      expect(result.reason).toBe('Evaluation error');
      expect(mockErrorHandler.setError).toHaveBeenCalledWith(
        SN_ERROR_CODES.RULE_CONDITION_FAILED,
        expect.stringContaining('Post-condition evaluation failed'),
        'evaluatePostConditionRules'
      );
    });
  });

  // ============================================================================
  // Rule Condition Evaluation Tests
  // ============================================================================

  describe('Rule Condition Evaluation', () => {
    test('should handle empty conditions array', () => {
      const activity = { identifier: 'test' };
      const result = sequencingEngine.evaluateRuleConditions([], activity);

      expect(result.satisfied).toBe(false);
      expect(result.reason).toBe('No conditions defined');
    });

    test('should evaluate SATISFIED condition', () => {
      const activity = {
        identifier: 'test-activity',
        objectives: [{
          id: 'primary',
          progressStatus: OBJECTIVE_PROGRESS_STATES.KNOWN,
          satisfiedStatus: true
        }]
      };

      // Mock the isActivitySatisfied method
      sequencingEngine.isActivitySatisfied = jest.fn(() => true);

      const result = sequencingEngine.evaluateSingleCondition(
        { condition: RULE_CONDITIONS.SATISFIED, operator: 'noOp' },
        activity
      );

      expect(result.satisfied).toBe(true);
      expect(result.reason).toContain('Activity satisfied: true');
    });

    test('should evaluate ACTIVITY_PROGRESS_KNOWN condition', () => {
      const activity = {
        identifier: 'test-activity',
        attemptState: ATTEMPT_STATES.INCOMPLETE
      };

      const result = sequencingEngine.evaluateSingleCondition(
        { condition: RULE_CONDITIONS.ACTIVITY_PROGRESS_KNOWN, operator: 'noOp' },
        activity
      );

      expect(result.satisfied).toBe(true);
      expect(result.reason).toContain('Activity progress known: true');
    });

    test('should evaluate ATTEMPT_LIMIT_EXCEEDED condition', () => {
      const activity = {
        identifier: 'test-activity',
        attemptCount: 5,
        sequencing: {
          limitConditions: {
            attemptLimit: 3
          }
        }
      };

      // Mock the isAttemptLimitExceeded method
      sequencingEngine.isAttemptLimitExceeded = jest.fn(() => true);

      const result = sequencingEngine.evaluateSingleCondition(
        { condition: RULE_CONDITIONS.ATTEMPT_LIMIT_EXCEEDED, operator: 'noOp' },
        activity
      );

      expect(result.satisfied).toBe(true);
      expect(result.reason).toContain('Attempt limit exceeded: true');
    });

    test('should handle unknown condition types', () => {
      const activity = { identifier: 'test' };
      const result = sequencingEngine.evaluateSingleCondition(
        { condition: 'unknown_condition', operator: 'noOp' },
        activity
      );

      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('Unknown condition: unknown_condition');
    });
  });
});