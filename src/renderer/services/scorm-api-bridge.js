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
    this._scormClient = null;
  }

  /**
   * Set the SCORM client reference for synchronous API calls
   * @param {Object} scormClient - The SCORM client instance
   */
  setScormClient(scormClient) {
    this._scormClient = scormClient;
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
   * Execute SCORM method and return result synchronously
   */
  executeScormMethod(method, params) {
    // Import synchronously using cached module reference
    let scormClient;
    try {
      // Use the imported scormClient from module scope
      scormClient = this._scormClient;
      if (!scormClient) {
        // Fallback: return error code if client not available
        return '101'; // General error code
      }
    } catch (e) {
      return '101';
    }
    
    let result;
    try {
      switch (method) {
        case 'Initialize':
        case 'LMSInitialize':
          // Generate session ID if not already set
          if (!this.sessionId) {
            this.sessionId = 'session_' + Date.now();
          }
          result = scormClient.Initialize(this.sessionId);
          break;
        case 'Terminate':
        case 'LMSFinish':
          result = scormClient.Terminate(params[0] || '');
          break;
        case 'GetValue':
        case 'LMSGetValue':
          result = scormClient.GetValue(params[0]);
          break;
        case 'SetValue':
        case 'LMSSetValue':
          result = scormClient.SetValue(params[0], params[1]);
          break;
        case 'Commit':
        case 'LMSCommit':
          result = scormClient.Commit(params[0] || '');
          break;
        case 'GetLastError':
        case 'LMSGetLastError':
          result = scormClient.GetLastError();
          break;
        case 'GetErrorString':
        case 'LMSGetErrorString':
          result = scormClient.GetErrorString(params[0]);
          break;
        case 'GetDiagnostic':
        case 'LMSGetDiagnostic':
          result = scormClient.GetDiagnostic(params[0]);
          break;
        default:
          result = 'false'; // Return 'false' for unknown methods, not '0'
      }
    } catch (error) {
      // If any SCORM method throws, return error code instead of crashing
      result = '101';
    }
    
    return result;
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