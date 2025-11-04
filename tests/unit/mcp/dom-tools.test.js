const { scorm_dom_click, scorm_dom_fill, scorm_dom_query, scorm_dom_evaluate, scorm_dom_wait_for, scorm_keyboard_type } = require('../../../src/mcp/tools/dom');

// Mock RuntimeManager
jest.mock('../../../src/mcp/runtime-manager', () => ({
  RuntimeManager: {
    getPersistent: jest.fn()
  }
}));

// Mock sessions
jest.mock('../../../src/mcp/session', () => ({
  emit: jest.fn()
}));

const { RuntimeManager } = require('../../../src/mcp/runtime-manager');

describe('DOM Interaction Tools', () => {
  let mockWin;
  let mockWebContents;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock webContents with executeJavaScript
    mockWebContents = {
      executeJavaScript: jest.fn()
    };
    
    // Create mock window
    mockWin = {
      webContents: mockWebContents
    };
    
    // Default: return the mock window
    RuntimeManager.getPersistent.mockReturnValue(mockWin);
  });

  describe('scorm_dom_click', () => {
    test('requires session_id parameter', async () => {
      await expect(scorm_dom_click({})).rejects.toThrow('session_id is required');
      await expect(scorm_dom_click({})).rejects.toMatchObject({ code: 'MCP_INVALID_PARAMS' });
    });

    test('requires selector parameter', async () => {
      await expect(scorm_dom_click({ session_id: 'test-session' })).rejects.toThrow('selector is required');
      await expect(scorm_dom_click({ session_id: 'test-session' })).rejects.toMatchObject({ code: 'MCP_INVALID_PARAMS' });
    });

    test('throws error if runtime not open', async () => {
      RuntimeManager.getPersistent.mockReturnValue(null);
      await expect(scorm_dom_click({ session_id: 'test-session', selector: '.button' }))
        .rejects.toThrow('Runtime not open');
      await expect(scorm_dom_click({ session_id: 'test-session', selector: '.button' }))
        .rejects.toMatchObject({ code: 'RUNTIME_NOT_OPEN' });
    });

    test('executes click script and returns result', async () => {
      const mockResult = {
        success: true,
        element: { tagName: 'BUTTON', id: 'next-btn', className: 'btn-primary', textContent: 'Next' }
      };
      mockWebContents.executeJavaScript.mockResolvedValue(mockResult);

      const result = await scorm_dom_click({ session_id: 'test-session', selector: '#next-btn' });

      expect(result).toEqual(mockResult);
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('document.querySelector'),
        true
      );
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('#next-btn'),
        true
      );
    });

    test('supports different click types', async () => {
      mockWebContents.executeJavaScript.mockResolvedValue({ success: true, element: {} });

      await scorm_dom_click({ 
        session_id: 'test-session', 
        selector: '.button',
        options: { click_type: 'double' }
      });

      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('double'),
        true
      );
    });

    test('throws DOM_CLICK_FAILED on execution error', async () => {
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Element not found'));

      await expect(scorm_dom_click({ session_id: 'test-session', selector: '.missing' }))
        .rejects.toThrow('DOM click failed');
      await expect(scorm_dom_click({ session_id: 'test-session', selector: '.missing' }))
        .rejects.toMatchObject({ code: 'DOM_CLICK_FAILED' });
    });
  });

  describe('scorm_dom_fill', () => {
    test('requires session_id parameter', async () => {
      await expect(scorm_dom_fill({})).rejects.toThrow('session_id is required');
    });

    test('requires selector parameter', async () => {
      await expect(scorm_dom_fill({ session_id: 'test-session' })).rejects.toThrow('selector is required');
    });

    test('requires value parameter', async () => {
      await expect(scorm_dom_fill({ session_id: 'test-session', selector: 'input' }))
        .rejects.toThrow('value is required');
    });

    test('fills text input and returns result', async () => {
      const mockResult = {
        success: true,
        element: { tagName: 'INPUT', type: 'text', value: 'test value' }
      };
      mockWebContents.executeJavaScript.mockResolvedValue(mockResult);

      const result = await scorm_dom_fill({ 
        session_id: 'test-session', 
        selector: '#name-input',
        value: 'test value'
      });

      expect(result).toEqual(mockResult);
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('test value'),
        true
      );
    });

    test('handles checkbox values', async () => {
      mockWebContents.executeJavaScript.mockResolvedValue({ success: true, element: { checked: true } });

      await scorm_dom_fill({ 
        session_id: 'test-session', 
        selector: '#agree-checkbox',
        value: true
      });

      expect(mockWebContents.executeJavaScript).toHaveBeenCalled();
    });

    test('throws DOM_FILL_FAILED on execution error', async () => {
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Element not found'));

      await expect(scorm_dom_fill({ session_id: 'test-session', selector: '.missing', value: 'test' }))
        .rejects.toMatchObject({ code: 'DOM_FILL_FAILED' });
    });
  });

  describe('scorm_dom_query', () => {
    test('requires session_id parameter', async () => {
      await expect(scorm_dom_query({})).rejects.toThrow('session_id is required');
    });

    test('requires selector parameter', async () => {
      await expect(scorm_dom_query({ session_id: 'test-session' })).rejects.toThrow('selector is required');
    });

    test('queries element state and returns result', async () => {
      const mockResult = {
        found: true,
        selector: '.content',
        textContent: 'Hello World',
        visible: true,
        tagName: 'DIV'
      };
      mockWebContents.executeJavaScript.mockResolvedValue(mockResult);

      const result = await scorm_dom_query({ 
        session_id: 'test-session', 
        selector: '.content'
      });

      expect(result).toEqual(mockResult);
      expect(result.found).toBe(true);
      expect(result.textContent).toBe('Hello World');
    });

    test('supports different query types', async () => {
      mockWebContents.executeJavaScript.mockResolvedValue({ found: true, textContent: 'test' });

      await scorm_dom_query({ 
        session_id: 'test-session', 
        selector: '.element',
        query_type: 'text'
      });

      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('text'),
        true
      );
    });

    test('returns not found for missing elements', async () => {
      mockWebContents.executeJavaScript.mockResolvedValue({ found: false, selector: '.missing' });

      const result = await scorm_dom_query({ 
        session_id: 'test-session', 
        selector: '.missing'
      });

      expect(result.found).toBe(false);
    });
  });

  describe('scorm_dom_evaluate', () => {
    test('requires session_id parameter', async () => {
      await expect(scorm_dom_evaluate({})).rejects.toThrow('session_id is required');
    });

    test('requires expression parameter', async () => {
      await expect(scorm_dom_evaluate({ session_id: 'test-session' }))
        .rejects.toThrow('expression is required');
    });

    test('executes JavaScript and returns result', async () => {
      mockWebContents.executeJavaScript.mockResolvedValue({ count: 5 });

      const result = await scorm_dom_evaluate({ 
        session_id: 'test-session', 
        expression: 'document.querySelectorAll(".item").length'
      });

      expect(result).toEqual({ result: { count: 5 } });
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        'document.querySelectorAll(".item").length',
        true
      );
    });

    test('throws DOM_EVALUATE_FAILED on execution error', async () => {
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Syntax error'));

      await expect(scorm_dom_evaluate({ session_id: 'test-session', expression: 'invalid js' }))
        .rejects.toMatchObject({ code: 'DOM_EVALUATE_FAILED' });
    });
  });

  describe('scorm_dom_wait_for', () => {
    test('requires session_id parameter', async () => {
      await expect(scorm_dom_wait_for({})).rejects.toThrow('session_id is required');
    });

    test('requires condition parameter', async () => {
      await expect(scorm_dom_wait_for({ session_id: 'test-session' }))
        .rejects.toThrow('condition is required');
    });

    test('waits for condition and returns result', async () => {
      const mockResult = { success: true, elapsed_ms: 150 };
      mockWebContents.executeJavaScript.mockResolvedValue(mockResult);

      const result = await scorm_dom_wait_for({ 
        session_id: 'test-session', 
        condition: { selector: '.loaded', visible: true }
      });

      expect(result).toEqual(mockResult);
      expect(result.success).toBe(true);
      expect(result.elapsed_ms).toBe(150);
    });

    test('throws DOM_WAIT_FAILED on timeout', async () => {
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Wait condition timeout'));

      await expect(scorm_dom_wait_for({ 
        session_id: 'test-session', 
        condition: { selector: '.never-appears' }
      })).rejects.toMatchObject({ code: 'DOM_WAIT_FAILED' });
    });
  });

  describe('scorm_keyboard_type', () => {
    test('requires session_id parameter', async () => {
      await expect(scorm_keyboard_type({})).rejects.toThrow('session_id is required');
    });

    test('requires text parameter', async () => {
      await expect(scorm_keyboard_type({ session_id: 'test-session' }))
        .rejects.toThrow('text is required');
    });

    test('types text and returns result', async () => {
      const mockResult = {
        success: true,
        characters_typed: 11,
        element: { tagName: 'INPUT', value: 'Hello World' }
      };
      mockWebContents.executeJavaScript.mockResolvedValue(mockResult);

      const result = await scorm_keyboard_type({ 
        session_id: 'test-session', 
        text: 'Hello World'
      });

      expect(result).toEqual(mockResult);
      expect(result.characters_typed).toBe(11);
    });

    test('supports selector option', async () => {
      mockWebContents.executeJavaScript.mockResolvedValue({ success: true, characters_typed: 4 });

      await scorm_keyboard_type({ 
        session_id: 'test-session', 
        text: 'test',
        options: { selector: '#input-field' }
      });

      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('#input-field'),
        true
      );
    });

    test('throws KEYBOARD_TYPE_FAILED on execution error', async () => {
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('No focused element'));

      await expect(scorm_keyboard_type({ session_id: 'test-session', text: 'test' }))
        .rejects.toMatchObject({ code: 'KEYBOARD_TYPE_FAILED' });
    });
  });
});

