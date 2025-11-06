/**
 * MCP Runtime Tools - Data Model History Tests
 * 
 * Tests for the scorm_get_data_model_history MCP tool.
 */

const { scorm_get_data_model_history } = require('../../../../src/mcp/tools/runtime');
const { RuntimeManager } = require('../../../../src/mcp/runtime-manager');

// Mock RuntimeManager
jest.mock('../../../../src/mcp/runtime-manager');

describe('MCP Tool: scorm_get_data_model_history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Parameter Validation', () => {
    test('should throw MCP_INVALID_PARAMS when session_id is missing', async () => {
      await expect(scorm_get_data_model_history({})).rejects.toThrow('session_id is required');
      await expect(scorm_get_data_model_history({})).rejects.toMatchObject({
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('should throw MCP_INVALID_PARAMS when session_id is not a string', async () => {
      await expect(scorm_get_data_model_history({ session_id: 123 })).rejects.toThrow();
      await expect(scorm_get_data_model_history({ session_id: null })).rejects.toThrow();
    });

    test('should accept valid session_id', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await expect(
        scorm_get_data_model_history({ session_id: 'valid-session' })
      ).resolves.toBeDefined();
    });
  });

  describe('Filter Parameters', () => {
    test('should pass sinceTs filter when provided', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        since_ts: 1234567890
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ sinceTs: 1234567890 })
      );
    });

    test('should pass elementPrefix filter as string', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        element_prefix: 'cmi.score'
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ elementPrefix: 'cmi.score' })
      );
    });

    test('should pass elementPrefix filter as array', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        element_prefix: ['cmi.score', 'cmi.interactions']
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ 
          elementPrefix: ['cmi.score', 'cmi.interactions'] 
        })
      );
    });

    test('should pass change_session_id filter', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        change_session_id: 'specific-session'
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ sessionId: 'specific-session' })
      );
    });

    test('should pass limit and offset filters', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        limit: 50,
        offset: 100
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ limit: 50, offset: 100 })
      );
    });

    test('should ignore invalid numeric filters', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        limit: 'invalid',
        offset: NaN
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        {} // No invalid filters passed
      );
    });
  });

  describe('Response Handling', () => {
    test('should return successful result with changes', async () => {
      const mockChanges = [
        {
          element: 'cmi.location',
          previousValue: 'page-1',
          newValue: 'page-2',
          timestamp: 1000
        },
        {
          element: 'cmi.score.raw',
          previousValue: undefined,
          newValue: '85',
          timestamp: 2000
        }
      ];

      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: mockChanges,
        total: 2,
        hasMore: false
      });

      const result = await scorm_get_data_model_history({
        session_id: 'session-1'
      });

      expect(result).toEqual({
        success: true,
        session_id: 'session-1',
        data: {
          changes: mockChanges,
          total: 2,
          has_more: false
        },
        filters_applied: {
          since_ts: null,
          element_prefix: null,
          change_session_id: null,
          limit: null,
          offset: 0
        }
      });
    });

    test('should handle empty result', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      const result = await scorm_get_data_model_history({
        session_id: 'session-1'
      });

      expect(result).toEqual({
        success: true,
        session_id: 'session-1',
        data: {
          changes: [],
          total: 0,
          has_more: false
        },
        filters_applied: {
          since_ts: null,
          element_prefix: null,
          change_session_id: null,
          limit: null,
          offset: 0
        }
      });
    });

    test('should handle pagination metadata', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: Array(50).fill({ element: 'test' }),
        total: 500,
        hasMore: true
      });

      const result = await scorm_get_data_model_history({
        session_id: 'session-1',
        limit: 50
      });

      expect(result.data.total).toBe(500);
      expect(result.data.has_more).toBe(true);
      expect(result.data.changes.length).toBe(50);
    });
  });

  describe('Error Handling', () => {
    test('should propagate RUNTIME_NOT_OPEN error', async () => {
      const error = new Error('Runtime not open for session');
      RuntimeManager.getDataModelHistory.mockRejectedValue(error);

      await expect(
        scorm_get_data_model_history({ session_id: 'session-1' })
      ).rejects.toMatchObject({
        code: 'RUNTIME_NOT_OPEN'
      });
    });

    test('should propagate MCP_UNKNOWN_SESSION error', async () => {
      const error = new Error('Session not found');
      error.code = 'MCP_UNKNOWN_SESSION';
      RuntimeManager.getDataModelHistory.mockRejectedValue(error);

      await expect(
        scorm_get_data_model_history({ session_id: 'unknown' })
      ).rejects.toMatchObject({
        code: 'MCP_UNKNOWN_SESSION'
      });
    });

    test('should preserve error codes from RuntimeManager', async () => {
      const error = new Error('Telemetry store unavailable');
      error.code = 'TELEMETRY_UNAVAILABLE';
      RuntimeManager.getDataModelHistory.mockRejectedValue(error);

      await expect(
        scorm_get_data_model_history({ session_id: 'session-1' })
      ).rejects.toMatchObject({
        code: 'TELEMETRY_UNAVAILABLE'
      });
    });

    test('should infer error code from message when missing', async () => {
      const error = new Error('runtime not open');
      RuntimeManager.getDataModelHistory.mockRejectedValue(error);

      await expect(
        scorm_get_data_model_history({ session_id: 'session-1' })
      ).rejects.toMatchObject({
        code: 'RUNTIME_NOT_OPEN'
      });
    });
  });

  describe('Integration with RuntimeManager', () => {
    test('should call RuntimeManager.getDataModelHistory with correct arguments', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue({
        success: true,
        changes: [],
        total: 0,
        hasMore: false
      });

      await scorm_get_data_model_history({
        session_id: 'session-1',
        since_ts: 5000,
        element_prefix: 'cmi.interactions',
        limit: 100
      });

      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledTimes(1);
      expect(RuntimeManager.getDataModelHistory).toHaveBeenCalledWith(
        'session-1',
        {
          sinceTs: 5000,
          elementPrefix: 'cmi.interactions',
          limit: 100
        }
      );
    });

    test('should handle RuntimeManager returning undefined gracefully', async () => {
      RuntimeManager.getDataModelHistory.mockResolvedValue(undefined);

      const result = await scorm_get_data_model_history({
        session_id: 'session-1'
      });

      // Should handle undefined and return safe defaults
      expect(result.data.changes).toBeDefined();
    });
  });
});
