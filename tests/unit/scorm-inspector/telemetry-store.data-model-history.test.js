/**
 * ScormInspectorTelemetryStore - Data Model History Tests
 * 
 * Tests for the data model change log storage, retrieval, and management.
 */

const ScormInspectorTelemetryStore = require('../../../src/main/services/scorm-inspector/scorm-inspector-telemetry-store');

describe('ScormInspectorTelemetryStore - Data Model History', () => {
  let store;
  let mockLogger;
  let mockWindowManager;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockWindowManager = {
      getAllWindows: jest.fn(() => [])
    };

    store = new ScormInspectorTelemetryStore({
      maxHistorySize: 100,
      dataModelHistorySize: 500,
      logger: mockLogger,
      enableBroadcast: false // Disable for most tests
    });

    store.setWindowManager(mockWindowManager);
  });

  describe('storeDataModelChange', () => {
    test('should store data model change with all fields', () => {
      const change = {
        sessionId: 'session-123',
        element: 'cmi.location',
        previousValue: 'page-1',
        newValue: 'page-2',
        source: 'api:SetValue',
        timestamp: Date.now()
      };

      store.storeDataModelChange(change);

      const result = store.getDataModelHistory({});
      expect(result.success).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        entryType: 'data-model-change',
        element: 'cmi.location',
        previousValue: 'page-1',
        newValue: 'page-2',
        source: 'api:SetValue',
        sessionId: 'session-123'
      });
    });

    test('should add entryType if missing', () => {
      store.storeDataModelChange({
        element: 'cmi.score.raw',
        newValue: '85'
      });

      const result = store.getDataModelHistory({});
      expect(result.changes[0].entryType).toBe('data-model-change');
    });

    test('should normalize timestamp to ISO and numeric formats', () => {
      const now = Date.now();
      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'test',
        timestamp: now
      });

      const result = store.getDataModelHistory({});
      expect(result.changes[0].timestampMs).toBe(now);
      expect(result.changes[0].timestampIso).toBeTruthy();
      expect(result.changes[0].timestamp).toBeTruthy();
    });

    test('should generate ID if missing', () => {
      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'test'
      });

      const result = store.getDataModelHistory({});
      expect(result.changes[0].id).toBeTruthy();
    });

    test('should stringify sessionId if present', () => {
      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'test',
        sessionId: 12345
      });

      const result = store.getDataModelHistory({});
      expect(result.changes[0].sessionId).toBe('12345');
    });
  });

  describe('Ring Buffer Management', () => {
    test('should trim history when exceeding dataModelHistorySize', () => {
      // Store more than capacity
      for (let i = 0; i < 600; i++) {
        store.storeDataModelChange({
          element: 'cmi.location',
          newValue: `page-${i}`,
          timestamp: Date.now() + i
        });
      }

      const result = store.getDataModelHistory({});
      expect(result.changes.length).toBeLessThanOrEqual(500);
      expect(result.total).toBeLessThanOrEqual(500);
    });

    test('should keep most recent entries when trimming', () => {
      for (let i = 0; i < 600; i++) {
        store.storeDataModelChange({
          element: 'cmi.location',
          newValue: `page-${i}`,
          timestamp: 1000 + i
        });
      }

      const result = store.getDataModelHistory({ limit: 1 });
      // Should have the last entry (page-599)
      expect(result.changes[0].newValue).toBe('page-599');
    });
  });

  describe('getDataModelHistory - Filtering', () => {
    beforeEach(() => {
      // Setup test data
      store.storeDataModelChange({
        sessionId: 'session-1',
        element: 'cmi.location',
        newValue: 'page-1',
        timestamp: 1000
      });

      store.storeDataModelChange({
        sessionId: 'session-1',
        element: 'cmi.score.raw',
        newValue: '85',
        timestamp: 2000
      });

      store.storeDataModelChange({
        sessionId: 'session-2',
        element: 'cmi.location',
        newValue: 'page-2',
        timestamp: 3000
      });

      store.storeDataModelChange({
        sessionId: 'session-1',
        element: 'cmi.interactions.0.id',
        newValue: 'q1',
        timestamp: 4000
      });
    });

    test('should filter by sinceTs', () => {
      const result = store.getDataModelHistory({ sinceTs: 2500 });

      expect(result.success).toBe(true);
      expect(result.changes.length).toBe(2); // Only entries at 3000 and 4000
    });

    test('should filter by elementPrefix (string)', () => {
      const result = store.getDataModelHistory({ elementPrefix: 'cmi.score' });

      expect(result.success).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].element).toBe('cmi.score.raw');
    });

    test('should filter by elementPrefix (array)', () => {
      const result = store.getDataModelHistory({
        elementPrefix: ['cmi.location', 'cmi.score']
      });

      expect(result.success).toBe(true);
      expect(result.changes.length).toBe(3); // 2 location + 1 score
    });

    test('should filter by sessionId', () => {
      const result = store.getDataModelHistory({ sessionId: 'session-1' });

      expect(result.success).toBe(true);
      expect(result.changes.length).toBe(3); // All session-1 entries
      expect(result.changes.every(c => c.sessionId === 'session-1')).toBe(true);
    });

    test('should combine multiple filters', () => {
      const result = store.getDataModelHistory({
        sessionId: 'session-1',
        elementPrefix: 'cmi.interactions',
        sinceTs: 3500
      });

      expect(result.success).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].element).toBe('cmi.interactions.0.id');
    });
  });

  describe('getDataModelHistory - Pagination', () => {
    beforeEach(() => {
      for (let i = 0; i < 50; i++) {
        store.storeDataModelChange({
          element: 'cmi.location',
          newValue: `page-${i}`,
          timestamp: 1000 + i
        });
      }
    });

    test('should respect limit parameter', () => {
      const result = store.getDataModelHistory({ limit: 10 });

      expect(result.success).toBe(true);
      expect(result.changes.length).toBe(10);
      expect(result.total).toBe(50);
    });

    test('should respect offset parameter', () => {
      const result = store.getDataModelHistory({ limit: 10, offset: 40 });

      expect(result.success).toBe(true);
      expect(result.changes.length).toBe(10);
      expect(result.total).toBe(50);
    });

    test('should indicate hasMore correctly', () => {
      const result1 = store.getDataModelHistory({ limit: 25, offset: 0 });
      expect(result1.hasMore).toBe(true);

      const result2 = store.getDataModelHistory({ limit: 25, offset: 25 });
      expect(result2.hasMore).toBe(false);
    });

    test('should return all when limit is null', () => {
      const result = store.getDataModelHistory({ limit: null });

      expect(result.success).toBe(true);
      expect(result.changes.length).toBe(50);
    });
  });

  describe('Sorting', () => {
    test('should return changes in descending timestamp order', () => {
      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'first',
        timestamp: 1000
      });

      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'second',
        timestamp: 2000
      });

      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'third',
        timestamp: 3000
      });

      const result = store.getDataModelHistory({});

      expect(result.changes[0].newValue).toBe('third');
      expect(result.changes[1].newValue).toBe('second');
      expect(result.changes[2].newValue).toBe('first');
    });
  });

  describe('Broadcasting', () => {
    test('should broadcast when enableBroadcast is true', () => {
      const broadcastStore = new ScormInspectorTelemetryStore({
        enableBroadcast: true,
        logger: mockLogger
      });

      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: jest.fn()
        }
      };

      const windowMgr = {
        getAllWindows: () => [mockWindow]
      };

      broadcastStore.setWindowManager(windowMgr);

      broadcastStore.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'test'
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'scorm-data-model-change',
        expect.objectContaining({
          element: 'cmi.location',
          newValue: 'test'
        })
      );
    });

    test('should not broadcast when enableBroadcast is false', () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: jest.fn()
        }
      };

      mockWindowManager.getAllWindows = () => [mockWindow];

      store.storeDataModelChange({
        element: 'cmi.location',
        newValue: 'test'
      });

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid input gracefully', () => {
      store.storeDataModelChange(null);
      store.storeDataModelChange(undefined);
      store.storeDataModelChange('string');

      const result = store.getDataModelHistory({});
      expect(result.changes).toHaveLength(0);
    });

    test('should return error response if getDataModelHistory throws', () => {
      // Force an error by corrupting internal state
      store.dataModelHistory = null;

      const result = store.getDataModelHistory({});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.changes).toEqual([]);
    });

    test('should not throw when broadcast fails', () => {
      const broadcastStore = new ScormInspectorTelemetryStore({
        enableBroadcast: true,
        logger: mockLogger
      });

      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: jest.fn(() => { throw new Error('Send failed'); })
        }
      };

      const windowMgr = {
        getAllWindows: () => [mockWindow]
      };

      broadcastStore.setWindowManager(windowMgr);

      expect(() => {
        broadcastStore.storeDataModelChange({
          element: 'cmi.location',
          newValue: 'test'
        });
      }).not.toThrow();
    });
  });

  describe('Clear Functionality', () => {
    test('should clear data model history', () => {
      store.storeDataModelChange({ element: 'cmi.location', newValue: 'test' });
      
      expect(store.dataModelHistory.length).toBeGreaterThan(0);

      store.clearDataModelHistory();

      expect(store.dataModelHistory.length).toBe(0);
      
      const result = store.getDataModelHistory({});
      expect(result.changes).toHaveLength(0);
    });
  });

  describe('Performance Tracking', () => {
    test('should track storeDataModelChange call count', () => {
      const initialCount = store.performanceStats.dataModelStoreCallCount;

      store.storeDataModelChange({ element: 'cmi.location', newValue: 'test' });

      expect(store.performanceStats.dataModelStoreCallCount).toBe(initialCount + 1);
    });

    test('should track total store time', () => {
      const initialTime = store.performanceStats.totalStoreTime;

      store.storeDataModelChange({ element: 'cmi.location', newValue: 'test' });

      expect(store.performanceStats.totalStoreTime).toBeGreaterThanOrEqual(initialTime);
    });
  });
});
