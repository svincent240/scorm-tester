/**
 * SCORM Tester Main Entry Point
 * 
 * Minimal main entry point for Phase 1 testing.
 * This will be expanded in later phases with full Electron integration.
 * 
 * @fileoverview Main entry point for SCORM Tester application
 */

const ScormApiHandler = require('./services/scorm/rte/api-handler');

/**
 * Create and export SCORM API Handler for testing
 * @param {Object} sessionManager - Session manager instance
 * @param {Object} logger - Logger instance
 * @param {Object} options - Configuration options
 * @returns {ScormApiHandler} SCORM API Handler instance
 */
function createScormApi(sessionManager, logger, options = {}) {
  return new ScormApiHandler(sessionManager, logger, options);
}

// Export for testing and future integration
module.exports = {
  ScormApiHandler,
  createScormApi
};

// For development/testing - create a default instance if run directly
if (require.main === module) {
  console.log('SCORM Tester - Phase 1 Foundation');
  console.log('Main entry point created for testing purposes');
  
  // Create a simple test logger
  const testLogger = {
    debug: (msg, ...args) => console.log('[DEBUG]', msg, ...args),
    info: (msg, ...args) => console.log('[INFO]', msg, ...args),
    warn: (msg, ...args) => console.warn('[WARN]', msg, ...args),
    error: (msg, ...args) => console.error('[ERROR]', msg, ...args)
  };
  
  // Create a simple test session manager
  const testSessionManager = {
    sessions: new Map(),
    registerSession: (id, handler) => console.log(`Session registered: ${id}`),
    unregisterSession: (id) => console.log(`Session unregistered: ${id}`),
    persistSessionData: (id, data) => {
      console.log(`Data persisted for session: ${id}`);
      return Promise.resolve(true);
    },
    getLearnerInfo: () => ({
      id: 'test_learner_001',
      name: 'Test Learner'
    })
  };
  
  // Create and test basic API functionality
  try {
    const api = createScormApi(testSessionManager, testLogger);
    console.log('SCORM API Handler created successfully');
    console.log('Available functions:', Object.getOwnPropertyNames(Object.getPrototypeOf(api)).filter(name => name !== 'constructor'));
  } catch (error) {
    console.error('Failed to create SCORM API Handler:', error);
  }
}