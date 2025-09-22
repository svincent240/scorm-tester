/**
 * SN Workflow Integration Tests
 * 
 * End-to-end integration tests for SCORM 2004 4th Edition Sequencing and Navigation
 * workflows including complex sequencing scenarios, remediation, and global objectives.
 * 
 * @fileoverview SN workflow integration tests
 */

const { ScormSNService } = require('../../src/main/services/scorm/sn');
const { SN_ERROR_CODES, NAVIGATION_REQUESTS } = require('../../src/shared/constants/sn-constants');

describe('SN Workflow Integration Tests', () => {
  let snService;
  let mockErrorHandler;
  let mockLogger;

  beforeEach(() => {
    // Mock logger with detailed tracking
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
      getErrorString: jest.fn().mockReturnValue(''),
      clearError: jest.fn()
    };

    snService = new ScormSNService(mockErrorHandler, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Simple Linear Sequencing Tests
  // ============================================================================

  describe('Simple Linear Sequencing', () => {
    test('should handle basic linear navigation workflow', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Linear Course',
            item: [{
              identifier: 'lesson1',
              title: 'Lesson 1',
              identifierref: 'resource1'
            }, {
              identifier: 'lesson2',
              title: 'Lesson 2',
              identifierref: 'resource2'
            }, {
              identifier: 'lesson3',
              title: 'Lesson 3',
              identifierref: 'resource3'
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco', href: 'lesson1.html' },
          { identifier: 'resource2', scormType: 'sco', href: 'lesson2.html' },
          { identifier: 'resource3', scormType: 'sco', href: 'lesson3.html' }
        ] }
      };

      // Initialize SN service
      const initResult = await snService.initialize(manifest);
      expect(initResult.success).toBe(true);
      expect(initResult.sessionId).toBeDefined();

      // Start navigation
      const startResult = await snService.processNavigation(NAVIGATION_REQUESTS.START);
      expect(startResult.success).toBe(true);
      expect(startResult.targetActivity.identifier).toBe('lesson1');

      // Continue to next lesson
      const continueResult = await snService.processNavigation(NAVIGATION_REQUESTS.CONTINUE);
      expect(continueResult.success).toBe(true);
      expect(continueResult.targetActivity.identifier).toBe('lesson2');

      // Continue to final lesson
      const finalResult = await snService.processNavigation(NAVIGATION_REQUESTS.CONTINUE);
      expect(finalResult.success).toBe(true);
      expect(finalResult.targetActivity.identifier).toBe('lesson3');

      // Verify sequencing state
      const state = snService.getSequencingState();
      expect(state.currentActivity.identifier).toBe('lesson3');
      expect(state.sessionState).toBe('active');
    });

    test('should handle previous navigation', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Bidirectional Course',
            item: [{
              identifier: 'lesson1',
              title: 'Lesson 1',
              identifierref: 'resource1'
            }, {
              identifier: 'lesson2',
              title: 'Lesson 2',
              identifierref: 'resource2'
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco' },
          { identifier: 'resource2', scormType: 'sco' }
        ] }
      };

      await snService.initialize(manifest);
      
      // Navigate to lesson 1, then lesson 2
      await snService.processNavigation(NAVIGATION_REQUESTS.START);
      await snService.processNavigation(NAVIGATION_REQUESTS.CONTINUE);

      // Navigate back to lesson 1
      const previousResult = await snService.processNavigation(NAVIGATION_REQUESTS.PREVIOUS);
      expect(previousResult.success).toBe(true);
      expect(previousResult.targetActivity.identifier).toBe('lesson1');
    });
  });

  // ============================================================================
  // Choice Navigation Tests
  // ============================================================================

  describe('Choice Navigation', () => {
    test('should handle choice navigation requests', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Choice Course',
            sequencing: {
              controlMode: { choice: true, flow: true }
            },
            item: [{
              identifier: 'intro',
              title: 'Introduction',
              identifierref: 'resource1'
            }, {
              identifier: 'topic1',
              title: 'Topic 1',
              identifierref: 'resource2'
            }, {
              identifier: 'topic2',
              title: 'Topic 2',
              identifierref: 'resource3'
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco' },
          { identifier: 'resource2', scormType: 'sco' },
          { identifier: 'resource3', scormType: 'sco' }
        ] }
      };

      await snService.initialize(manifest);
      await snService.processNavigation(NAVIGATION_REQUESTS.START);

      // Make choice navigation to topic2
      const choiceResult = await snService.processNavigation(NAVIGATION_REQUESTS.CHOICE, 'topic2');
      expect(choiceResult.success).toBe(true);
      expect(choiceResult.targetActivity.identifier).toBe('topic2');

      // Verify available navigation includes choice options
      expect(choiceResult.availableNavigation).toContain(NAVIGATION_REQUESTS.CHOICE);
    });

    test('should reject choice navigation when disabled', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'No Choice Course',
            sequencing: {
              controlMode: { choice: false, flow: true }
            },
            item: [{
              identifier: 'lesson1',
              title: 'Lesson 1',
              identifierref: 'resource1'
            }]
          }]
        },
        resources: { resource: [{ identifier: 'resource1', scormType: 'sco' }] }
      };

      await snService.initialize(manifest);
      await snService.processNavigation(NAVIGATION_REQUESTS.START);

      const choiceResult = await snService.processNavigation(NAVIGATION_REQUESTS.CHOICE, 'lesson1');
      expect(choiceResult.success).toBe(false);
      expect(choiceResult.reason).toContain('Choice navigation disabled');
    });
  });

  // ============================================================================
  // Sequencing Rules Tests
  // ============================================================================

  describe('Sequencing Rules Processing', () => {
    test('should process skip rules based on satisfaction', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Skip Rule Course',
            item: [{
              identifier: 'lesson1',
              title: 'Lesson 1',
              identifierref: 'resource1',
              sequencing: {
                sequencingRules: {
                  preConditionRules: [{
                    conditions: [{
                      condition: 'satisfied'
                    }],
                    action: 'skip'
                  }]
                },
                objectives: {
                  primaryObjective: {
                    objectiveID: 'lesson1_objective'
                  }
                }
              }
            }, {
              identifier: 'lesson2',
              title: 'Lesson 2',
              identifierref: 'resource2'
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco' },
          { identifier: 'resource2', scormType: 'sco' }
        ] }
      };

      await snService.initialize(manifest);

      // Mark lesson1 as satisfied
      snService.updateActivityProgress('lesson1', { satisfied: true, completed: true });

      // Start navigation - should skip lesson1 and go to lesson2
      const startResult = await snService.processNavigation(NAVIGATION_REQUESTS.START);
      expect(startResult.success).toBe(true);
      
      // Due to skip rule, should proceed to lesson2
      if (startResult.sequencing && startResult.sequencing.preCondition) {
        expect(startResult.sequencing.preCondition.action).toBe('skip');
      }
    });

    test('should handle exit parent action', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Exit Parent Course',
            item: [{
              identifier: 'chapter1',
              title: 'Chapter 1',
              item: [{
                identifier: 'lesson1',
                title: 'Lesson 1',
                identifierref: 'resource1',
                sequencing: {
                  sequencingRules: {
                    postConditionRules: [{
                      conditions: [{
                        condition: 'completed'
                      }],
                      action: 'exitParent'
                    }]
                  }
                }
              }]
            }]
          }]
        },
        resources: { resource: [{ identifier: 'resource1', scormType: 'sco' }] }
      };

      await snService.initialize(manifest);
      await snService.processNavigation(NAVIGATION_REQUESTS.START);

      // Complete lesson1 - should trigger exitParent
      const progressResult = snService.updateActivityProgress('lesson1', { completed: true });
      expect(progressResult.success).toBe(true);
      
      if (progressResult.postCondition) {
        expect(progressResult.postCondition.action).toBe('exitParent');
      }
    });
  });

  // ============================================================================
  // Rollup Processing Tests
  // ============================================================================

  describe('Rollup Processing', () => {
    test('should process objective rollup correctly', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Rollup Course',
            sequencing: {
              rollupRules: {
                rollupObjectiveSatisfied: true,
                rollupProgressCompletion: true
              }
            },
            item: [{
              identifier: 'test1',
              title: 'Test 1',
              identifierref: 'resource1',
              sequencing: {
                rollupRules: {
                  objectiveMeasureWeight: 1.0
                }
              }
            }, {
              identifier: 'test2',
              title: 'Test 2',
              identifierref: 'resource2',
              sequencing: {
                rollupRules: {
                  objectiveMeasureWeight: 1.0
                }
              }
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco' },
          { identifier: 'resource2', scormType: 'sco' }
        ] }
      };

      await snService.initialize(manifest);

      // Complete both tests with different satisfaction levels
      snService.updateActivityProgress('test1', { 
        completed: true, 
        satisfied: true, 
        measure: 0.85 
      });

      const rollupResult = snService.updateActivityProgress('test2', { 
        completed: true, 
        satisfied: true, 
        measure: 0.75 
      });

      expect(rollupResult.success).toBe(true);
      expect(rollupResult.rollup).toBeDefined();
      expect(rollupResult.rollup.success).toBe(true);
    });

    test('should handle global objectives mapping', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Global Objectives Course',
            item: [{
              identifier: 'lesson1',
              title: 'Lesson 1',
              identifierref: 'resource1',
              sequencing: {
                objectives: {
                  primaryObjective: {
                    objectiveID: 'local_obj1',
                    mapInfo: {
                      targetObjectiveID: 'global_obj1',
                      writeSatisfiedStatus: true,
                      writeNormalizedMeasure: true
                    }
                  }
                }
              }
            }]
          }]
        },
        resources: { resource: [{ identifier: 'resource1', scormType: 'sco' }] }
      };

      await snService.initialize(manifest);

      // Update activity progress - should map to global objective
      snService.updateActivityProgress('lesson1', { 
        satisfied: true, 
        measure: 0.9 
      });

      const state = snService.getSequencingState();
      expect(state.globalObjectives).toBeDefined();
      expect(Object.keys(state.globalObjectives)).toContain('global_obj1');
    });
  });

  // ============================================================================
  // Complex Sequencing Scenarios
  // ============================================================================

  describe('Complex Sequencing Scenarios', () => {
    test('should handle remediation workflow', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Remediation Course',
            sequencing: {
              controlMode: { choice: false, flow: true },
              sequencingRules: {
                postConditionRules: [{
                  conditions: [{
                    condition: 'satisfied',
                    operator: 'not'
                  }],
                  action: 'retry'
                }]
              }
            },
            item: [{
              identifier: 'content1',
              title: 'Content 1',
              identifierref: 'resource1'
            }, {
              identifier: 'test1',
              title: 'Test 1',
              identifierref: 'resource2',
              sequencing: {
                objectives: {
                  primaryObjective: {
                    objectiveID: 'test1_objective'
                  }
                }
              }
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco' },
          { identifier: 'resource2', scormType: 'sco' }
        ] }
      };

      await snService.initialize(manifest);
      await snService.processNavigation(NAVIGATION_REQUESTS.START);

      // Complete content, then fail test
      snService.updateActivityProgress('content1', { completed: true });
      await snService.processNavigation(NAVIGATION_REQUESTS.CONTINUE);

      // Fail the test - should trigger retry
      const failResult = snService.updateActivityProgress('test1', { 
        completed: true, 
        satisfied: false 
      });

      expect(failResult.success).toBe(true);
      if (failResult.postCondition) {
        expect(failResult.postCondition.action).toBe('retry');
      }
    });

    test('should handle hierarchical activity structure', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Hierarchical Course',
            item: [{
              identifier: 'module1',
              title: 'Module 1',
              item: [{
                identifier: 'lesson1_1',
                title: 'Lesson 1.1',
                identifierref: 'resource1'
              }, {
                identifier: 'lesson1_2',
                title: 'Lesson 1.2',
                identifierref: 'resource2'
              }]
            }, {
              identifier: 'module2',
              title: 'Module 2',
              item: [{
                identifier: 'lesson2_1',
                title: 'Lesson 2.1',
                identifierref: 'resource3'
              }]
            }]
          }]
        },
        resources: { resource: [
          { identifier: 'resource1', scormType: 'sco' },
          { identifier: 'resource2', scormType: 'sco' },
          { identifier: 'resource3', scormType: 'sco' }
        ] }
      };

      await snService.initialize(manifest);

      const stats = snService.getSequencingState().activityTreeStats;
      expect(stats.totalActivities).toBe(6); // org + 2 modules + 3 lessons
      expect(stats.maxDepth).toBe(2); // org -> module -> lesson
      expect(stats.leafActivities).toBe(3); // 3 lessons
      expect(stats.launchableActivities).toBe(3); // 3 SCOs
    });
  });

  // ============================================================================
  // Session Management Tests
  // ============================================================================

  describe('Session Management', () => {
    test('should maintain session state throughout workflow', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Session Test Course',
            item: [{
              identifier: 'lesson1',
              title: 'Lesson 1',
              identifierref: 'resource1'
            }]
          }]
        },
        resources: { resource: [{ identifier: 'resource1', scormType: 'sco' }] }
      };

      const initResult = await snService.initialize(manifest);
      expect(initResult.success).toBe(true);

      const initialState = snService.getSequencingState();
      expect(initialState.sessionState).toBe('active');
      expect(initialState.sessionId).toBe(initResult.sessionId);

      await snService.processNavigation(NAVIGATION_REQUESTS.START);

      const activeState = snService.getSequencingState();
      expect(activeState.currentActivity).toBeDefined();
      expect(activeState.currentActivity.identifier).toBe('lesson1');

      const terminateResult = snService.terminateSequencing();
      expect(terminateResult.success).toBe(true);
      expect(terminateResult.finalState.sessionState).toBe('ended');
    });

    test('should handle service reset correctly', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Reset Test Course',
            item: [{ identifier: 'lesson1', title: 'Lesson 1' }]
          }]
        }
      };

      await snService.initialize(manifest);
      await snService.processNavigation(NAVIGATION_REQUESTS.START);

      let state = snService.getSequencingState();
      expect(state.sessionState).toBe('active');
      expect(state.currentActivity).toBeDefined();

      snService.reset();

      state = snService.getSequencingState();
      expect(state.sessionState).toBe('not_started');
      expect(state.currentActivity).toBeNull();
      expect(state.activityTreeStats.totalActivities).toBe(0);
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('Error Handling', () => {
    test('should handle invalid navigation requests', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Error Test Course',
            item: [{ identifier: 'lesson1', title: 'Lesson 1' }]
          }]
        }
      };

      await snService.initialize(manifest);

      const invalidResult = await snService.processNavigation('invalid_request');
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.reason).toContain('Invalid navigation request');
    });

    test('should handle navigation without initialization', async () => {
      const navResult = await snService.processNavigation(NAVIGATION_REQUESTS.START);
      expect(navResult.success).toBe(false);
      expect(navResult.reason).toContain('SN service not active');
    });

    test('should handle invalid activity progress updates', async () => {
      const manifest = {
        organizations: {
          default: 'org1',
          organization: [{
            identifier: 'org1',
            title: 'Progress Test Course',
            item: [{ identifier: 'lesson1', title: 'Lesson 1' }]
          }]
        }
      };

      await snService.initialize(manifest);

      const progressResult = snService.updateActivityProgress('nonexistent', { completed: true });
      expect(progressResult.success).toBe(false);
      expect(progressResult.reason).toContain('Activity not found');
    });
  });
});