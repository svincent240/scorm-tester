/**
 * SCORM Phase 3 Performance Benchmark
 * 
 * Tests performance characteristics of the Sequencing and Navigation implementation
 * to ensure it meets production requirements for responsiveness and scalability.
 */

const { ScormSNService } = require('./src/main/services/scorm/sn');
const ScormErrorHandler = require('./src/main/services/scorm/rte/error-handler');

// Performance test configurations
const PERFORMANCE_TESTS = {
  initialization: {
    name: 'SN Service Initialization',
    target: 100, // ms
    iterations: 10
  },
  navigation: {
    name: 'Navigation Processing',
    target: 50, // ms
    iterations: 100
  },
  progressUpdate: {
    name: 'Activity Progress Update',
    target: 25, // ms
    iterations: 100
  },
  rollup: {
    name: 'Rollup Processing',
    target: 30, // ms
    iterations: 50
  },
  largeActivityTree: {
    name: 'Large Activity Tree Processing',
    target: 200, // ms
    iterations: 5
  }
};

function createTestManifest(activityCount = 4) {
  const items = [];
  for (let i = 1; i <= activityCount; i++) {
    items.push({
      identifier: `activity_${i}`,
      title: `Activity ${i}`,
      identifierref: `resource_${i}`,
      sequencing: {
        objectives: {
          primaryObjective: { objectiveID: `obj_${i}` }
        },
        sequencingRules: {
          preConditionRules: [{
            conditions: [{ condition: 'satisfied' }],
            action: 'skip'
          }],
          postConditionRules: [{
            conditions: [{ condition: 'satisfied', operator: 'not' }],
            action: 'retry'
          }]
        }
      }
    });
  }

  return {
    organizations: {
      default: 'org1',
      organizations: [{
        identifier: 'org1',
        title: 'Performance Test Course',
        sequencing: {
          controlMode: { choice: true, flow: true },
          sequencingRules: {
            postConditionRules: [{
              conditions: [{ condition: 'satisfied', operator: 'not' }],
              action: 'retry'
            }]
          }
        },
        items
      }]
    },
    resources: items.map(item => ({
      identifier: item.identifierref,
      scormType: 'sco',
      href: `content/${item.identifier}.html`
    }))
  };
}

function createLargeTestManifest() {
  // Create a more complex nested structure for stress testing
  const createNestedItems = (depth, breadth, prefix = '') => {
    const items = [];
    for (let i = 1; i <= breadth; i++) {
      const identifier = `${prefix}item_${i}`;
      const item = {
        identifier,
        title: `Item ${identifier}`,
        identifierref: `resource_${identifier}`,
        sequencing: {
          objectives: {
            primaryObjective: { objectiveID: `obj_${identifier}` }
          },
          sequencingRules: {
            preConditionRules: [{
              conditions: [{ condition: 'satisfied' }],
              action: 'skip'
            }],
            postConditionRules: [{
              conditions: [{ condition: 'satisfied', operator: 'not' }],
              action: 'retry'
            }]
          }
        }
      };

      if (depth > 1) {
        item.items = createNestedItems(depth - 1, Math.max(2, breadth - 1), `${identifier}_`);
      }

      items.push(item);
    }
    return items;
  };

  const items = createNestedItems(3, 5); // 3 levels deep, 5 items per level

  return {
    organizations: {
      default: 'org1',
      organizations: [{
        identifier: 'org1',
        title: 'Large Performance Test Course',
        sequencing: {
          controlMode: { choice: true, flow: true }
        },
        items
      }]
    },
    resources: [] // Resources would be generated based on items
  };
}

