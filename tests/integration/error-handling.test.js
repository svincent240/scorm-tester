/**
 * SCORM Error Handling and Edge Cases Integration Tests
 * 
 * Tests error handling scenarios and edge cases to ensure robust behavior
 * under various failure conditions and invalid inputs.
 * 
 * @fileoverview Integration tests for SCORM error handling
 */

const { ScormSNService } = require('../../src/main/services/scorm/sn');
const { ScormCAMService } = require('../../src/main/services/scorm/cam');
const ScormErrorHandler = require('../../src/main/services/scorm/rte/error-handler');

describe('SCORM Error Handling Integration', () => {
  let logger;
  let errorHandler;
  let snService;

  beforeEach(() => {
    logger = global.testUtils.createMockLogger();
    errorHandler = new ScormErrorHandler(logger);
    snService = new ScormSNService(errorHandler, logger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Invalid Manifest Handling', () => {
    test('should handle null manifest', async () => {
      await expect(snService.initialize(null)).rejects.toMatchObject({
        name: 'ParserError',
        code: expect.stringMatching(/PARSE_(XML_ERROR|EMPTY_INPUT|VALIDATION_ERROR)/)
      });
    });

    test('should handle empty manifest', async () => {
      await expect(snService.initialize({})).rejects.toMatchObject({
        name: 'ParserError',
        code: expect.stringMatching(/PARSE_(XML_ERROR|EMPTY_INPUT|VALIDATION_ERROR)/)
      });
    });

    test('should handle manifest without organizations', async () => {
      await expect(snService.initialize({ resources: [] })).rejects.toMatchObject({
        name: 'ParserError',
        code: expect.stringMatching(/PARSE_(VALIDATION_ERROR|XML_ERROR|EMPTY_INPUT)/),
        message: expect.stringContaining('No items in default organization')
      });
    });

    test('should handle circular references in manifest gracefully', async () => {
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
      
      await expect(snService.initialize(circularManifest)).resolves.toMatchObject({
        success: expect.any(Boolean)
      });
    });
  });

  describe('Navigation Error Handling', () => {
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

    test('should fail navigation without initialization', async () => {
      const result = await snService.processNavigation('start');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not active');
    });

    test('should fail with invalid navigation type', async () => {
      await snService.initialize(validManifest);
      const result = await snService.processNavigation('invalid_nav_type');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Invalid navigation request type');
    });

    test('should fail choice navigation to non-existent activity', async () => {
      await snService.initialize(validManifest);
      const result = await snService.processNavigation('choice', 'non_existent_item');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('No current activity');
    });

    test('should fail previous navigation at start', async () => {
      await snService.initialize(validManifest);
      await snService.processNavigation('start');
      const result = await snService.processNavigation('previous');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('previous');
    });
  });

  describe('Activity Progress Error Handling', () => {
    const validManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Test Course',
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

    beforeEach(async () => {
      await snService.initialize(validManifest);
    });

    test('should fail progress update for non-existent activity', () => {
      const result = snService.updateActivityProgress('non_existent', {
        completed: true,
        satisfied: true
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not found');
    });

    test('should handle progress update with invalid data types', () => {
      const state = snService.getSequencingState();
      if (state.currentActivity) {
        const result = snService.updateActivityProgress(state.currentActivity.identifier, {
          completed: 'invalid', // Should be boolean
          satisfied: 'also_invalid',
          measure: 'not_a_number'
        });
        // Should handle gracefully and convert/validate data
        expect(result).toBeDefined();
      }
    });
  });

  describe('Sequencing Rules Error Handling', () => {
    test('should handle malformed sequencing rules gracefully', async () => {
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
      expect(result.success).toBe(true);
    });
  });

  describe('Memory and Resource Management', () => {
    const validManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Test Course',
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

    test('should handle multiple service instances', async () => {
      const services = [];
      
      // Create many service instances to test resource management
      for (let i = 0; i < 10; i++) {
        const errorHandler = new ScormErrorHandler(logger);
        const snService = new ScormSNService(errorHandler, logger);
        const result = await snService.initialize(validManifest);
        expect(result.success).toBe(true);
        services.push(snService);
      }
      
      // Clean up all services
      services.forEach(service => {
        service.terminateSequencing();
      });
    });

    test('should handle large activity tree', async () => {
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
            items: createLargeTree(3, 5) // 3 levels deep, 5 items per level
          }]
        },
        resources: []
      };
      
      const result = await snService.initialize(largeManifest);
      expect(result.success).toBe(true);
      
      // Test navigation through large tree
      await snService.processNavigation('start');
      for (let i = 0; i < 10; i++) {
        await snService.processNavigation('continue');
      }
    });
  });

  describe('Concurrent Operations', () => {
    const validManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Test Course',
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

    test('should handle concurrent navigation requests', async () => {
      await snService.initialize(validManifest);
      
      // Fire multiple navigation requests simultaneously
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(snService.processNavigation('start'));
      }
      
      const results = await Promise.all(promises);
      // At least one should succeed, others should handle gracefully
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe('Edge Case Data Values', () => {
    const validManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Test Course',
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

    beforeEach(async () => {
      await snService.initialize(validManifest);
      await snService.processNavigation('start');
    });

    test('should handle extreme measure values', () => {
      const state = snService.getSequencingState();
      if (state.currentActivity) {
        // Test with extreme values
        expect(() => {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: true,
            satisfied: true,
            measure: 999999999 // Very large number
          });
        }).not.toThrow();
        
        expect(() => {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: true,
            satisfied: true,
            measure: -999999999 // Very negative number
          });
        }).not.toThrow();
        
        expect(() => {
          snService.updateActivityProgress(state.currentActivity.identifier, {
            completed: true,
            satisfied: true,
            measure: Number.POSITIVE_INFINITY
          });
        }).not.toThrow();
      }
    });
  });

  describe('Service State Management', () => {
    const validManifest = {
      organizations: {
        default: 'org1',
        organizations: [{
          identifier: 'org1',
          title: 'Test Course',
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

    test('should handle double initialization', async () => {
      const result1 = await snService.initialize(validManifest);
      expect(result1.success).toBe(true);
      
      const result2 = await snService.initialize(validManifest);
      // Should handle gracefully (either succeed or fail predictably)
      expect(result2).toBeDefined();
      expect(typeof result2.success).toBe('boolean');
    });

    test('should fail operations after termination', async () => {
      await snService.initialize(validManifest);
      const terminateResult = snService.terminateSequencing();
      expect(terminateResult.success).toBe(true);
      
      // Try operations after termination
      const navResult = await snService.processNavigation('start');
      expect(navResult.success).toBe(false);
      expect(navResult.reason).toContain('not active');
    });
  });
});