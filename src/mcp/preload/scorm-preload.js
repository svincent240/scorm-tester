(function () {
  try {
    // Guard: ensure we are in an Electron renderer with preload privileges
    // eslint-disable-next-line no-undef
    const { contextBridge, ipcRenderer } = require('electron');

    // Local capture buffer (lives in isolated world); expose getter via SCORM_MCP.getCalls()
    const __calls = [];

    // Provide a minimal bridge for invoking SCORM API via main process
    const bridge = {
      // Synchronous API invoke for SCORM compliance
      // Real SCORM content expects synchronous API methods that return strings immediately
      apiInvokeSync: (method, args) => {
        try {
          const res = ipcRenderer.sendSync('scorm-mcp:api-sync', { method, args: Array.isArray(args) ? args : [] });
          return typeof res === 'string' ? res : String(res);
        } catch (e) {
          try { ipcRenderer.send('renderer-log-error', '[MCP preload] apiInvokeSync failed', e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
          return 'false';
        }
      },
      // Async API invoke for MCP tools that can handle promises
      apiInvoke: async (method, args) => {
        try {
          const res = await ipcRenderer.invoke('scorm-mcp:api', { method, args: Array.isArray(args) ? args : [] });
          return typeof res === 'string' ? res : String(res);
        } catch (e) {
          try { ipcRenderer.invoke('renderer-log-error', '[MCP preload] apiInvoke failed', e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
          return 'false';
        }
      },
      snInvoke: async (action, payload) => {
        try {
          const res = await ipcRenderer.invoke('scorm-mcp:sn', { action, payload: payload || {} });
          return res;
        } catch (e) {
          try { ipcRenderer.invoke('renderer-log-error', '[MCP preload] snInvoke failed', e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
          return null;
        }
      },
      getCalls: () => __calls.slice(0)
    };

    contextBridge.exposeInMainWorld('SCORM_MCP', bridge);

    // Local capture buffer so existing MCP tools can read calls (via executeJavaScript)
    // We intentionally keep this simple and only capture method, parameters, and result.
    // Timestamp is recorded client-side.
    // eslint-disable-next-line no-undef
    if (!window.__scorm_calls) {
      // eslint-disable-next-line no-undef
      window.__scorm_calls = [];
    }

    // Synchronous wrapper for SCORM API compliance
    // Real SCORM content expects synchronous methods that return strings immediately
    function wrapSync(method) {
      return function () {
        const args = Array.from(arguments).map(a => String(a));
        // eslint-disable-next-line no-undef
        const ts = Date.now();
        const result = bridge.apiInvokeSync(method, args);
        try {
          __calls.push({ ts, method, parameters: args, result });
          // eslint-disable-next-line no-undef
          if (Array.isArray(window.__scorm_calls)) window.__scorm_calls.push({ ts, method, parameters: args, result });
        } catch (_) { /* intentionally empty */ }
        return result;
      };
    }

    // Expose SCORM 2004 API (window.API_1484_11) with synchronous methods
    // This is required for SCORM compliance - content expects immediate string returns
    contextBridge.exposeInMainWorld('API_1484_11', {
      Initialize: wrapSync('Initialize'),
      Terminate: wrapSync('Terminate'),
      GetValue: wrapSync('GetValue'),
      SetValue: wrapSync('SetValue'),
      Commit: wrapSync('Commit'),
      GetLastError: wrapSync('GetLastError'),
      GetErrorString: wrapSync('GetErrorString'),
      GetDiagnostic: wrapSync('GetDiagnostic')
    });
  } catch (e) {
    try {
      const r = (typeof globalThis !== 'undefined' && globalThis.ipcRenderer) ? globalThis.ipcRenderer : null;
      if (r) {
        r.invoke('renderer-log-error', '[MCP preload] Failed to initialize SCORM_MCP bridge', e && e.message ? e.message : String(e));
      }
    } catch (_) { /* intentionally empty */ }
  }
})();

