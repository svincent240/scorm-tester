// @ts-check

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

    // Initialize logger immediately
    this.logger = rendererLogger;

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
      respectContentDesign: true, // SCORM compliance: respect content author's design
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-presentation',
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
   * Setup event subscriptions (BUG-007 FIX)
   */
  setupEventSubscriptions() {
    // Listen for course loading events
    this.subscribe('course:loaded', this.handleCourseLoaded);
    this.subscribe('course:error', this.handleCourseError);

    // Listen for UI state changes
    this.subscribe('ui:updated', this.handleUIUpdate);

    // Listen for SCORM events (UI-scoped)
    this.subscribe('ui:scorm:initialized', this.handleScormInitialized);
    this.subscribe('ui:scorm:error', this.handleScormError);

    // Listen for navigation launch events (results only; requests handled centrally by AppManager)
    this.subscribe('navigation:launch', this.handleNavigationLaunch);

    // Listen for browse mode changes
    this.subscribe('browseMode:changed', this.handleBrowseModeChanged);

    // Listen for viewport size changes
    this.subscribe('viewport:size-changed', this.handleViewportSizeChanged);
  }

  /**
   * Handle viewport size changes
   */
  handleViewportSizeChanged(data) {
    const size = data?.data || data;
    if (!size || !size.width || !size.height) return;

    try {
      // Apply size to container
      const container = this.find('.content-viewer__container');
      if (container) {
        // Check if this is desktop mode (1366x768 or similar large size)
        const isDesktopMode = size.width >= 1200;
        
        if (isDesktopMode) {
          // Desktop mode - remove all constraints to use full window
          container.style.width = '';
          container.style.height = '';
          container.style.maxWidth = '';
          container.style.maxHeight = '';
          container.style.margin = '';
          container.style.border = '';
          container.style.overflow = '';
        } else {
          // Mobile/tablet mode - apply size constraints
          container.style.width = `${size.width}px`;
          container.style.height = `${size.height}px`;
          container.style.maxWidth = `${size.width}px`;
          container.style.maxHeight = `${size.height}px`;
          container.style.margin = '0 auto';
          container.style.border = '1px solid #ccc';
          container.style.overflow = 'auto';
        }
      }

      this.logger?.info('ContentViewer: Viewport size changed', size);
    } catch (error) {
      this.logger?.error('ContentViewer: Failed to apply viewport size', error);
    }
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
   * Load SCORM activity (BUG-001 FIX)
   * @param {Object} activityObject - SCORM activity object with identifier, launchUrl, etc.
   * @param {Object} options - Loading options
   */
  loadActivity(activityObject, options = {}) {
    if (!activityObject) {
      this.showError('Invalid activity', 'A valid activity object must be provided.');
      return;
    }

    try {
      // Extract SCORM-compliant data from activity object
      const activityData = {
        identifier: activityObject.identifier || activityObject.id,
        launchUrl: activityObject.launchUrl || activityObject.href,
        title: activityObject.title,
        // SCORM 2004 data elements
        launch_data: activityObject.launch_data || '',
        mastery_score: activityObject.mastery_score || '',
        max_time_allowed: activityObject.max_time_allowed || '',
        time_limit_action: activityObject.time_limit_action || '',
        data_from_lms: activityObject.data_from_lms || '',
        prerequisites: activityObject.prerequisites || '',
        ...options
      };

      // Validate activity object contains required SCORM 2004 elements
      if (!activityData.identifier) {
        throw new Error('Activity missing required identifier');
      }

      // Determine launch URL (must be provided by main as scorm-app://)
      const launchUrl = activityData.launchUrl || (activityObject && activityObject.identifierref) || null;
      if (!launchUrl) {
        throw new Error('Activity missing launch URL');
      }
      if (!String(launchUrl).startsWith('scorm-app://')) {
        throw new Error('Launch URL must be a scorm-app:// URL resolved by main process');
      }

      // Store activity data for SCORM API access
      this.currentActivity = activityData;

      // Load the content using the existing loadContent method
      this.loadContent(launchUrl, {
        ...options,
        activityData,
        isActivity: true
      });

      this.logger?.info('ContentViewer: Loading activity', {
        identifier: activityData.identifier,
        launchUrl: launchUrl,
        title: activityData.title
      });

    } catch (error) {
      this.showError('Failed to load activity', error?.message || String(error));
      this.emit('activityLoadError', { activityObject, error });
    }
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

    // Enforce scorm-app:// URLs only (resolved by main process)
    let processedUrl;
    try {
      processedUrl = ContentViewer.normalizeURL(url);
    } catch (error) {
      this.logger?.error('ContentViewer: URL validation failed', {
        originalPath: url,
        error: error.message
      });
      this.showError('Content loading failed', error.message);
      // Emit global error for AppManager gating
      import('../../services/event-bus.js').then(({ eventBus }) => {
        eventBus.emit('content:load:error', { url, error: error.message });
      }).catch(() => { /* intentionally empty */ });
      return;
    }

    this.currentUrl = processedUrl;
    this.loadStartTime = Date.now();

    // Initialize session with main process BEFORE loading content (LMS pattern)
    // The main process checks for suspended session automatically
    let sessionId;
    let initialScormData = null;
    try {
      const { ipcClient } = await import('../../services/ipc-client.js');
      // Get the app instance ID to create a session unique to this app instance.
      // This allows multiple app instances to run the same course without conflicts,
      // while keeping the session consistent within this instance for resume.
      const { appManager } = await import('../../services/app-manager.js');
      const instanceId = appManager?.instanceId || 'default';
      sessionId = 'session_' + instanceId;
      
      const sessionResult = await ipcClient.invoke('scorm-initialize', {
        sessionId: sessionId,
        forceNew: options.forceNew || false
      });
      
      if (!sessionResult || !sessionResult.success) {
        throw new Error(sessionResult?.reason || 'Failed to initialize session');
      }

      // Prime the SCORM client cache with initial data to prevent race conditions
      // where the course calls GetValue before the async initialization completes
      // Store it temporarily to apply AFTER teardownScormAPIs()
      if (sessionResult.initialData) {
        initialScormData = sessionResult.initialData;
      }
      
      this.logger?.info('ContentViewer: Session initialized by main process', { sessionId });
    } catch (error) {
      this.logger?.error('ContentViewer: Failed to initialize session', error);
      this.showError('Failed to initialize session', error.message);
      return;
    }    try {
      this.showLoading();
      this.clearError();

      // Notify AppManager that content load is starting
      import('../../services/event-bus.js').then(({ eventBus }) => {
        eventBus.emit('content:load:start', { url: processedUrl, options });
      }).catch(() => { /* intentionally empty */ });

      // Set loading timeout
      if (this.loadingTimeout) {
        clearTimeout(this.loadingTimeout);
      }

      this.loadingTimeout = setTimeout(() => {
        this.handleLoadTimeout();
      }, this.options.loadingTimeout);

      // CRITICAL FIX: Clear old content BEFORE tearing down APIs
      //
      // Problem: When reloading or resuming a course, the old content was still executing
      // in the iframe when teardownScormAPIs() was called. This caused the old content's
      // cached API references to become stubs, leading to "SCORM API not available" errors
      // when the old content tried to make SCORM calls (e.g., recording interactions).
      //
      // Solution: Unload the old content first by setting iframe.src to 'about:blank',
      // then wait briefly for unload handlers to complete before stubifying the APIs.
      // This ensures a clean transition with no lingering content trying to use stubbed APIs.
      //
      // Timing: The 50ms delay allows the browser to:
      // 1. Trigger the old content's beforeunload/unload events
      // 2. Stop executing the old content's JavaScript
      // 3. Clear the old content's window object
      if (this.iframe && this.iframe.src && this.iframe.src !== 'about:blank') {
        this.iframe.src = 'about:blank';
        this.contentWindow = null;
        // Small delay to allow old content's unload handlers to complete
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Detach any previous SCORM API bindings to avoid stray calls from the old content
      this.teardownScormAPIs();

      // Pass session ID to bridge BEFORE setting up APIs (LMS pattern)
      const { scormAPIBridge } = await import('../../services/scorm-api-bridge.js');
      scormAPIBridge.setSessionId(sessionId);

      // Apply primed cache data if available (must be done after teardown/reset)
      if (initialScormData) {
        try {
          scormClient.primeCache(initialScormData);
          this.logger?.info('ContentViewer: Primed SCORM cache with initial data', { 
            keys: Object.keys(initialScormData).length 
          });
        } catch (e) {
          this.logger?.warn('ContentViewer: Failed to prime SCORM cache', e);
        }
      }

      // Setup SCORM APIs BEFORE iframe loads
      this.setupScormAPIs();

      // Pre-inject APIs into the iframe's current window synchronously (about:blank)
      if (this.iframe && this._syncInjectApiIntoWindow) {
        try { this._syncInjectApiIntoWindow(this.iframe.contentWindow); } catch (_) { /* intentionally empty */ }
      }

      // Load content directly in iframe
      if (this.iframe) {
        this.iframe.src = processedUrl;
      }

      this.emit('contentLoadStarted', { url, options });

    } catch (error) {
      this.showError('Failed to load content', error?.message || String(error));
      this.emit('contentLoadError', { url, error });
      import('../../services/event-bus.js').then(({ eventBus }) => {
        eventBus.emit('content:load:error', { url: processedUrl, error: error?.message || String(error) });
      }).catch(() => { /* intentionally empty */ });
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

    try {
      this.contentWindow = this.iframe.contentWindow;

      // Inject SCORM API into iframe after it loads
      if (this._injectApiIntoIframe) {
        this._injectApiIntoIframe(this.iframe);
      }

      // Check for deprecated Flash content and warn user
      this.detectAndWarnAboutFlashContent();

      this.hideLoading();
      this.showContent();

      // Respect content design after content loads
      this.respectContentDesign();
      this.startResizeObserver();
      this.refreshLayout();
      this.fixNestedIframeSizing();

      // Notify AppManager that content is ready
      import('../../services/event-bus.js').then(({ eventBus }) => {
        eventBus.emit('content:load:ready', { url: this.currentUrl });
      }).catch(() => { /* intentionally empty */ });

      this.emit('contentLoaded', {
        url: this.currentUrl,
        contentWindow: this.contentWindow
      });

    } catch (error) {
      this.showError('Content initialization failed', error?.message || String(error));
      import('../../services/event-bus.js').then(({ eventBus }) => {
        eventBus.emit('content:load:error', { url: this.currentUrl, error: error?.message || String(error) });
      }).catch(() => { /* intentionally empty */ });
    }
  }

  /**
   * Detect Flash content and warn user about deprecation
   */
  detectAndWarnAboutFlashContent() {
    try {
      if (!this.contentWindow || !this.contentWindow.document) {
        return;
      }

      const doc = this.contentWindow.document;

      // Check for Flash objects and embeds
      const flashElements = doc.querySelectorAll('object[type*="flash"], object[data*="swf"], embed[src*="swf"]');

      if (flashElements.length > 0) {
        // Log the detection for debugging
        if (this.logger?.info) {
          this.logger.info('ContentViewer: Detected Flash content', {
            count: flashElements.length,
            url: this.currentUrl
          });
        }

        // Show user warning about Flash deprecation
        this.uiState.showNotification({
          type: 'warning',
          message: 'Flash Content Detected',
          details: `This course contains ${flashElements.length} Flash element(s) which are no longer supported by modern browsers. The content may not function properly.`,
          duration: 0, // Persistent until dismissed
          actions: [
            {
              label: 'Learn More',
              handler: () => {
                // Open external link about Flash deprecation
                if (typeof window !== 'undefined' && window.open) {
                  window.open('https://www.adobe.com/products/flashplayer/end-of-life.html', '_blank');
                }
              }
            }
          ]
        });
      }

      // Also check for SWF files referenced in links or other elements
      const swfLinks = doc.querySelectorAll('a[href*="swf"], link[href*="swf"]');
      if (swfLinks.length > 0 && flashElements.length === 0) {
        // Only show warning if we haven't already shown one for embedded Flash
        this.uiState.showNotification({
          type: 'info',
          message: 'Flash Files Detected',
          details: 'This course references Flash files (.swf) which may not be supported in modern browsers.',
          duration: 10000 // Show for 10 seconds
        });
      }

    } catch (error) {
      // Silently fail Flash detection - don't break content loading
      if (this.logger?.debug) {
        this.logger.debug('ContentViewer: Flash detection failed', error?.message || error);
      }
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
    import('../../services/event-bus.js').then(({ eventBus }) => {
      eventBus.emit('content:load:error', { url: this.currentUrl, error: 'iframe error' });
    }).catch(() => { /* intentionally empty */ });
  }





  /**
   * Setup SCORM APIs - single method called before iframe loads
   */
  setupScormAPIs() {
    try {
      // Set the SCORM client for the bridge
      scormAPIBridge.setScormClient(scormClient);

      // Create direct API methods that call the bridge synchronously
      const createDirectAPI = (version) => {
        const methods = version === '2004'
          ? ['Initialize', 'Terminate', 'GetValue', 'SetValue', 'Commit', 'GetLastError', 'GetErrorString', 'GetDiagnostic']
          : ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError', 'LMSGetErrorString', 'LMSGetDiagnostic'];

        const api = {};

        methods.forEach(method => {
          api[method] = (...args) => {
            try {
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

      // Create API objects
      const api12 = createDirectAPI('1.2');
      const api2004 = createDirectAPI('2004');

      // Persist on instance for synchronous injection
      this._api12 = api12;
      this._api2004 = api2004;

      // Inject into main window
      window.API = api12;
      window.API_1484_11 = api2004;

      // Also inject into the content viewer's window context for iframe access
      // This ensures SCOs loaded in iframes can find the API in their parent window
      if (this.element && this.element.ownerDocument && this.element.ownerDocument.defaultView) {
        const docWindow = this.element.ownerDocument.defaultView;
        try {
          docWindow.API = api12;
          docWindow.API_1484_11 = api2004;
        } catch (error) {
          // Ignore cross-origin errors
        }
      }

      // Helper to inject APIs into any target window synchronously
      this._syncInjectApiIntoWindow = (win) => {
        if (!win) return;
        try {
          win.API = this._api12;
          win.API_1484_11 = this._api2004;
          if (win.parent && win.parent !== win) {
            win.parent.API = this._api12;
            win.parent.API_1484_11 = this._api2004;
          }
          if (win.opener) {
            win.opener.API = this._api12;
            win.opener.API_1484_11 = this._api2004;
          }
        } catch (_) { /* ignore cross-origin */ }
      };

      // Set up a mechanism to inject API into iframe when it loads (fallback)
      this._injectApiIntoIframe = (iframe) => {
        if (!iframe || !iframe.contentWindow) return;
        this._syncInjectApiIntoWindow(iframe.contentWindow);
      };

    } catch (error) {
      try {
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.error('[ContentViewer] API setup error', error?.message || String(error));
        }).catch(() => { /* intentionally empty */ });
      } catch (error) {
        // Ignore logger import errors - logger is optional
      }
    }
  }

  /**
   * Teardown SCORM APIs to prevent stray calls from previous content during transitions
   * - Resets scormClient to clear session state (isInitialized, sessionId, caches, timers)
   * - Detaches bridge from scormClient
   * - Clears session ID from bridge
   * - Mutates existing API objects to inert stubs that return "false" without emitting errors
   *
   * CRITICAL TIMING: This must be called AFTER the old content has been unloaded
   * (after iframe.src = 'about:blank' and the 50ms delay) to allow the old content's
   * unload handlers to complete their SCORM API calls (typically Commit/Terminate).
   * Resetting the scormClient before unload would cause error 142 (Commit before initialization).
   */
  teardownScormAPIs() {
    try {
      // Reset scormClient to clear previous session state
      // This ensures isInitialized is false so new content can call Initialize()
      try { scormClient.reset(); } catch (_) { /* intentionally empty */ }

      // Clear session ID from bridge (new session will be created on next load)
      try { scormAPIBridge.setSessionId(null); } catch (_) { /* intentionally empty */ }

      // Detach bridge from client so any lingering calls do not reach scormClient
      try { scormAPIBridge.setScormClient(null); } catch (_) { /* intentionally empty */ }

      const makeStub = (methodName) => {
        return (...args) => {
          try {
            import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
              rendererLogger.info('[ContentViewer] Ignored SCORM call during teardown', { method: methodName, argsCount: args?.length || 0 });
            }).catch(() => { /* intentionally empty */ });
          } catch (_) { /* intentionally empty */ }
          // SCORM API returns string values; return "false" to indicate failure without surfacing an error
          return 'false';
        };
      };

      const stubify = (apiObj) => {
        if (!apiObj || typeof apiObj !== 'object') return;
        Object.keys(apiObj).forEach((k) => { apiObj[k] = makeStub(k); });
      };

      // Mutate existing API objects so even cached references in content become inert
      stubify(this._api12);
      stubify(this._api2004);

      // Replace globals on parent windows as well
      try { window.API = this._api12 || { Initialize: makeStub('Initialize') }; } catch (_) { /* intentionally empty */ }
      try { window.API_1484_11 = this._api2004 || { Initialize: makeStub('Initialize') }; } catch (_) { /* intentionally empty */ }

      if (this.element && this.element.ownerDocument && this.element.ownerDocument.defaultView) {
        const docWindow = this.element.ownerDocument.defaultView;
        try { docWindow.API = window.API; } catch (_) { /* intentionally empty */ }
        try { docWindow.API_1484_11 = window.API_1484_11; } catch (_) { /* intentionally empty */ }
      }

    } catch (_) {
      // Swallow teardown errors to avoid noisy logs during transitions
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
    const welcomeElement = this.find('.content-viewer__welcome');
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
   * Respect content author's design - no scaling modifications
   * SCORM content should display as intended by the content author
   */
  respectContentDesign() {
    // SCORM standard compliance: Do not modify content presentation
    // Content authors design their content for specific dimensions and layouts
    // The LMS should not alter the visual presentation

    try {
      // Only ensure the iframe is properly sized to contain the content
      // without modifying the content itself
      if (this.iframe) {
        // Let the content determine its own scrolling behavior
        this.iframe.style.overflow = 'auto';
      }
    } catch (error) {
      // Silent failure - respect for content design is best effort
    }
  }

  // Content scaling methods removed - respecting SCORM standard compliance
  // SCORM content should not be visually modified by the LMS

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

    // Add to error tracking system as non-catastrophic error
    if (this.uiState && typeof this.uiState.addNonCatastrophicError === 'function') {
      this.uiState.addNonCatastrophicError({
        message: message,
        stack: details || null,
        context: {
          source: 'content-viewer',
          details: details,
          timestamp: new Date().toISOString()
        },
        component: 'ContentViewer'
      });
    }

    // Also show notification for immediate feedback
    this.uiState.showNotification({
      message: message,
      type: 'error',
      details: details,
      duration: 5000
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

    // Add to error tracking system as non-catastrophic error
    if (this.uiState && typeof this.uiState.addNonCatastrophicError === 'function') {
      this.uiState.addNonCatastrophicError({
        message: `${title}: ${message}`,
        stack: options.details || null,
        context: {
          source: 'content-viewer',
          details: options.details,
          timestamp: new Date().toISOString()
        },
        component: 'ContentViewer'
      });
    }

    // Also show notification for immediate feedback
    this.uiState.showNotification({
      message: `${title}: ${message}`,
      type: 'error',
      details: options.details,
      duration: 5000,
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
    const launchUrl = data && data.launchUrl;
    if (!launchUrl) {
      this.showError('Course load error', 'No launch URL provided by main process');
      return;
    }
    if (!String(launchUrl).startsWith('scorm-app://')) {
      this.showError('Course load error', 'Launch URL must be a scorm-app:// URL resolved by main process');
      return;
    }
    this.loadContent(launchUrl);
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
    const errorCode = data?.code || 'unknown';
    const element = data?.element || null;
    const source = data?.source || 'scorm-api';

    // Build detailed error context with all available diagnostic information
    const errorContext = {
      source,
      errorCode,
      timestamp: new Date().toISOString()
    };

    // Add element if present
    if (element) {
      errorContext.element = element;
    }

    // Add session information if available
    if (this.uiState?.state?.session) {
      errorContext.sessionId = this.uiState.state.session.id;
      errorContext.sessionState = this.uiState.state.session.connected ? 'connected' : 'disconnected';
    }

    // Build user-friendly error message with diagnostic details
    let detailedMessage = `SCORM Error [${errorCode}]: ${message}`;

    // Add element context if present
    if (element) {
      detailedMessage += `\nData Model Element: ${element}`;
    }

    // Add diagnostic hint based on error code
    const diagnosticHint = this.getErrorDiagnosticHint(errorCode);
    if (diagnosticHint) {
      detailedMessage += `\n\nDiagnostic: ${diagnosticHint}`;
    }

    // Add to error tracking system as non-catastrophic error
    if (this.uiState && typeof this.uiState.addNonCatastrophicError === 'function') {
      this.uiState.addNonCatastrophicError({
        message: detailedMessage,
        stack: data?.stack || null,
        context: errorContext,
        component: 'ContentViewer'
      });
    }

    // Also show notification for immediate feedback
    this.uiState.showNotification({
      type: 'error',
      message: detailedMessage,
      duration: 5000
    });
  }

  /**
   * Get diagnostic hint for common SCORM error codes
   * @param {string} errorCode - SCORM error code
   * @returns {string|null} Diagnostic hint or null
   */
  getErrorDiagnosticHint(errorCode) {
    const hints = {
      '142': 'The content attempted to commit data before calling Initialize(). The SCORM session must be initialized first.',
      '132': 'The content attempted to set data before calling Initialize(). The SCORM session must be initialized first.',
      '122': 'The content attempted to retrieve data before calling Initialize(). The SCORM session must be initialized first.',
      '143': 'The content attempted to commit data after calling Terminate(). No further API calls are allowed after termination.',
      '133': 'The content attempted to set data after calling Terminate(). No further API calls are allowed after termination.',
      '123': 'The content attempted to retrieve data after calling Terminate(). No further API calls are allowed after termination.',
      '103': 'The content called Initialize() when the session was already initialized. Initialize() can only be called once.',
      '112': 'The content called Terminate() before calling Initialize(). The session must be initialized first.',
      '113': 'The content called Terminate() when the session was already terminated. Terminate() can only be called once.',
      '404': 'The requested data model element does not exist or is not supported by this LMS.',
      '407': 'The content attempted to write to a read-only data model element.',
      '408': 'The content attempted to read from a write-only data model element.',
      '409': 'The value provided does not match the expected data type for this element.',
      '410': 'The value provided is outside the allowed range for this element.'
    };

    return hints[errorCode] || null;
  }

  /**
   * Handle unified navigation request event (BUG-007 FIX)
   */
  async handleNavigationRequest(eventData) {
    try {
      this.logger?.info('ContentViewer: Handling navigation request', {
        requestType: eventData?.requestType,
        source: eventData?.source,
        activityId: eventData?.activityId
      });

      const { activityObject, requestType, url, scormData } = eventData || {};

      switch (requestType) {
        case 'activityLaunch':
          if (activityObject) {
            await this.loadActivity(activityObject);
          } else {
            this.logger?.warn('ContentViewer: Activity launch request missing activity object');
          }
          break;

        case 'directContent':
          if (url) {
            await this.loadContent(url, scormData || {});
          } else {
            this.logger?.warn('ContentViewer: Direct content request missing URL');
          }
          break;

        case 'choice':
          // Choice navigation should include activity object
          if (activityObject) {
            await this.loadActivity(activityObject);
          } else {
            this.logger?.warn('ContentViewer: Choice navigation request missing activity object');
          }
          break;

        default:
          this.logger?.debug('ContentViewer: Unhandled navigation request type', requestType);
          break;
      }

    } catch (error) {
      this.logger?.error('ContentViewer: Error handling navigation request', error);

      // Emit error back to event bus for centralized error handling
      try {
        const { eventBus } = await import('../../services/event-bus.js');
        // Unified namespaced event only
        eventBus.emit('navigation:error', {
          error: error.message || String(error),
          source: 'ContentViewer',
          originalRequest: eventData
        });
      } catch (_) {
        // Fallback error handling
        this.showError('Navigation Error', error.message || String(error));
      }
    }
  }

  /**
   * Handle content load request event (BUG-007 FIX)
   */
  async handleContentLoadRequest(eventData) {
    try {
      const { url, options } = eventData || {};
      if (url) {
        await this.loadContent(url, options || {});
      } else {
        this.logger?.warn('ContentViewer: Content load request missing URL');
      }
    } catch (error) {
      this.logger?.error('ContentViewer: Error handling content load request', error);
      this.showError('Content Load Error', error.message || String(error));
    }
  }

  /**
   * Handle browse mode changed event (BUG-007 FIX)
   */
  handleBrowseModeChanged(eventData) {
    try {
      const { enabled } = eventData || {};
      this.logger?.info('ContentViewer: Browse mode changed', { enabled });

      // Update content viewer behavior for browse mode
      if (this.element) {
        this.element.classList.toggle('content-viewer--browse-mode', enabled);
      }

      // In browse mode, we might want to show additional indicators
      if (enabled) {
        this.showBrowseModeIndicator();
      } else {
        this.hideBrowseModeIndicator();
      }

    } catch (error) {
      this.logger?.error('ContentViewer: Error handling browse mode change', error);
    }
  }

  /**
   * Show browse mode indicator
   * Note: Hidden to save space in the UI - browse mode is still active
   */
  showBrowseModeIndicator() {
    // Indicator hidden to save space - browse mode functionality still works
    // The browse mode button in the navigation bar provides sufficient visual indication
  }

  /**
   * Hide browse mode indicator
   */
  hideBrowseModeIndicator() {
    if (this.browseModeIndicator) {
      this.browseModeIndicator.style.display = 'none';
    }
  }

  /**
   * Handle navigation launch event (CRITICAL for browse mode navigation)
   */
  async handleNavigationLaunch(data) {
    try {
      this.logger?.info('ContentViewer: Handling navigation launch', {
        activityId: data?.activity?.identifier || data?.activity?.id,
        launchUrl: data?.activity?.launchUrl,
        href: data?.activity?.href,
        resourceHref: data?.activity?.resource?.href,
        parameters: data?.activity?.parameters,
        source: data?.source
      });

      // Get launch URL from multiple possible locations
      let launchUrl = data?.activity?.launchUrl ||
                      data?.activity?.href ||
                      data?.activity?.resource?.href;

      if (launchUrl) {
        // If parameters are present, append them to the launchUrl directly
        if (data?.activity?.parameters && launchUrl) {
          launchUrl = this.combineResourceUrlWithParameters(
            launchUrl,
            data.activity.parameters
          );
          this.logger?.info('ContentViewer: Combined resource URL with parameters', {
            baseUrl: launchUrl,
            parameters: data.activity.parameters,
            combined: launchUrl
          });
        }

        // Enforce final URL format from main (no client-side resolution)
        if (!launchUrl.startsWith('scorm-app://')) {
          this.logger?.error('ContentViewer: Launch URL is not a scorm-app:// URL. Navigation aborted.', { url: launchUrl });
          this.showError('Navigation Error', 'Invalid launch URL format');
          return;
        }

        // Load the activity content
        this.loadContent(launchUrl, {
          activity: data.activity,
          sequencing: data.sequencing,
          source: data.source
        });
      } else {
        this.logger?.warn('ContentViewer: No launch URL available for navigation', data);
        this.showError('Navigation Error', 'Unable to load the requested activity content');
      }
    } catch (error) {
      this.logger?.error('ContentViewer: Error handling navigation launch', error);
      this.showError('Navigation Error', 'Failed to load activity content');
    }
  }

  /**
   * Combine resource URL with item parameters
   * @param {string} resourceHref - The resource href from manifest
   * @param {string} parameters - The item parameters from manifest
   * @returns {string} Combined URL
   */
  combineResourceUrlWithParameters(resourceHref, parameters) {
    try {
      if (!resourceHref) return resourceHref;
      if (!parameters) return resourceHref;

      // Remove leading '?' from parameters if present
      const cleanParams = parameters.startsWith('?') ? parameters.substring(1) : parameters;

      // Check if resource href already has query parameters
      const [baseUrl, existingQuery] = resourceHref.split('?');

      if (existingQuery) {
        // Both have parameters, combine them
        return `${baseUrl}?${existingQuery}&${cleanParams}`;
      } else {
        // Only item parameters, append them
        return `${baseUrl}?${cleanParams}`;
      }
    } catch (error) {
      this.logger?.warn('ContentViewer: Error combining URL with parameters', {
        resourceHref,
        parameters,
        error: error.message
      });
      // Return original resource href as fallback
      return resourceHref;
    }
  }

  /**
   * Get the extraction path for the current course
   * @returns {string|null} Extraction path or null if not available
   */
  getExtractionPath() {
    try {
      // Try to get extraction path from various sources
      // This should match the path used during initial course loading

      // Check if we have it stored from course loading
      if (this._extractionPath) {
        return this._extractionPath;
      }

      // Try to derive from current URL if it's a scorm-app:// URL
      if (this.currentUrl && this.currentUrl.startsWith('scorm-app://')) {
        // Extract the base path from the current URL
        // scorm-app://index.html/shared/launchpage.html?content=playing
        // We need to get the extraction directory path
        const urlParts = this.currentUrl.split('/');
        if (urlParts.length >= 3) {
          // Remove the protocol and index.html parts
          const pathParts = urlParts.slice(3);
          // This is a simplified approach - in practice, we might need more sophisticated path resolution
          return pathParts.join('/').split('?')[0]; // Remove query params
        }
      }

      // Fallback: try to get from UI state or other sources
      if (this.uiState && typeof this.uiState.getCurrentCourse === 'function') {
        const course = this.uiState.getCurrentCourse();
        if (course && course.extractionPath) {
          return course.extractionPath;
        }
      }

      return null;
    } catch (error) {
      this.logger?.warn('ContentViewer: Error getting extraction path', error);
      return null;
    }
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
    // No scaling cleanup needed - we respect content as-is

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
          // Only adjust container sizing, respect content design
          this.respectContentDesign();
        });
        this.resizeObserver.observe(this.element);
      } else {
        // Fallback: listen to window resize
        this._resizeHandler = () => this.respectContentDesign();
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
   * Trigger SCORM content's own resize logic instead of overriding it
   */
  fixNestedIframeSizing() {
    try {
      if (!this.contentWindow || !this.contentWindow.document) {
        return;
      }

      const contentWindow = this.contentWindow;

      // Try to trigger the course's own resize logic if it exists
      if (typeof contentWindow.setIframeHeight === 'function') {
        // Call the course's own resize function with proper parameters
        contentWindow.setIframeHeight('contentFrame', 40);
      } else if (typeof contentWindow.SetupIFrame === 'function') {
        // Some courses might have SetupIFrame function
        contentWindow.SetupIFrame();
      }

      // Also dispatch a resize event to trigger any window.onresize handlers
      if (contentWindow.dispatchEvent) {
        contentWindow.dispatchEvent(new Event('resize'));
      }

    } catch (error) {
      // Silent fail - resize trigger is best effort
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
    // Ensure SCORM APIs are detached so no further calls are routed during teardown
    try { this.teardownScormAPIs(); } catch (_) { /* intentionally empty */ }


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
        try { this.iframe.removeEventListener('load', this._boundHandlers.onIframeLoad); } catch (_) { /* ignore */ }
        try { this.iframe.removeEventListener('error', this._boundHandlers.onIframeError); } catch (_) { /* ignore */ }
      }

      // Fullscreen button
      if (this.fullscreenBtn) {
        try { this.fullscreenBtn.removeEventListener('click', this._boundHandlers.onFullscreenBtnClick); } catch (_) { /* ignore */ }
      }

      // Retry button (may or may not exist at destroy time)
      try {
        const retryBtn = this.find('.error-retry-btn');
        if (retryBtn) retryBtn.removeEventListener('click', this._boundHandlers.onRetryClick);
      } catch (_) { /* ignore */ }

      this._boundHandlers = null;
    }

    // Remove host message handler if installed (diagnostic forwarder)
    try {
      if (this._hostMessageHandler) {
        try { window.removeEventListener('message', this._hostMessageHandler); } catch (_) { /* ignore */ }
        this._hostMessageHandler = null;
      }
    } catch (_) { /* ignore */ }

    // Clean up browse mode indicator
    if (this.browseModeIndicator) {
      try {
        this.browseModeIndicator.remove();
        this.browseModeIndicator = null;
      } catch (_) { /* ignore */ }
    }

    this.clearContent();
    super.destroy();
  }

  /**
   * BUG-021 FIX: Simplified URL processing with better error messages
   * @param {string} url - The URL to normalize
   * @returns {string} - The normalized URL
   */
  static normalizeURL(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL: URL must be a non-empty string');
    }

    // Strict enforcement: Only allow scorm-app:// URLs resolved by main process
    if (!url.startsWith('scorm-app://')) {
      throw new Error('Invalid URL scheme: renderer only accepts scorm-app:// URLs');
    }

    return url;
  }
}

export { ContentViewer };


