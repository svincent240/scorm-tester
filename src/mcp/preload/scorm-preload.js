(function () {
  try {
    // Guard: ensure we are in an Electron renderer with preload privileges
    // eslint-disable-next-line no-undef
    const { contextBridge, ipcRenderer } = require('electron');

    // Provide a minimal bridge for invoking SCORM API via main process
    const bridge = {
      apiInvoke: async (method, args) => {
        try {
          const res = await ipcRenderer.invoke('scorm-mcp:api', { method, args: Array.isArray(args) ? args : [] });
          return typeof res === 'string' ? res : String(res);
        } catch (e) {
          return 'false';
        }
      },
      snInvoke: async (action, payload) => {
        try {
          const res = await ipcRenderer.invoke('scorm-mcp:sn', { action, payload: payload || {} });
          return res;
        } catch (e) {
          return null;
        }
      }
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

    function wrap(method) {
      return async function () {
        const args = Array.from(arguments).map(a => String(a));
        // eslint-disable-next-line no-undef
        const ts = Date.now();
        const result = await bridge.apiInvoke(method, args);
        try {
          // eslint-disable-next-line no-undef
          window.__scorm_calls.push({ ts, method, parameters: args, result });
        } catch (_) {}
        return result;
      };
    }

    // Expose SCORM 2004 API (window.API_1484_11)
    contextBridge.exposeInMainWorld('API_1484_11', {
      Initialize: wrap('Initialize'),
      Terminate: wrap('Terminate'),
      GetValue: wrap('GetValue'),
      SetValue: wrap('SetValue'),
      Commit: wrap('Commit'),
      GetLastError: wrap('GetLastError'),
      GetErrorString: wrap('GetErrorString'),
      GetDiagnostic: wrap('GetDiagnostic')
    });
  } catch (e) {
    // Preload failed; do nothing (runtime will fall back)
  }
})();

