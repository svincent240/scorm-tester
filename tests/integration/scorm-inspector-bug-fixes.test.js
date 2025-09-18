/**
 * @jest-environment node
 *
 * SCORM Inspector Bug Fixes - Integration Tests
 *
 * Integration tests that verify bug fixes work correctly in real scenarios:
 * 1. Test full IPC communication flow with error handling
 * 2. Test data model updates under load
 * 3. Test localStorage persistence and cleanup
 * 4. Test memory management under stress
 * 5. Test error recovery and graceful degradation
 *
 * @fileoverview Integration tests for SCORM Inspector bug fixes
 */

const path = require('path');
const { EventEmitter } = require('events');
const { createLoggerSink, makeTempDir, rimraf, useFakeTimers } = require('../setup');

// Mock JSDOM environment for renderer-like testing
const { JSDOM } = require('jsdom');

describe('SCORM Inspector Bug Fixes - Integration Tests', () => {
  let dom;
  let window;
  let document;
  let ScormInspectorWindow;
  let tempDir;
  let mockElectronAPI;
  let fakeTimers;

  beforeAll(() => {
    // Create JSDOM environment
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head><title>SCORM Inspector Test</title></head>
        <body>
          <div id="api-timeline"></div>
          <div id="error-list"></div>
          <div id="data-model"></div>
          <button id="clear-history-btn">Clear History</button>
          <button id="refresh-btn">Refresh</button>
          <input id="data-filter" type="text" />
          <button id="clear-filter">Clear Filter</button>
          <button id="expand-all-data">Expand All</button>
          <button id="collapse-all-data">Collapse All</button>
          <button id="export-data">Export Data</button>

          <!-- Enhanced Inspector Elements -->
          <div id="activity-tree"></div>
          <div id="navigation-analysis"></div>
          <div id="global-objectives"></div>
          <div id="ssp-buckets"></div>
          <div id="enhanced-log"></div>

          <!-- Log Filters -->
          <input id="log-control" type="checkbox" checked />
          <input id="log-runtime" type="checkbox" checked />
          <input id="log-sequencing" type="checkbox" checked />
          <input id="log-pcode" type="checkbox" checked />
        </body>
      </html>
    `, {
      url: 'http://localhost',
      pretendToBeVisual: true,
      resources: 'usable'
    });

    window = dom.window;
    document = dom.window.document;
    global.window = window;
    global.document = document;
    global.localStorage = window.localStorage;

    // Mock additional globals
    global.URL = {
      createObjectURL: jest.fn(() => 'mock-blob-url'),
      revokeObjectURL: jest.fn()
    };

    global.Blob = class MockBlob {
      constructor(content, options) {
        this.content = content;
        this.options = options;
      }
    };

    // Mock navigator
    global.navigator = {
      clipboard: {
        writeText: jest.fn().mockResolvedValue()
      }
    };

    // Set up fake timers
    fakeTimers = useFakeTimers(jest);
  });

  beforeEach(() => {
    tempDir = makeTempDir('scorm-inspector-integration-');

    // Clear DOM state
    document.querySelectorAll('[id]').forEach(element => {
      element.innerHTML = '';
      element.value = '';
      if (element.type === 'checkbox') {
        element.checked = true;
      }
    });

    // Mock comprehensive electronAPI
    mockElectronAPI = {
      // Basic methods with realistic responses
      getScormInspectorHistory: jest.fn().mockResolvedValue({
        success: true,
        data: {
          history: [
            {
              method: 'Initialize',
              parameters: [''],
              result: 'true',
              timestamp: Date.now(),
              sessionId: 'test-session-1'
            },
            {
              method: 'GetValue',
              parameters: ['cmi.completion_status'],
              result: 'incomplete',
              timestamp: Date.now() + 1000,
              sessionId: 'test-session-1'
            }
          ],
          errors: [],
          dataModel: {
            coreData: {
              'cmi.completion_status': 'incomplete',
              'cmi.success_status': 'unknown'
            }
          }
        }
      }),

      // Event handlers
      onScormInspectorDataUpdated: jest.fn(),
      onScormInspectorErrorUpdated: jest.fn(),
      onScormDataModelUpdated: jest.fn(),
      onCourseLoaded: jest.fn(),
      onSessionStateChanged: jest.fn(),

      // Enhanced inspector methods
      getActivityTree: jest.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'root',
          title: 'Test Course',
          children: [
            {
              id: 'sco1',
              title: 'Introduction',
              type: 'sco',
              status: 'not attempted'
            }
          ]
        }
      }),

      getNavigationRequests: jest.fn().mockResolvedValue({
        success: true,
        data: [
          { type: 'continue', disabled: false },
          { type: 'previous', disabled: true }
        ]
      }),

      getGlobalObjectives: jest.fn().mockResolvedValue({
        success: true,
        data: [
          { id: 'obj1', status: 'not satisfied', score: 0 }
        ]
      }),

      getSSPBuckets: jest.fn().mockResolvedValue({
        success: true,
        data: [
          { id: 'bucket1', size: 1024, persistence: 'session' }
        ]
      })
    };

    window.electronAPI = mockElectronAPI;

    // Load ScormInspectorWindow class
    const inspectorCode = require('fs').readFileSync(
      path.resolve(__dirname, '../../scorm-inspector-window.js'),
      'utf8'
    );

    // Execute in JSDOM context
    const script = new window.Function(inspectorCode);
    script.call(window);

    ScormInspectorWindow = window.ScormInspectorWindow;
  });

  afterEach(() => {
    rimraf(tempDir);
    jest.clearAllMocks();
    fakeTimers.useReal();
    fakeTimers = useFakeTimers(jest);
  });

  afterAll(() => {
    if (dom) {
      dom.window.close();
    }
    fakeTimers.useReal();
  });

  describe('Full Integration Flow', () => {
    test('should handle complete initialization and data loading', async () => {
      const inspector = new ScormInspectorWindow();

      // Wait for initialization to complete
      await inspector.loadInitialHistory();

      expect(mockElectronAPI.getScormInspectorHistory).toHaveBeenCalled();
      expect(inspector.apiHistory.length).toBeGreaterThan(0);
      expect(inspector.dataModel).toBeDefined();
    });

    test('should handle real-time data updates during session', async () => {
      const inspector = new ScormInspectorWindow();

      // Set up event listeners
      let dataUpdateCallback;
      let dataModelUpdateCallback;

      mockElectronAPI.onScormInspectorDataUpdated.mockImplementation((callback) => {
        dataUpdateCallback = callback;
      });

      mockElectronAPI.onScormDataModelUpdated.mockImplementation((callback) => {
        dataModelUpdateCallback = callback;
      });

      await inspector.setupIpcEventListeners();

      // Simulate real-time updates
      if (dataUpdateCallback) {
        dataUpdateCallback({
          method: 'SetValue',
          parameters: ['cmi.completion_status', 'completed'],
          result: 'true',
          timestamp: Date.now(),
          sessionId: 'test-session-1'
        });
      }

      if (dataModelUpdateCallback) {
        dataModelUpdateCallback({
          coreData: {
            'cmi.completion_status': 'completed',
            'cmi.success_status': 'passed'
          }
        });
      }

      expect(inspector.apiHistory.length).toBeGreaterThan(0);
      expect(inspector.dataModel).toBeDefined();
    });
  });

  describe('Error Handling Under Load', () => {
    test('should handle rapid API call additions without performance degradation', async () => {
      const inspector = new ScormInspectorWindow();

      const startTime = Date.now();

      // Add 1000 API calls rapidly
      for (let i = 0; i < 1000; i++) {
        inspector.addApiCall({
          method: 'GetValue',
          parameters: [`cmi.interactions.${i}.id`],
          result: `interaction_${i}`,
          timestamp: Date.now(),
          sessionId: 'load-test'
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle 1000 calls in under 100ms
      expect(duration).toBeLessThan(100);
      expect(inspector.apiHistory.length).toBeLessThanOrEqual(1000);
    });

    test('should handle concurrent data model updates gracefully', async () => {
      const inspector = new ScormInspectorWindow();

      // Simulate concurrent updates from different sources
      const promises = [];

      for (let i = 0; i < 50; i++) {
        promises.push(new Promise(resolve => {
          setTimeout(() => {
            inspector.updateDataModel({
              coreData: {
                [`cmi.interactions.${i}.id`]: `interaction_${i}`,
                [`cmi.interactions.${i}.type`]: 'choice'
              }
            });
            resolve();
          }, Math.random() * 10);
        }));
      }

      await Promise.all(promises);

      // Advance timers to complete any pending updates
      fakeTimers.advance(200);

      expect(inspector.dataModel).toBeDefined();
      expect(inspector.isUpdatingDataModel).toBe(false);
    });

    test('should recover from IPC failures and continue operating', async () => {
      // Start with working API
      const inspector = new ScormInspectorWindow();
      await inspector.loadInitialHistory();

      expect(inspector.apiHistory.length).toBeGreaterThan(0);

      // Simulate IPC failure
      mockElectronAPI.getScormInspectorHistory.mockRejectedValue(new Error('IPC Failure'));

      // Should handle failure gracefully
      await inspector.refreshData();

      // Inspector should still be functional
      inspector.addApiCall({
        method: 'SetValue',
        parameters: ['cmi.exit', 'suspend'],
        result: 'true',
        timestamp: Date.now()
      });

      expect(inspector.apiHistory.length).toBeGreaterThan(0);
    });
  });

  describe('Memory Management Integration', () => {
    test('should maintain memory limits during extended operation', async () => {
      const inspector = new ScormInspectorWindow();

      // Simulate extended operation with many data updates
      for (let session = 0; session < 5; session++) {
        for (let i = 0; i < 500; i++) {
          inspector.addApiCall({
            method: 'GetValue',
            parameters: [`cmi.test.${session}.${i}`],
            result: `value_${i}`,
            timestamp: Date.now(),
            sessionId: `session_${session}`
          });

          inspector.addError({
            errorCode: '101',
            errorMessage: `Error in session ${session}, call ${i}`,
            timestamp: Date.now(),
            sessionId: `session_${session}`
          });
        }
      }

      // Should enforce memory limits
      expect(inspector.apiHistory.length).toBeLessThanOrEqual(2000);
      expect(inspector.scormErrors.length).toBeLessThanOrEqual(500);
    });

    test('should clean up resources completely on destruction', () => {
      const inspector = new ScormInspectorWindow();

      // Add significant data
      for (let i = 0; i < 100; i++) {
        inspector.addApiCall({
          method: 'test',
          result: 'test',
          timestamp: Date.now()
        });
      }

      inspector.dataModelHistory.set('test', 'data');
      inspector.pendingDataModel = { test: 'pending' };

      // Set up timeouts
      inspector.dataModelUpdateTimeout = setTimeout(() => {}, 1000);
      inspector.logRenderTimeout = setTimeout(() => {}, 1000);

      const timeoutsSpy = jest.spyOn(global, 'clearTimeout');

      inspector.destroy();

      // Verify cleanup
      expect(inspector.isDestroyed).toBe(true);
      expect(inspector.apiHistory).toBeNull();
      expect(inspector.scormErrors).toBeNull();
      expect(inspector.dataModel).toBeNull();
      expect(inspector.dataModelHistory).toBeNull();
      expect(inspector.pendingDataModel).toBeNull();
      expect(timeoutsSpy).toHaveBeenCalled();
    });
  });

  describe('localStorage Integration', () => {
    test('should handle localStorage persistence across sessions', () => {
      const inspector1 = new ScormInspectorWindow();

      // Set some UI state
      inspector1.setCategoryCollapsedState('Core Tracking', true);
      inspector1.setActivityNodeCollapsedState('sco1', false);

      // Create new instance (simulating app restart)
      const inspector2 = new ScormInspectorWindow();

      // Should remember state
      expect(inspector2.getCategoryCollapsedState('Core Tracking')).toBe(true);
      expect(inspector2.getActivityNodeCollapsedState('sco1')).toBe(false);
    });

    test('should handle localStorage corruption gracefully', () => {
      const inspector = new ScormInspectorWindow();

      // Mock localStorage to return invalid data
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = jest.fn((key) => {
        if (key.startsWith('scorm-inspector-')) {
          return 'invalid-json-data';
        }
        return originalGetItem.call(localStorage, key);
      });

      // Should handle corrupt data without crashing
      expect(() => {
        inspector.getCategoryCollapsedState('test');
      }).not.toThrow();

      // Restore
      localStorage.getItem = originalGetItem;
    });
  });

  describe('Enhanced Inspector Integration', () => {
    test('should load all enhanced inspector components', async () => {
      const inspector = new ScormInspectorWindow();

      await inspector.loadEnhancedInspectorData();

      expect(mockElectronAPI.getActivityTree).toHaveBeenCalled();
      expect(mockElectronAPI.getNavigationRequests).toHaveBeenCalled();
      expect(mockElectronAPI.getGlobalObjectives).toHaveBeenCalled();
      expect(mockElectronAPI.getSSPBuckets).toHaveBeenCalled();
    });

    test('should handle enhanced inspector API failures', async () => {
      // Mock failures
      mockElectronAPI.getActivityTree.mockRejectedValue(new Error('API Failed'));
      mockElectronAPI.getNavigationRequests.mockRejectedValue(new Error('API Failed'));

      const inspector = new ScormInspectorWindow();

      // Should handle failures gracefully
      await inspector.loadEnhancedInspectorData();

      // Inspector should still be functional
      expect(inspector.isDestroyed).toBe(false);
    });

    test('should handle log filtering and export correctly', () => {
      const inspector = new ScormInspectorWindow();

      // Add test log entries
      const logEntries = [
        { id: '1', category: 'control', message: 'Control message' },
        { id: '2', category: 'runtime', message: 'Runtime message' },
        { id: '3', category: 'sequencing', message: 'Sequencing message' }
      ];

      logEntries.forEach(entry => {
        inspector.addEnhancedLogEntry(entry);
      });

      // Test filtering
      document.getElementById('log-control').checked = false;
      const filtered = inspector.getFilteredLogEntries();

      expect(filtered.some(entry => entry.category === 'control')).toBe(false);
      expect(filtered.some(entry => entry.category === 'runtime')).toBe(true);

      // Test export
      expect(() => {
        inspector.exportEnhancedLog();
      }).not.toThrow();
    });
  });

  describe('Performance Under Stress', () => {
    test('should maintain responsiveness under high data volume', async () => {
      const inspector = new ScormInspectorWindow();

      // Simulate high-volume SCORM session
      const startTime = Date.now();

      // Add large number of interactions
      for (let i = 0; i < 100; i++) {
        inspector.updateDataModel({
          interactions: Array(50).fill().map((_, idx) => ({
            id: `interaction_${i}_${idx}`,
            type: 'choice',
            student_response: `answer_${idx}`,
            result: 'correct',
            timestamp: new Date().toISOString()
          }))
        });
      }

      const processingTime = Date.now() - startTime;

      // Should process large data set in reasonable time
      expect(processingTime).toBeLessThan(500);
      expect(inspector.dataModel).toBeDefined();
    });

    test('should handle rapid UI updates without blocking', async () => {
      const inspector = new ScormInspectorWindow();

      // Mock DOM elements
      inspector.apiTimelineElement = { innerHTML: '' };
      inspector.dataModelElement = { innerHTML: '' };
      inspector.enhancedLogElement = { innerHTML: '' };

      const renderSpy = jest.spyOn(inspector, 'renderApiTimeline');

      // Rapid updates
      for (let i = 0; i < 50; i++) {
        inspector.addApiCall({
          method: 'GetValue',
          parameters: [`cmi.test.${i}`],
          result: `value${i}`,
          timestamp: Date.now()
        });

        inspector.addEnhancedLogEntry({
          id: `log${i}`,
          message: `Log ${i}`,
          timestamp: Date.now()
        });
      }

      // Should not block UI with excessive renders
      expect(renderSpy).toHaveBeenCalled();

      // Advance timers to complete throttled operations
      fakeTimers.advance(200);

      expect(inspector.apiHistory.length).toBe(50);
    });
  });

  describe('Error Recovery Scenarios', () => {
    test('should recover from DOM manipulation errors', () => {
      const inspector = new ScormInspectorWindow();

      // Mock element to throw errors
      inspector.dataModelElement = {
        get innerHTML() { throw new Error('DOM Error'); },
        set innerHTML(value) { throw new Error('DOM Error'); },
        querySelector: () => null,
        querySelectorAll: () => []
      };

      // Should handle DOM errors gracefully
      expect(() => {
        inspector.renderDataModel();
      }).not.toThrow();
    });

    test('should handle circular reference in complex data structures', () => {
      const inspector = new ScormInspectorWindow();

      // Create complex circular structure
      const rootObj = { type: 'root', children: [] };
      const childObj = { type: 'child', parent: rootObj };
      const grandChildObj = { type: 'grandchild', parent: childObj, root: rootObj };

      rootObj.children.push(childObj);
      childObj.children = [grandChildObj];
      grandChildObj.selfRef = grandChildObj;

      // Should handle without infinite loops
      expect(() => {
        inspector.updateDataModel({
          complexStructure: rootObj
        });
      }).not.toThrow();
    });
  });
});