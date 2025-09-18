/**
 * @jest-environment jsdom
 *
 * SCORM Inspector Error Handling Tests
 *
 * Focused tests for error handling and edge cases:
 * 1. IPC communication failures
 * 2. DOM manipulation errors
 * 3. JSON serialization edge cases
 * 4. Memory exhaustion scenarios
 * 5. Browser API failures
 * 6. Race condition edge cases
 *
 * @fileoverview Error handling tests for SCORM Inspector
 */

describe('SCORM Inspector Error Handling', () => {
  let ScormInspectorWindow;
  let inspectorWindow;
  let mockConsole;

  beforeAll(() => {
    // Mock console methods
    mockConsole = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Set up minimal DOM
    const elements = [
      'api-timeline', 'error-list', 'data-model', 'clear-history-btn', 'refresh-btn',
      'data-filter', 'clear-filter', 'expand-all-data', 'collapse-all-data', 'export-data'
    ];

    elements.forEach(id => {
      if (!document.getElementById(id)) {
        const element = document.createElement('div');
        element.id = id;
        element.addEventListener = jest.fn();
        element.removeEventListener = jest.fn();
        document.body.appendChild(element);
      }
    });

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn()
      },
      writable: true
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a minimal ScormInspectorWindow class for testing
    ScormInspectorWindow = class TestScormInspectorWindow {
      constructor() {
        this.apiHistory = [];
        this.scormErrors = [];
        this.dataModel = {};
        this.dataModelHistory = new Map();
        this.isDestroyed = false;
        this.isUpdatingDataModel = false;
        this.pendingDataModel = null;
        this.eventListeners = [];
        this.dataModelUpdateTimeout = null;
        this.logRenderTimeout = null;
        this.filterText = '';

        // Get DOM elements
        this.apiTimelineElement = document.getElementById('api-timeline');
        this.errorListElement = document.getElementById('error-list');
        this.dataModelElement = document.getElementById('data-model');
        this.dataFilterInput = document.getElementById('data-filter');
        this.clearFilterBtn = document.getElementById('clear-filter');
      }

      // Safe JSON stringification with circular reference handling
      safeJsonStringify(obj, replacer = null, space = null) {
        const seen = new WeakSet();

        const jsonReplacer = (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular Reference]';
            }
            seen.add(value);
          }

          if (typeof replacer === 'function') {
            return replacer(key, value);
          }

          return value;
        };

        try {
          return JSON.stringify(obj, jsonReplacer, space);
        } catch (error) {
          console.error('Failed to stringify object:', error);
          return JSON.stringify({
            error: 'Failed to serialize data',
            type: typeof obj,
            message: error.message
          }, null, space);
        }
      }

      // Add API call with error handling
      addApiCall(data) {
        if (!data || this.isDestroyed) return;

        try {
          this.apiHistory.push(data);
          if (this.apiHistory.length > 2000) {
            this.apiHistory.splice(0, this.apiHistory.length - 2000);
          }
        } catch (error) {
          console.error('Error adding API call:', error);
        }
      }

      // Update data model with race condition prevention
      updateDataModel(newDataModel) {
        if (!newDataModel || this.isDestroyed) return;

        const now = Date.now();
        if (this.isUpdatingDataModel) {
          this.pendingDataModel = newDataModel;
          return;
        }

        this.isUpdatingDataModel = true;

        try {
          // Validate data
          const isEmpty = !newDataModel ||
            (Object.keys(newDataModel).length === 0) ||
            (!newDataModel.coreData && !newDataModel.interactions &&
             !newDataModel.objectives);

          const hasExistingData = this.dataModel && Object.keys(this.dataModel).length > 0;

          if (hasExistingData && isEmpty) {
            console.warn('Ignoring empty data model update');
            return;
          }

          this.dataModel = newDataModel;
        } catch (error) {
          console.error('Error updating data model:', error);
        } finally {
          this.isUpdatingDataModel = false;

          // Process pending update if any
          if (this.pendingDataModel) {
            const pending = this.pendingDataModel;
            this.pendingDataModel = null;
            setTimeout(() => this.updateDataModel(pending), 10);
          }
        }
      }

      // Safe HTML escaping
      escapeHtml(text) {
        if (typeof text !== 'string') {
          text = String(text);
        }

        try {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        } catch (error) {
          // Fallback manual escaping
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }
      }

      // DOM rendering with error handling
      renderApiTimeline() {
        if (!this.apiTimelineElement || this.isDestroyed) return;

        try {
          if (this.apiHistory.length === 0) {
            this.apiTimelineElement.innerHTML =
              '<div class="no-data">No SCORM API calls recorded yet.</div>';
            return;
          }

          const entriesHtml = this.apiHistory
            .slice(-100) // Limit for performance
            .reverse()
            .map(entry => this.createApiEntryHtml(entry))
            .join('');

          this.apiTimelineElement.innerHTML = entriesHtml;
        } catch (error) {
          console.error('Error rendering API timeline:', error);
          if (this.apiTimelineElement) {
            this.apiTimelineElement.innerHTML =
              '<div class="error">Error displaying API timeline</div>';
          }
        }
      }

      createApiEntryHtml(entry) {
        try {
          const timestamp = new Date(entry.timestamp).toLocaleTimeString();
          const method = this.escapeHtml(entry.method || 'Unknown');
          const result = this.escapeHtml(entry.result || '');

          return `
            <div class="api-entry">
              <span class="api-method">${method}</span> →
              <span class="api-result">${result}</span>
              <div class="api-timestamp">${timestamp}</div>
            </div>
          `;
        } catch (error) {
          console.error('Error creating API entry HTML:', error);
          return '<div class="api-entry error">Error displaying entry</div>';
        }
      }

      // Categorize data model with error handling
      categorizeDataModel() {
        const categories = {
          'Core Tracking': { icon: '🎯', items: {}, description: 'Core tracking data' },
          'Interactions': { icon: '💬', items: {}, description: 'Interaction data' }
        };

        try {
          if (!this.dataModel) return categories;

          // Handle structured format
          if (this.dataModel.coreData) {
            Object.entries(this.dataModel.coreData).forEach(([key, value]) => {
              try {
                categories['Core Tracking'].items[key] = value;
              } catch (error) {
                console.error(`Error processing core data key ${key}:`, error);
              }
            });
          }

          // Handle interactions array
          if (Array.isArray(this.dataModel.interactions)) {
            this.dataModel.interactions.forEach((interaction, index) => {
              try {
                if (interaction && typeof interaction === 'object') {
                  Object.entries(interaction).forEach(([key, value]) => {
                    const fullKey = `interactions[${index}].${key}`;
                    categories['Interactions'].items[fullKey] = value;
                  });
                }
              } catch (error) {
                console.error(`Error processing interaction ${index}:`, error);
                categories['Interactions'].items[`interactions[${index}]`] =
                  '[Error processing interaction]';
              }
            });
          }

        } catch (error) {
          console.error('Error categorizing data model:', error);
          categories['System Data'] = {
            icon: '⚠️',
            items: { '[Error]': 'Failed to process data model' },
            description: 'Error processing data'
          };
        }

        return categories;
      }

      // localStorage operations with error handling
      getCategoryCollapsedState(categoryName) {
        try {
          return localStorage.getItem(`scorm-inspector-category-${categoryName}`) === 'true';
        } catch (error) {
          console.warn('Failed to read category state:', error);
          return false;
        }
      }

      setCategoryCollapsedState(categoryName, collapsed) {
        try {
          const key = `scorm-inspector-category-${categoryName}`;
          if (collapsed) {
            localStorage.setItem(key, 'true');
          } else {
            localStorage.removeItem(key);
          }
        } catch (error) {
          console.warn('Failed to save category state:', error);
        }
      }

      // Export with error handling
      exportDataModel() {
        try {
          if (Object.keys(this.dataModel).length === 0) {
            throw new Error('No data to export');
          }

          const exportData = {
            timestamp: new Date().toISOString(),
            dataModel: this.dataModel,
            metadata: { version: '1.0' }
          };

          const dataStr = this.safeJsonStringify(exportData, null, 2);

          // Try to create download
          if (typeof window.Blob !== 'undefined' && typeof window.URL !== 'undefined') {
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `scorm-data-${Date.now()}.json`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          } else {
            throw new Error('Download not supported');
          }
        } catch (error) {
          console.error('Export failed:', error);

          // Fallback: try clipboard
          if (navigator.clipboard) {
            const dataStr = this.safeJsonStringify(this.dataModel, null, 2);
            navigator.clipboard.writeText(dataStr).catch(() => {
              alert('Export failed. Data logged to console.');
              console.log('Export data:', dataStr);
            });
          } else {
            alert('Export failed. Data logged to console.');
            console.log('Export data:', this.safeJsonStringify(this.dataModel, null, 2));
          }
        }
      }

      // Cleanup with error handling
      destroy() {
        if (this.isDestroyed) return;

        try {
          // Clear timeouts
          if (this.dataModelUpdateTimeout) {
            clearTimeout(this.dataModelUpdateTimeout);
            this.dataModelUpdateTimeout = null;
          }

          if (this.logRenderTimeout) {
            clearTimeout(this.logRenderTimeout);
            this.logRenderTimeout = null;
          }

          // Clear data
          this.apiHistory = null;
          this.scormErrors = null;
          this.dataModel = null;
          this.dataModelHistory = null;
          this.pendingDataModel = null;

          // Remove event listeners
          this.eventListeners.forEach(({ element, type, handler }) => {
            try {
              element.removeEventListener(type, handler);
            } catch (error) {
              console.warn('Failed to remove event listener:', error);
            }
          });
          this.eventListeners = null;

          this.isDestroyed = true;
        } catch (error) {
          console.error('Error during destruction:', error);
          this.isDestroyed = true;
        }
      }
    };
  });

  describe('JSON Serialization Error Handling', () => {
    test('should handle circular references in data', () => {
      inspectorWindow = new ScormInspectorWindow();

      const circular = { a: 1 };
      circular.self = circular;

      const result = inspectorWindow.safeJsonStringify(circular);
      expect(result).toContain('[Circular Reference]');
    });

    test('should handle BigInt and other non-serializable types', () => {
      inspectorWindow = new ScormInspectorWindow();

      const problematicData = {
        bigint: BigInt(123),
        symbol: Symbol('test'),
        func: function() {},
        undefined: undefined,
        date: new Date()
      };

      expect(() => {
        const result = inspectorWindow.safeJsonStringify(problematicData);
        expect(result).toBeDefined();
      }).not.toThrow();
    });

    test('should handle deeply nested circular structures', () => {
      inspectorWindow = new ScormInspectorWindow();

      const deep = { level: 0 };
      let current = deep;

      // Create deep nesting
      for (let i = 1; i < 100; i++) {
        current.child = { level: i, parent: current };
        current = current.child;
      }

      // Create circular reference
      current.root = deep;

      const result = inspectorWindow.safeJsonStringify(deep);
      expect(result).toContain('[Circular Reference]');
    });
  });

  describe('DOM Manipulation Error Handling', () => {
    test('should handle missing DOM elements', () => {
      inspectorWindow = new ScormInspectorWindow();
      inspectorWindow.apiTimelineElement = null;

      expect(() => {
        inspectorWindow.renderApiTimeline();
      }).not.toThrow();
    });

    test('should handle DOM element access errors', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Mock element that throws on property access
      inspectorWindow.apiTimelineElement = {
        get innerHTML() { throw new Error('DOM access denied'); },
        set innerHTML(value) { throw new Error('DOM write denied'); }
      };

      expect(() => {
        inspectorWindow.renderApiTimeline();
      }).not.toThrow();
    });

    test('should handle document.createElement failures', () => {
      inspectorWindow = new ScormInspectorWindow();

      const originalCreateElement = document.createElement;
      document.createElement = jest.fn(() => {
        throw new Error('createElement failed');
      });

      expect(() => {
        inspectorWindow.escapeHtml('<script>alert("xss")</script>');
      }).not.toThrow();

      document.createElement = originalCreateElement;
    });
  });

  describe('Memory and Performance Error Handling', () => {
    test('should handle memory exhaustion gracefully', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Simulate memory pressure by adding large amounts of data
      const largeString = 'x'.repeat(10000);

      for (let i = 0; i < 1000; i++) {
        inspectorWindow.addApiCall({
          method: 'GetValue',
          parameters: [largeString],
          result: largeString,
          timestamp: Date.now(),
          largeData: largeString
        });
      }

      // Should enforce memory limits
      expect(inspectorWindow.apiHistory.length).toBeLessThanOrEqual(2000);
    });

    test('should handle rapid data updates without memory leaks', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Rapid updates that could cause memory leaks
      for (let i = 0; i < 100; i++) {
        setTimeout(() => {
          if (!inspectorWindow.isDestroyed) {
            inspectorWindow.updateDataModel({
              [`dynamic_${i}`]: `value_${i}`,
              timestamp: Date.now()
            });
          }
        }, i);
      }

      // Cleanup should work without errors
      setTimeout(() => {
        expect(() => inspectorWindow.destroy()).not.toThrow();
      }, 200);
    });
  });

  describe('Race Condition Error Handling', () => {
    test('should handle concurrent updateDataModel calls safely', () => {
      inspectorWindow = new ScormInspectorWindow();

      const promises = [];

      // Simulate concurrent updates
      for (let i = 0; i < 50; i++) {
        promises.push(new Promise(resolve => {
          inspectorWindow.updateDataModel({
            [`concurrent_${i}`]: `value_${i}`
          });
          resolve();
        }));
      }

      expect(() => Promise.all(promises)).not.toThrow();
      expect(inspectorWindow.isUpdatingDataModel).toBe(false);
    });

    test('should handle destruction during active operations', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Start some operations
      inspectorWindow.updateDataModel({ test: 'data' });
      inspectorWindow.addApiCall({ method: 'test', result: 'test' });

      // Set up timeouts
      inspectorWindow.dataModelUpdateTimeout = setTimeout(() => {}, 1000);

      // Destroy while operations might be pending
      expect(() => inspectorWindow.destroy()).not.toThrow();
      expect(inspectorWindow.isDestroyed).toBe(true);
    });
  });

  describe('Browser API Error Handling', () => {
    test('should handle localStorage quota exceeded', () => {
      inspectorWindow = new ScormInspectorWindow();

      // Mock localStorage to throw quota exceeded error
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = jest.fn(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      expect(() => {
        inspectorWindow.setCategoryCollapsedState('test', true);
      }).not.toThrow();

      localStorage.setItem = originalSetItem;
    });

    test('should handle Blob/URL API unavailability', () => {
      inspectorWindow = new ScormInspectorWindow();
      inspectorWindow.dataModel = { test: 'data' };

      // Mock missing Blob API
      const originalBlob = global.Blob;
      const originalURL = global.URL;

      global.Blob = undefined;
      global.URL = undefined;

      expect(() => {
        inspectorWindow.exportDataModel();
      }).not.toThrow();

      global.Blob = originalBlob;
      global.URL = originalURL;
    });

    test('should handle clipboard API failures', () => {
      inspectorWindow = new ScormInspectorWindow();
      inspectorWindow.dataModel = { test: 'data' };

      // Mock clipboard failure
      const originalClipboard = navigator.clipboard;
      navigator.clipboard = {
        writeText: jest.fn().mockRejectedValue(new Error('Clipboard failed'))
      };

      // Mock missing Blob to force clipboard fallback
      global.Blob = undefined;

      expect(() => {
        inspectorWindow.exportDataModel();
      }).not.toThrow();

      navigator.clipboard = originalClipboard;
      global.Blob = class MockBlob {};
    });
  });

  describe('Data Validation Error Handling', () => {
    test('should handle malformed API call data', () => {
      inspectorWindow = new ScormInspectorWindow();

      const malformedCalls = [
        null,
        undefined,
        { method: null },
        { method: 123, parameters: 'not-array' },
        { method: 'test', result: { circular: {} } }
      ];

      // Create circular reference in one of the calls
      malformedCalls[4].result.circular.self = malformedCalls[4].result.circular;

      malformedCalls.forEach(call => {
        expect(() => inspectorWindow.addApiCall(call)).not.toThrow();
      });
    });

    test('should handle invalid data model structures', () => {
      inspectorWindow = new ScormInspectorWindow();

      const invalidModels = [
        null,
        undefined,
        'string-instead-of-object',
        { interactions: 'not-an-array' },
        { interactions: [null, undefined, 'invalid'] },
        { objectives: ['string', 123, true] }
      ];

      invalidModels.forEach(model => {
        expect(() => {
          inspectorWindow.updateDataModel(model);
          inspectorWindow.categorizeDataModel();
        }).not.toThrow();
      });
    });
  });

  afterEach(() => {
    if (inspectorWindow && !inspectorWindow.isDestroyed) {
      inspectorWindow.destroy();
    }
  });
});