async function measurePerformance(testName, testFunction, iterations = 1) {
  const times = [];
  let errors = 0;

  console.log(`  🔍 Running ${testName} (${iterations} iterations)...`);

  for (let i = 0; i < iterations; i++) {
    const startTime = process.hrtime.bigint();
    
    try {
      await testFunction();
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      times.push(duration);
    } catch (error) {
      errors++;
      console.log(`    ⚠️  Error in iteration ${i + 1}: ${error.message}`);
    }
  }

  if (times.length === 0) {
    return {
      testName,
      success: false,
      error: 'All iterations failed'
    };
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  return {
    testName,
    success: true,
    iterations: times.length,
    errors,
    avg: avg.toFixed(2),
    min: min.toFixed(2),
    max: max.toFixed(2),
    p95: p95.toFixed(2)
  };
}

async function runPerformanceBenchmark() {
  console.log('🚀 SCORM Phase 3 Performance Benchmark\n');

  const logger = {
    debug: () => {}, // Disable debug logging for performance tests
    info: () => {},
    warn: (msg, data) => console.log(`[WARN] ${msg}`, data || ''),
    error: (msg, data) => console.log(`[ERROR] ${msg}`, data || '')
  };

  const results = [];

  try {
    // Test 1: Initialization Performance
    console.log('📊 Testing Initialization Performance...');
    const initResult = await measurePerformance(
      'SN Service Initialization',
      async () => {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const manifest = createTestManifest(4);
        const result = await snService.initialize(manifest);
        if (!result.success) throw new Error(result.reason);
      },
      PERFORMANCE_TESTS.initialization.iterations
    );
    results.push(initResult);

    // Test 2: Navigation Performance
    console.log('📊 Testing Navigation Performance...');
    const errorHandler = new ScormErrorHandler(logger);
    const snService = new ScormSNService(errorHandler, logger);
    const manifest = createTestManifest(10);
    await snService.initialize(manifest);

    const navResult = await measurePerformance(
      'Navigation Processing',
      async () => {
        const navTypes = ['start', 'continue', 'previous'];
        const navType = navTypes[Math.floor(Math.random() * navTypes.length)];
        await snService.processNavigation(navType);
      },
      PERFORMANCE_TESTS.navigation.iterations
    );
    results.push(navResult);

    // Test 3: Progress Update Performance
    console.log('📊 Testing Progress Update Performance...');
    const progressResult = await measurePerformance(
      'Activity Progress Update',
      async () => {
        const state = snService.getSequencingState();
        if (state.currentActivity) {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: Math.random() > 0.5,
            satisfied: Math.random() > 0.3,
            measure: Math.random()
          });
        }
      },
      PERFORMANCE_TESTS.progressUpdate.iterations
    );
    results.push(progressResult);

    // Test 4: Large Activity Tree Performance
    console.log('📊 Testing Large Activity Tree Performance...');
    const largeTreeResult = await measurePerformance(
      'Large Activity Tree Processing',
      async () => {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const largeManifest = createLargeTestManifest();
        const result = await snService.initialize(largeManifest);
        if (!result.success) throw new Error(result.reason);
        
        // Perform some navigation operations
        await snService.processNavigation('start');
        await snService.processNavigation('continue');
      },
      PERFORMANCE_TESTS.largeActivityTree.iterations
    );
    results.push(largeTreeResult);

    // Test 5: Memory Usage Test
    console.log('📊 Testing Memory Usage...');
    const memBefore = process.memoryUsage();
    
    // Create multiple service instances to test memory usage
    const services = [];
    for (let i = 0; i < 10; i++) {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const manifest = createTestManifest(20);
      await snService.initialize(manifest);
      services.push(snService);
    }

    const memAfter = process.memoryUsage();
    const memDiff = {
      heapUsed: ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
      heapTotal: ((memAfter.heapTotal - memBefore.heapTotal) / 1024 / 1024).toFixed(2),
      external: ((memAfter.external - memBefore.external) / 1024 / 1024).toFixed(2)
    };

    // Clean up
    services.forEach(service => {
      try {
        service.terminateSequencing();
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    console.log('\n🎯 Performance Benchmark Results:\n');

    results.forEach(result => {
      if (result.success) {
        const config = Object.values(PERFORMANCE_TESTS).find(t => t.name === result.testName);
        const target = config?.target || 100;
        const avgTime = parseFloat(result.avg);
        const status = avgTime <= target ? '✅' : avgTime <= target * 1.5 ? '⚠️' : '❌';
        
        console.log(`${status} ${result.testName}:`);
        console.log(`    Average: ${result.avg}ms (target: ${target}ms)`);
        console.log(`    Min: ${result.min}ms | Max: ${result.max}ms | P95: ${result.p95}ms`);
        console.log(`    Iterations: ${result.iterations} | Errors: ${result.errors}`);
        console.log('');
      } else {
        console.log(`❌ ${result.testName}: FAILED - ${result.error}\n`);
      }
    });

    console.log('💾 Memory Usage:');
    console.log(`    Heap Used: +${memDiff.heapUsed}MB`);
    console.log(`    Heap Total: +${memDiff.heapTotal}MB`);
    console.log(`    External: +${memDiff.external}MB\n`);

    // Overall assessment
    const successfulTests = results.filter(r => r.success);
    const performantTests = successfulTests.filter(r => {
      const config = Object.values(PERFORMANCE_TESTS).find(t => t.name === r.testName);
      const target = config?.target || 100;
      return parseFloat(r.avg) <= target;
    });

    const performanceScore = (performantTests.length / results.length) * 100;

    console.log('🏆 Performance Assessment:');
    console.log(`📊 Performance Score: ${performanceScore.toFixed(1)}%`);
    console.log(`✅ Tests Passed: ${successfulTests.length}/${results.length}`);
    console.log(`🚀 Performance Targets Met: ${performantTests.length}/${results.length}`);

    if (performanceScore >= 90) {
      console.log('\n🏆 Performance: EXCELLENT (≥90%)');
    } else if (performanceScore >= 80) {
      console.log('\n✅ Performance: GOOD (≥80%)');
    } else if (performanceScore >= 70) {
      console.log('\n⚠️  Performance: ACCEPTABLE (≥70%)');
    } else {
      console.log('\n❌ Performance: NEEDS IMPROVEMENT (<70%)');
    }

    return {
      success: performanceScore >= 70,
      score: performanceScore,
      results,
      memoryUsage: memDiff
    };

  } catch (error) {
    console.error('\n💥 Performance benchmark error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the performance benchmark
runPerformanceBenchmark().then(results => {
  if (results.success) {
    console.log('\n🏆 Performance benchmark completed successfully!');
    process.exit(0);
  } else {
    console.log('\n💥 Performance benchmark failed!');
    process.exit(1);
  }
}).catch(error => {
  console.error('\n💥 Performance benchmark error:', error);
  process.exit(1);
});