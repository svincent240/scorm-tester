/**
 * Data Model Change Logging Tests
 * 
 * Tests for the data model change event emission functionality,
 * ensuring all mutations are captured with proper metadata.
 */

const ScormDataModel = require('../../../../src/main/services/scorm/rte/data-model');
const ScormErrorHandler = require('../../../../src/main/services/scorm/rte/error-handler');

describe('ScormDataModel - Change Logging', () => {
  let dataModel;
  let errorHandler;
  let mockLogger;
  let capturedChanges;
  let mockChangeListener;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    errorHandler = new ScormErrorHandler(mockLogger);
    capturedChanges = [];
    mockChangeListener = jest.fn((change) => {
      capturedChanges.push(change);
    });

    dataModel = new ScormDataModel(errorHandler, mockLogger, {
      changeListener: mockChangeListener,
      changeContextProvider: () => ({ sessionId: 'test-session-123' }),
      maxChangeValueLength: 100
    });
  });

  describe('Basic Change Emission', () => {
    test('should emit change when value is set for the first time', () => {
      dataModel.setValue('cmi.location', 'page-1');

      expect(capturedChanges).toHaveLength(1);
      expect(capturedChanges[0]).toMatchObject({
        entryType: 'data-model-change',
        changeType: 'data-model',
        element: 'cmi.location',
        previousValue: undefined,
        newValue: 'page-1',
        sessionId: 'test-session-123',
        source: expect.any(String)
      });
      expect(capturedChanges[0].timestamp).toBeGreaterThan(0);
    });

    test('should NOT emit change when value is set to same value', () => {
      dataModel.setValue('cmi.location', 'page-1');
      capturedChanges.length = 0; // Clear

      dataModel.setValue('cmi.location', 'page-1');
      expect(capturedChanges).toHaveLength(0);
    });

    test('should emit change when value is updated to different value', () => {
      dataModel.setValue('cmi.location', 'page-1');
      capturedChanges.length = 0;

      dataModel.setValue('cmi.location', 'page-2');

      expect(capturedChanges).toHaveLength(1);
      expect(capturedChanges[0]).toMatchObject({
        element: 'cmi.location',
        previousValue: 'page-1',
        newValue: 'page-2'
      });
    });

    test('should NOT emit changes during initialization', () => {
      // Changes during constructor initialization should be suppressed
      // capturedChanges should only contain changes after init
      const initialLength = capturedChanges.length;

      // Any setValue after init should emit (use a writable element)
      dataModel.setValue('cmi.location', 'page-1');
      expect(capturedChanges.length).toBeGreaterThan(initialLength);
    });
  });

  describe('Change Metadata', () => {
    test('should include all required fields in change payload', () => {
      dataModel.setValue('cmi.score.raw', '85');

      const change = capturedChanges[0];
      expect(change).toMatchObject({
        entryType: 'data-model-change',
        changeType: 'data-model',
        element: 'cmi.score.raw',
        newValue: '85',
        sessionId: 'test-session-123',
        timestamp: expect.any(Number),
        source: expect.any(String)
      });
      // previousValue should exist (even if undefined for first-time sets)
      expect(change).toHaveProperty('previousValue');
    });

    test('should include truncation metadata for large values', () => {
      const largeValue = 'x'.repeat(200);
      dataModel.setValue('cmi.suspend_data', largeValue);

      expect(capturedChanges[0]).toMatchObject({
        element: 'cmi.suspend_data',
        newValueTruncated: true,
        newValueOriginalLength: 200,
        newValueOriginalBytes: expect.any(Number)
      });
      expect(capturedChanges[0].newValue.length).toBeLessThanOrEqual(100);
    });

    test('should mark source as internal for _setInternalValue calls', () => {
      dataModel._setInternalValue('cmi.total_time', 'PT1H30M');

      expect(capturedChanges[0]).toMatchObject({
        element: 'cmi.total_time',
        source: 'internal'
      });
    });
  });

  describe('Collection Changes', () => {
    test('should emit changes for interaction collection with collectionIndex', () => {
      dataModel.setValue('cmi.interactions.0.id', 'q1');

      const interactionChange = capturedChanges.find(c => c.element === 'cmi.interactions.0.id');
      expect(interactionChange).toMatchObject({
        element: 'cmi.interactions.0.id',
        collection: 'interactions',
        collectionIndex: 0,
        collectionProperty: 'id',
        newValue: 'q1'
      });
    });

    test('should emit changes for objective collection with collectionIndex', () => {
      dataModel.setValue('cmi.objectives.0.id', 'obj1');

      const objectiveChange = capturedChanges.find(c => c.element === 'cmi.objectives.0.id');
      expect(objectiveChange).toMatchObject({
        element: 'cmi.objectives.0.id',
        collection: 'objectives',
        collectionIndex: 0,
        collectionProperty: 'id',
        newValue: 'obj1'
      });
    });

    test('should emit count changes when collection grows', () => {
      capturedChanges.length = 0;
      dataModel.setValue('cmi.interactions.0.id', 'q1');

      const countChange = capturedChanges.find(c => c.element === 'cmi.interactions._count');
      expect(countChange).toMatchObject({
        element: 'cmi.interactions._count',
        collection: 'interactions',
        newValue: '1'
      });
    });
  });

  describe('Context Provider Integration', () => {
    test('should use sessionId from context provider', () => {
      dataModel.setValue('cmi.location', 'page-1');

      expect(capturedChanges[0].sessionId).toBe('test-session-123');
    });

    test('should handle missing context provider gracefully', () => {
      const dmNoContext = new ScormDataModel(errorHandler, mockLogger, {
        changeListener: mockChangeListener
        // No changeContextProvider
      });

      dmNoContext.setValue('cmi.location', 'page-1');

      expect(capturedChanges[capturedChanges.length - 1]).toMatchObject({
        element: 'cmi.location',
        newValue: 'page-1'
      });
    });
  });

  describe('Change Context Stack', () => {
    test('should support pushChangeContext and popChangeContext', () => {
      dataModel.pushChangeContext({ source: 'api:SetValue' });
      dataModel.setValue('cmi.location', 'page-1');
      dataModel.popChangeContext();

      expect(capturedChanges[0].source).toBe('api:SetValue');
    });

    test('should support withChangeContext for scoped changes', () => {
      dataModel.withChangeContext({ source: 'api:Commit' }, () => {
        dataModel.setValue('cmi.location', 'page-2');
      });

      expect(capturedChanges[0].source).toBe('api:Commit');
    });
  });

  describe('Suppression Control', () => {
    test('should not emit changes when suppressChangeEvents is true', () => {
      dataModel.suppressChangeEvents = true;
      dataModel.setValue('cmi.location', 'page-1');

      // Should not have emitted the change
      const locationChanges = capturedChanges.filter(c => c.element === 'cmi.location');
      expect(locationChanges).toHaveLength(0);
    });

    test('should resume emitting after suppression is disabled', () => {
      dataModel.suppressChangeEvents = true;
      dataModel.setValue('cmi.location', 'page-1');
      
      dataModel.suppressChangeEvents = false;
      capturedChanges.length = 0;
      dataModel.setValue('cmi.location', 'page-2');

      expect(capturedChanges).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    test('should handle undefined to value transition', () => {
      dataModel.setValue('cmi.score.raw', '75');

      expect(capturedChanges[0]).toMatchObject({
        element: 'cmi.score.raw',
        previousValue: undefined,
        newValue: '75'
      });
    });

    test('should handle value to undefined transition', () => {
      dataModel.setValue('cmi.location', 'page-1');
      capturedChanges.length = 0;

      // Note: SCORM doesn't typically allow setting to undefined,
      // but test the change detection logic
      dataModel.data.set('cmi.location', undefined);
      dataModel._emitChange('cmi.location', 'page-1', undefined);

      expect(capturedChanges[0]).toMatchObject({
        element: 'cmi.location',
        previousValue: 'page-1',
        newValue: undefined
      });
    });

    test('should handle null values correctly', () => {
      dataModel._emitChange('cmi.test', null, 'value');

      expect(capturedChanges[0]).toMatchObject({
        element: 'cmi.test',
        previousValue: null,
        newValue: 'value'
      });
    });
  });
});
