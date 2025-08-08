/**
 * SCORM API Bridge Service
 * 
 * Handles SCORM API injection and communication between iframe content and the main application.
 *
 * @fileoverview SCORM API bridge for iframe communication
 */

import { scormClient } from './scorm-client.js';
import { eventBus } from './event-bus.js';

/**
 * SCORM API Bridge Class
 * 
 * Manages SCORM API communication between iframe content and the renderer process.
 */
class ScormAPIBridge {
  constructor() {
    this.sessionId = null;
    // Lazy activation flag — message handler is installed only when enable() is called.
    this.isEnabled = false;
    this._boundMessageHandler = null;
  }

  /**
   * Set up message handler for SCORM API calls from iframe
   *
   * NOTE: Deprecated — prefer enable()/disable() for explicit control.
   */
  setupMessageHandler() {
    // Backwards-compatible shim that simply enables the bridge.
    if (!this.isEnabled) this.enable();
  }

  /**
   * Enable the bridge: install the window message handler.
   * Safe to call multiple times (idempotent).
   */
  enable() {
    if (this.isEnabled) return;
    this._boundMessageHandler = (event) => {
      if (event.data && event.data.type === 'SCORM_API_CALL') {
        this.handleScormAPICall(event.data, event.source);
      }
    };
    window.addEventListener('message', this._boundMessageHandler);
    this.isEnabled = true;
  }

  /**
   * Disable the bridge: remove the window message handler.
   */
  disable() {
    if (!this.isEnabled) return;
    try {
      if (this._boundMessageHandler) {
        window.removeEventListener('message', this._boundMessageHandler);
      }
    } finally {
      this._boundMessageHandler = null;
      this.isEnabled = false;
    }
  }

  /**
   * Handle SCORM API calls from iframe content
   */
  async handleScormAPICall(data, source) {
    const { method, params, callId } = data;
    
    try {
      // Initialize session if needed
      if (!this.sessionId && method === 'Initialize') {
        this.sessionId = 'session_' + Date.now();
        scormClient.Initialize(this.sessionId);
      }

      let result = this.executeScormMethod(method, params);

      // Emit API call event for debug panel
      this.logApiCall(method, params, result);

      // Send response back to iframe
      if (source && source.postMessage) {
        source.postMessage({
          type: 'SCORM_API_RESPONSE',
          callId,
          result
        }, '*');
      }

    } catch (error) {
      // Route renderer errors via centralized logger (no console.* in renderer)
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        rendererLogger?.error('SCORM API Bridge Error', { method, message: error?.message || String(error) });
      } catch (_) { /* no-op */ }

      // Log the error as an API call
      this.logApiCall(method, params, 'false', '101');

      if (source && source.postMessage) {
        try {
          source.postMessage({
            type: 'SCORM_API_RESPONSE',
            callId,
            result: 'false',
            error: error?.message || String(error)
          }, '*');
        } catch (_e) { /* no-op */ }
      }
    }
  }

  /**
   * Execute SCORM method and return result
   */
  executeScormMethod(method, params) {
    switch (method) {
      case 'Initialize':
        return scormClient.Initialize(this.sessionId || 'default');
      case 'Terminate':
        return scormClient.Terminate(params[0] || '');
      case 'GetValue':
        return scormClient.GetValue(params[0]);
      case 'SetValue':
        return scormClient.SetValue(params[0], params[1]);
      case 'Commit':
        return scormClient.Commit(params[0] || '');
      case 'GetLastError':
        return scormClient.GetLastError();
      case 'GetErrorString':
        return scormClient.GetErrorString(params[0]);
      case 'GetDiagnostic':
        return scormClient.GetDiagnostic(params[0]);
      default:
        return '0';
    }
  }
  /**
   * Log API call for debug panel
   * @private
   */
  logApiCall(method, params, result, errorCode = '0') {
    const startedAt = Date.now();
    // Normalize and sanitize args (avoid leaking large/sensitive payloads)
    const parameter = params ? (Array.isArray(params) ? params.map(p => String(p).slice(0, 512)).join(', ') : String(params).slice(0, 512)) : '';
    const apiCall = {
      id: startedAt + Math.random(),
      seq: startedAt, // simple monotonic-ish base; aggregator may refine
      method,
      parameter,
      result: String(result),
      errorCode: String(errorCode),
      timestamp: startedAt
    };

    // Emit event for debug panel in same window
    eventBus.emit('api:call', { data: apiCall });
    
    // Also emit via IPC for debug window
    if (window.electronAPI && window.electronAPI.emitDebugEvent) {
      try { window.electronAPI.emitDebugEvent('api:call', apiCall); } catch (_e) { /* no-op */ }
    }
    
    // Route to centralized logger with subsystem tag
    import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
      rendererLogger?.debug('[RTE/API] call', apiCall);
    }).catch(() => { /* no-op */ });

    // Legacy IPC event for backward compatibility
    if (window.electronAPI && window.electronAPI.log) {
      try { window.electronAPI.log('scorm-api-call', apiCall); } catch (_e) { /* no-op */ }
    }
  }
}

// Create and export singleton instance
const scormAPIBridge = new ScormAPIBridge();
 
// Export initialize helper for tests and instrumentation — consumers can opt-in to enable()
export function initializeScormAPIBridge() {
  if (scormAPIBridge && typeof scormAPIBridge.enable === 'function') {
    scormAPIBridge.enable();
  }
  return scormAPIBridge;
}
 
export { ScormAPIBridge, scormAPIBridge };