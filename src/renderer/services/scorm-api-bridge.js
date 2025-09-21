// @ts-check

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
   * Execute SCORM method and return result synchronously
   */
  executeScormMethod(method, params) {
    if (!this._scormClient) {
      return '101';
    }

    try {
      switch (method) {
        case 'Initialize':
        case 'LMSInitialize':
          if (!this.sessionId) {
            this.sessionId = 'session_' + Date.now();
          }
          return this._scormClient.Initialize(this.sessionId);
        case 'Terminate':
        case 'LMSFinish':
          return this._scormClient.Terminate(params[0] || '');
        case 'GetValue':
        case 'LMSGetValue':
          return this._scormClient.GetValue(params[0]);
        case 'SetValue':
        case 'LMSSetValue':
          return this._scormClient.SetValue(params[0], params[1]);
        case 'Commit':
        case 'LMSCommit':
          return this._scormClient.Commit(params[0] || '');
        case 'GetLastError':
        case 'LMSGetLastError':
          return this._scormClient.GetLastError();
        case 'GetErrorString':
        case 'LMSGetErrorString':
          return this._scormClient.GetErrorString(params[0]);
        case 'GetDiagnostic':
        case 'LMSGetDiagnostic':
          return this._scormClient.GetDiagnostic(params[0]);
        default:
          return 'false';
      }
    } catch (error) {
      return '101';
    }
  }
}

const scormAPIBridge = new ScormAPIBridge();

export function initializeScormAPIBridge() {
  return scormAPIBridge;
}

export { ScormAPIBridge, scormAPIBridge };