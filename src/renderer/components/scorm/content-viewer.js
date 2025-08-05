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
    
    if (this.iframe) {
      this.iframe.addEventListener('load', this.handleIframeLoad.bind(this));
      this.iframe.addEventListener('error', this.handleIframeError.bind(this));
    }
    
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', this.toggleFullscreen);
    }
    
    const retryBtn = this.find('.error-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', this.retryLoad);
    }
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', this.handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', this.handleFullscreenChange);
  }

  /**
   * Load SCORM content
   * @param {string} url - Content URL
   * @param {Object} options - Loading options
   */
  async loadContent(url, options = {}) {
    if (!url) {
      this.showError('Invalid content URL');
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
        this.iframe.src = url;
      }
      
      this.emit('contentLoadStarted', { url, options });
      
    } catch (error) {
      this.showError('Failed to load content', error.message);
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
      
      // Setup SCORM API in content window using the bridge
      this.setupScormAPI();

      // Verify SCORM API presence and fallbacks
      setTimeout(() => {
        this.verifyScormApiPresence();
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
      this.showError('Content initialization failed', error.message);
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
      
      // Prefer direct injection
      this.contentWindow.API = apiWrapper.scorm12;           // SCORM 1.2
      this.contentWindow.API_1484_11 = apiWrapper.scorm2004; // SCORM 2004
      
      this.emit('scormApiInjected', { contentWindow: this.contentWindow });
      
    } catch (error) {
      // Do not console.warn per logging rules; presence verification will notify/log
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
        console.log('ContentViewer: Content scaling removed');
      } catch (error) {
        console.warn('ContentViewer: Failed to remove scaling:', error.message);
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
      console.log('ContentViewer: Retrying content load:', this.currentUrl);
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
    this.showError('Course loading failed', data.message);
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
          // Neither direct API nor bridge responded; notify user
          this.uiState.showNotification({
            type: 'error',
            duration: 0,
            message: 'SCORM API not found in content. The SCO did not expose API_1484_11 or API, and no postMessage bridge responded. The course may not be SCORM-enabled or is loading in a context that cannot access the API.'
          });
          this.uiState.setError({ message: 'SCORM API not found (no direct API or bridge response).' });
          this.emit('scormApiMissing', { url: this.currentUrl });
        }
      }, 600);
    } catch (err) {
      this.uiState.showNotification({
        type: 'error',
        duration: 0,
        message: `SCORM API verification error: ${err.message || String(err)}`
      });
      this.uiState.setError(err);
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
    
    // Remove fullscreen event listeners
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', this.handleFullscreenChange);
    
    this.clearContent();
    super.destroy();
  }
}

export { ContentViewer };
