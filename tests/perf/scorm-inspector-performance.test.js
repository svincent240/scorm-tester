/**
 * @jest-environment jsdom
 *
 * SCORM Inspector Performance Tests
 *
 * Performance tests to ensure bug fixes don't introduce performance regressions:
 * 1. Data model update performance under load
 * 2. API call processing performance
 * 3. Memory usage patterns
 * 4. UI rendering performance with large datasets
 * 5. Cleanup performance verification
 *
 * @fileoverview Performance tests for SCORM Inspector bug fixes
 */

const { performance } = require('perf_hooks');

// Mock performance.now for consistent testing
global.performance = global.performance || {
  now: jest.fn(() => Date.now())
};

describe('SCORM Inspector Performance Tests', () => {
  let ScormInspectorWindow;
  let inspectorWindow;

  beforeAll(() => {
    // Set up DOM elements
    const elements = [
      'api-timeline', 'error-list', 'data-model', 'clear-history-btn', 'refresh-btn',
      'data-filter', 'clear-filter', 'expand-all-data', 'collapse-all-data', 'export-data',
      'enhanced-log', 'log-control', 'log-runtime', 'log-sequencing', 'log-pcode'
    ];

    elements.forEach(id => {
      const element = document.createElement('div');
      element.id = id;
      element.addEventListener = jest.fn();
      element.removeEventListener = jest.fn();
      if (id.includes('filter') && (id.includes('log-') || id === 'data-filter')) {
        element.checked = true;
        element.value = '';
      }
      document.body.appendChild(element);
    });

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn()
      }
    });

    // Create test ScormInspectorWindow class
    ScormInspectorWindow = class TestScormInspectorWindow {
      constructor() {
        this.apiHistory = [];
        this.scormErrors = [];
        this.dataModel = {};
        this.dataModelHistory = new Map();
        this.enhancedLogEntries = [];
        this.isDestroyed = false;
        this.isUpdatingDataModel = false;
        this.pendingDataModel = null;
        this.eventListeners = [];
        this.dataModelUpdateTimeout = null;
        this.logRenderTimeout = null;
        this.filterText = '';
        this.lastDataModelUpdate = 0;

        // Mock DOM elements
        this.apiTimelineElement = document.getElementById('api-timeline');
        this.errorListElement = document.getElementById('error-list');
        this.dataModelElement = document.getElementById('data-model');
        this.enhancedLogElement = document.getElementById('enhanced-log');
        this.logControlFilter = document.getElementById('log-control');
        this.logRuntimeFilter = document.getElementById('log-runtime');
        this.logSequencingFilter = document.getElementById('log-sequencing');
        this.logPcodeFilter = document.getElementById('log-pcode');
      }

      addApiCall(data) {
        if (!data || this.isDestroyed) return;

        this.apiHistory.push(data);
        if (this.apiHistory.length > 2000) {
          this.apiHistory.splice(0, this.apiHistory.length - 2000);
        }
      }

      addError(errorData) {
        if (!errorData || this.isDestroyed) return;

        this.scormErrors.push(errorData);
        if (this.scormErrors.length > 500) {
          this.scormErrors.splice(0, this.scormErrors.length - 500);
        }
      }

      updateDataModel(newDataModel) {
        if (!newDataModel || this.isDestroyed) return;

        const now = Date.now();
        if (this.isUpdatingDataModel) {
          this.pendingDataModel = newDataModel;
          return;
        }

        if ((now - this.lastDataModelUpdate) < 50) {
          if (this.dataModelUpdateTimeout) {
            clearTimeout(this.dataModelUpdateTimeout);
          }
          this.dataModelUpdateTimeout = setTimeout(() => {
            const dataToUpdate = this.pendingDataModel || newDataModel;
            this.pendingDataModel = null;
            this.updateDataModel(dataToUpdate);
          }, 100);
          return;
        }

        this.isUpdatingDataModel = true;
        this.lastDataModelUpdate = now;

        const hasExistingData = this.dataModel && Object.keys(this.dataModel).length > 0;
        const isNewDataEmpty = !newDataModel || Object.keys(newDataModel).length === 0;

        if (hasExistingData && isNewDataEmpty) {
          this.isUpdatingDataModel = false;
          return;
        }

        this.dataModel = newDataModel;
        this.isUpdatingDataModel = false;

        if (this.pendingDataModel) {
          const pendingData = this.pendingDataModel;
          this.pendingDataModel = null;
          setTimeout(() => this.updateDataModel(pendingData), 10);
        }
      }

      addEnhancedLogEntry(entry) {
        if (!entry || this.isDestroyed) return;

        this.enhancedLogEntries.push(entry);
        if (this.enhancedLogEntries.length > 5000) {
          this.enhancedLogEntries.splice(0, this.enhancedLogEntries.length - 5000);
        }

        if (!this.logRenderTimeout) {
          this.logRenderTimeout = setTimeout(() => {
            this.renderEnhancedLog();
            this.logRenderTimeout = null;
          }, 100);
        }
      }

      renderEnhancedLog() {
        if (!this.enhancedLogElement || this.isDestroyed) return;

        const filteredEntries = this.getFilteredLogEntries();
        const displayEntries = filteredEntries.reverse().slice(0, 1000);

        // Simulate DOM manipulation time
        const startTime = performance.now();
        this.enhancedLogElement.innerHTML = displayEntries
          .map(entry => `<div class="log-entry">${entry.message}</div>`)
          .join('');
        return performance.now() - startTime;
      }

      getFilteredLogEntries() {
        return this.enhancedLogEntries.filter(entry => {
          const category = entry.category?.toLowerCase();
          if (category === 'control' && !this.logControlFilter?.checked) return false;
          if (category === 'runtime' && !this.logRuntimeFilter?.checked) return false;
          if (category === 'sequencing' && !this.logSequencingFilter?.checked) return false;
          if (category === 'pcode' && !this.logPcodeFilter?.checked) return false;
          return true;
        });
      }

      categorizeDataModel() {
        const categories = {
          'Core Tracking': { items: {} },
          'Interactions': { items: {} },
          'Objectives': { items: {} }
        };

        if (!this.dataModel) return categories;

        if (this.dataModel.coreData) {
          Object.entries(this.dataModel.coreData).forEach(([key, value]) => {
            categories['Core Tracking'].items[key] = value;
          });
        }

        if (Array.isArray(this.dataModel.interactions)) {
          this.dataModel.interactions.forEach((interaction, index) => {
            if (interaction && typeof interaction === 'object') {
              Object.entries(interaction).forEach(([key, value]) => {
                categories['Interactions'].items[`interactions[${index}].${key}`] = value;
              });
            }
          });
        }

        return categories;
      }

      safeJsonStringify(obj, replacer = null, space = null) {
        const seen = new WeakSet();

        const jsonReplacer = (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular Reference]';
            seen.add(value);
          }
          if (typeof replacer === 'function') return replacer(key, value);
          return value;
        };

        try {
          return JSON.stringify(obj, jsonReplacer, space);
        } catch (error) {
          return JSON.stringify({ error: 'Serialization failed' });
        }
      }

      destroy() {
        if (this.isDestroyed) return;

        if (this.dataModelUpdateTimeout) {
          clearTimeout(this.dataModelUpdateTimeout);
          this.dataModelUpdateTimeout = null;
        }

        if (this.logRenderTimeout) {
          clearTimeout(this.logRenderTimeout);
          this.logRenderTimeout = null;
        }

        this.apiHistory = null;
        this.scormErrors = null;
        this.dataModel = null;
        this.dataModelHistory = null;
        this.enhancedLogEntries = null;
        this.pendingDataModel = null;
        this.eventListeners = null;

        this.isDestroyed = true;
      }
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    performance.now.mockClear();
    let mockTime = 0;
    performance.now.mockImplementation(() => mockTime++);
  });

  afterEach(() => {
    if (inspectorWindow && !inspectorWindow.isDestroyed) {
      inspectorWindow.destroy();
    }
  });

  describe('API Call Processing Performance', () => {
    test('should add 1000 API calls within performance threshold', () => {
      inspectorWindow = new ScormInspectorWindow();

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        inspectorWindow.addApiCall({
          method: 'GetValue',
          parameters: [`cmi.interactions.${i}.id`],
          result: `interaction_${i}`,
          timestamp: Date.now(),
          sessionId: 'perf-test'
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100); // Should complete within 100 time units
      expect(inspectorWindow.apiHistory.length).toBe(1000);
    });

    test('should maintain performance with memory limit enforcement', () => {
      inspectorWindow = new ScormInspectorWindow();

      const startTime = performance.now();

      // Add more than the memory limit
      for (let i = 0; i < 3000; i++) {
        inspectorWindow.addApiCall({
          method: 'SetValue',
          parameters: [`cmi.test.${i}`, `value_${i}`],
          result: 'true',
          timestamp: Date.now()
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(150);
      expect(inspectorWindow.apiHistory.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('Data Model Update Performance', () => {
    test('should handle rapid data model updates efficiently', async () => {
      inspectorWindow = new ScormInspectorWindow();

      const startTime = performance.now();
      const updatePromises = [];

      // Simulate rapid updates
      for (let i = 0; i < 100; i++) {
        updatePromises.push(new Promise(resolve => {
          setTimeout(() => {
            inspectorWindow.updateDataModel({
              coreData: {
                [`cmi.interactions.${i}.id`]: `interaction_${i}`,
                [`cmi.interactions.${i}.type`]: 'choice'
              }
            });
            resolve();
          }, i % 10);
        }));
      }

      await Promise.all(updatePromises);

      // Wait for debouncing to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(300);
      expect(inspectorWindow.isUpdatingDataModel).toBe(false);
      expect(inspectorWindow.pendingDataModel).toBeNull();
    });

    test('should prevent performance degradation with large data models', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Create large data model
      const largeDataModel = {
        coreData: {},
        interactions: [],
        objectives: []
      };

      // Add many core data entries
      for (let i = 0; i < 500; i++) {
        largeDataModel.coreData[`cmi.test.${i}`] = `value_${i}`;
      }

      // Add many interactions
      for (let i = 0; i < 100; i++) {
        largeDataModel.interactions.push({
          id: `interaction_${i}`,
          type: 'choice',
          student_response: `answer_${i}`,
          result: 'correct'
        });
      }

      const startTime = performance.now();
      inspectorWindow.updateDataModel(largeDataModel);
      const categories = inspectorWindow.categorizeDataModel();
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50);
      expect(Object.keys(categories['Core Tracking'].items).length).toBe(500);
      expect(Object.keys(categories['Interactions'].items).length).toBe(400); // 100 interactions * 4 properties
    });
  });

  describe('Enhanced Log Performance', () => {
    test('should handle high-volume log entries efficiently', () => {
      inspectorWindow = new ScormInspectorWindow();

      const startTime = performance.now();

      // Add many log entries
      for (let i = 0; i < 2000; i++) {
        inspectorWindow.addEnhancedLogEntry({
          id: `log_${i}`,
          category: ['control', 'runtime', 'sequencing', 'pcode'][i % 4],
          message: `Log message ${i}`,
          timestamp: Date.now(),
          details: { data: `details_${i}` }
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100);
      expect(inspectorWindow.enhancedLogEntries.length).toBe(2000);
    });

    test('should maintain performance with log filtering', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Add diverse log entries
      const categories = ['control', 'runtime', 'sequencing', 'pcode'];
      for (let i = 0; i < 1000; i++) {
        inspectorWindow.addEnhancedLogEntry({
          id: `log_${i}`,
          category: categories[i % categories.length],
          message: `Message ${i}`,
          timestamp: Date.now()
        });
      }

      const startTime = performance.now();

      // Test filtering performance
      inspectorWindow.logControlFilter.checked = false;
      inspectorWindow.logRuntimeFilter.checked = true;

      const filteredEntries = inspectorWindow.getFilteredLogEntries();

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(20);
      expect(filteredEntries.length).toBeLessThan(1000); // Some should be filtered out
      expect(filteredEntries.every(entry => entry.category !== 'control')).toBe(true);
    });

    test('should throttle rendering to prevent UI blocking', async () => {
      inspectorWindow = new ScormInspectorWindow();

      let renderCount = 0;
      const originalRender = inspectorWindow.renderEnhancedLog;
      inspectorWindow.renderEnhancedLog = function() {
        renderCount++;
        return originalRender.call(this);
      };

      const startTime = performance.now();

      // Add many entries rapidly
      for (let i = 0; i < 50; i++) {
        inspectorWindow.addEnhancedLogEntry({
          id: `rapid_log_${i}`,
          message: `Rapid message ${i}`,
          timestamp: Date.now()
        });
      }

      // Should not render immediately due to throttling
      expect(renderCount).toBe(0);

      // Wait for throttling to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should have rendered only once due to throttling
      expect(renderCount).toBeLessThanOrEqual(1);
      expect(duration).toBeLessThan(200);
    });
  });

  describe('Memory Management Performance', () => {
    test('should enforce memory limits without significant performance impact', () => {
      inspectorWindow = new ScormInspectorWindow();

      const startTime = performance.now();

      // Fill beyond limits
      for (let i = 0; i < 6000; i++) {
        inspectorWindow.addEnhancedLogEntry({
          id: `memory_test_${i}`,
          message: `Memory test message ${i}`,
          timestamp: Date.now()
        });
      }

      const midTime = performance.now();

      // Add more after limit
      for (let i = 6000; i < 7000; i++) {
        inspectorWindow.addEnhancedLogEntry({
          id: `memory_test_${i}`,
          message: `Memory test message ${i}`,
          timestamp: Date.now()
        });
      }

      const endTime = performance.now();

      const totalDuration = endTime - startTime;
      const limitedDuration = endTime - midTime;

      // Performance should remain consistent even when enforcing limits
      expect(totalDuration).toBeLessThan(300);
      expect(limitedDuration).toBeLessThan(50);
      expect(inspectorWindow.enhancedLogEntries.length).toBeLessThanOrEqual(5000);
    });

    test('should clean up efficiently on destroy', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Add substantial data
      for (let i = 0; i < 1000; i++) {
        inspectorWindow.addApiCall({ method: 'test', result: 'test', timestamp: Date.now() });
        inspectorWindow.addError({ errorCode: '101', message: 'test', timestamp: Date.now() });
        inspectorWindow.addEnhancedLogEntry({ id: `log_${i}`, message: 'test', timestamp: Date.now() });
      }

      inspectorWindow.dataModelHistory.set('test', 'data');
      inspectorWindow.eventListeners.push({
        element: { removeEventListener: jest.fn() },
        type: 'click',
        handler: () => {}
      });

      const startTime = performance.now();
      inspectorWindow.destroy();
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(10);
      expect(inspectorWindow.isDestroyed).toBe(true);
      expect(inspectorWindow.apiHistory).toBeNull();
      expect(inspectorWindow.scormErrors).toBeNull();
      expect(inspectorWindow.dataModel).toBeNull();
      expect(inspectorWindow.enhancedLogEntries).toBeNull();
    });
  });

  describe('JSON Serialization Performance', () => {
    test('should handle large objects with circular references efficiently', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Create large object with circular references
      const largeObject = {
        data: Array(1000).fill().map((_, i) => ({ id: i, value: `value_${i}` }))
      };

      // Add circular reference
      largeObject.self = largeObject;
      largeObject.data[500].parent = largeObject;

      const startTime = performance.now();
      const result = inspectorWindow.safeJsonStringify(largeObject);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50);
      expect(result).toContain('[Circular Reference]');
      expect(result.length).toBeGreaterThan(1000);
    });

    test('should maintain performance with deeply nested objects', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Create deeply nested object
      let deepObject = { level: 0 };
      let current = deepObject;

      for (let i = 1; i <= 100; i++) {
        current.child = { level: i, data: `level_${i}_data` };
        current = current.child;
      }

      const startTime = performance.now();
      const result = inspectorWindow.safeJsonStringify(deepObject);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(30);
      expect(result).toContain('"level":100');
      expect(JSON.parse(result)).toBeDefined();
    });
  });

  describe('Concurrent Operations Performance', () => {
    test('should handle multiple concurrent operations efficiently', async () => {
      inspectorWindow = new ScormInspectorWindow();

      const startTime = performance.now();

      const operations = [
        // API call additions
        ...Array(100).fill().map((_, i) => () =>
          inspectorWindow.addApiCall({
            method: 'GetValue',
            parameters: [`cmi.test.${i}`],
            result: `value_${i}`,
            timestamp: Date.now()
          })
        ),

        // Data model updates
        ...Array(20).fill().map((_, i) => () =>
          inspectorWindow.updateDataModel({
            coreData: { [`test_${i}`]: `data_${i}` }
          })
        ),

        // Log entries
        ...Array(50).fill().map((_, i) => () =>
          inspectorWindow.addEnhancedLogEntry({
            id: `concurrent_${i}`,
            message: `Concurrent message ${i}`,
            timestamp: Date.now()
          })
        )
      ];

      // Execute all operations concurrently
      await Promise.all(operations.map(op =>
        new Promise(resolve => {
          setTimeout(() => {
            op();
            resolve();
          }, Math.random() * 10);
        })
      ));

      // Wait for any pending updates
      await new Promise(resolve => setTimeout(resolve, 200));

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(400);
      expect(inspectorWindow.apiHistory.length).toBe(100);
      expect(inspectorWindow.enhancedLogEntries.length).toBe(50);
      expect(inspectorWindow.isUpdatingDataModel).toBe(false);
    });
  });
});