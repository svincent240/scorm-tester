/**
 * SCORM API Bridge Service
 * 
 * Handles SCORM API injection and communication between iframe content and the main application.
 * Preserves critical fixes from troubleshooting while maintaining clean architecture.
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
    this.setupMessageHandler();
  }

  /**
   * Set up message handler for SCORM API calls from iframe
   */
  setupMessageHandler() {
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SCORM_API_CALL') {
        console.log('SCORM API Bridge: Received API call from iframe:', event.data);
        this.handleScormAPICall(event.data, event.source);
      }
    });
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
      console.error('SCORM API Bridge Error:', error);
      
      // Log the error as an API call
      this.logApiCall(method, params, 'false', '101');
      
      if (source && source.postMessage) {
        source.postMessage({
          type: 'SCORM_API_RESPONSE',
          callId,
          result: 'false',
          error: error.message
        }, '*');
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
   * Inject SCORM API into iframe content (CRITICAL: preserved from troubleshooting)
   */
  injectScormAPI(contentFrame) {
    console.log('SCORM API Bridge: Injecting SCORM API into iframe');
    
    try {
      const contentUrl = contentFrame.src;
      const apiScript = this.generateAPIScript();
      const wrapperHtml = this.generateWrapperHTML(apiScript, contentUrl);
      
      contentFrame.srcdoc = wrapperHtml;
      console.log('SCORM API Bridge: API injection completed successfully');
      
    } catch (error) {
      console.error('SCORM API Bridge: Error during API injection:', error);
    }
  }

  /**
   * Generate SCORM API script for injection
   */
  generateAPIScript() {
    return `
      console.log('SCORM API: Enhanced injection with real data flow');
      
      function createScormAPICall(method) {
        return function(...params) {
          const callId = 'call_' + Date.now() + '_' + Math.random();
          
          parent.postMessage({
            type: 'SCORM_API_CALL',
            method: method,
            params: params,
            callId: callId
          }, '*');
          
          // Return synchronous defaults for immediate response
          switch (method) {
            case 'Initialize':
            case 'Terminate':
            case 'SetValue':
            case 'Commit':
              return 'true';
            case 'GetLastError':
              return '0';
            case 'GetErrorString':
              return 'No error';
            case 'GetDiagnostic':
              return 'No diagnostic information';
            case 'GetValue':
              return this.getDefaultValue(params[0]);
            default:
              return '';
          }
        };
      }
      
      // Default values for GetValue calls
      function getDefaultValue(element) {
        const defaults = {
          'cmi.completion_status': 'incomplete',
          'cmi.success_status': 'unknown',
          'cmi.learner_id': 'test_learner',
          'cmi.learner_name': 'Test Learner',
          'cmi.credit': 'credit',
          'cmi.mode': 'normal',
          'cmi.entry': 'ab-initio',
          'cmi.exit': '',
          'cmi.session_time': 'PT0H0M0S',
          'cmi.total_time': 'PT0H0M0S',
          'cmi.location': '',
          'cmi.suspend_data': '',
          'cmi.score.scaled': '',
          'cmi.score.raw': '',
          'cmi.score.min': '',
          'cmi.score.max': '',
          'cmi.progress_measure': '0'
        };
        return defaults[element] || '';
      }
      
      // Inject SCORM 2004 API
      window.API_1484_11 = {
        Initialize: createScormAPICall('Initialize'),
        Terminate: createScormAPICall('Terminate'),
        GetValue: createScormAPICall('GetValue'),
        SetValue: createScormAPICall('SetValue'),
        Commit: createScormAPICall('Commit'),
        GetLastError: createScormAPICall('GetLastError'),
        GetErrorString: createScormAPICall('GetErrorString'),
        GetDiagnostic: createScormAPICall('GetDiagnostic')
      };
      
      // Inject SCORM 1.2 API for compatibility
      window.API = {
        LMSInitialize: window.API_1484_11.Initialize,
        LMSFinish: window.API_1484_11.Terminate,
        LMSGetValue: window.API_1484_11.GetValue,
        LMSSetValue: window.API_1484_11.SetValue,
        LMSCommit: window.API_1484_11.Commit,
        LMSGetLastError: window.API_1484_11.GetLastError,
        LMSGetErrorString: window.API_1484_11.GetErrorString,
        LMSGetDiagnostic: window.API_1484_11.GetDiagnostic
      };
      
      console.log('SCORM API enhanced injection completed');
    `;
  }

  /**
   * Generate wrapper HTML for API injection
   */
  generateWrapperHTML(apiScript, contentUrl) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <script>${apiScript}</script>
      </head>
      <body>
        <script>
          console.log('SCORM Tester: Redirecting to content with enhanced API:', '${contentUrl}');
          try {
            window.location.href = '${contentUrl}';
          } catch (error) {
            console.error('SCORM Tester: Failed to redirect to content:', error);
            document.body.innerHTML = '<h3>Error loading SCORM content</h3><p>URL: ${contentUrl}</p><p>Error: ' + error.message + '</p>';
          }
        </script>
      </body>
      </html>
    `;
  }
  /**
   * Log API call for debug panel
   * @private
   */
  logApiCall(method, params, result, errorCode = '0') {
    const apiCall = {
      method,
      parameter: params ? (Array.isArray(params) ? params.join(', ') : String(params)) : '',
      result: String(result),
      errorCode,
      timestamp: Date.now()
    };

    console.log('SCORM API Bridge: Logging API call:', apiCall);
    
    // Emit event for debug panel in same window
    eventBus.emit('api:call', { data: apiCall });
    
    // Also emit via IPC for debug window
    if (window.electronAPI && window.electronAPI.emitDebugEvent) {
      console.log('SCORM API Bridge: Emitting debug event via IPC:', apiCall);
      window.electronAPI.emitDebugEvent('api:call', apiCall);
    }
    
    // Legacy IPC event for backward compatibility
    if (window.electronAPI && window.electronAPI.log) {
      window.electronAPI.log('scorm-api-call', apiCall);
    }
  }
}

// Create and export singleton instance
const scormAPIBridge = new ScormAPIBridge();

export { ScormAPIBridge, scormAPIBridge };