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
  loadContent(url, options = {}) {
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
      
      // PRE-INJECT APIs into parent window contexts BEFORE loading iframe
      // This ensures APIs are already present when SCORM content starts searching
      this.preInjectAPIs();
      
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
      
      // Simplified API verification - no complex monitoring needed
      
      // Verify API presence after a brief delay to ensure injection is complete
      setTimeout(() => { 
        this.verifyScormApiPresence();
      }, 100);
      
      // Apply scaling after content loads
      setTimeout(() => {
        this.applyContentScaling();
        // Begin observing size changes to keep fit without inner scrollbars
        this.startResizeObserver();
        // Force layout refresh to ensure content utilizes full available space
        this.refreshLayout();
      }, 100);
      
      // Fix nested iframe sizing issues with additional delay for SCORM courses
      // that create nested iframes after initial load
      setTimeout(() => {
        this.fixNestedIframeSizing();
      }, 500);
      
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
   * Pre-inject APIs into parent window contexts BEFORE iframe loads
   * This ensures APIs are present when Rustici algorithm searches
   */
  preInjectAPIs() {
    try {
      // Set the SCORM client for synchronous bridge calls (already imported)
      scormAPIBridge.setScormClient(scormClient);
      
      // Enable the bridge for communication
      scormAPIBridge.enable();
      
      // Create direct API methods that call the bridge synchronously
      const createDirectAPI = (version) => {
        const methods = version === '2004' 
          ? ['Initialize', 'Terminate', 'GetValue', 'SetValue', 'Commit', 'GetLastError', 'GetErrorString', 'GetDiagnostic']
          : ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic'];
          
        const api = {};
        
        methods.forEach(method => {
          api[method] = (...args) => {
            try {
              // Direct synchronous call to the bridge's executeScormMethod
              return scormAPIBridge.executeScormMethod(method, args);
            } catch (error) {
              return '0';
            }
          };
        });
        
        // Add SCORM 1.2 compatibility methods
        if (version === '1.2') {
          api.Initialize = api.LMSInitialize;
          api.Terminate = api.LMSFinish;
          api.GetValue = api.LMSGetValue;
          api.SetValue = api.LMSSetValue;
          api.Commit = api.LMSCommit;
          api.GetLastError = api.LMSGetLastError;
          api.GetErrorString = api.LMSGetErrorString;
          api.GetDiagnostic = api.LMSGetDiagnostic;
        }
        
        return api;
      };
      
      // Create the API objects
      const api12 = createDirectAPI('1.2');
      const api2004 = createDirectAPI('2004');
      
      // CRITICAL: Inject APIs into current window (which will be parent of iframe)
      window.API = api12;
      window.API_1484_11 = api2004;
      
      // Ensure APIs are enumerable properties (Rustici checks this)
      try {
        Object.defineProperty(window, 'API', {
          value: api12,
          writable: true,
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(window, 'API_1484_11', {
          value: api2004,
          writable: true,
          enumerable: true,
          configurable: true
        });
      } catch (e) {
        // Direct assignment should work as fallback
      }
      
      // Also inject into parent/top windows if they exist and are different
      try {
        if (window.parent && window.parent !== window) {
          window.parent.API = api12;
          window.parent.API_1484_11 = api2004;
        }
      } catch (e) {
        // Cross-origin access may fail - ignore
      }
      
      try {
        if (window.top && window.top !== window && window.top !== window.parent) {
          window.top.API = api12;
          window.top.API_1484_11 = api2004;
        }
      } catch (e) {
        // Cross-origin access may fail - ignore
      }
      
    } catch (error) {
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] Pre-injection API error', error?.message || String(error));
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Setup SCORM API in content window - APIs are now pre-injected in parent
   */
  setupScormAPI() {
    if (!this.contentWindow) {
      this.showError('Content Setup Error', 'Content window not available for SCORM API setup');
      return;
    }
    
    try {
      const win = this.contentWindow;
      
      // APIs are already pre-injected in parent window, just add verification function
      win.testAPIInjection = function() {
        return {
          hasAPI: !!win.API,
          hasAPI_1484_11: !!win.API_1484_11,
          parentHasAPI: !!(window.parent?.API),
          parentHasAPI_1484_11: !!(window.parent?.API_1484_11),
          topHasAPI: !!(window.top?.API),
          topHasAPI_1484_11: !!(window.top?.API_1484_11),
          apiInitialize: typeof window.parent?.API?.Initialize,
          api1484Initialize: typeof window.parent?.API_1484_11?.Initialize
        };
      };
      
      this.emit('scormApiInjected', { contentWindow: win, mode: 'pre-injected' });
      
    } catch (error) {
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] API setup error', error?.message || String(error));
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
   * Force layout refresh to ensure proper space utilization
   */
  refreshLayout() {
    try {
      // Force a reflow by reading layout properties and triggering resize
      if (this.element) {
        // Force reflow by accessing layout-triggering properties
        const height = this.element.offsetHeight;
        const width = this.element.offsetWidth;
        
        // Dispatch a resize event to trigger layout recalculation
        if (window.ResizeObserver) {
          // If ResizeObserver is available, manually trigger observers
          this.element.style.width = width + 'px';
          this.element.style.height = height + 'px';
          // Remove explicit sizing to let flex handle it
          setTimeout(() => {
            this.element.style.width = '';
            this.element.style.height = '';
          }, 10);
        } else {
          // Fallback: dispatch window resize event
          window.dispatchEvent(new Event('resize'));
        }
      }
      
      // Fix nested iframe sizing issues in SCORM content
      this.fixNestedIframeSizing();
      
    } catch (error) {
      // Silent fail - layout refresh is best effort
    }
  }

  /**
   * Fix nested iframe sizing issues in SCORM content that uses fixed dimensions
   */
  fixNestedIframeSizing() {
    try {
      if (!this.contentWindow || !this.contentWindow.document) {
        return;
      }

      const contentDoc = this.contentWindow.document;
      
      // Get our content viewer's available height
      const availableHeight = this.iframe ? this.iframe.clientHeight : 600;
      
      // Look for common iframe IDs/classes used in SCORM courses
      const nestedIframes = contentDoc.querySelectorAll('iframe#contentFrame, iframe[id*="content"], iframe[id*="Content"]');
      
      nestedIframes.forEach(nestedIframe => {
        if (nestedIframe) {
          // Calculate proper height accounting for navigation elements
          const navDiv = contentDoc.getElementById('navDiv');
          const navHeight = navDiv ? navDiv.offsetHeight + 10 : 50; // Add some padding
          const calculatedHeight = availableHeight - navHeight;
          
          // Override the fixed sizing with calculated dimensions
          nestedIframe.style.width = '100%';
          nestedIframe.style.height = `${Math.max(calculatedHeight, 400)}px`; // Ensure minimum height
          nestedIframe.style.border = 'none';
          nestedIframe.style.marginTop = '0';
          nestedIframe.style.overflow = 'hidden'; // Prevent scrollbars on the iframe itself
          
          // Fix the parent body to not create additional scrollbars while preserving expected margins
          const iframeDoc = nestedIframe.contentDocument || nestedIframe.contentWindow?.document;
          if (iframeDoc) {
            iframeDoc.documentElement.style.height = '100%';
            iframeDoc.documentElement.style.overflow = 'hidden';
            iframeDoc.body.style.height = '100%';
            // Preserve the original left margin (20px) from the course's CSS but remove others
            const computedStyle = iframeDoc.defaultView?.getComputedStyle(iframeDoc.body);
            const originalMarginLeft = computedStyle?.marginLeft || '20px';
            iframeDoc.body.style.margin = `0 0 0 ${originalMarginLeft}`;
            iframeDoc.body.style.padding = '0';
            iframeDoc.body.style.overflow = 'auto'; // Allow scrolling only in the inner content if needed
          }
        }
      });

      // Fix the main content document to eliminate outer scrollbars
      if (contentDoc.body) {
        contentDoc.body.style.height = `${availableHeight}px`;
        contentDoc.body.style.margin = '0';
        contentDoc.body.style.padding = '0';
        contentDoc.body.style.overflow = 'hidden'; // Prevent outer scrollbars
      }
      
      if (contentDoc.documentElement) {
        contentDoc.documentElement.style.height = '100%';
        contentDoc.documentElement.style.overflow = 'hidden';
      }
      
    } catch (error) {
      // Silent fail - nested iframe fixes are best effort
    }
  }


  /**
   * Verify SCORM API presence - check parent window where APIs are pre-injected
   */
  verifyScormApiPresence() {
    try {
      // APIs are pre-injected in parent window, not content window
      const parentApi2004 = window.API_1484_11;
      const parentApi12 = window.API;
      const hasParent2004 = parentApi2004 && typeof parentApi2004.Initialize === 'function';
      const hasParent12 = parentApi12 && (typeof parentApi12.Initialize === 'function' || typeof parentApi12.LMSInitialize === 'function');

      if (hasParent2004 || hasParent12) {
        // API present in parent window - success!
        this.emit('scormApiVerified', { mode: 'pre-injected', hasParent2004, hasParent12 });
        return;
      }

      // If APIs are missing from parent window, show error
      this.showError(
        'SCORM API not found',
        'SCORM APIs were not properly pre-injected into parent window. API bridge may not be functioning correctly.'
      );
      this.emit('scormApiMissing', { url: this.currentUrl });
      
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
