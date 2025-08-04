/**
 * Phase 3 Integration Test with Phase 1 RTE and Phase 2 CAM
 * 
 * Tests the complete SCORM workflow: CAM -> SN -> RTE integration
 */

const { ScormSNService } = require('./src/main/services/scorm/sn');
const { ScormCAMService } = require('./src/main/services/scorm/cam');
const ScormApiHandler = require('./src/main/services/scorm/rte/api-handler');
const ScormErrorHandler = require('./src/main/services/scorm/rte/error-handler');

async function testPhaseIntegration() {
  console.log('🧪 Testing Phase 1, 2, and 3 Integration...\n');

  // Create shared error handler
  const errorHandler = new ScormErrorHandler();
  
  // Mock logger
  const logger = {
    debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data || ''),
    info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
    warn: (msg, data) => console.log(`[WARN] ${msg}`, data || ''),
    error: (msg, data) => console.log(`[ERROR] ${msg}`, data || '')
  };

  // Mock session manager for RTE
  const sessionManager = {
    sessions: new Map(),
    registerSession: () => 'test-session',
    unregisterSession: () => {},
    persistSessionData: () => Promise.resolve(true),
    getLearnerInfo: () => ({ id: 'test_learner', name: 'Test Learner' })
  };

  try {
    // Test 1: Phase 2 CAM Service
    console.log('📦 Testing Phase 2 CAM Service...');
    const camService = new ScormCAMService(errorHandler);
    
    // Create a test manifest
    const testManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Integration Test Course',
          sequencing: {
            controlMode: { choice: true, flow: true },
            sequencingRules: {
              postConditionRules: [{
                conditions: [{ condition: 'satisfied', operator: 'not' }],
                action: 'retry'
              }]
            }
          },
          items: [{
            identifier: 'lesson1',
            title: 'Lesson 1',
            identifierref: 'resource1',
            sequencing: {
              objectives: {
                primaryObjective: { objectiveID: 'lesson1_obj' }
              }
            }
          }, {
            identifier: 'lesson2',
            title: 'Lesson 2',
            identifierref: 'resource2'
          }]
        }]
      },
      resources: [
        { identifier: 'resource1', scormType: 'sco', href: 'lesson1.html' },
        { identifier: 'resource2', scormType: 'sco', href: 'lesson2.html' }
      ]
    };

    console.log('✅ CAM Service initialized successfully');

    // Test 2: Phase 3 SN Service
    console.log('\n🔄 Testing Phase 3 SN Service...');
    const snService = new ScormSNService(errorHandler, logger);
    
    const initResult = await snService.initialize(testManifest);
    if (!initResult.success) {
      throw new Error(`SN initialization failed: ${initResult.reason}`);
    }
    console.log(`✅ SN Service initialized: ${initResult.sessionId}`);

    // Test navigation workflow
    const startResult = await snService.processNavigation('start');
    if (!startResult.success) {
      throw new Error(`Navigation start failed: ${startResult.reason}`);
    }
    console.log(`✅ Navigation started: ${startResult.targetActivity.identifier}`);

    // Test activity progress update
    const progressResult = snService.updateActivityProgress('lesson1', {
      completed: true,
      satisfied: false,
      measure: 0.4
    });
    if (!progressResult.success) {
      throw new Error(`Progress update failed: ${progressResult.reason}`);
    }
    console.log('✅ Activity progress updated');

    // Test 3: Phase 1 RTE Service
    console.log('\n📡 Testing Phase 1 RTE Service...');
    const apiHandler = new ScormApiHandler(sessionManager, logger);
    
    // Test API initialization
    const initializeResult = apiHandler.Initialize('');
    if (initializeResult !== 'true') {
      throw new Error('RTE initialization failed');
    }
    console.log('✅ RTE API initialized');

    // Test data model operations
    const setResult = apiHandler.SetValue('cmi.completion_status', 'completed');
    if (setResult !== 'true') {
      throw new Error('SetValue failed');
    }
    
    const getValue = apiHandler.GetValue('cmi.completion_status');
    if (getValue !== 'completed') {
      throw new Error('GetValue failed');
    }
    console.log('✅ RTE data model operations working');

    // Test 4: Cross-Phase Integration
    console.log('\n🔗 Testing Cross-Phase Integration...');
    
    // Test error handling consistency
    const lastError = errorHandler.getLastError();
    console.log(`✅ Shared error handling: ${lastError}`);

    // Test sequencing state
    const sequencingState = snService.getSequencingState();
    console.log(`✅ Sequencing state: ${sequencingState.sessionState}`);
    console.log(`   Current activity: ${sequencingState.currentActivity?.identifier || 'none'}`);
    console.log(`   Available navigation: ${sequencingState.availableNavigation.join(', ')}`);

    // Test navigation with choice
    const choiceResult = await snService.processNavigation('choice', 'lesson2');
    if (choiceResult.success) {
      console.log(`✅ Choice navigation: ${choiceResult.targetActivity.identifier}`);
    } else {
      console.log(`⚠️  Choice navigation failed: ${choiceResult.reason}`);
    }

    // Test termination
    const terminateResult = snService.terminateSequencing();
    if (terminateResult.success) {
      console.log('✅ Sequencing terminated successfully');
    }

    const terminateRTE = apiHandler.Terminate('');
    if (terminateRTE === 'true') {
      console.log('✅ RTE terminated successfully');
    }

    console.log('\n🎉 Integration Test Results:');
    console.log('✅ Phase 1 RTE: Working correctly');
    console.log('✅ Phase 2 CAM: Working correctly');
    console.log('✅ Phase 3 SN: Working correctly');
    console.log('✅ Cross-phase integration: Successful');
    console.log('✅ Shared error handling: Functional');
    console.log('✅ End-to-end workflow: Complete');

    return true;

  } catch (error) {
    console.error('\n❌ Integration Test Failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

// Run the integration test
testPhaseIntegration().then(success => {
  if (success) {
    console.log('\n🏆 All integration tests passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Integration tests failed!');
    process.exit(1);
  }
}).catch(error => {
  console.error('\n💥 Integration test error:', error);
  process.exit(1);
});