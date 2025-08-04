/**
 * SCORM Content Viewer Component
 * 
 * Displays SCORM content in a secure iframe with loading states,
 * error handling, and fullscreen support. Manages content lifecycle
 * and coordinates with SCORM API.
 * 
 * @fileoverview SCORM content viewer component
 */

const BaseComponent = require('../base-component');
const uiState = require('../../services/ui-state');
const scormClient = require('../../services/scorm-client');

/**
 * SCORM Content Viewer Class
 * 
 * Manages SCORM content display with secure iframe, loading states,
 * and integration with SCORM API.
 */
class ContentViewer extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
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
    this.element.innerHTML = `
      <div class="content-viewer__container">
        <div class="content-viewer__loading" id="${this.elementId}-loading">
          <div class="loading-spinner"></div>
          <div class="loading-message">Loading SCORM course...</div>
        </div>
        
        <div class="content-viewer__error" id="${this.elementId}-error" style="display: none;">
          <div class="error-icon">⚠️</div>
          <div class="error-message">Failed to load course content</div>
          <div class="error-details"></div>
          <button class="error-retry-btn">Retry</button>
        </div>
        
        <div class="content-viewer__no-content" id="${this.elementId}-no-content">
          <div class="no-content-icon">🎓</div>
          <div class="no-content-title">No Course Loaded</div>
          <div class="no-content-message">Load a SCORM package to begin testing</div>
        </div>
        
        <iframe 
          id="${this.elementId}-iframe"
          class="content-viewer__iframe"
          style="display: none;"
          sandbox="${this.options.sandbox}"
          allowfullscreen="${this.options.enableFullscreen}"
        ></iframe>
        
        ${this.options.enableFullscreen ? `
          <button class="content-viewer__fullscreen-btn" id="${this.elementId}-fullscreen" title="Fullscreen">
            ⛶
          </button>
        ` : ''}
      </div>
    `;

    // Get references to created elements
    this.iframe = this.find('.content-viewer__iframe');
    this.loadingElement = this.find('.content-viewer__loading');
    this.errorElement = this.find('.content-viewer__error');
    this.noContentElement = this.find('.content-viewer__no-content');
    
    if (this.options.enableFullscreen) {
      this.fullscreenBtn = this.find('.content-viewer__fullscreen-btn');
    }
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
      this.iframe.addEventListener('load', this.handleIframeLoad);
      this.iframe.addEventListener('error', this.handleIframeError);
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
        this.showError('Content loading timeout', 'The course took too long to load. Please check your connection and try again.');
      }, this.options.loadingTimeout);
      
      // Load content in iframe
      this.iframe.src = url;
      
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
      
      // Setup SCORM API in content window
      this.setupScormAPI();
      
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
    if (!this.contentWindow) return;
    
    try {
      // Inject SCORM API objects
      this.contentWindow.API = {
        LMSInitialize: (param) => scormClient.Initialize(scormClient.getSessionId() || 'default'),
        LMSFinish: (param) => scormClient.Terminate(param),
        LMSGetValue: (element) => scormClient.GetValue(element),
        LMSSetValue: (element, value) => scormClient.SetValue(element, value),
        LMSCommit: (param) => scormClient.Commit(param),
        LMSGetLastError: () => scormClient.GetLastError(),
        LMSGetErrorString: (errorCode) => scormClient.GetErrorString(errorCode),
        LMSGetDiagnostic: (errorCode) => scormClient.GetDiagnostic(errorCode)
      };
      
      // SCORM 2004 API
      this.contentWindow.API_1484_11 = {
        Initialize: (param) => scormClient.Initialize(scormClient.getSessionId() || 'default'),
        Terminate: (param) => scormClient.Terminate(param),
        GetValue: (element) => scormClient.GetValue(element),
        SetValue: (element, value) => scormClient.SetValue(element, value),
        Commit: (param) => scormClient.Commit(param),
        GetLastError: () => scormClient.GetLastError(),
        GetErrorString: (errorCode) => scormClient.GetErrorString(errorCode),
        GetDiagnostic: (errorCode) => scormClient.GetDiagnostic(errorCode)
      };
      
      this.emit('scormApiInjected', { contentWindow: this.contentWindow });
      
    } catch (error) {
      console.warn('Failed to inject SCORM API:', error);
    }
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
    
    uiState.setLoading(true, 'Loading SCORM course...');
  }

  /**
   * Hide loading state
   */
  hideLoading() {
    if (this.loadingElement) {
      this.loadingElement.style.display = 'none';
    }
    
    uiState.setLoading(false);
  }

  /**
   * Show content
   */
  showContent() {
    this.hideNoContent();
    
    if (this.iframe) {
      this.iframe.style.display = 'block';
    }
    
    if (this.fullscreenBtn) {
      this.fullscreenBtn.style.display = 'block';
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
    
    if (this.errorElement) {
      this.errorElement.style.display = 'flex';
      
      const messageEl = this.errorElement.querySelector('.error-message');
      const detailsEl = this.errorElement.querySelector('.error-details');
      
      if (messageEl) messageEl.textContent = message;
      if (detailsEl) detailsEl.textContent = details || '';
    }
    
    uiState.setError(message);
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
    uiState.setError(null);
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
      this.loadContent(this.currentUrl);
    }
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
    console.warn('SCORM Error:', data);
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
    
    // Remove fullscreen event listeners
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', this.handleFullscreenChange);
    
    this.clearContent();
    super.destroy();
  }
}

module.exports = ContentViewer;