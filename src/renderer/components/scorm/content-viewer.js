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
import { uiState } from '../../services/ui-state.js';
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
    // DO NOT modify existing HTML structure - preserve welcome screen
    console.log('ContentViewer: Preserving existing HTML structure completely');
    
    // Find existing iframe if it exists
    this.iframe = this.find('.content-viewer__frame') || this.find('#content-frame');
    this.loadingElement = null;
    this.errorElement = null;
    this.noContentElement = null;
    this.fullscreenBtn = null;
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
      
      // Apply scaling after content loads
      setTimeout(() => {
        this.applyContentScaling();
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
    if (!this.contentWindow) return;
    
    try {
      console.log('ContentViewer: Setting up SCORM API with debug logging');
      
      // Inject SCORM API objects with logging wrappers
      this.contentWindow.API = {
        // LMS-prefixed methods (SCORM 1.2 standard)
        LMSInitialize: (param) => {
          const result = scormClient.Initialize(scormClient.getSessionId() || 'default');
          this.logApiCall('LMSInitialize', param, result);
          return result;
        },
        LMSFinish: (param) => {
          const result = scormClient.Terminate(param);
          this.logApiCall('LMSFinish', param, result);
          return result;
        },
        LMSGetValue: (element) => {
          const result = scormClient.GetValue(element);
          this.logApiCall('LMSGetValue', element, result);
          return result;
        },
        LMSSetValue: (element, value) => {
          const result = scormClient.SetValue(element, value);
          this.logApiCall('LMSSetValue', `${element} = ${value}`, result);
          return result;
        },
        LMSCommit: (param) => {
          const result = scormClient.Commit(param);
          this.logApiCall('LMSCommit', param, result);
          return result;
        },
        LMSGetLastError: () => {
          const result = scormClient.GetLastError();
          this.logApiCall('LMSGetLastError', '', result);
          return result;
        },
        LMSGetErrorString: (errorCode) => {
          const result = scormClient.GetErrorString(errorCode);
          this.logApiCall('LMSGetErrorString', errorCode, result);
          return result;
        },
        LMSGetDiagnostic: (errorCode) => {
          const result = scormClient.GetDiagnostic(errorCode);
          this.logApiCall('LMSGetDiagnostic', errorCode, result);
          return result;
        },
        
        // Direct methods (for content that expects API.Commit instead of API.LMSCommit)
        Initialize: (param) => {
          const result = scormClient.Initialize(scormClient.getSessionId() || 'default');
          this.logApiCall('Initialize', param, result);
          return result;
        },
        Finish: (param) => {
          const result = scormClient.Terminate(param);
          this.logApiCall('Finish', param, result);
          return result;
        },
        GetValue: (element) => {
          const result = scormClient.GetValue(element);
          this.logApiCall('GetValue', element, result);
          return result;
        },
        SetValue: (element, value) => {
          const result = scormClient.SetValue(element, value);
          this.logApiCall('SetValue', `${element} = ${value}`, result);
          return result;
        },
        Commit: (param) => {
          const result = scormClient.Commit(param);
          this.logApiCall('Commit', param, result);
          return result;
        },
        GetLastError: () => {
          const result = scormClient.GetLastError();
          this.logApiCall('GetLastError', '', result);
          return result;
        },
        GetErrorString: (errorCode) => {
          const result = scormClient.GetErrorString(errorCode);
          this.logApiCall('GetErrorString', errorCode, result);
          return result;
        },
        GetDiagnostic: (errorCode) => {
          const result = scormClient.GetDiagnostic(errorCode);
          this.logApiCall('GetDiagnostic', errorCode, result);
          return result;
        }
      };
      
      // SCORM 2004 API
      this.contentWindow.API_1484_11 = {
        Initialize: (param) => {
          const result = scormClient.Initialize(scormClient.getSessionId() || 'default');
          this.logApiCall('Initialize', param, result);
          return result;
        },
        Terminate: (param) => {
          const result = scormClient.Terminate(param);
          this.logApiCall('Terminate', param, result);
          return result;
        },
        GetValue: (element) => {
          const result = scormClient.GetValue(element);
          this.logApiCall('GetValue', element, result);
          return result;
        },
        SetValue: (element, value) => {
          const result = scormClient.SetValue(element, value);
          this.logApiCall('SetValue', `${element} = ${value}`, result);
          return result;
        },
        Commit: (param) => {
          const result = scormClient.Commit(param);
          this.logApiCall('Commit', param, result);
          return result;
        },
        GetLastError: () => {
          const result = scormClient.GetLastError();
          this.logApiCall('GetLastError', '', result);
          return result;
        },
        GetErrorString: (errorCode) => {
          const result = scormClient.GetErrorString(errorCode);
          this.logApiCall('GetErrorString', errorCode, result);
          return result;
        },
        GetDiagnostic: (errorCode) => {
          const result = scormClient.GetDiagnostic(errorCode);
          this.logApiCall('GetDiagnostic', errorCode, result);
          return result;
        }
      };
      
      this.emit('scormApiInjected', { contentWindow: this.contentWindow });
      
    } catch (error) {
      console.warn('Failed to inject SCORM API:', error);
    }
  }

  /**
   * Log API call for debug panel
   * @private
   */
  logApiCall(method, parameter, result) {
    const apiCall = {
      method,
      parameter: String(parameter || ''),
      result: String(result),
      errorCode: scormClient.GetLastError(),
      timestamp: Date.now()
    };

    console.log('ContentViewer: API call:', apiCall);
    
    // Emit via IPC for debug window
    if (window.electronAPI && window.electronAPI.emitDebugEvent) {
      console.log('ContentViewer: Emitting debug event via IPC:', apiCall);
      window.electronAPI.emitDebugEvent('api:call', apiCall);
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
   * Apply content scaling to fit iframe content properly
   */
  applyContentScaling() {
    if (!this.iframe || !this.contentWindow) {
      return;
    }

    try {
      // Get iframe container dimensions
      const iframeRect = this.iframe.getBoundingClientRect();
      const containerWidth = iframeRect.width;
      const containerHeight = iframeRect.height;

      // Get content document dimensions
      const contentDoc = this.contentWindow.document;
      if (!contentDoc || !contentDoc.body) {
        console.log('ContentViewer: Content document not ready for scaling');
        return;
      }

      // Try to get the actual content dimensions
      const contentBody = contentDoc.body;
      const contentHtml = contentDoc.documentElement;
      
      // Get the larger of body scroll dimensions or html scroll dimensions
      const contentWidth = Math.max(
        contentBody.scrollWidth || 0,
        contentHtml.scrollWidth || 0,
        contentBody.offsetWidth || 0,
        contentHtml.offsetWidth || 0
      );
      
      const contentHeight = Math.max(
        contentBody.scrollHeight || 0,
        contentHtml.scrollHeight || 0,
        contentBody.offsetHeight || 0,
        contentHtml.offsetHeight || 0
      );

      console.log(`ContentViewer: Container: ${containerWidth}x${containerHeight}, Content: ${contentWidth}x${contentHeight}`);

      // Calculate scale factors
      const scaleX = containerWidth / contentWidth;
      const scaleY = containerHeight / contentHeight;
      const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down

      // Apply scaling if needed
      if (scale < 1) {
        console.log(`ContentViewer: Applying scale factor: ${scale}`);
        
        // Apply CSS transform to scale the content
        const styleElement = contentDoc.createElement('style');
        styleElement.textContent = `
          html, body {
            transform: scale(${scale});
            transform-origin: top left;
            width: ${100 / scale}%;
            height: ${100 / scale}%;
            overflow: hidden;
          }
        `;
        contentDoc.head.appendChild(styleElement);
        
        // Also try to set viewport meta tag if it doesn't exist
        let viewportMeta = contentDoc.querySelector('meta[name="viewport"]');
        if (!viewportMeta) {
          viewportMeta = contentDoc.createElement('meta');
          viewportMeta.name = 'viewport';
          viewportMeta.content = `width=${contentWidth}, initial-scale=${scale}, maximum-scale=${scale}, user-scalable=no`;
          contentDoc.head.appendChild(viewportMeta);
        }
      } else {
        console.log('ContentViewer: Content fits within container, no scaling needed');
      }

    } catch (error) {
      console.error('ContentViewer: Error applying content scaling:', error);
      // Scaling failed, but content should still be viewable
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
    console.warn('SCORM Error:', JSON.stringify(data, null, 2));
    console.warn('SCORM Error Details:', {
      type: typeof data,
      message: data?.message || 'No message',
      code: data?.code || 'No code',
      stack: data?.stack || 'No stack trace',
      raw: data
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

export { ContentViewer };
