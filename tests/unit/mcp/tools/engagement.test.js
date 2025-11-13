"use strict";

/**
 * Unit tests for MCP Engagement Tracking tools
 * Tests error handling, parameter validation, and API availability checking
 */

// Mock RuntimeManager
jest.mock('../../../../src/mcp/runtime-manager', () => ({
  RuntimeManager: {
    getRuntimeStatus: jest.fn(),
    executeJS: jest.fn()
  }
}));

// Mock sessions
jest.mock('../../../../src/mcp/session', () => ({
  emit: jest.fn()
}));

const sessions = require('../../../../src/mcp/session');
const { RuntimeManager } = require('../../../../src/mcp/runtime-manager');

// Import tools to test
const {
  scorm_engagement_get_state,
  scorm_engagement_get_progress,
  scorm_engagement_mark_tab_viewed,
  scorm_engagement_set_scroll_depth,
  scorm_engagement_reset
} = require('../../../../src/mcp/tools/automation');

describe('MCP Engagement Tracking Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock: runtime is open
    RuntimeManager.getRuntimeStatus = jest.fn().mockResolvedValue({
      open: true,
      url: 'http://localhost:8080/index.html'
    });
    
    sessions.emit = jest.fn();
  });

  describe('Parameter Validation', () => {
    test('all tools reject missing session_id', async () => {
      const tools = [
        scorm_engagement_get_state,
        scorm_engagement_get_progress,
        scorm_engagement_reset
      ];

      for (const tool of tools) {
        await expect(tool({})).rejects.toMatchObject({
          message: 'session_id is required',
          code: 'MCP_INVALID_PARAMS'
        });
      }
    });

    test('scorm_engagement_mark_tab_viewed rejects missing tab_id', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_engagement_mark_tab_viewed({ session_id: 'test' })
      ).rejects.toMatchObject({
        message: 'tab_id is required and must be a string',
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('scorm_engagement_mark_tab_viewed rejects non-string tab_id', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_engagement_mark_tab_viewed({ session_id: 'test', tab_id: 123 })
      ).rejects.toMatchObject({
        message: 'tab_id is required and must be a string',
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('scorm_engagement_set_scroll_depth rejects missing percentage', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_engagement_set_scroll_depth({ session_id: 'test' })
      ).rejects.toMatchObject({
        message: 'percentage must be a number between 0 and 100',
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('scorm_engagement_set_scroll_depth rejects percentage < 0', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_engagement_set_scroll_depth({ session_id: 'test', percentage: -5 })
      ).rejects.toMatchObject({
        message: 'percentage must be a number between 0 and 100',
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('scorm_engagement_set_scroll_depth rejects percentage > 100', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(true);

      await expect(
        scorm_engagement_set_scroll_depth({ session_id: 'test', percentage: 150 })
      ).rejects.toMatchObject({
        message: 'percentage must be a number between 0 and 100',
        code: 'MCP_INVALID_PARAMS'
      });
    });

    test('scorm_engagement_set_scroll_depth accepts valid percentages', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(undefined); // setScrollDepth call

      const validPercentages = [0, 50, 100, 33.5];

      for (const percentage of validPercentages) {
        jest.clearAllMocks();
        RuntimeManager.executeJS = jest.fn()
          .mockResolvedValueOnce(true) // API check
          .mockResolvedValueOnce(undefined); // setScrollDepth call

        const result = await scorm_engagement_set_scroll_depth({
          session_id: 'test',
          percentage
        });

        expect(result).toEqual({
          available: true,
          success: true,
          percentage
        });
      }
    });
  });

  describe('Runtime Status Validation', () => {
    test('all tools reject when runtime is not open', async () => {
      RuntimeManager.getRuntimeStatus = jest.fn().mockResolvedValue({
        open: false
      });

      const tools = [
        { fn: scorm_engagement_get_state, params: { session_id: 'test' } },
        { fn: scorm_engagement_get_progress, params: { session_id: 'test' } },
        { fn: scorm_engagement_mark_tab_viewed, params: { session_id: 'test', tab_id: 'tab1' } },
        { fn: scorm_engagement_set_scroll_depth, params: { session_id: 'test', percentage: 50 } },
        { fn: scorm_engagement_reset, params: { session_id: 'test' } }
      ];

      for (const { fn, params } of tools) {
        await expect(fn(params)).rejects.toMatchObject({
          message: 'Runtime not open',
          code: 'RUNTIME_NOT_OPEN'
        });
      }
    });
  });

  describe('API Availability Checking', () => {
    test('tools throw AUTOMATION_API_NOT_AVAILABLE when API is missing', async () => {
      RuntimeManager.executeJS = jest.fn().mockResolvedValue(false);

      const tools = [
        { fn: scorm_engagement_get_state, params: { session_id: 'test' } },
        { fn: scorm_engagement_get_progress, params: { session_id: 'test' } },
        { fn: scorm_engagement_mark_tab_viewed, params: { session_id: 'test', tab_id: 'tab1' } },
        { fn: scorm_engagement_set_scroll_depth, params: { session_id: 'test', percentage: 50 } },
        { fn: scorm_engagement_reset, params: { session_id: 'test' } }
      ];

      for (const { fn, params } of tools) {
        await expect(fn(params)).rejects.toMatchObject({
          code: 'AUTOMATION_API_NOT_AVAILABLE',
          name: 'AutomationAPIError'
        });
      }
    });
  });

  describe('scorm_engagement_get_state', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('returns engagement state when API is available', async () => {
      const mockState = {
        complete: false,
        requirements: {
          required: true,
          mode: 'all',
          requirements: [
            { type: 'viewAllTabs', config: {} },
            { type: 'scrollDepth', config: { percentage: 80 } }
          ]
        },
        tracked: {
          tabsViewed: ['tab-1'],
          tabsTotal: 3,
          interactionsCompleted: {},
          interactionsTotal: 2,
          scrollDepth: 45,
          timeSpent: 12000
        },
        completedAt: null
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockState); // getEngagementState call

      const result = await scorm_engagement_get_state({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        state: mockState
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'window.SCORMAutomation.getEngagementState()',
        'test'
      );
    });

    test('returns complete engagement state', async () => {
      const mockState = {
        complete: true,
        requirements: {
          required: true,
          mode: 'all',
          requirements: [
            { type: 'viewAllTabs', config: {} }
          ]
        },
        tracked: {
          tabsViewed: ['tab-1', 'tab-2', 'tab-3'],
          tabsTotal: 3,
          interactionsCompleted: {},
          interactionsTotal: 0,
          scrollDepth: 100,
          timeSpent: 60000
        },
        completedAt: 1699876543210
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockState); // getEngagementState call

      const result = await scorm_engagement_get_state({ session_id: 'test' });

      expect(result.state.complete).toBe(true);
      expect(result.state.completedAt).toBe(1699876543210);
    });
  });

  describe('scorm_engagement_get_progress', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('returns engagement progress when API is available', async () => {
      const mockProgress = {
        percentage: 60,
        items: [
          { type: 'viewAllTabs', label: 'View all tabs', complete: false },
          { type: 'scrollDepth', label: 'Scroll to 80%', complete: true },
          { type: 'interactionComplete', label: 'Complete quiz', complete: true }
        ]
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockProgress); // getEngagementProgress call

      const result = await scorm_engagement_get_progress({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        progress: mockProgress
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'window.SCORMAutomation.getEngagementProgress()',
        'test'
      );
    });

    test('returns 100% progress when complete', async () => {
      const mockProgress = {
        percentage: 100,
        items: [
          { type: 'viewAllTabs', label: 'View all tabs', complete: true },
          { type: 'scrollDepth', label: 'Scroll to 80%', complete: true }
        ]
      };

      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(mockProgress); // getEngagementProgress call

      const result = await scorm_engagement_get_progress({ session_id: 'test' });

      expect(result.progress.percentage).toBe(100);
      expect(result.progress.items.every(item => item.complete)).toBe(true);
    });
  });

  describe('scorm_engagement_mark_tab_viewed', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('marks tab as viewed', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(undefined); // markTabViewed call

      const result = await scorm_engagement_mark_tab_viewed({
        session_id: 'test',
        tab_id: 'tab-overview'
      });

      expect(result).toEqual({
        available: true,
        success: true,
        tab_id: 'tab-overview'
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        "window.SCORMAutomation.markTabViewed('tab-overview')",
        'test'
      );
    });

    test('properly escapes tab_id with special characters', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(undefined); // markTabViewed call

      await scorm_engagement_mark_tab_viewed({
        session_id: 'test',
        tab_id: "tab's-name"
      });

      const call = RuntimeManager.executeJS.mock.calls[1];
      const expression = call[1];
      
      // Should escape the single quote
      expect(expression).toBe("window.SCORMAutomation.markTabViewed('tab\\'s-name')");
    });
  });

  describe('scorm_engagement_set_scroll_depth', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('sets scroll depth percentage', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(undefined); // setScrollDepth call

      const result = await scorm_engagement_set_scroll_depth({
        session_id: 'test',
        percentage: 75
      });

      expect(result).toEqual({
        available: true,
        success: true,
        percentage: 75
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'window.SCORMAutomation.setScrollDepth(75)',
        'test'
      );
    });

    test('handles decimal percentages', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(undefined); // setScrollDepth call

      const result = await scorm_engagement_set_scroll_depth({
        session_id: 'test',
        percentage: 33.33
      });

      expect(result.percentage).toBe(33.33);
      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'window.SCORMAutomation.setScrollDepth(33.33)',
        'test'
      );
    });

    test('handles edge cases (0 and 100)', async () => {
      const testCases = [0, 100];

      for (const percentage of testCases) {
        jest.clearAllMocks();
        RuntimeManager.executeJS = jest.fn()
          .mockResolvedValueOnce(true) // API check
          .mockResolvedValueOnce(undefined); // setScrollDepth call

        const result = await scorm_engagement_set_scroll_depth({
          session_id: 'test',
          percentage
        });

        expect(result.percentage).toBe(percentage);
        expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
          null,
          `window.SCORMAutomation.setScrollDepth(${percentage})`,
          'test'
        );
      }
    });
  });

  describe('scorm_engagement_reset', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('resets engagement state', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockResolvedValueOnce(undefined); // resetEngagement call

      const result = await scorm_engagement_reset({ session_id: 'test' });

      expect(result).toEqual({
        available: true,
        success: true
      });

      expect(RuntimeManager.executeJS).toHaveBeenCalledWith(
        null,
        'window.SCORMAutomation.resetEngagement()',
        'test'
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      RuntimeManager.executeJS = jest.fn()
        .mockImplementation((_, expression) => {
          if (expression.includes('typeof window.SCORMAutomation')) {
            return Promise.resolve(true);
          }
          return Promise.resolve(null);
        });
    });

    test('scorm_engagement_get_state throws AUTOMATION_API_ERROR on executeJS failure', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockRejectedValueOnce(new Error('Browser context destroyed'));

      await expect(
        scorm_engagement_get_state({ session_id: 'test' })
      ).rejects.toMatchObject({
        code: 'AUTOMATION_API_ERROR',
        name: 'AutomationAPIError',
        message: expect.stringContaining('Failed to get engagement state')
      });
    });

    test('scorm_engagement_mark_tab_viewed throws AUTOMATION_API_ERROR on executeJS failure', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockRejectedValueOnce(new Error('Tab not found'));

      await expect(
        scorm_engagement_mark_tab_viewed({ session_id: 'test', tab_id: 'invalid' })
      ).rejects.toMatchObject({
        code: 'AUTOMATION_API_ERROR',
        name: 'AutomationAPIError',
        message: expect.stringContaining('Failed to mark tab as viewed')
      });
    });

    test('scorm_engagement_set_scroll_depth throws AUTOMATION_API_ERROR on executeJS failure', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockRejectedValueOnce(new Error('Invalid scroll depth'));

      await expect(
        scorm_engagement_set_scroll_depth({ session_id: 'test', percentage: 50 })
      ).rejects.toMatchObject({
        code: 'AUTOMATION_API_ERROR',
        name: 'AutomationAPIError',
        message: expect.stringContaining('Failed to set scroll depth')
      });
    });

    test('scorm_engagement_reset throws AUTOMATION_API_ERROR on executeJS failure', async () => {
      RuntimeManager.executeJS = jest.fn()
        .mockResolvedValueOnce(true) // API check
        .mockRejectedValueOnce(new Error('Reset failed'));

      await expect(
        scorm_engagement_reset({ session_id: 'test' })
      ).rejects.toMatchObject({
        code: 'AUTOMATION_API_ERROR',
        name: 'AutomationAPIError',
        message: expect.stringContaining('Failed to reset engagement')
      });
    });
  });
});
