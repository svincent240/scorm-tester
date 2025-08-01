/**
 * Jest Test Setup
 * 
 * Global test configuration and setup for SCORM Tester test suite.
 * Provides common utilities, mocks, and test environment configuration.
 * 
 * @fileoverview Jest test setup and configuration
 */

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress console output during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Global test utilities
global.testUtils = {
  /**
   * Create a mock logger for testing
   * @returns {Object} Mock logger instance
   */
  createMockLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    logs: []
  }),

  /**
   * Create a mock session manager for testing
   * @returns {Object} Mock session manager instance
   */
  createMockSessionManager: () => ({
    sessions: new Map(),
    persistedData: new Map(),
    
    registerSession: jest.fn(),
    unregisterSession: jest.fn(),
    persistSessionData: jest.fn().mockResolvedValue(true),
    getLearnerInfo: jest.fn(() => ({
      id: 'test_learner',
      name: 'Test Learner'
    }))
  }),

  /**
   * Wait for a specified amount of time
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise} Promise that resolves after the specified time
   */
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Generate a random string for testing
   * @param {number} length - Length of the string
   * @returns {string} Random string
   */
  randomString: (length = 10) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Create test SCORM data for testing
   * @returns {Object} Test SCORM data
   */
  createTestScormData: () => ({
    completion_status: 'completed',
    success_status: 'passed',
    score: {
      raw: '85',
      max: '100',
      min: '0',
      scaled: '0.85'
    },
    location: 'page5',
    suspend_data: JSON.stringify({
      currentPage: 5,
      userAnswers: ['a', 'b', 'c'],
      timeSpent: 1800
    }),
    interactions: [
      {
        id: 'question1',
        type: 'choice',
        learner_response: 'a',
        result: 'correct'
      },
      {
        id: 'question2', 
        type: 'true-false',
        learner_response: 'true',
        result: 'correct'
      }
    ]
  })
};

// Global SCORM test constants
global.SCORM_TEST_CONSTANTS = {
  VALID_COMPLETION_STATUSES: ['completed', 'incomplete', 'not attempted', 'unknown'],
  VALID_SUCCESS_STATUSES: ['passed', 'failed', 'unknown'],
  VALID_EXIT_STATUSES: ['time-out', 'suspend', 'logout', 'normal', ''],
  VALID_ENTRY_STATUSES: ['ab-initio', 'resume', ''],
  VALID_LESSON_MODES: ['normal', 'browse', 'review'],
  VALID_CREDIT_VALUES: ['credit', 'no-credit'],
  VALID_INTERACTION_TYPES: [
    'true-false', 'choice', 'fill-in', 'long-fill-in',
    'matching', 'performance', 'sequencing', 'likert',
    'numeric', 'other'
  ],
  VALID_INTERACTION_RESULTS: ['correct', 'incorrect', 'unanticipated', 'neutral'],
  VALID_NAV_REQUESTS: [
    'continue', 'previous', 'exit', 'exitAll', 'abandon',
    'abandonAll', 'suspendAll', 'start', 'resumeAll'
  ]
};

// Mock Electron modules if needed
if (typeof window === 'undefined') {
  global.window = {};
}

// Setup custom matchers for SCORM testing
expect.extend({
  /**
   * Check if a value is a valid SCORM error code
   * @param {string} received - The error code to check
   * @returns {Object} Jest matcher result
   */
  toBeValidScormErrorCode(received) {
    const errorCode = parseInt(received, 10);
    const isValid = !isNaN(errorCode) && errorCode >= 0 && errorCode <= 999;
    
    return {
      message: () => `expected ${received} to be a valid SCORM error code (0-999)`,
      pass: isValid
    };
  },

  /**
   * Check if a value is a valid SCORM boolean string
   * @param {string} received - The value to check
   * @returns {Object} Jest matcher result
   */
  toBeScormBoolean(received) {
    const isValid = received === 'true' || received === 'false';
    
    return {
      message: () => `expected ${received} to be a SCORM boolean ("true" or "false")`,
      pass: isValid
    };
  },

  /**
   * Check if a value is within SCORM scaled score range
   * @param {string} received - The score to check
   * @returns {Object} Jest matcher result
   */
  toBeValidScaledScore(received) {
    const score = parseFloat(received);
    const isValid = !isNaN(score) && score >= -1 && score <= 1;
    
    return {
      message: () => `expected ${received} to be a valid scaled score (-1 to 1)`,
      pass: isValid
    };
  },

  /**
   * Check if a value is a valid ISO 8601 duration
   * @param {string} received - The duration to check
   * @returns {Object} Jest matcher result
   */
  toBeValidTimeInterval(received) {
    const timeIntervalRegex = /^PT(\d+H)?(\d+M)?(\d+(\.\d+)?S)?$/;
    const isValid = timeIntervalRegex.test(received);
    
    return {
      message: () => `expected ${received} to be a valid ISO 8601 duration`,
      pass: isValid
    };
  }
});

// Global error handler for unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

console.log('SCORM Tester test environment initialized');