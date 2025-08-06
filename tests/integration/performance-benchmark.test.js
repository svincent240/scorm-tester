/**
 * SCORM Performance Benchmark Integration Tests
 *
 * Tests performance characteristics of the Sequencing and Navigation implementation
 * to ensure it meets production requirements for responsiveness and scalability.
 *
 * @fileoverview Integration tests for SCORM performance benchmarks
 *
 * Migration Note:
 * This integration test overlaps with the new non-gating perf layer in tests/perf/.
 * Do not delete yet. We will gradually migrate metrics to tests/perf/* and keep this
 * file focused on end-to-end validations. Avoid console.* usage; prefer file-based
 * artifact sinks when capturing performance summaries.
 */

const { ScormSNService } = require('../../src/main/services/scorm/sn');
const ScormErrorHandler = require('../../src/main/services/scorm/rte/error-handler');

describe('SCORM Performance Benchmarks', () => {
  let logger;

  beforeEach(() => {
    // Disable debug logging for performance tests
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Create a test manifest with specified number of activities
   */
  const createTestManifest = (activityCount = 4) => {
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
  };

  /**
   * Create a large nested test manifest for stress testing
   */
  const createLargeTestManifest = () => {
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
  };

  /**
   * Measure performance of an async function
   */
  const measurePerformance = async (testFunction, iterations = 1) => {
    const times = [];
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();
      
      try {
        await testFunction();
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        times.push(duration);
      } catch (error) {
        errors++;
      }
    }

    if (times.length === 0) {
      return { success: false, errors };
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

    return {
      success: true,
      iterations: times.length,
      errors,
      avg: parseFloat(avg.toFixed(2)),
      min: parseFloat(min.toFixed(2)),
      max: parseFloat(max.toFixed(2)),
      p95: parseFloat(p95.toFixed(2))
    };
  };

  describe('Service Initialization Performance', () => {
    test('should initialize SN service within 100ms target', async () => {
      const TARGET_TIME = 100; // ms
      const ITERATIONS = 10;

      const result = await measurePerformance(async () => {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const manifest = createTestManifest(4);
        const initResult = await snService.initialize(manifest);
        expect(initResult.success).toBe(true);
      }, ITERATIONS);

      expect(result.success).toBe(true);
      expect(result.avg).toBeLessThan(TARGET_TIME);
      expect(result.errors).toBe(0);
    });

    test('should handle multiple service instances efficiently', async () => {
      const services = [];
      const manifest = createTestManifest(10);
      
      const startTime = Date.now();
      
      // Create multiple service instances
      for (let i = 0; i < 10; i++) {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const result = await snService.initialize(manifest);
        expect(result.success).toBe(true);
        services.push(snService);
      }
      
      const totalTime = Date.now() - startTime;
      
      // Clean up
      services.forEach(service => {
        service.terminateSequencing();
      });
      
      expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });

  describe('Navigation Performance', () => {
    let snService;
    let manifest;

    beforeEach(async () => {
      const errorHandler = new ScormErrorHandler(logger);
      snService = new ScormSNService(errorHandler, logger);
      manifest = createTestManifest(10);
      await snService.initialize(manifest);
    });

    afterEach(() => {
      if (snService) {
        snService.terminateSequencing();
      }
    });

    test('should process navigation within 50ms target', async () => {
      const TARGET_TIME = 50; // ms
      const ITERATIONS = 20;

      const result = await measurePerformance(async () => {
        const navTypes = ['start', 'continue', 'previous'];
        const navType = navTypes[Math.floor(Math.random() * navTypes.length)];
        await snService.processNavigation(navType);
      }, ITERATIONS);

      expect(result.success).toBe(true);
      expect(result.avg).toBeLessThan(TARGET_TIME);
    });

    test('should handle rapid navigation requests', async () => {
      const startTime = Date.now();
      
      // Fire multiple navigation requests in sequence
      for (let i = 0; i < 20; i++) {
        await snService.processNavigation('start');
      }
      
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Progress Update Performance', () => {
    let snService;

    beforeEach(async () => {
      const errorHandler = new ScormErrorHandler(logger);
      snService = new ScormSNService(errorHandler, logger);
      const manifest = createTestManifest(10);
      await snService.initialize(manifest);
      await snService.processNavigation('start');
    });

    afterEach(() => {
      if (snService) {
        snService.terminateSequencing();
      }
    });

    test('should update activity progress within 25ms target', async () => {
      const TARGET_TIME = 25; // ms
      const ITERATIONS = 50;

      const result = await measurePerformance(async () => {
        const state = snService.getSequencingState();
        if (state.currentActivity) {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: Math.random() > 0.5,
            satisfied: Math.random() > 0.3,
            measure: Math.random()
          });
        }
      }, ITERATIONS);

      expect(result.success).toBe(true);
      expect(result.avg).toBeLessThan(TARGET_TIME);
    });

    test('should handle batch progress updates efficiently', async () => {
      const state = snService.getSequencingState();
      if (state.currentActivity) {
        const startTime = Date.now();
        
        // Perform multiple progress updates
        for (let i = 0; i < 100; i++) {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: true,
            satisfied: true,
            measure: Math.random()
          });
        }
        
        const totalTime = Date.now() - startTime;
        expect(totalTime).toBeLessThan(500); // Should complete within 500ms
      }
    });
  });

  describe('Large Activity Tree Performance', () => {
    test('should handle large activity tree within 200ms target', async () => {
      const TARGET_TIME = 200; // ms
      const ITERATIONS = 5;

      const result = await measurePerformance(async () => {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const largeManifest = createLargeTestManifest();
        const initResult = await snService.initialize(largeManifest);
        expect(initResult.success).toBe(true);
        
        // Perform some navigation operations
        await snService.processNavigation('start');
        await snService.processNavigation('continue');
        
        snService.terminateSequencing();
      }, ITERATIONS);

      expect(result.success).toBe(true);
      expect(result.avg).toBeLessThan(TARGET_TIME);
    });

    test('should navigate through large tree efficiently', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const largeManifest = createLargeTestManifest();
      
      await snService.initialize(largeManifest);
      
      const startTime = Date.now();
      
      // Navigate through the tree
      await snService.processNavigation('start');
      for (let i = 0; i < 20; i++) {
        await snService.processNavigation('continue');
      }
      
      const totalTime = Date.now() - startTime;
      
      snService.terminateSequencing();
      
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Memory Usage and Resource Management', () => {
    test('should maintain reasonable memory usage', async () => {
      const memBefore = process.memoryUsage();
      
      // Create multiple service instances
      const services = [];
      for (let i = 0; i < 10; i++) {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const manifest = createTestManifest(20);
        await snService.initialize(manifest);
        services.push(snService);
      }

      const memAfter = process.memoryUsage();
      
      // Clean up
      services.forEach(service => {
        service.terminateSequencing();
      });

      const memDiff = {
        heapUsed: (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024, // MB
        heapTotal: (memAfter.heapTotal - memBefore.heapTotal) / 1024 / 1024, // MB
        external: (memAfter.external - memBefore.external) / 1024 / 1024 // MB
      };

      // Memory usage should be reasonable (less than 50MB for 10 services)
      expect(memDiff.heapUsed).toBeLessThan(50);
    });

    test('should clean up resources properly on termination', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const manifest = createTestManifest(10);
      
      await snService.initialize(manifest);
      
      // Verify service is running
      const stateBefore = snService.getSequencingState();
      expect(stateBefore.sessionState).toBe('active');
      
      // Terminate and verify cleanup
      const terminateResult = snService.terminateSequencing();
      expect(terminateResult.success).toBe(true);
      
      const stateAfter = snService.getSequencingState();
      expect(stateAfter.sessionState).toBe('ended');
    });
  });

  describe('Concurrent Operations Performance', () => {
    test('should handle concurrent navigation requests gracefully', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const manifest = createTestManifest(10);
      await snService.initialize(manifest);
      
      const startTime = Date.now();
      
      // Fire multiple navigation requests simultaneously
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(snService.processNavigation('start'));
      }
      
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      // At least one should succeed
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThan(0);
      expect(totalTime).toBeLessThan(500); // Should complete within 500ms
      
      snService.terminateSequencing();
    });

    test('should handle mixed operations concurrently', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const manifest = createTestManifest(10);
      await snService.initialize(manifest);
      await snService.processNavigation('start');
      
      const startTime = Date.now();
      
      // Mix of navigation and progress updates
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(snService.processNavigation('continue'));
      }
      
      const state = snService.getSequencingState();
      if (state.currentActivity) {
        for (let i = 0; i < 5; i++) {
          promises.push(Promise.resolve(
            snService.updateActivityProgress(state.currentActivity.identifier, {
              completed: true,
              satisfied: true,
              measure: Math.random()
            })
          ));
        }
      }
      
      await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      expect(totalTime).toBeLessThan(300); // Should complete within 300ms
      
      snService.terminateSequencing();
    });
  });

  describe('Stress Testing', () => {
    test('should handle rapid initialization/termination cycles', async () => {
      const manifest = createTestManifest(5);
      const startTime = Date.now();
      
      for (let i = 0; i < 20; i++) {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        
        const initResult = await snService.initialize(manifest);
        expect(initResult.success).toBe(true);
        
        const terminateResult = snService.terminateSequencing();
        expect(terminateResult.success).toBe(true);
      }
      
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(3000); // Should complete within 3 seconds
    });

    test('should maintain performance under sustained load', async () => {
      const errorHandler = new ScormErrorHandler(logger);
      const snService = new ScormSNService(errorHandler, logger);
      const manifest = createTestManifest(20);
      await snService.initialize(manifest);
      
      const startTime = Date.now();
      
      // Sustained operations for performance testing
      for (let i = 0; i < 100; i++) {
        await snService.processNavigation('start');
        
        const state = snService.getSequencingState();
        if (state.currentActivity) {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: true,
            satisfied: true,
            measure: Math.random()
          });
        }
      }
      
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      snService.terminateSequencing();
    });
  });
});