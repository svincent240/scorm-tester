/**
 * SCORM Content Viewer Component
 * 
 * Displays SCORM content in a secure iframe with loading states,
 * error handling, and fullscreen support. Manages content lifecycle
 * and coordinates with SCORM API.
 * 
 * @fileoverview SCORM content viewer component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { scormClient } from '../../services/scorm-client.js';
import { scormAPIBridge } from '../../services/scorm-api-bridge.js';
import { rendererLogger } from '../../utils/renderer-logger.js';

/**
 * SCORM Content Viewer Class
 * 
 * Manages SCORM content display with secure iframe, loading states,
 * and integration with SCORM API.
 */
class ContentViewer extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    // Logger will be initialized dynamically when needed
    this.logger = null;
    
    this.iframe = null;
    this.currentUrl = null;
    this.loadingTimeout = null;
    this.contentWindow = null;
    this.isFullscreen = false;
    this.loadStartTime = null;
  }

  /**
   * Get default options
   */
  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'scorm-content-viewer',
      loadingTimeout: 30000,
      showLoadingIndicator: true,
      enableFullscreen: true,
      enableContentScaling: true, // Enable to make SCORM content responsive
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals',
      attributes: {
        'data-component': 'content-viewer'
      }
    };
  }

  /**
   * Setup component
   */
  async setup() {
    this.uiState = await uiStatePromise;
    this.createIframe();
    this.createLoadingIndicator();
    this.createErrorDisplay();
    this.createNoContentDisplay();
    
    if (this.options.enableFullscreen) {
      this.createFullscreenControls();
    }
  }

  /**
   * Render component content
   */
  renderContent() {
    // Find existing iframe first to preserve existing HTML
    this.iframe = this.find('.content-viewer__frame') || this.find('#content-frame');
    
    // If no iframe exists, create minimal structure
    if (!this.iframe) {
      // NOTE: Per dev_docs, avoid console.* in renderer. Route via UI notification only if needed.
      this.element.innerHTML = `
        <div class="content-viewer__container">
          <div class="content-viewer__welcome">
            <div class="welcome-screen">
              <div class="welcome-screen__icon">🎓</div>
              <div class="welcome-screen__title">SCORM Content Viewer</div>
              <div class="welcome-screen__message">Load a SCORM course to begin</div>
            </div>
          </div>
          
          <iframe
            id="content-frame"
            class="content-viewer__frame hidden"
            sandbox="${this.options.sandbox}"
            style="width: 100%; height: 100%; border: none;"
          ></iframe>
          
          <div class="content-viewer__loading hidden">
            <div class="loading-spinner">
              <div class="spinner"></div>
              <div class="loading-message">Loading course content...</div>
            </div>
          </div>
          
          <div class="content-viewer__error hidden">
            <div class="error-display">
              <div class="error-icon">⚠️</div>
              <div class="error-message">Failed to load content</div>
              <div class="error-details"></div>
              <button class="error-retry-btn">Retry</button>
            </div>
          </div>
          
          <div class="content-viewer__no-content hidden">
            <div class="no-content-display">
              <div class="no-content-icon">📄</div>
              <div class="no-content-message">No content available</div>
            </div>
          </div>
          
          ${this.options.enableFullscreen ? `
            <button class="content-viewer__fullscreen-btn" title="Fullscreen">⛶</button>
          ` : ''}
        </div>
      `;
      
      // Update references after creating structure
      this.iframe = this.find('#content-frame');
    }
    
    // Get references to elements (existing or newly created)
    this.loadingElement = this.find('.content-viewer__loading');
    this.errorElement = this.find('.content-viewer__error');
    this.noContentElement = this.find('.content-viewer__no-content');
    this.fullscreenBtn = this.find('.content-viewer__fullscreen-btn');
  }

  /**
   * Setup event subscriptions
   */
  setupEventSubscriptions() {
    // Listen for course loading events
    this.subscribe('course:loaded', this.handleCourseLoaded);
    this.subscribe('course:error', this.handleCourseError);
    
    // Listen for UI state changes
    this.subscribe('ui:updated', this.handleUIUpdate);
    
    // Listen for SCORM events
    this.subscribe('scorm:initialized', this.handleScormInitialized);
    this.subscribe('scorm:error', this.handleScormError);
  }

  /**
   * Bind component events
   */
  bindEvents() {
    super.bindEvents();

    // Lazily create and persist bound handler references for add/remove symmetry
    if (!this._boundHandlers) {
      this._boundHandlers = {
        onIframeLoad: this.handleIframeLoad.bind(this),
        onIframeError: this.handleIframeError.bind(this),
        onFullscreenBtnClick: this.toggleFullscreen.bind(this),
        onRetryClick: this.retryLoad.bind(this),
        onFsChange: this.handleFullscreenChange.bind(this),
        onWebkitFsChange: this.handleFullscreenChange.bind(this),
        onMozFsChange: this.handleFullscreenChange.bind(this),
        onMsFsChange: this.handleFullscreenChange.bind(this)
      };
    }

    if (this.iframe) {
      this.iframe.addEventListener('load', this._boundHandlers.onIframeLoad);
      this.iframe.addEventListener('error', this._boundHandlers.onIframeError);
    }

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', this._boundHandlers.onFullscreenBtnClick);
    }

    const retryBtn = this.find('.error-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', this._boundHandlers.onRetryClick);
    }

    // Listen for fullscreen changes using stored references
    document.addEventListener('fullscreenchange', this._boundHandlers.onFsChange);
    document.addEventListener('webkitfullscreenchange', this._boundHandlers.onWebkitFsChange);
    document.addEventListener('mozfullscreenchange', this._boundHandlers.onMozFsChange);
    document.addEventListener('MSFullscreenChange', this._boundHandlers.onMsFsChange);
  }

  /**
   * Load SCORM content
   * @param {string} url - Content URL
   * @param {Object} options - Loading options
   */
  async loadContent(url, options = {}) {
    if (!url) {
      this.showError('Invalid content URL', 'A valid content URL must be provided.');
      return;
    }

    // Convert local file paths to file:// URLs to avoid cross-origin restrictions
    // Skip conversion if already using scorm-app:// protocol
    let processedUrl = url;
    if (typeof url === 'string' && !url.startsWith('scorm-app://') && (url.includes('\\') || url.startsWith('C:') || url.startsWith('/'))) {
      try {
        // Convert Windows path to file:// URL
        if (url.includes('\\') || (url.match(/^[A-Za-z]:/))) {
          // Windows path - normalize and convert to file URL
          const normalizedPath = url.replace(/\\/g, '/');
          processedUrl = 'file:///' + normalizedPath.replace(/^([A-Za-z]:)/, '$1');
        } else if (url.startsWith('/')) {
          // Unix-style absolute path
          processedUrl = 'file://' + url;
        }

        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] Converted local path to file:// URL', {
            originalPath: url,
            fileUrl: processedUrl
          });
        }).catch(() => {});
      } catch (error) {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] Failed to convert path to file:// URL', {
            originalPath: url,
            error: error?.message || error
          });
        }).catch(() => {});
        throw error;
      }
    }

    this.currentUrl = processedUrl;
    this.loadStartTime = Date.now();
    
    try {
      this.showLoading();
      this.clearError();
      
      // Set loading timeout
      if (this.loadingTimeout) {
        clearTimeout(this.loadingTimeout);
      }
      
      this.loadingTimeout = setTimeout(() => {
        this.handleLoadTimeout();
      }, this.options.loadingTimeout);
      
      // Load content directly in iframe (no host frameset)
      if (this.iframe) {
        this.iframe.src = processedUrl;
      }
      
      this.emit('contentLoadStarted', { url, options });
      
    } catch (error) {
      this.showError('Failed to load content', error?.message || String(error));
      this.emit('contentLoadError', { url, error });
    }
  }

  /**
   * Handle iframe load event
   */
  handleIframeLoad() {
    const iframeLoadTime = Date.now();
    
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }
    
    const loadTime = iframeLoadTime - this.loadStartTime;
    
    try {
      this.contentWindow = this.iframe.contentWindow;
      const contentWindowAcquiredTime = Date.now();
      
      this.hideLoading();
      this.showContent();

      try {
        // Diagnostics: log initial content document state and timing
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          const docReady = (() => {
            try { return this.contentWindow?.document?.readyState || 'unknown'; } catch (_) { return 'err'; }
          })();
          rendererLogger.info('[ContentViewer] iframe load event - timing analysis', {
            url: this.currentUrl,
            loadTimeMs: loadTime,
            contentWindowAcquiredMs: contentWindowAcquiredTime - iframeLoadTime,
            docReadyState: docReady,
            timestampBreakdown: {
              iframeLoadEvent: iframeLoadTime,
              contentWindowAcquired: contentWindowAcquiredTime,
              startTime: this.loadStartTime
            }
          });
        }).catch(() => {});
      } catch (_) {}

      // Direct content loading - inject API directly into SCORM content window
      const apiSetupStartTime = Date.now();
      this.setupScormAPI();
      const apiSetupCompleteTime = Date.now();
      
      // Add Rustici detection monitoring after API setup
      const monitoringSetupStartTime = Date.now();
      this.setupRusticiDetectionMonitoring();
      const monitoringSetupCompleteTime = Date.now();
      
      // Log timing relationship between iframe load and API injection
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] API injection timing relative to iframe load', {
            url: this.currentUrl,
            timingSequence: {
              iframeLoadToApiStart: apiSetupStartTime - iframeLoadTime,
              apiSetupDuration: apiSetupCompleteTime - apiSetupStartTime,
              monitoringSetupDuration: monitoringSetupCompleteTime - monitoringSetupStartTime,
              totalPostLoadDuration: monitoringSetupCompleteTime - iframeLoadTime
            },
            documentState: {
              readyState: this.contentWindow?.document?.readyState || 'unknown',
              hasBody: !!(this.contentWindow?.document?.body),
              hasHead: !!(this.contentWindow?.document?.head)
            }
          });
        }).catch(() => {});
      } catch (_) {}
      
      setTimeout(() => { 
        const verificationStartTime = Date.now();
        this.verifyScormApiPresence();
        
        try {
          import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
            rendererLogger.info('[ContentViewer] API verification timing', {
              verificationDelayFromLoad: verificationStartTime - iframeLoadTime,
              verificationDelayFromApiSetup: verificationStartTime - apiSetupCompleteTime
            });
          }).catch(() => {});
        } catch (_) {}
      }, 0);
      
      // Apply scaling after content loads
      setTimeout(() => {
        this.applyContentScaling();
        // Begin observing size changes to keep fit without inner scrollbars
        this.startResizeObserver();
      }, 100);
      
      this.emit('contentLoaded', {
        url: this.currentUrl,
        loadTime,
        contentWindow: this.contentWindow
      });
      
    } catch (error) {
      this.showError('Content initialization failed', error?.message || String(error));
    }
  }

  /**
   * Handle iframe error event
   */
  handleIframeError() {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }
    
    this.showError('Failed to load content', 'The course content could not be loaded. Please check the file and try again.');
    this.emit('contentLoadError', { url: this.currentUrl });
  }

  /**
   * Inject API script directly into content document head for immediate availability
   */
  injectAPIScript() {
    if (!this.contentWindow || !this.contentWindow.document) return;
    
    try {
      const doc = this.contentWindow.document;
      const script = doc.createElement('script');
      
      // Create the API objects as a script that executes immediately
      script.textContent = `
        (function() {
          // Create API proxy functions that communicate via postMessage
          function createAPIMethod(method) {
            return function() {
              const args = Array.from(arguments);
              const callId = 'call_' + Date.now() + '_' + Math.random();
              let result = '0';
              let responseReceived = false;
              
              const listener = function(event) {
                if (event.data && event.data.type === 'SCORM_API_RESPONSE' && event.data.callId === callId) {
                  window.removeEventListener('message', listener);
                  responseReceived = true;
                  result = event.data.result || '0';
                }
              };
              window.addEventListener('message', listener);
              
              try {
                window.parent.postMessage({
                  type: 'SCORM_API_CALL',
                  method: method,
                  params: args,
                  callId: callId
                }, '*');
              } catch (e) {
                window.removeEventListener('message', listener);
                return '0';
              }
              
              // Synchronous wait
              const startTime = Date.now();
              while (!responseReceived && (Date.now() - startTime) < 5000) {
                const now = Date.now();
                while (Date.now() - now < 1) {}
              }
              
              if (!responseReceived) {
                window.removeEventListener('message', listener);
              }
              
              return result;
            };
          }
          
          // SCORM 1.2 API
          window.API = {
            LMSInitialize: createAPIMethod('Initialize'),
            LMSFinish: createAPIMethod('Terminate'),
            LMSGetValue: createAPIMethod('GetValue'),
            LMSSetValue: createAPIMethod('SetValue'),
            LMSCommit: createAPIMethod('Commit'),
            LMSGetLastError: createAPIMethod('GetLastError'),
            LMSGetErrorString: createAPIMethod('GetErrorString'),
            LMSGetDiagnostic: createAPIMethod('GetDiagnostic')
          };
          
          // SCORM 2004 API
          window.API_1484_11 = {
            Initialize: createAPIMethod('Initialize'),
            Terminate: createAPIMethod('Terminate'),
            GetValue: createAPIMethod('GetValue'),
            SetValue: createAPIMethod('SetValue'),
            Commit: createAPIMethod('Commit'),
            GetLastError: createAPIMethod('GetLastError'),
            GetErrorString: createAPIMethod('GetErrorString'),
            GetDiagnostic: createAPIMethod('GetDiagnostic')
          };
          
          // Add compatibility methods to SCORM 1.2 API
          window.API.Initialize = window.API.LMSInitialize;
          window.API.Terminate = window.API.LMSFinish;
          window.API.GetValue = window.API.LMSGetValue;
          window.API.SetValue = window.API.LMSSetValue;
          window.API.Commit = window.API.LMSCommit;
          window.API.GetLastError = window.API.LMSGetLastError;
          window.API.GetErrorString = window.API.LMSGetErrorString;
          window.API.GetDiagnostic = window.API.LMSGetDiagnostic;
        })();
      `;
      
      // Insert at the beginning of head to ensure early availability
      if (doc.head) {
        doc.head.insertBefore(script, doc.head.firstChild);
      } else {
        // If no head yet, add to document
        doc.appendChild(script);
      }
      
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] API script injected into document head', {
            url: this.currentUrl,
            hasAPI: !!(this.contentWindow.API),
            hasAPI_1484_11: !!(this.contentWindow.API_1484_11),
            windowLocation: this.contentWindow.location.href,
            documentState: this.contentWindow.document.readyState
          });
        }).catch(() => {});
      } catch (_) {}
      
    } catch (error) {
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] Failed to inject API script', error?.message || String(error));
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Inject APIs into the main renderer window for Rustici Software algorithm
   */
  injectAPIIntoRendererWindow() {
    // Create API methods that communicate directly with the SCORM bridge
    const createRendererAPIMethod = (method) => {
      return (...args) => {
        const callId = 'renderer_' + Date.now() + '_' + Math.random();
        let result = '0';
        let responseReceived = false;
        
        const listener = (event) => {
          if (event.data?.type === 'SCORM_API_RESPONSE' && event.data.callId === callId) {
            window.removeEventListener('message', listener);
            responseReceived = true;
            result = event.data.result || '0';
          }
        };
        window.addEventListener('message', listener);
        
        // Send to the bridge (which is listening on this same window)
        try {
          window.postMessage({
            type: 'SCORM_API_CALL',
            method,
            params: args,
            callId
          }, '*');
        } catch (e) {
          window.removeEventListener('message', listener);
          return '0';
        }
        
        // Synchronous wait for response
        const startTime = Date.now();
        while (!responseReceived && (Date.now() - startTime) < 5000) {
          const now = Date.now();
          while (Date.now() - now < 1) {}
        }
        
        if (!responseReceived) {
          window.removeEventListener('message', listener);
        }
        
        return result;
      };
    };
    
    // Create API objects with proper structure for Rustici detection
    const mainAPI12 = {
      LMSInitialize: createRendererAPIMethod('Initialize'),
      LMSFinish: createRendererAPIMethod('Terminate'),
      LMSGetValue: createRendererAPIMethod('GetValue'),
      LMSSetValue: createRendererAPIMethod('SetValue'),
      LMSCommit: createRendererAPIMethod('Commit'),
      LMSGetLastError: createRendererAPIMethod('GetLastError'),
      LMSGetErrorString: createRendererAPIMethod('GetErrorString'),
      LMSGetDiagnostic: createRendererAPIMethod('GetDiagnostic'),
      // Add direct methods for compatibility
      Initialize: createRendererAPIMethod('Initialize'),
      Terminate: createRendererAPIMethod('Terminate'),
      GetValue: createRendererAPIMethod('GetValue'),
      SetValue: createRendererAPIMethod('SetValue'),
      Commit: createRendererAPIMethod('Commit'),
      GetLastError: createRendererAPIMethod('GetLastError'),
      GetErrorString: createRendererAPIMethod('GetErrorString'),
      GetDiagnostic: createRendererAPIMethod('GetDiagnostic')
    };
    
    const mainAPI2004 = {
      Initialize: createRendererAPIMethod('Initialize'),
      Terminate: createRendererAPIMethod('Terminate'),
      GetValue: createRendererAPIMethod('GetValue'),
      SetValue: createRendererAPIMethod('SetValue'),
      Commit: createRendererAPIMethod('Commit'),
      GetLastError: createRendererAPIMethod('GetLastError'),
      GetErrorString: createRendererAPIMethod('GetErrorString'),
      GetDiagnostic: createRendererAPIMethod('GetDiagnostic')
    };
    
    // Inject SCORM APIs into main renderer window with property descriptors
    window.API = mainAPI12;
    window.API_1484_11 = mainAPI2004;
    
    // Ensure they're properly defined as enumerable properties
    try {
      Object.defineProperty(window, 'API', {
        value: mainAPI12,
        writable: true,
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(window, 'API_1484_11', {
        value: mainAPI2004,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } catch (e) {
      // Property descriptors might fail in some contexts
    }
    
    try {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.info('[ContentViewer] APIs injected into main renderer window', {
          hasAPI: !!(window.API),
          hasAPI_1484_11: !!(window.API_1484_11)
        });
      }).catch(() => {});
    } catch (_) {}
  }

  /**
   * Inject API script into a specific window (for child frames)
   */
  injectAPIScriptIntoWindow(targetWindow) {
    if (!targetWindow || !targetWindow.document) return;
    
    try {
      const doc = targetWindow.document;
      const script = doc.createElement('script');
      
      // Use the same API creation script as injectAPIScript
      script.textContent = `
        (function() {
          // Create API proxy functions that communicate via postMessage
          function createAPIMethod(method) {
            return function() {
              const args = Array.from(arguments);
              const callId = 'call_' + Date.now() + '_' + Math.random();
              let result = '0';
              let responseReceived = false;
              
              const listener = function(event) {
                if (event.data && event.data.type === 'SCORM_API_RESPONSE' && event.data.callId === callId) {
                  window.removeEventListener('message', listener);
                  responseReceived = true;
                  result = event.data.result || '0';
                }
              };
              window.addEventListener('message', listener);
              
              try {
                window.parent.postMessage({
                  type: 'SCORM_API_CALL',
                  method: method,
                  params: args,
                  callId: callId
                }, '*');
              } catch (e) {
                window.removeEventListener('message', listener);
                return '0';
              }
              
              // Synchronous wait
              const startTime = Date.now();
              while (!responseReceived && (Date.now() - startTime) < 5000) {
                const now = Date.now();
                while (Date.now() - now < 1) {}
              }
              
              if (!responseReceived) {
                window.removeEventListener('message', listener);
              }
              
              return result;
            };
          }
          
          // SCORM 1.2 API
          window.API = {
            LMSInitialize: createAPIMethod('Initialize'),
            LMSFinish: createAPIMethod('Terminate'),
            LMSGetValue: createAPIMethod('GetValue'),
            LMSSetValue: createAPIMethod('SetValue'),
            LMSCommit: createAPIMethod('Commit'),
            LMSGetLastError: createAPIMethod('GetLastError'),
            LMSGetErrorString: createAPIMethod('GetErrorString'),
            LMSGetDiagnostic: createAPIMethod('GetDiagnostic')
          };
          
          // SCORM 2004 API
          window.API_1484_11 = {
            Initialize: createAPIMethod('Initialize'),
            Terminate: createAPIMethod('Terminate'),
            GetValue: createAPIMethod('GetValue'),
            SetValue: createAPIMethod('SetValue'),
            Commit: createAPIMethod('Commit'),
            GetLastError: createAPIMethod('GetLastError'),
            GetErrorString: createAPIMethod('GetErrorString'),
            GetDiagnostic: createAPIMethod('GetDiagnostic')
          };
          
          // Add compatibility methods to SCORM 1.2 API
          window.API.Initialize = window.API.LMSInitialize;
          window.API.Terminate = window.API.LMSFinish;
          window.API.GetValue = window.API.LMSGetValue;
          window.API.SetValue = window.API.LMSSetValue;
          window.API.Commit = window.API.LMSCommit;
          window.API.GetLastError = window.API.LMSGetLastError;
          window.API.GetErrorString = window.API.LMSGetErrorString;
          window.API.GetDiagnostic = window.API.LMSGetDiagnostic;
        })();
      `;
      
      // Insert script
      if (doc.head) {
        doc.head.insertBefore(script, doc.head.firstChild);
      } else if (doc.body) {
        doc.body.appendChild(script);
      } else {
        doc.appendChild(script);
      }
      
    } catch (error) {
      // Silent failure - cross-origin restrictions expected
    }
  }

  /**
   * Ensure API availability by monitoring document state and re-injecting if needed
   */
  ensureAPIAvailability() {
    if (!this.contentWindow || !this.contentWindow.document) return;
    
    const doc = this.contentWindow.document;
    const win = this.contentWindow;
    
    // Check if APIs are already present
    const checkAndInject = () => {
      if (!win.API || !win.API_1484_11) {
        try {
          import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
            rendererLogger.info('[ContentViewer] Re-injecting SCORM APIs', {
              hasAPI: !!win.API,
              hasAPI_1484_11: !!win.API_1484_11
            });
          }).catch(() => {});
        } catch (_) {}
        
        this.setupScormAPI();
        this.injectAPIScript();
      }
    };
    
    // Monitor document ready state changes
    if (doc.readyState === 'loading') {
      const readyHandler = () => {
        checkAndInject();
        doc.removeEventListener('DOMContentLoaded', readyHandler);
      };
      doc.addEventListener('DOMContentLoaded', readyHandler);
    }
    
    // Also monitor for any DOM mutations that might clear our APIs
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        // Throttle API checks
        if (!this._apiCheckTimeout) {
          this._apiCheckTimeout = setTimeout(() => {
            checkAndInject();
            this._apiCheckTimeout = null;
          }, 100);
        }
      });
      
      observer.observe(doc, { childList: true, subtree: true });
      
      // Clean up observer when content is cleared
      this._mutationObserver = observer;
    }
  }

  /**
   * Setup SCORM API in content window using postMessage bridge
   */
  setupScormAPI() {
    const setupStartTime = Date.now();
    
    try {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.info('[ContentViewer] setupScormAPI START - timing diagnostic', {
          timestamp: setupStartTime,
          url: this.currentUrl,
          documentReadyState: this.contentWindow?.document?.readyState || 'unknown',
          windowContexts: {
            hasContentWindow: !!this.contentWindow,
            hasParent: !!(window.parent),
            hasTop: !!(window.top),
            isSameOrigin: this.contentWindow && window.location.origin === this.contentWindow.location.origin
          }
        });
      }).catch(() => {});
    } catch (_) {}
    
    if (!this.contentWindow) {
      this.showError('Content Setup Error', 'Content window not available for SCORM API setup');
      return;
    }
    
    try {
      // Enable the postMessage bridge to handle SCORM API calls
      scormAPIBridge.enable();
      
      const bridgeEnableTime = Date.now();
      
      // CRITICAL: Inject APIs into the main renderer window FIRST
      // This ensures the Rustici Software frame traversal algorithm finds them
      this.injectAPIIntoRendererWindow();
      
      const rendererInjectionTime = Date.now();
      
      // Debug: Verify APIs are present in main window
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] Main window API injection complete - timing diagnostic', {
            bridgeEnableMs: bridgeEnableTime - setupStartTime,
            rendererInjectionMs: rendererInjectionTime - bridgeEnableTime,
            totalElapsedMs: rendererInjectionTime - setupStartTime,
            mainWindowAPIs: {
              hasAPI: !!(window.API),
              hasAPI_1484_11: !!(window.API_1484_11),
              apiInitialize: typeof window.API?.Initialize,
              api1484Initialize: typeof window.API_1484_11?.Initialize
            }
          });
        }).catch(() => {});
      } catch (_) {}
      
      const win = this.contentWindow;
      
      // Create proxy API objects that use postMessage to communicate with the bridge
      const createProxyAPI = (version) => {
        const methods = version === '2004' 
          ? ['Initialize', 'Terminate', 'GetValue', 'SetValue', 'Commit', 'GetLastError', 'GetErrorString', 'GetDiagnostic']
          : ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic'];
          
        const proxy = {};
        
        methods.forEach(method => {
          proxy[method] = (...args) => {
            const callId = 'call_' + Date.now() + '_' + Math.random();
            let result = '0';
            let responseReceived = false;
            
            // Set up response listener
            const listener = (event) => {
              if (event.data?.type === 'SCORM_API_RESPONSE' && event.data.callId === callId) {
                window.removeEventListener('message', listener);
                responseReceived = true;
                result = event.data.result || '0';
              }
            };
            window.addEventListener('message', listener);
            
            // Send request to parent window (where bridge is listening)
            try {
              window.parent.postMessage({
                type: 'SCORM_API_CALL',
                method,
                params: args,
                callId
              }, '*');
            } catch (e) {
              window.removeEventListener('message', listener);
              return '0';
            }
            
            // Synchronous wait for response (required by SCORM spec)
            // Use a tight polling loop with yielding to prevent blocking
            const startTime = Date.now();
            const timeout = 5000; // 5 second timeout
            
            while (!responseReceived && (Date.now() - startTime) < timeout) {
              // Yield control to allow message processing
              // This creates a synchronous wait without blocking the event loop completely
              const now = Date.now();
              while (Date.now() - now < 1) {
                // Busy wait for 1ms, then yield
              }
            }
            
            // Clean up listener if timeout occurred
            if (!responseReceived) {
              window.removeEventListener('message', listener);
              result = '0';
            }
            
            return result;
          };
        });
        
        // Add SCORM 1.2 compatibility methods
        if (version === '1.2') {
          proxy.Initialize = proxy.LMSInitialize;
          proxy.Terminate = proxy.LMSFinish;
          proxy.GetValue = proxy.LMSGetValue;
          proxy.SetValue = proxy.LMSSetValue;
          proxy.Commit = proxy.LMSCommit;
          proxy.GetLastError = proxy.LMSGetLastError;
          proxy.GetErrorString = proxy.LMSGetErrorString;
          proxy.GetDiagnostic = proxy.LMSGetDiagnostic;
        }
        
        return proxy;
      };
      
      // Inject proxy API objects into the content window
      const contentInjectionStart = Date.now();
      
      // CRITICAL: Ensure APIs are directly accessible as window properties
      // Rustici's algorithm checks window.API_1484_11 directly
      const api12 = createProxyAPI('1.2');
      const api2004 = createProxyAPI('2004');
      
      // Direct assignment to ensure Rustici detection works
      win.API = api12;
      win.API_1484_11 = api2004;
      
      // Also ensure they're accessible via property descriptors  
      try {
        Object.defineProperty(win, 'API', {
          value: api12,
          writable: true,
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(win, 'API_1484_11', {
          value: api2004,
          writable: true,
          enumerable: true,
          configurable: true
        });
      } catch (e) {
        // Fallback to direct assignment if defineProperty fails
      }
      
      // CRITICAL DEBUG: Intercept Rustici's API detection to see what it's actually checking
      try {
        // Override the SCORM2004_APIFound function if it exists
        if (typeof win.SCORM2004_APIFound === 'function') {
          const originalAPIFound = win.SCORM2004_APIFound;
          win.SCORM2004_APIFound = function(obj) {
            try {
              import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                rendererLogger.info('[ContentViewer] SCORM2004_APIFound intercepted', {
                  obj: obj,
                  objType: typeof obj,
                  objNull: obj === null,
                  objUndefined: obj === undefined,
                  objStringified: obj ? obj.toString() : 'null/undefined',
                  hasInitialize: !!(obj?.Initialize),
                  objectKeys: obj ? Object.keys(obj) : [],
                  windowAPI: win.API_1484_11,
                  windowAPIType: typeof win.API_1484_11
                });
              }).catch(() => {});
            } catch (_) {}
            
            const result = originalAPIFound.call(this, obj);
            
            try {
              import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                rendererLogger.info('[ContentViewer] SCORM2004_APIFound result', {
                  result,
                  objWasNull: obj === null || obj === undefined,
                  comparison: `obj=${obj}, result=${result}`
                });
              }).catch(() => {});
            } catch (_) {}
            
            return result;
          };
        }
      } catch (e) {
        // Function override might fail
      }
      
      const contentInjectionTime = Date.now();
      
      // IMMEDIATE DEBUG: Check what's actually in the window after injection
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] POST-INJECTION DEBUG - What Rustici will see', {
            currentWindowAPI: !!win.API_1484_11,
            currentWindowLocation: win.location.href,
            parentHasAPI: !!(window.parent?.API_1484_11),
            topHasAPI: !!(window.top?.API_1484_11)
          });
        }).catch(() => {});
      } catch (_) {}
      
      // TEST: Add a simple test function to the content window to verify injection worked
      try {
        win.testAPIInjection = function() {
          return {
            hasAPI: !!win.API,
            hasAPI_1484_11: !!win.API_1484_11,
            apiType: typeof win.API,
            api1484Type: typeof win.API_1484_11,
            directAccess: win.API_1484_11,
            manualCheck: win.API_1484_11 === null || typeof win.API_1484_11 === 'undefined'
          };
        };
        
        // Simple access logging without complex property descriptors
        console.log('[ContentViewer] API injection completed for window:', win.location.href);
      } catch (_) {}
      
      // Also inject into the main renderer window (parent context) for Rustici discovery
      const parentInjectionStart = Date.now();
      try {
        if (window.parent && window.parent !== win) {
          const parentAPI12 = createProxyAPI('1.2');
          const parentAPI2004 = createProxyAPI('2004');
          
          window.parent.API = parentAPI12;
          window.parent.API_1484_11 = parentAPI2004;
          
          // Ensure proper property definitions
          try {
            Object.defineProperty(window.parent, 'API', {
              value: parentAPI12,
              writable: true,
              enumerable: true,
              configurable: true
            });
            Object.defineProperty(window.parent, 'API_1484_11', {
              value: parentAPI2004,
              writable: true,
              enumerable: true,
              configurable: true
            });
          } catch (_) {}
        }
        if (window.top && window.top !== win && window.top !== window.parent) {
          const topAPI12 = createProxyAPI('1.2');
          const topAPI2004 = createProxyAPI('2004');
          
          window.top.API = topAPI12;
          window.top.API_1484_11 = topAPI2004;
          
          // Ensure proper property definitions
          try {
            Object.defineProperty(window.top, 'API', {
              value: topAPI12,
              writable: true,
              enumerable: true,
              configurable: true
            });
            Object.defineProperty(window.top, 'API_1484_11', {
              value: topAPI2004,
              writable: true,
              enumerable: true,
              configurable: true
            });
          } catch (_) {}
        }
      } catch (e) {
        // Cross-origin restrictions - expected in some cases
        try {
          import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
            rendererLogger.debug('[ContentViewer] Could not inject into parent/top windows', e.message);
          }).catch(() => {});
        } catch (_) {}
      }
      const parentInjectionTime = Date.now();
      
      // Also inject into child iframes that may contain the actual SCORM content
      try {
        // Look for common SCORM iframe IDs/names
        const potentialFrames = [
          win.document?.getElementById('scoFrame'),
          win.document?.getElementById('scorm_object'),
          win.document?.querySelector('iframe[name="scoFrame"]'),
          win.document?.querySelector('iframe[name="scorm_object"]'),
          win.document?.querySelector('iframe')  // fallback to first iframe
        ].filter(Boolean);
        
        potentialFrames.forEach(frame => {
          const injectIntoFrame = () => {
            try {
              const frameWin = frame.contentWindow;
              if (frameWin && frameWin !== win) {
                const frameAPI12 = createProxyAPI('1.2');
                const frameAPI2004 = createProxyAPI('2004');
                
                frameWin.API = frameAPI12;
                frameWin.API_1484_11 = frameAPI2004;
                
                // Ensure proper property definitions for child frames too
                try {
                  Object.defineProperty(frameWin, 'API', {
                    value: frameAPI12,
                    writable: true,
                    enumerable: true,
                    configurable: true
                  });
                  Object.defineProperty(frameWin, 'API_1484_11', {
                    value: frameAPI2004,
                    writable: true,
                    enumerable: true,
                    configurable: true
                  });
                } catch (_) {}
                
                // Also inject script into the frame document
                this.injectAPIScriptIntoWindow(frameWin);
                
                try {
                  import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                    rendererLogger.info('[ContentViewer] Injected APIs into child frame', {
                      frameId: frame.id || 'unnamed',
                      frameSrc: frame.src || 'no-src'
                    });
                  }).catch(() => {});
                } catch (_) {}
              }
            } catch (e) {
              // Cross-origin or not accessible - this is expected for some frames
              try {
                import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                  rendererLogger.debug('[ContentViewer] Could not access child frame', {
                    frameId: frame.id || 'unnamed',
                    error: e.message
                  });
                }).catch(() => {});
              } catch (_) {}
            }
          };
          
          // Try immediate injection if frame is ready
          if (frame.contentWindow && frame.contentWindow.document) {
            injectIntoFrame();
          }
          
          // Also listen for frame load
          frame.addEventListener('load', injectIntoFrame, { once: true });
        });
      } catch (_) {}
      
      const setupCompleteTime = Date.now();
      
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] setupScormAPI COMPLETE - final timing diagnostic', {
            url: this.currentUrl,
            timingBreakdown: {
              contentInjectionMs: contentInjectionTime - contentInjectionStart,
              parentInjectionMs: parentInjectionTime - parentInjectionStart,
              totalSetupMs: setupCompleteTime - setupStartTime
            },
            apiAvailability: {
              contentWindow: {
                hasAPI: !!(win.API),
                hasAPI_1484_11: !!(win.API_1484_11)
              },
              mainWindow: {
                hasAPI: !!(window.API),
                hasAPI_1484_11: !!(window.API_1484_11)
              },
              parentWindow: {
                hasAPI: !!(window.parent?.API),
                hasAPI_1484_11: !!(window.parent?.API_1484_11)
              }
            },
            bridgeEnabled: scormAPIBridge.isEnabled
          });
        }).catch(() => {});
      } catch (_) {}
      
      this.emit('scormApiInjected', { contentWindow: win, mode: 'postMessage' });
      
    } catch (error) {
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] postMessage API injection error', error?.message || String(error));
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Create optimized SCORM API wrapper
   * @private
   */
  createOptimizedAPIWrapper() {
    const sessionId = scormClient.getSessionId() || 'default';
    
    // Common API methods with optimized logging
    const createAPIMethod = (methodName, clientMethod) => {
      return (...args) => {
        const result = clientMethod.apply(scormClient, args);
        return result;
      };
    };
    
    // SCORM 2004 API methods
    const scorm2004Methods = {
      Initialize: createAPIMethod('Initialize', () => scormClient.Initialize(sessionId)),
      Terminate: createAPIMethod('Terminate', scormClient.Terminate),
      GetValue: createAPIMethod('GetValue', scormClient.GetValue),
      SetValue: createAPIMethod('SetValue', scormClient.SetValue),
      Commit: createAPIMethod('Commit', scormClient.Commit),
      GetLastError: createAPIMethod('GetLastError', scormClient.GetLastError),
      GetErrorString: createAPIMethod('GetErrorString', scormClient.GetErrorString),
      GetDiagnostic: createAPIMethod('GetDiagnostic', scormClient.GetDiagnostic)
    };
    
    // SCORM 1.2 API methods (with LMS prefix)
    const scorm12Methods = {
      ...scorm2004Methods, // Include direct methods for compatibility
      LMSInitialize: scorm2004Methods.Initialize,
      LMSFinish: scorm2004Methods.Terminate,
      LMSGetValue: scorm2004Methods.GetValue,
      LMSSetValue: scorm2004Methods.SetValue,
      LMSCommit: scorm2004Methods.Commit,
      LMSGetLastError: scorm2004Methods.GetLastError,
      LMSGetErrorString: scorm2004Methods.GetErrorString,
      LMSGetDiagnostic: scorm2004Methods.GetDiagnostic,
      // Add legacy aliases
      Finish: scorm2004Methods.Terminate
    };
    
    return {
      scorm12: scorm12Methods,
      scorm2004: scorm2004Methods
    };
  }


  /**
   * Show loading state
   */
  showLoading() {
    this.hideContent();
    this.hideError();
    this.hideNoContent();
    
    if (this.loadingElement) {
      this.loadingElement.style.display = 'flex';
    }
    
    this.uiState.setLoading(true, 'Loading SCORM course...');
  }

  /**
   * Hide loading state
   */
  hideLoading() {
    if (this.loadingElement) {
      this.loadingElement.style.display = 'none';
    }
    
    this.uiState.setLoading(false);
  }

  /**
   * Show content
   */
  showContent() {
    this.hideNoContent();
    this.hideError();
    this.hideLoading();
    
    // Hide the welcome screen
    const welcomeElement = document.querySelector('.content-viewer__welcome');
    if (welcomeElement) {
      welcomeElement.style.display = 'none';
    }
    
    // Show the iframe
    if (this.iframe) {
      this.iframe.style.display = 'block';
      this.iframe.classList.remove('hidden');
    }
    
    if (this.fullscreenBtn) {
      this.fullscreenBtn.style.display = 'block';
    }
  }

  /**
   * Apply content scaling to fit iframe content properly (optimized)
   */
  applyContentScaling() {
    // Skip scaling if disabled or content window not available
    if (!this.options.enableContentScaling || !this.iframe || !this.contentWindow) {
      return;
    }

    try {
      const contentDoc = this.contentWindow.document;
      if (!contentDoc || !contentDoc.body || contentDoc.readyState !== 'complete') {
        // Retry after content is fully loaded
        setTimeout(() => this.applyContentScaling(), 500);
        return;
      }

      // Get dimensions to check if scaling is needed
      const iframeRect = this.iframe.getBoundingClientRect();
      const contentBody = contentDoc.body;
      
      // Check actual content dimensions vs iframe size
      const contentWidth = Math.max(contentBody.scrollWidth, contentBody.offsetWidth);
      const contentHeight = Math.max(contentBody.scrollHeight, contentBody.offsetHeight);
      
      // Calculate scaling ratios
      const scaleX = iframeRect.width / contentWidth;
      const scaleY = iframeRect.height / contentHeight;
      const scale = Math.min(scaleX, scaleY, 1);
      
      // If content fits, skip scaling
      if (scale >= 1.0) {
        return;
      }

      // Apply scaling for content that needs it
      contentBody.style.setProperty('--scorm-scale', scale);
      contentBody.style.setProperty('--scorm-inverse-scale-width', `${100 / scale}%`);
      contentBody.style.setProperty('--scorm-inverse-scale-height', `${100 / scale}%`);
      contentBody.classList.add('scaled-content');
      
      // Store scaling info for cleanup
      this.appliedScaling = { scale };

    } catch (error) {
      // Silent failure per plan; content remains viewable
    }
  }

  /**
   * Remove applied content scaling
   */
  removeContentScaling() {
    if (this.appliedScaling && this.contentWindow && this.contentWindow.document && this.contentWindow.document.body) {
      try {
        const contentBody = this.contentWindow.document.body;
        contentBody.classList.remove('scaled-content');
        contentBody.style.removeProperty('--scorm-scale');
        contentBody.style.removeProperty('--scorm-inverse-scale-width');
        contentBody.style.removeProperty('--scorm-inverse-scale-height');
        this.appliedScaling = null;
        rendererLogger.info('ContentViewer: Content scaling removed');
      } catch (error) {
        rendererLogger.warn('ContentViewer: Failed to remove scaling:', error?.message || error);
      }
    }
  }

  /**
   * Hide content
   */
  hideContent() {
    if (this.iframe) {
      this.iframe.style.display = 'none';
    }
    
    if (this.fullscreenBtn) {
      this.fullscreenBtn.style.display = 'none';
    }
  }

  /**
   * Show error state
   */
  showError(message, details = null) {
    this.hideLoading();
    this.hideContent();
    this.hideNoContent();
    
    this.uiState.showNotification({
      message: message,
      type: 'error',
      details: details,
      duration: 0 // Persistent until dismissed
    });
    
    // Hide the internal error display as uiState will handle it
    if (this.errorElement) {
      this.errorElement.style.display = 'none';
    }
    
    this.uiState.setError(message); // Keep this for internal state tracking
    this.emit('errorShown', { message, details });
  }

  /**
   * Hide error state
   */
  hideError() {
    if (this.errorElement) {
      this.errorElement.style.display = 'none';
    }
  }

  /**
   * Clear error state
   */
  clearError() {
    this.hideError();
    this.uiState.setError(null);
  }

  /**
   * Show no content state
   */
  showNoContent() {
    this.hideLoading();
    this.hideContent();
    this.hideError();
    
    if (this.noContentElement) {
      this.noContentElement.style.display = 'flex';
    }
  }

  /**
   * Hide no content state
   */
  hideNoContent() {
    if (this.noContentElement) {
      this.noContentElement.style.display = 'none';
    }
  }

  /**
   * Retry loading content
   */
  retryLoad() {
    if (this.currentUrl) {
      rendererLogger.info('ContentViewer: Retrying content load', this.currentUrl);
      this.clearError();
      this.loadContent(this.currentUrl);
    } else {
      this.showError('Retry Failed', 'No content URL available for retry');
    }
  }

  /**
   * Handle content load timeout with user options
   */
  handleLoadTimeout() {
    this.showError(
      'Content Load Timeout', 
      'The course took too long to load. This may be due to network issues or large content files.',
      {
        showRetry: true,
        showReload: true,
        showDetails: true
      }
    );
  }

  /**
   * Show enhanced error with recovery options
   */
  showEnhancedError(title, message, options = {}) {
    this.hideLoading();
    this.hideContent();
    this.hideNoContent();
    
    this.uiState.showNotification({
      message: `${title}: ${message}`,
      type: 'error',
      details: options.details,
      duration: 0, // Persistent until dismissed
      actions: [ // Add actions for retry, reload, reset
        options.showRetry ? { label: 'Retry Loading', handler: () => this.retryLoad() } : null,
        options.showReload ? { label: 'Reload Page', handler: () => location.reload() } : null,
        options.showReset ? { label: 'Reset Content', handler: () => this.resetContent() } : null,
      ].filter(Boolean), // Filter out null actions
      help: options.showHelp ? `
        <details>
          <summary>Troubleshooting Help</summary>
          <ul>
            <li>Check your internet connection</li>
            <li>Verify the SCORM package is valid</li>
            <li>Try refreshing the application</li>
            <li>Contact support if the problem persists</li>
          </ul>
        </details>
      ` : null
    });
    
    // Hide the internal error display as uiState will handle it
    if (this.errorElement) {
      this.errorElement.style.display = 'none';
    }
    
    this.uiState.setError(title + ': ' + message); // Keep this for internal state tracking
    this.emit('errorShown', { title, message, options });
  }

  /**
   * Bind error action buttons
   */
  bindErrorActions() {
    const retryBtn = this.errorElement?.querySelector('.error-retry-btn');
    const reloadBtn = this.errorElement?.querySelector('.error-reload-btn');
    const resetBtn = this.errorElement?.querySelector('.error-reset-btn');
    
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.retryLoad());
    }
    
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => location.reload());
    }
    
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetContent());
    }
  }

  /**
   * Reset content viewer to initial state
   */
  resetContent() {
    this.clearContent();
    this.clearError();
    this.showNoContent();
    this.emit('contentReset');
  }

  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen() {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  /**
   * Enter fullscreen mode
   */
  enterFullscreen() {
    if (!this.iframe) return;
    
    const element = this.iframe;
    
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
  }

  /**
   * Exit fullscreen mode
   */
  exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  /**
   * Handle fullscreen change
   */
  handleFullscreenChange() {
    this.isFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
    
    if (this.fullscreenBtn) {
      this.fullscreenBtn.textContent = this.isFullscreen ? '⛶' : '⛶';
      this.fullscreenBtn.title = this.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
    }
    
    this.emit('fullscreenChanged', { isFullscreen: this.isFullscreen });
  }

  /**
   * Handle course loaded event
   */
  handleCourseLoaded(data) {
    if (data.launchUrl) {
      this.loadContent(data.launchUrl);
    } else if (data.entryPoint) {
      // Fallback to entryPoint if launchUrl not available
      this.loadContent(data.entryPoint);
    }
  }

  /**
   * Handle course error event
   */
  handleCourseError(data) {
    const msg = typeof data === 'string' ? data : (data?.message || 'Unknown error');
    this.showError('Course loading failed', msg);
  }

  /**
   * Handle UI update event
   */
  handleUIUpdate(data) {
    if (data.loading !== undefined) {
      if (data.loading && !this.currentUrl) {
        this.showLoading();
      }
    }
  }

  /**
   * Handle SCORM initialized event
   */
  handleScormInitialized(data) {
    // SCORM session is ready
    this.emit('scormReady', data);
  }

  /**
   * Handle SCORM error event
   */
  handleScormError(data) {
    // Route user-visible error through notifications; no console logging
    const message = typeof data === 'string' ? data : (data?.message || 'SCORM error occurred');
    this.uiState.showNotification({
      type: 'error',
      message: `SCORM Error: ${message}`,
      duration: 0
    });
  }

  /**
   * Get content window
   * @returns {Window|null} Content window
   */
  getContentWindow() {
    return this.contentWindow;
  }

  /**
   * Get current URL
   * @returns {string|null} Current URL
   */
  getCurrentUrl() {
    return this.currentUrl;
  }

  /**
   * Check if content is loaded
   * @returns {boolean} Load state
   */
  isContentLoaded() {
    return !!(this.iframe && this.iframe.src && this.contentWindow);
  }

  /**
   * Reload current content
   */
  reload() {
    if (this.currentUrl) {
      this.loadContent(this.currentUrl);
    }
  }

  /**
   * Clear content
   */
  clearContent() {
    // Clean up any applied scaling
    this.removeContentScaling();
    
    this.currentUrl = null;
    this.contentWindow = null;
    
    if (this.iframe) {
      this.iframe.src = 'about:blank';
    }
    
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }
    
    this.showNoContent();
    this.emit('contentCleared');
  }

  /**
   * Create iframe element
   */
  createIframe() {
    // Iframe will be created in renderContent
  }

  /**
   * Start ResizeObserver to re-apply scaling on container size changes
   */
  startResizeObserver() {
    try {
      if (!this.element) return;
      // Clean up previous observer
      this.stopResizeObserver();

      // Prefer native ResizeObserver if available
      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => {
          // Re-apply scaling when container size changes
          this.applyContentScaling();
        });
        this.resizeObserver.observe(this.element);
      } else {
        // Fallback: listen to window resize
        this._resizeHandler = () => this.applyContentScaling();
        window.addEventListener('resize', this._resizeHandler);
      }
    } catch (_) {
      // Non-fatal
    }
  }

  /**
   * Stop ResizeObserver/listeners
   */
  stopResizeObserver() {
    try {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
    } catch (_) {
      // ignore
    }
  }

  /**
   * Setup monitoring for Rustici Software SCORM detection algorithm
   * Intercepts common detection patterns to understand timing
   */
  setupRusticiDetectionMonitoring() {
    if (!this.contentWindow) return;
    
    try {
      const win = this.contentWindow;
      const startTime = Date.now();
      
      // Hook into common Rustici detection function calls
      const originalSetTimeout = win.setTimeout;
      const originalSetInterval = win.setInterval;
      
      // Monitor setTimeout calls that might be part of detection algorithm
      win.setTimeout = function(callback, delay, ...args) {
        const callbackStr = callback.toString();
        if (callbackStr.includes('API') || callbackStr.includes('SCORM') || callbackStr.includes('SearchFor')) {
          try {
            import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
              rendererLogger.info('[ContentViewer] Rustici detection setTimeout intercepted', {
                delay,
                timestamp: Date.now(),
                elapsedSinceSetup: Date.now() - startTime,
                callbackPreview: callbackStr.substring(0, 100) + '...'
              });
            }).catch(() => {});
          } catch (_) {}
        }
        return originalSetTimeout.call(this, callback, delay, ...args);
      };
      
      // Monitor function calls that look like Rustici API detection
      const monitorAPIAccess = (windowObj, windowName) => {
        if (!windowObj) return;
        
        try {
          const apiAccessHandler = {
            get(target, prop) {
              if (prop === 'API' || prop === 'API_1484_11') {
                try {
                  import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                    rendererLogger.info('[ContentViewer] Rustici API access detected', {
                      windowContext: windowName,
                      apiProperty: prop,
                      timestamp: Date.now(),
                      elapsedSinceSetup: Date.now() - startTime,
                      hasAPI: !!(target[prop]),
                      callStack: new Error().stack?.split('\n').slice(1, 4) || []
                    });
                  }).catch(() => {});
                } catch (_) {}
              }
              return target[prop];
            }
          };
          
          // Only wrap if not already wrapped
          if (!windowObj._rusticiMonitorInstalled) {
            const proxy = new Proxy(windowObj, apiAccessHandler);
            windowObj._rusticiMonitorInstalled = true;
          }
        } catch (e) {
          // Cross-origin or other restrictions
        }
      };
      
      // Monitor main window contexts
      monitorAPIAccess(win, 'contentWindow');
      monitorAPIAccess(window, 'mainWindow');
      if (window.parent !== window) {
        monitorAPIAccess(window.parent, 'parentWindow');
      }
      if (window.top !== window && window.top !== window.parent) {
        monitorAPIAccess(window.top, 'topWindow');
      }
      
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] Rustici detection monitoring setup complete', {
            timestamp: startTime,
            monitoredWindows: ['contentWindow', 'mainWindow', 'parentWindow', 'topWindow']
          });
        }).catch(() => {});
      } catch (_) {}
      
    } catch (error) {
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.debug('[ContentViewer] Rustici monitoring setup failed', error?.message || String(error));
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Verify SCORM API presence and establish fallback if needed
   * - Prefer direct API injection (API_1484_11 or API with Initialize())
   * - If unavailable, attempt bridge-based postMessage path
   * - If both unavailable, notify user with persistent error
   */
  verifyScormApiPresence() {
    try {
      const win = this.contentWindow;
      if (!win) {
        this.showError('SCORM API Verification Failed', 'Content window not available to verify SCORM API.');
        return;
      }

      // Check SCORM APIs in content window
      const api2004 = win.API_1484_11;
      const api12 = win.API;
      const has2004 = api2004 && typeof api2004.Initialize === 'function';
      const has12 = api12 && (typeof api12.Initialize === 'function' || typeof api12.LMSInitialize === 'function');

      // Comprehensive API presence verification across all window contexts
      const verifyWindowContext = (windowObj, contextName) => {
        try {
          return {
            contextName,
            accessible: !!windowObj,
            hasAPI: !!(windowObj?.API),
            hasAPI_1484_11: !!(windowObj?.API_1484_11),
            apiInitialize: typeof windowObj?.API?.Initialize,
            apiLMSInitialize: typeof windowObj?.API?.LMSInitialize,
            api1484Initialize: typeof windowObj?.API_1484_11?.Initialize,
            origin: windowObj?.location?.origin || 'unknown',
            href: windowObj?.location?.href || 'unknown'
          };
        } catch (e) {
          return {
            contextName,
            accessible: false,
            error: e.message
          };
        }
      };

      const windowContexts = [
        verifyWindowContext(win, 'contentWindow'),
        verifyWindowContext(window, 'mainWindow'),
        verifyWindowContext(window.parent, 'parentWindow'),
        verifyWindowContext(window.top, 'topWindow')
      ];

      // Diagnostic snapshot with comprehensive window context analysis
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] verifyScormApiPresence - comprehensive window analysis', {
            url: this.currentUrl,
            contentWindowAPIs: { has12, has2004 },
            allWindowContexts: windowContexts,
            frameHierarchy: {
              selfIsParent: window === window.parent,
              selfIsTop: window === window.top,
              parentIsTop: window.parent === window.top,
              contentIsMain: win === window,
              contentIsParent: win === window.parent
            }
          });
        }).catch(() => {});
      } catch (_) {}

      if (has2004 || has12) {
        // API present; nothing further required
        this.emit('scormApiVerified', { mode: 'direct', has2004, has12 });
        return;
      }

      // Fallback: attempt postMessage bridge discovery by sending a ping
      const callId = 'probe_' + Date.now();
      let responded = false;
      const listener = (event) => {
        if (event.data && event.data.type === 'SCORM_API_RESPONSE' && event.data.callId === callId) {
          responded = true;
          window.removeEventListener('message', listener);
          this.emit('scormApiVerified', { mode: 'bridge' });
        }
      };
      window.addEventListener('message', listener);

      // Enable the SCORM API bridge before sending the probe
      scormAPIBridge.enable();

      // Post a harmless probe request expected by bridge (Initialize with empty)
      try {
        win.postMessage({
          type: 'SCORM_API_CALL',
          method: 'GetLastError',
          params: [],
          callId
        }, '*');
      } catch (_) {
        // ignore
      }

      // Give the bridge a short time to respond
      setTimeout(() => {
        if (!responded) {
          window.removeEventListener('message', listener);
          // Neither direct API nor bridge responded; standardize via showError
          try {
            import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
              rendererLogger.error('[ContentViewer] SCORM API missing after probe', { url: this.currentUrl });
            }).catch(() => {});
          } catch (_) {}

          this.showError(
            'SCORM API not found',
            'The SCO did not expose API_1484_11 or API, and no postMessage bridge responded. The course may not be SCORM-enabled or is loading in a context that cannot access the API.'
          );
          this.emit('scormApiMissing', { url: this.currentUrl });
        }
      }, 600);
    } catch (err) {
      this.showError('SCORM API verification error', err?.message || String(err));
    }
  }


  /**
   * Create loading indicator
   */
  createLoadingIndicator() {
    // Loading indicator will be created in renderContent
  }

  /**
   * Create error display
   */
  createErrorDisplay() {
    // Error display will be created in renderContent
  }

  /**
   * Create no content display
   */
  createNoContentDisplay() {
    // No content display will be created in renderContent
  }

  /**
   * Create fullscreen controls
   */
  createFullscreenControls() {
    // Fullscreen controls will be created in renderContent
  }

  /**
   * Destroy component
   */
  destroy() {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }

    // Stop observers/listeners
    this.stopResizeObserver();
    
    // Clean up mutation observer
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    
    if (this._apiCheckTimeout) {
      clearTimeout(this._apiCheckTimeout);
      this._apiCheckTimeout = null;
    }

    // Remove event listeners using the same bound references to avoid leaks
    if (this._boundHandlers) {
      // Fullscreen change listeners
      document.removeEventListener('fullscreenchange', this._boundHandlers.onFsChange);
      document.removeEventListener('webkitfullscreenchange', this._boundHandlers.onWebkitFsChange);
      document.removeEventListener('mozfullscreenchange', this._boundHandlers.onMozFsChange);
      document.removeEventListener('MSFullscreenChange', this._boundHandlers.onMsFsChange);

      // Iframe load/error
      if (this.iframe) {
        try { this.iframe.removeEventListener('load', this._boundHandlers.onIframeLoad); } catch (_) {}
        try { this.iframe.removeEventListener('error', this._boundHandlers.onIframeError); } catch (_) {}
      }

      // Fullscreen button
      if (this.fullscreenBtn) {
        try { this.fullscreenBtn.removeEventListener('click', this._boundHandlers.onFullscreenBtnClick); } catch (_) {}
      }

      // Retry button (may or may not exist at destroy time)
      try {
        const retryBtn = this.find('.error-retry-btn');
        if (retryBtn) retryBtn.removeEventListener('click', this._boundHandlers.onRetryClick);
      } catch (_) {}

      this._boundHandlers = null;
    }

    // Remove host message handler if installed (diagnostic forwarder)
    try {
      if (this._hostMessageHandler) {
        try { window.removeEventListener('message', this._hostMessageHandler); } catch (_) {}
        this._hostMessageHandler = null;
      }
    } catch (_) {}

    // Disable the SCORM API bridge
    try {
      scormAPIBridge.disable();
    } catch (_) {}

    this.clearContent();
    super.destroy();
  }
}

export { ContentViewer };
