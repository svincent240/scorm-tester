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

    this.currentUrl = url;
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
      
      // Load content in iframe
      if (this.iframe) {
        // Use a host frameset document so the API lives on the parent of the SCO,
        // matching typical LMS embedding without modifying course code.
        const hostHtml = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>SCORM Host</title>
    <style>
      html, body { margin:0; padding:0; height:100%; width:100%; overflow:hidden; background:#fff; }
      #scoFrame { border:0; width:100%; height:100%; }
    </style>
  </head>
  <body>
    <iframe id="scoFrame" name="scoFrame" src="about:blank" allow="fullscreen" sandbox="${this.options.sandbox}"></iframe>
    <script>
      // Placeholder - APIs will be injected by parent renderer synchronously after load
    </script>
  </body>
</html>`;
        // srcdoc sets the host document first; on load we will inject APIs and set child frame src to url
        this.iframe.srcdoc = hostHtml;
        // Stash target SCO URL for use when host becomes available
        this._pendingScoUrl = url;
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
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }
    
    const loadTime = Date.now() - this.loadStartTime;
    
    try {
      this.contentWindow = this.iframe.contentWindow;
      this.hideLoading();
      this.showContent();

      try {
        // Diagnostics: log initial content document state
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          const docReady = (() => {
            try { return this.contentWindow?.document?.readyState || 'unknown'; } catch (_) { return 'err'; }
          })();
          rendererLogger.info('[ContentViewer] iframe load: contentWindow acquired', {
            url: this.currentUrl,
            loadTimeMs: loadTime,
            docReadyState: docReady
          });
        }).catch(() => {});
      } catch (_) {}

      // If we used host frameset via srcdoc, we must await the host DOM and then:
      // - inject canonical APIs into host (self)
      // - mirror to host.parent/top/opener (within iframe context, as accessible)
      // - set the child frame src to the SCO launch URL
      const cw = this.contentWindow;
      const hostDoc = cw?.document;
      const useHost = !!(hostDoc && hostDoc.getElementById && hostDoc.getElementById('scoFrame'));
      if (useHost) {
        // Ensure host DOM is ready
        const onHostReady = () => {
          try {
            // Inject canonical APIs into the host window and mirror to its ancestors within iframe context
            this.setupScormAPI();

            // Point child frame to the actual SCO URL
            try {
              const scoFrame = hostDoc.getElementById('scoFrame');
              if (scoFrame && this._pendingScoUrl) {
                scoFrame.src = this._pendingScoUrl;
              }
            } catch (_) {}

            // Verify presence from host window perspective
            setTimeout(() => { this.verifyScormApiPresence(); }, 0);

            // Host initialized log
            import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
              rendererLogger.info('[ContentViewer] host frameset initialized', {
                url: this.currentUrl,
                scoUrl: this._pendingScoUrl || null
              });
            }).catch(() => {});
          } catch (e) {
            try {
              import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                rendererLogger.error('[ContentViewer] host frameset init error', { message: e?.message || String(e) });
              }).catch(() => {});
            } catch (_) {}
          }
        };

        if (hostDoc.readyState === 'complete' || hostDoc.readyState === 'interactive') {
          onHostReady();
        } else {
          hostDoc.addEventListener('DOMContentLoaded', onHostReady, { once: true });
        }
      } else {
        // Fallback: direct page load (non-srcdoc path)
        this.setupScormAPI();
        setTimeout(() => { this.verifyScormApiPresence(); }, 0);
      }
      
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
   * Setup SCORM API in content window
   */
  setupScormAPI() {
    if (!this.contentWindow) {
      this.showError('Content Setup Error', 'Content window not available for SCORM API setup');
      return;
    }
    
    // Check if SCORM client is available
    if (!scormClient) {
      this.showError('SCORM Client Error', 'SCORM client service not available');
      return;
    }
    
    try {
      // Create optimized SCORM API wrapper
      const apiWrapper = this.createOptimizedAPIWrapper();
      
      // Prefer direct injection into the content window
      const win = this.contentWindow;
      win.API = apiWrapper.scorm12;           // SCORM 1.2
      win.API_1484_11 = apiWrapper.scorm2004; // SCORM 2004

      // Strict spec exposure only: no overrides to course discovery functions.
      // We expose canonical API objects; SCO's own discovery will locate them.
      const defineDiscoveryShims = null; // intentionally not used to avoid patching course code

      // Mirror canonical API onto self, parent, top, and opener when accessible (no function overrides)
      let mirrorParentSet = false;
      let mirrorTopSet = false;
      let mirrorOpenerSet = false;
      try {
        const parent = win.parent;
        if (parent && parent !== win) {
          try {
            if (!parent.API_1484_11) { parent.API_1484_11 = win.API_1484_11; mirrorParentSet = true; }
            if (!parent.API) { parent.API = win.API; mirrorParentSet = true; }
          } catch (_) {}
        }
        if (win.top && win.top !== win) {
          try {
            if (!win.top.API_1484_11) { win.top.API_1484_11 = win.API_1484_11; mirrorTopSet = true; }
            if (!win.top.API) { win.top.API = win.API; mirrorTopSet = true; }
          } catch (_) {}
        }
        if (win.opener) {
          try {
            if (!win.opener.API_1484_11) { win.opener.API_1484_11 = win.API_1484_11; mirrorOpenerSet = true; }
            if (!win.opener.API) { win.opener.API = win.API; mirrorOpenerSet = true; }
          } catch (_) {}
        }
      } catch (_) {}

      // Diagnostics for parent/top mirroring and discovery patch
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          const has12 = !!(win && win.API && (typeof win.API.Initialize === 'function' || typeof win.API.LMSInitialize === 'function'));
          const has2004 = !!(win && win.API_1484_11 && typeof win.API_1484_11.Initialize === 'function');
          const hasFinders = !!(win && (typeof win.FindAPI === 'function' || typeof win.FindAPI_1484_11 === 'function'));
          const parentHas = (() => { try { const p = win.parent; return !!(p && (p.API_1484_11 || p.API)); } catch (_) { return false; } })();
          const topHas = (() => { try { const t = win.top; return !!(t && (t.API_1484_11 || t.API)); } catch (_) { return false; } })();
          rendererLogger.info('[ContentViewer] SCORM API injected', {
            url: this.currentUrl,
            has12,
            has2004,
            hasFinders
          });
          rendererLogger.info('[ContentViewer] parent/top mirror diagnostics', {
            url: this.currentUrl,
            mirrorParentSet,
            mirrorTopSet,
            parentHasAny: parentHas,
            topHasAny: topHas
          });
        }).catch(() => {});
      } catch (_) {}

 
      // Strict mode: no normalization helpers and no invocation of SCO discovery.
      let ensuredSelf = true; // we exposed canonical APIs already
 
      // Strict mode: do not wrap or modify course functions. Only log presence.
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] strict mode active: no course overrides', { url: this.currentUrl });
        }).catch(() => {});
      } catch (_) {}
 
      // Log ensure results
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] ensureScormAPI diagnostics', {
            url: this.currentUrl,
            ensuredSelf
          });
        }).catch(() => {});
      } catch (_) {}

      // Final compatibility: expose only canonical APIs and avoid course overrides.
      // Also ensure any popup windows receive canonical APIs without touching their discovery functions.
      try {
        // Ensure global references on SCO window are present
        try {
          if (typeof win.API === 'undefined' || !win.API || typeof win.API.Initialize !== 'function') {
            if (win.API_1484_11 && typeof win.API_1484_11.Initialize === 'function') {
              win.API = win.API_1484_11;
            } else {
              win.API = apiWrapper.scorm12;
            }
          }
          if (!win.API_1484_11 || typeof win.API_1484_11.Initialize !== 'function') {
            win.API_1484_11 = apiWrapper.scorm2004;
          }
        } catch (_) {}

        // Intercept window.open only to set canonical API objects on new windows
        try {
          if (!win.__scormWindowOpenPatched) {
            const originalOpen = win.open;
            win.open = function patchedOpen(url, name, specs) {
              const popup = originalOpen ? originalOpen.call(win, url, name, specs) : null;
              try {
                const pw = popup && (popup.window || popup);
                if (pw) {
                  try {
                    if (!pw.API_1484_11) pw.API_1484_11 = apiWrapper.scorm2004;
                    if (!pw.API) pw.API = apiWrapper.scorm12;
                  } catch (_) {}
                }
              } catch (_) {}
              try {
                import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
                  rendererLogger.info('[ContentViewer] window.open intercepted (canonical APIs set)', { url, name, injected: !!(popup && (popup.window || popup)) });
                }).catch(() => {});
              } catch (_) {}
              return popup;
            };
            win.__scormWindowOpenPatched = true;
          }
        } catch (_) {}

        // Enumerate immediate frames for visibility
        try {
          const framesInfo = [];
          const doc = win.document;
          if (doc && doc.getElementsByTagName) {
            const iframes = doc.getElementsByTagName('iframe') || [];
            for (let i = 0; i < iframes.length; i++) {
              const node = iframes[i];
              let name = '';
              let src = '';
              try { name = node.name || node.id || ''; } catch (_) {}
              try { src = node.getAttribute('src') || ''; } catch (_) {}
              framesInfo.push({ index: i, name, src });
            }
          }
          import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
            rendererLogger.info('[ContentViewer] immediate frame enumeration', { url: this.currentUrl, count: framesInfo.length, frames: framesInfo });
          }).catch(() => {});
        } catch (_) {}
      } catch (_) {}
 
      // After injection, propagate API into same-origin descendant frames that the SCO might use
      this.propagateApiToFrames(win, apiWrapper);
 
      // Also observe for dynamically created iframes within the SCO
      this.observeAndPropagateToNewIframes(win, apiWrapper);
 
      this.emit('scormApiInjected', { contentWindow: win });
      
    } catch (error) {
      // Do not console.warn per logging rules; presence verification will notify/log
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] SCORM API injection error', error?.message || String(error));
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
    if (data.entryPoint) {
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

      // Check SCORM 2004 first
      const api2004 = win.API_1484_11;
      const api12 = win.API;
      const has2004 = api2004 && typeof api2004.Initialize === 'function';
      const has12 = api12 && (typeof api12.Initialize === 'function' || typeof api12.LMSInitialize === 'function');

      // Diagnostic snapshot before branching
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('[ContentViewer] verifyScormApiPresence snapshot', {
            url: this.currentUrl,
            has12,
            has2004
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
   * Recursively propagate injected API into same-origin descendant frames
   * and define discovery shims in those contexts.
   * Best-effort, silently skips cross-origin frames.
   * @private
   */
  propagateApiToFrames(rootWin, apiWrapper, depth = 0) {
    try {
      if (!rootWin || depth > 5) return; // prevent deep recursion
      const wins = [];
      try {
        // Current window first
        wins.push(rootWin);
        // Descendant iframes
        const doc = rootWin.document;
        if (doc && doc.getElementsByTagName) {
          const iframes = doc.getElementsByTagName('iframe') || [];
          for (let i = 0; i < iframes.length; i++) {
            const cw = iframes[i].contentWindow;
            if (cw) wins.push(cw);
          }
        }
      } catch (_) {}

      const defineDiscoveryShims = (w) => {
        try {
          if (!w) return;
          if (typeof w.FindAPI_1484_11 !== 'function') {
            w.FindAPI_1484_11 = function (start) {
              try {
                if (start && start.API_1484_11) return start.API_1484_11;
                let p = start ? start.parent : w.parent;
                let hops = 0;
                while (p && p !== start && hops < 10) {
                  if (p.API_1484_11) return p.API_1484_11;
                  p = p.parent;
                  hops++;
                }
              } catch (_) {}
              return w.API_1484_11 || null;
            };
          }
          if (typeof w.GetAPI_1484_11 !== 'function') {
            w.GetAPI_1484_11 = function () { return w.FindAPI_1484_11(w) || null; };
          }
          if (typeof w.FindAPI !== 'function') {
            w.FindAPI = function (start) {
              try {
                if (start && start.API) return start.API;
                let p = start ? start.parent : w.parent;
                let hops = 0;
                while (p && p !== start && hops < 10) {
                  if (p.API) return p.API;
                  p = p.parent;
                  hops++;
                }
              } catch (_) {}
              return w.API || null;
            };
          }
          if (typeof w.GetAPI !== 'function') {
            w.GetAPI = function () { return w.FindAPI(w) || null; };
          }
        } catch (_) {}
      };

      for (const w of wins) {
        try {
          if (w) {
            if (!w.API_1484_11) w.API_1484_11 = apiWrapper.scorm2004;
            if (!w.API) w.API = apiWrapper.scorm12;
            defineDiscoveryShims(w);
          }
        } catch (_) { /* cross-origin frame or access denied */ }
      }

      // Recurse a level into discovered frames
      for (const w of wins) {
        try { this.propagateApiToFrames(w, apiWrapper, depth + 1); } catch (_) {}
      }

      // Log a brief snapshot for diagnostics
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        try {
          const hasAny = !!(rootWin && (rootWin.API_1484_11 || rootWin.API));
          rendererLogger.info('[ContentViewer] propagateApiToFrames completed', {
            url: this.currentUrl,
            depth,
            rootHasAny: hasAny
          });
        } catch (_) {}
      }).catch(() => {});
    } catch (_) { /* swallow */ }
  }

  /**
   * Observe the SCO document for newly added iframes and propagate API
   * @private
   */
  observeAndPropagateToNewIframes(rootWin, apiWrapper) {
    try {
      const doc = rootWin && rootWin.document;
      if (!doc || !doc.body || typeof MutationObserver !== 'function') return;

      // Disconnect previous observer if any
      if (this._iframeObserver) {
        try { this._iframeObserver.disconnect(); } catch (_) {}
        this._iframeObserver = null;
      }

      this._iframeObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
            for (const node of m.addedNodes) {
              try {
                if (node && node.tagName && node.tagName.toLowerCase() === 'iframe') {
                  const cw = node.contentWindow;
                  if (cw) {
                    try {
                      if (!cw.API_1484_11) cw.API_1484_11 = apiWrapper.scorm2004;
                      if (!cw.API) cw.API = apiWrapper.scorm12;
                    } catch (_) {}
                  }
                }
              } catch (_) {}
            }
          }
        }
      });

      this._iframeObserver.observe(doc.body, { childList: true, subtree: true });

      // Also do a delayed pass to catch late loads
      setTimeout(() => { try { this.propagateApiToFrames(rootWin, apiWrapper, 0); } catch (_) {} }, 300);

      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.info('[ContentViewer] observeAndPropagateToNewIframes attached', { url: this.currentUrl });
      }).catch(() => {});
    } catch (_) { /* swallow */ }
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

    this.clearContent();
    super.destroy();
  }
}

export { ContentViewer };
