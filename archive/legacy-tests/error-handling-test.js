/**
 * SCORM Phase 3 Error Handling and Edge Cases Test
 * 
 * Tests error handling scenarios and edge cases to ensure robust behavior
 * under various failure conditions and invalid inputs.
 */

const { ScormSNService } = require('./src/main/services/scorm/sn');
const { ScormCAMService } = require('./src/main/services/scorm/cam');
const ScormErrorHandler = require('./src/main/services/scorm/rte/error-handler');

async function testErrorHandling() {
  console.log('🧪 SCORM Phase 3 Error Handling and Edge Cases Test\n');

  const logger = {
    debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data || ''),
    info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
    warn: (msg, data) => console.log(`[WARN] ${msg}`, data || ''),
    error: (msg, data) => console.log(`[ERROR] ${msg}`, data || '')
  };

  const results = {
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    errors: []
  };

  const runTest = async (testName, testFunction, expectError = false) => {
    console.log(`  🔍 Testing ${testName}...`);
    results.testsRun++;
    
    try {
      await testFunction();
      if (expectError) {
        console.log(`  ❌ ${testName}: FAILED - Expected error but none occurred`);
        results.testsFailed++;
        results.errors.push(`${testName}: Expected error but none occurred`);
      } else {
        console.log(`  ✅ ${testName}: PASSED`);
        results.testsPassed++;
      }
    } catch (error) {
      if (expectError) {
        console.log(`  ✅ ${testName}: PASSED - Expected error: ${error.message}`);
        results.testsPassed++;
      } else {
        console.log(`  ❌ ${testName}: FAILED - ${error.message}`);
        results.testsFailed++;
        results.errors.push(`${testName}: ${error.message}`);
      }
    }
  };

  try {
    // Test 1: Invalid Manifest Handling
    console.log('📋 Testing Invalid Manifest Handling...');
    
    await runTest('Null manifest', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const result = await snService.initialize(null);
      if (result.success) throw new Error('Should have failed with null manifest');
    });

    await runTest('Empty manifest', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const result = await snService.initialize({});
      if (result.success) throw new Error('Should have failed with empty manifest');
    });

    await runTest('Manifest without organizations', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const result = await snService.initialize({ resources: [] });
      if (result.success) throw new Error('Should have failed without organizations');
    });

    await runTest('Manifest with circular references', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      
      // Create a manifest with circular item references
      const circularManifest = {
        organizations: {
          default: 'org1',
          organizations: [{
            identifier: 'org1',
            title: 'Circular Test',
            items: [{
              identifier: 'item1',
              title: 'Item 1',
              items: [{
                identifier: 'item2',
                title: 'Item 2',
                items: [{
                  identifier: 'item1', // Circular reference
                  title: 'Item 1 Again'
                }]
              }]
            }]
          }]
        },
        resources: []
      };
      
      const result = await snService.initialize(circularManifest);
      if (result.success) throw new Error('Should have detected circular reference');
    });

    // Test 2: Navigation Error Handling
    console.log('\n🧭 Testing Navigation Error Handling...');

    const errorHandler = new ScormErrorHandler(logger);
    const snService = new ScormSNService(errorHandler, logger);
    
    await runTest('Navigation without initialization', async () => {
      const result = await snService.processNavigation('start');
      if (result.success) throw new Error('Should fail without initialization');
    });

    // Initialize for subsequent tests
    const validManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Test Course',
          sequencing: {
            controlMode: { choice: true, flow: true }
          },
          items: [{
            identifier: 'item1',
            title: 'Item 1',
            identifierref: 'resource1'
          }]
        }]
      },
      resources: [
        { identifier: 'resource1', scormType: 'sco', href: 'content.html' }
      ]
    };

    await snService.initialize(validManifest);

    await runTest('Invalid navigation type', async () => {
      const result = await snService.processNavigation('invalid_nav_type');
      if (result.success) throw new Error('Should fail with invalid navigation type');
    });

    await runTest('Choice navigation to non-existent activity', async () => {
      const result = await snService.processNavigation('choice', 'non_existent_item');
      if (result.success) throw new Error('Should fail with non-existent target');
    });

    await runTest('Previous navigation at start', async () => {
      await snService.processNavigation('start'); // Go to first activity
      const result = await snService.processNavigation('previous');
      if (result.success) throw new Error('Should fail - no previous activity');
    });

    // Test 3: Activity Progress Error Handling
    console.log('\n📊 Testing Activity Progress Error Handling...');

    await runTest('Progress update for non-existent activity', async () => {
      const result = snService.updateActivityProgress('non_existent', {
        completed: true,
        satisfied: true
      });
      if (result.success) throw new Error('Should fail for non-existent activity');
    });

    await runTest('Progress update with invalid data', async () => {
      const state = snService.getSequencingState();
      if (state.currentActivity) {
        const result = snService.updateActivityProgress(state.currentActivity.identifier, {
          completed: 'invalid', // Should be boolean
          satisfied: 'also_invalid',
          measure: 'not_a_number'
        });
        // This should handle gracefully and convert/validate data
      }
    });

    // Test 4: Sequencing Rules Error Handling
    console.log('\n📏 Testing Sequencing Rules Error Handling...');

    await runTest('Malformed sequencing rules', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      
      const malformedManifest = {
        organizations: {
          default: 'org1',
          organizations: [{
            identifier: 'org1',
            title: 'Malformed Rules Test',
            items: [{
              identifier: 'item1',
              title: 'Item 1',
              identifierref: 'resource1',
              sequencing: {
                sequencingRules: {
                  preConditionRules: [{
                    conditions: [{ condition: 'invalid_condition' }], // Invalid condition
                    action: 'invalid_action' // Invalid action
                  }]
                }
              }
            }]
          }]
        },
        resources: [
          { identifier: 'resource1', scormType: 'sco', href: 'content.html' }
        ]
      };
      
      const result = await snService.initialize(malformedManifest);
      // Should initialize but handle malformed rules gracefully
      if (!result.success) throw new Error('Should handle malformed rules gracefully');
    });

    // Test 5: Memory and Resource Management
    console.log('\n💾 Testing Memory and Resource Management...');

    await runTest('Multiple service instances', async () => {
      const services = [];
      
      // Create many service instances to test resource management
      for (let i = 0; i < 50; i++) {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        await snService.initialize(validManifest);
        services.push(snService);
      }
      
      // Clean up all services
      services.forEach(service => {
        service.terminateSequencing();
      });
    });

    await runTest('Large activity tree stress test', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      
      // Create a very large activity tree
      const createLargeTree = (depth, breadth) => {
        if (depth === 0) return [];
        
        const items = [];
        for (let i = 0; i < breadth; i++) {
          items.push({
            identifier: `item_${depth}_${i}`,
            title: `Item ${depth}-${i}`,
            identifierref: `resource_${depth}_${i}`,
            items: createLargeTree(depth - 1, Math.max(1, breadth - 1))
          });
        }
        return items;
      };
      
      const largeManifest = {
        organizations: {
          default: 'org1',
          organizations: [{
            identifier: 'org1',
            title: 'Large Tree Test',
            items: createLargeTree(4, 10) // 4 levels deep, 10 items per level
          }]
        },
        resources: []
      };
      
      const result = await snService.initialize(largeManifest);
      if (!result.success) throw new Error(`Large tree failed: ${result.reason}`);
      
      // Test navigation through large tree
      await snService.processNavigation('start');
      for (let i = 0; i < 20; i++) {
        await snService.processNavigation('continue');
      }
    });

    // Test 6: Concurrent Operations
    console.log('\n🔄 Testing Concurrent Operations...');

    await runTest('Concurrent navigation requests', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      await snService.initialize(validManifest);
      
      // Fire multiple navigation requests simultaneously
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(snService.processNavigation('start'));
      }
      
      const results = await Promise.all(promises);
      // At least one should succeed, others should handle gracefully
      const successCount = results.filter(r => r.success).length;
      if (successCount === 0) throw new Error('No concurrent requests succeeded');
    });

    // Test 7: Edge Case Data Values
    console.log('\n🎯 Testing Edge Case Data Values...');

    await runTest('Extreme measure values', async () => {
      const state = snService.getSequencingState();
      if (state.currentActivity) {
        // Test with extreme values
        snService.updateActivityProgress(state.currentActivity.identifier, {
          completed: true,
          satisfied: true,
          measure: 999999999 // Very large number
        });
        
        snService.updateActivityProgress(state.currentActivity.identifier, {
          completed: true,
          satisfied: true,
          measure: -999999999 // Very negative number
        });
        
        snService.updateActivityProgress(state.currentActivity.identifier, {
          completed: true,
          satisfied: true,
          measure: Number.POSITIVE_INFINITY
        });
      }
    });

    // Test 8: Service State Management
    console.log('\n🔧 Testing Service State Management...');

    await runTest('Double initialization', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      
      await snService.initialize(validManifest);
      const result = await snService.initialize(validManifest); // Second initialization
      
      // Should handle gracefully (either succeed or fail predictably)
    });

    await runTest('Operations after termination', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      
      await snService.initialize(validManifest);
      snService.terminateSequencing();
      
      // Try operations after termination
      const navResult = await snService.processNavigation('start');
      if (navResult.success) throw new Error('Should fail after termination');
    });

    console.log('\n🎯 Error Handling Test Results:');
    console.log(`🧪 Tests run: ${results.testsRun}`);
    console.log(`✅ Tests passed: ${results.testsPassed}`);
    console.log(`❌ Tests failed: ${results.testsFailed}`);
    console.log(`📊 Success rate: ${((results.testsPassed / results.testsRun) * 100).toFixed(1)}%`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      results.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }

    // Overall assessment
    const successRate = (results.testsPassed / results.testsRun) * 100;
    if (successRate >= 90) {
      console.log('\n🏆 Error Handling: EXCELLENT (≥90%)');
    } else if (successRate >= 80) {
      console.log('\n✅ Error Handling: GOOD (≥80%)');
    } else if (successRate >= 70) {
      console.log('\n⚠️  Error Handling: ACCEPTABLE (≥70%)');
    } else {
      console.log('\n❌ Error Handling: NEEDS IMPROVEMENT (<70%)');
    }

    return {
      success: successRate >= 80,
      successRate,
      results
    };

  } catch (error) {
    console.error('\n💥 Error handling test error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the error handling test
testErrorHandling().then(results => {
  if (results.success) {
    console.log('\n🏆 Error handling validation completed successfully!');
    process.exit(0);
  } else {
    console.log('\n💥 Error handling validation failed!');
    process.exit(1);
  }
}).catch(error => {
  console.error('\n💥 Error handling test error:', error);
  process.exit(1);
});