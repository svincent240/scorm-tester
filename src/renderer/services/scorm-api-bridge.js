/**
 * SCORM API Bridge Service
 * 
 * Handles SCORM API injection and communication between iframe content and the main application.
 *
 * @fileoverview SCORM API bridge for iframe communication
 */


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
    let result;
    let error = null;

    try {
      // Execute SCORM method
      result = this.executeScormMethod(method, params);

      // Send response back to iframe
      if (source && source.postMessage) {
        source.postMessage({
          type: 'SCORM_API_RESPONSE',
          callId,
          result
        }, '*');
      }

    } catch (error) {

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
  async executeScormMethod(method, params) {
    const { scormClient } = await import('./scorm-client.js');
    switch (method) {
      case 'Initialize':
        // Generate session ID if not already set
        if (!this.sessionId) {
          this.sessionId = 'session_' + Date.now();
        }
        return scormClient.Initialize(this.sessionId);
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