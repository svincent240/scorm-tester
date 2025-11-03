// @ts-check

/**
 * Application Manager
 *
 * Main application orchestrator that manages services, components, and lifecycle.
 * Provides clean separation of concerns and centralized application management.
 *
 * @fileoverview Main application management service
 */
import { ipcClient } from './ipc-client.js';
import { rendererLogger } from '../utils/renderer-logger.js';



/**
 * Application Manager Class
 *
 * Orchestrates the entire application lifecycle and component interactions.
 */
class AppManager {
  constructor() {
    this.services = new Map();
    this.components = new Map();
    this.initialized = false;

    // Prevent recursive initialization error handling loops
    this._handlingInitError = false;

    // Track startup errors for diagnostic purposes
    this.startupErrors = [];

    // BUG-003 FIX: Navigation state machine
    this.navigationState = 'IDLE'; // IDLE, PROCESSING, LOADING
    this.navigationQueue = [];
    this.currentNavigationRequest = null;

    // BUG-005 FIX: Centralized browse mode state
    this.browseMode = {
      enabled: false,
      session: null,
      config: {}
    };

    // BUG-004 FIX: SCORM lifecycle tracking integration
    this.currentActivity = null;
    this.previousActivity = null;

    // Lazy, safe logger reference with no-op fallback
    this.logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    // Initialize logger asynchronously but safely
    try {
      import('../utils/renderer-logger.js')
        .then(({ rendererLogger }) => {
          if (rendererLogger) {
            this.logger = rendererLogger;
          }
        })
        .catch(() => {
          // keep no-op fallback
        });
    } catch (_) {
      // If any unexpected error occurs while resolving rendererBaseUrl, keep no-op logger
    }

    // Guard: event handler registration should be idempotent
    this._eventHandlersSetup = false;

    this.setupErrorHandlers();
  }

  /**
   * Initialize the application
   */
  async initialize() {
    // Prevent duplicate initialization and re-entrancy which can lead to double event handlers and dialogs
    if (this.initialized || this.initializing) {
      try { this.logger.warn('AppManager.initialize called while already initialized/initializing; skipping'); } catch (_) {}
      return;
    }
    this.initializing = true;
    try {
      // Dynamically import eventBus first as it's a core dependency
      const { eventBus } = await import('./event-bus.js');
      this.services.set('eventBus', eventBus); // Set it early
      this.eventBus = eventBus; // Also expose as direct property for easier access

      // Dynamically import uiStatePromise
      const { uiState: uiStatePromise } = await import('./ui-state.js');
      // Ensure logger is available (no-op fallback already set in constructor)
      this.uiState = await uiStatePromise; // Resolve the promise
      this.logger.debug('AppManager - uiState resolved');
      const { scormClient } = await import('./scorm-client.js'); // Dynamically import scormClient
      scormClient.setUiState(this.uiState); // Pass resolved uiState to scormClient

      // Step 1: Initialize services
      await this.initializeServices();

      // Step 2: Initialize components
      await this.initializeComponents();

      // Step 3: Setup event listeners
      this.setupEventHandlers();

      // Step 4: Setup UI event listeners
      this.setupUIEventListeners();

      // Initialize UI settings from main AppState (theme, sidebar, etc.)
      try { await this.initializeUiFromMain(); } catch (_) {}


      // Step 5: Setup centralized SN status polling
      this.setupSnPollingController();

      // BUG-005 FIX: Setup centralized browse mode management
      this.setupBrowseModeManagement(eventBus);

      this.initialized = true;
      this.initializing = false;

      // Clear any persistent loading states from previous sessions
      this.hideLoading();
      try { this.logger.debug('AppManager - setLoading(false)'); } catch (_) {}
      this.uiState.setLoading(false); // Use the resolved instance

      // Start syncing centralized UI settings to main AppState
      try { this.setupUiSettingsSync(); } catch (_) {}

      // Configure EventBus debug mode based on UIState (Step 8)
      try {
        const devEnabled = !!this.uiState.getState('ui.devModeEnabled');
        eventBus.setDebugMode(devEnabled);
      } catch (_) {}

      // Keep EventBus debug mode in sync with UIState changes
      try {
        // Prefer explicit API if available; otherwise watch for UI updates and detect devModeEnabled changes
        if (typeof this.uiState.subscribe === 'function') {
          let lastDev = !!this.uiState.getState('ui.devModeEnabled');
          this.uiState.subscribe((newState) => {
            const current = !!(newState && newState.ui && newState.ui.devModeEnabled);
            if (current !== lastDev) {
              lastDev = current;
              try { this.logger.info(`AppManager: UI devModeEnabled changed -> ${current}`); } catch (_) {}
              eventBus.setDebugMode(current);
            }
          });
        }
      } catch (_) {}

      // Render recent courses on initial welcome screen if container exists
      try { await this.renderRecentCourses(); } catch (e) { try { this.logger.error('AppManager: renderRecentCourses failed', e?.message || e); } catch (_) {} }

      // Display any startup errors that were captured
      this.displayStartupErrors();

      // Emit initialization complete event
      eventBus.emit('app:initialized');

    } catch (error) {
      try {
        this.logger.error('AppManager: Failed to initialize application', (error && (error.message || error)));
        if (error && error.stack) this.logger.error('AppManager: Error details stack', error.stack);
      } catch (_) {}
      this.handleInitializationError(error);
      throw error;
    }
  }

  /**
   * Initialize all services
   */
  async initializeServices() {
    // console.log('AppManager: Initializing services...'); // Removed debug log

    // Dynamically import services (eventBus already imported at top of initialize)
    const { scormClient } = await import('./scorm-client.js');
    const { scormAPIBridge } = await import('./scorm-api-bridge.js');
    const { courseLoader } = await import('./course-loader.js');

    // Register services
    // eventBus is already set in initialize()
    this.services.set('uiState', this.uiState); // Use the resolved instance
    this.services.set('scormClient', scormClient);
    this.services.set('scormAPIBridge', scormAPIBridge);
    this.services.set('courseLoader', courseLoader);

    // Initialize SCORM client if needed
    if (!scormClient.getInitialized()) {
      // Note: ScormClient doesn't have an initialize() method - it initializes via Initialize()
      // We'll skip this for now as SCORM initialization happens when content is loaded
      // console.log('AppManager: SCORM client not initialized, will initialize when content loads'); // Removed debug log
    }

    // console.log('AppManager: Services initialized'); // Removed debug log
  }

  /**
   * Ensure minimal DOM skeleton exists after index.html cleanup
   * Builds the structured application layout (header/main/sidebar/content/footer)
   * with component mount points so components can render themselves.
   */
  ensureDomSkeleton() {
    try {
      const root = document.getElementById('app-root');
      if (!root) return;

      // If we've already built the layout once, do nothing
      if (root.querySelector('.app-layout')) return;

      // Build structured layout using existing CSS classes
      root.innerHTML = `
        <div class="app-layout initialized">
          <header class="app-header">
            <div class="header">
              <div class="header__nav">
                <div id="navigation-controls"></div>
              </div>
              <div class="header__actions">
                <div id="error-badge"></div>
                <div id="header-controls"></div>
              </div>
            </div>
          </header>
          <main class="app-main">
            <aside id="app-sidebar" class="app-sidebar">
              <div class="sidebar">
                <div class="sidebar__content">
                  <div id="course-outline"></div>
                </div>
              </div>
            </aside>
            <section class="app-content">
              <div id="recent-courses"></div>
              <div id="content-viewer"></div>
              <div id="inspector-panel"></div>
            </section>
          </main>
          <footer class="app-footer" id="app-footer">
            <div id="footer-progress"></div>
            <div id="footer-status"></div>
          </footer>
          <!-- Notification components (overlays) -->
          <div id="notification-container"></div>
          <div id="error-dialog"></div>
          <div id="error-list-panel"></div>
          <div id="course-exit-summary"></div>
        </div>
      `;
    } catch (_) {
      // best-effort, non-fatal
    }
  }


  /**
   * Initialize all components
   */
  async initializeComponents() {
    try { this.logger.info('AppManager: Initializing components...'); } catch (_) {}
    // Ensure DOM skeleton exists for component mount points
    this.ensureDomSkeleton();

    // Dynamically import required component classes (avoid destructuring for parser compatibility)
    const _modBase = await import('../components/base-component.js');
    const BaseComponent = _modBase.BaseComponent;
    const _modCV = await import('../components/scorm/content-viewer.js');
    const ContentViewer = _modCV.ContentViewer;
    const _modNav = await import('../components/scorm/navigation-controls.js');
    const NavigationControls = _modNav.NavigationControls;
    const _modOutline = await import('../components/scorm/course-outline.js');
    const CourseOutline = _modOutline.CourseOutline;
    const _modFooterPB = await import('../components/scorm/footer-progress-bar.js');
    const FooterProgressBar = _modFooterPB.FooterProgressBar;
    const _modFooterSD = await import('../components/scorm/footer-status-display.js');
    const FooterStatusDisplay = _modFooterSD.FooterStatusDisplay;
    const _modInspector = await import('../components/inspector/inspector-panel.js');
    const InspectorPanel = _modInspector.InspectorPanel;
    const _modHeader = await import('../components/header-controls.js');
    const HeaderControls = _modHeader.HeaderControls;

    // Notification components
    const _modNotifContainer = await import('../components/notifications/notification-container.js');
    const NotificationContainer = _modNotifContainer.NotificationContainer;
    const _modErrorDialog = await import('../components/notifications/error-dialog.js');
    const ErrorDialog = _modErrorDialog.ErrorDialog;
    const _modErrorBadge = await import('../components/notifications/error-badge.js');
    const ErrorBadge = _modErrorBadge.ErrorBadge;
    const _modErrorListPanel = await import('../components/notifications/error-list-panel.js');
    const ErrorListPanel = _modErrorListPanel.ErrorListPanel;
    const _modCourseExitSummary = await import('../components/scorm/course-exit-summary.js');
    const CourseExitSummary = _modCourseExitSummary.CourseExitSummary;

    // Optional components (lazy/conditional import)
    let ProgressTracking = null;
    try {
      if (document.getElementById('progress-tracking')) {
        const _modPT = await import('../components/scorm/progress-tracking.js');
        ProgressTracking = _modPT.ProgressTracking;
      } else {
        if (this && this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug('AppManager: progress-tracking mount point not found; skipping component import');
        }
      }
    } catch (e) {
      if (this && this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn('AppManager: Optional component import failed (progress-tracking). Continuing without it.', (e && (e.message || e)));
      }
    }
    const componentConfigs = [
      { name: 'headerControls', class: HeaderControls, elementId: 'header-controls', required: true },
      { name: 'contentViewer', class: ContentViewer, elementId: 'content-viewer', required: true },
      { name: 'navigationControls', class: NavigationControls, elementId: 'navigation-controls', required: true },
      { name: 'footerProgressBar', class: FooterProgressBar, elementId: 'footer-progress', required: true },
      { name: 'footerStatusDisplay', class: FooterStatusDisplay, elementId: 'footer-status', required: true },
      { name: 'courseOutline', class: CourseOutline, elementId: 'course-outline', required: true },
      { name: 'inspectorPanel', class: InspectorPanel, elementId: 'inspector-panel', required: false },
      // Notification components
      { name: 'notificationContainer', class: NotificationContainer, elementId: 'notification-container', required: true },
      { name: 'errorDialog', class: ErrorDialog, elementId: 'error-dialog', required: true },
      { name: 'errorBadge', class: ErrorBadge, elementId: 'error-badge', required: true },
      { name: 'errorListPanel', class: ErrorListPanel, elementId: 'error-list-panel', required: true },
      { name: 'courseExitSummary', class: CourseExitSummary, elementId: 'course-exit-summary', required: true },
    ];

    // Add optional component configs conditionally
    if (ProgressTracking) {
      componentConfigs.push({ name: 'progressTracking', class: ProgressTracking, elementId: 'progress-tracking', required: false });
    }

    // DIAGNOSTIC: verify DOM mount points exist before instantiation
    try {
      ['content-viewer','navigation-controls','footer-progress','footer-status','course-outline'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) {
          this.logger.error(`AppManager: Missing DOM element '${id}' prior to component init`);
        } else {
          this.logger.debug(`AppManager: Found DOM element '${id}' for component mounting`);
        }
      });
    } catch (_) {}

    try {
      for (const config of componentConfigs) {
        const element = document.getElementById(config.elementId);
        if (element) {
          this.logger.debug(`AppManager: Creating component '${config.name}' with elementId='${config.elementId}'`);
          const componentInstance = new config.class(config.elementId);
          try {
            await componentInstance.initialize();
            this.logger.debug(`AppManager: Component '${config.name}' initialize() resolved`, componentInstance?.getStatus?.() || null);
          } catch (err) {
            this.logger.error(`AppManager: Component '${config.name}' initialize() failed`, err?.message || err);
            throw err;
          }
          this.components.set(config.name, componentInstance);
          this.logger.info(`AppManager: ${config.name} initialized`);
        } else {
          if (config.required) {
            throw new Error(`Required UI element '${config.elementId}' for component '${config.name}' not found in DOM.`);
          } else {
            this.logger.debug(`AppManager: Optional UI element '${config.elementId}' for component '${config.name}' not found in DOM. Skipping initialization.`);
          }
        }
      }

      // Wire NavigationControls to ContentViewer reference
     const navigationControls = this.components.get('navigationControls');
     const contentViewer = this.components.get('contentViewer');
     if (navigationControls && typeof navigationControls.setContentViewer === 'function') {
       navigationControls.setContentViewer(contentViewer || null);
       try { this.logger.debug('AppManager: navigationControls wired to contentViewer'); } catch (_) {}
     }

     // DIAGNOSTIC: After init, log status snapshots for key components
     try {
       const co = this.components.get('courseOutline');
       const nc = this.components.get('navigationControls');
       const cv = this.components.get('contentViewer');
       this.logger.info('AppManager: Post-init component status snapshot', {
         courseOutline: co?.getStatus?.() || null,
         navigationControls: nc?.getStatus?.() || null,
         contentViewer: cv?.getStatus?.() || null
       });
     } catch (_) {}

     try { this.logger.info('AppManager: All components initialized'); } catch (_) {}
    } catch (error) {
      try { this.logger.error('AppManager: Error initializing components', error?.message || error); } catch (_) {}
      throw error;
    }
  }

  /**
   * Setup application event handlers
   */
  setupEventHandlers() {
   // console.log('AppManager: Setting up event handlers...'); // Removed debug log

   // Idempotency guard to prevent duplicate registrations
   if (this._eventHandlersSetup) {
     try { this.logger.warn('AppManager: setupEventHandlers called again; skipping duplicate registration'); } catch (_) {}
     return;
   }

   try { this.logger.debug('AppManager: Registering core event handlers'); } catch (_) {}

   // Course loading events
   const eventBus = this.services.get('eventBus');
   if (!eventBus) {
     this.logger.error('AppManager: eventBus not found in services. Cannot set up event handlers.');
     return;
   }

   // Mark as set up exactly once
   this._eventHandlersSetup = true;

  // Bridge unified menu events to the same intent path as header buttons
  try {
    ipcClient.onMenuEvent((payload) => {
      const action = (payload && payload.action) || payload;
      if (action === 'menu-load-package') {
        eventBus.emit('course:open-zip:request');
      } else if (action === 'menu-toggle-theme') {
        eventBus.emit('ui:theme:toggle-request');
      } else if (action === 'menu-toggle-error-log') {
        eventBus.emit('error-list:toggle');
      }
    });
  } catch (_) {}


    eventBus.on('course:loadError', (errorData) => {
      try { this.logger.error('AppManager: Course load error', (errorData && (errorData.error || errorData.message)) || errorData || 'unknown'); } catch (_) {}

      // Course load failures are catastrophic - they prevent core functionality
      const errorMessage = (errorData && (errorData.error || errorData.message)) || 'Unknown error';
      const error = new Error(errorMessage);
      error.context = {
        source: 'course-loader',
        errorData: errorData
      };

      if (this.uiState) {
        this.uiState.addCatastrophicError(error);
      } else {
        // Fallback to old notification system if UIState not available
        this.showError('Course Loading Error', errorMessage);
      }
    });

    eventBus.on('course:loaded', (courseData) => {
      try { this.logger.info('AppManager: Course loaded event received'); } catch (_) {}
      this.handleCourseLoaded(courseData);
    });

    eventBus.on('course:cleared', () => {
      try { this.logger.info('AppManager: Course cleared event received'); } catch (_) {}
      this.handleCourseCleared();
    });

    eventBus.on('course:exited', (exitData) => {
      try { this.logger.info('AppManager: Course exited event received'); } catch (_) {}
      this.handleCourseExit(exitData);
    });

    eventBus.on('course:test-resume', (data) => {
      try { this.logger.info('AppManager: Test resume event received'); } catch (_) {}
      try { rendererLogger.info('AppManager: [DIAG] course:test-resume received', { sessionId: data?.sessionId }); } catch (_) {}
      this.handleTestResume(data);
    });

    eventBus.on('course:exit-summary-closed', (data) => {
      try { this.logger.info('AppManager: Exit summary closed event received'); } catch (_) {}
      this.handleExitSummaryClosed(data);
    });

    eventBus.on('course:loadStart', () => {
      // Clear all errors when starting to load a new course
      if (this.uiState && typeof this.uiState.clearAllErrors === 'function') {
        this.uiState.clearAllErrors();
        try { this.logger.info('AppManager: Cleared all errors for course load start'); } catch (_) {}
      }
    });

    eventBus.on('course:loadingStateChanged', (stateData) => {
      if (stateData.loading) {
        this.showLoading('Loading course...');
      } else {
        this.hideLoading();
      }
    });

    // SCORM events
    eventBus.on('ui:scorm:dataChanged', (data) => {
      // console.log('AppManager: SCORM data changed:', data); // Removed debug log
    });

    eventBus.on('ui:scorm:error', (errorData) => {
      try {
        const safeMsg = (errorData && (errorData.message || errorData.error)) || 'Unknown SCORM error';
        this.logger.error('AppManager: SCORM error', safeMsg);
        this.logger.error('AppManager: SCORM error details', {
          code: errorData && errorData.code,
          source: errorData && errorData.source,
          timestamp: new Date().toISOString()
        });

        // SCORM API errors are non-catastrophic - they don't block core app functionality
        const error = new Error(safeMsg);
        error.context = {
          code: errorData && errorData.code,
          source: errorData && errorData.source,
          timestamp: new Date().toISOString()
        };
        error.component = 'scorm-api';

        if (this.uiState) {
          this.uiState.addNonCatastrophicError(error);
        }
      } catch (_) {}
    });

    // Renderer console errors from main process (captured via window.webContents.on('console-message'))
    eventBus.on('renderer:console-error', (errorData) => {
      try {
        if (!errorData) return;

        const message = errorData.message || 'Console error';
        const source = errorData.source || 'unknown';
        const line = errorData.line || 0;
        const level = errorData.level || 'error';

        // Filter out SCORM API stub errors during course reload/load transitions
        // These occur when old course content tries to call SCORM APIs after teardown
        // The stubbed APIs return "false" which the course logs as errors
        if (message.includes('[SCORM Commit] Error false:') ||
            message.includes('[SCORM Terminate] Error false:') ||
            message.includes('[SCORM Initialize] Error false:') ||
            message.includes('[SCORM SetValue] Error false:') ||
            message.includes('[SCORM GetValue] Error false:') ||
            message.includes('Error false: false. false')) {
          // Log but don't add to error tracking - these are expected during transitions
          this.logger.debug('AppManager: Suppressed SCORM stub error during transition', message);
          return;
        }

        // Format source location for display
        const sourceLocation = line > 0 ? `${source}:${line}` : source;

        this.logger.error('AppManager: Renderer console error', message, { source: sourceLocation });

        // Add to error tracking UI (non-catastrophic)
        const error = new Error(message);
        error.context = {
          source: sourceLocation,
          level: level,
          timestamp: errorData.timestamp ? new Date(errorData.timestamp).toISOString() : new Date().toISOString(),
          errorCode: errorData.errorCode || null
        };
        error.component = 'renderer-console';

        if (this.uiState) {
          this.uiState.addNonCatastrophicError(error);
        }
      } catch (_) {}
    });



    // BUG-003 FIX: Unified navigation pipeline with state machine
    this.setupUnifiedNavigationPipeline(eventBus);

    // BUG-020 FIX: Removed legacy navigationRequest support - all events now use standardized navigation:request

    // Optional: reflect navigation launch to components that rely on centralized signal
    eventBus.on('navigation:launch', (data) => {
      try {
        this.logger.info('AppManager: navigation:launch propagated', { activityId: data?.activity?.id || data?.activity?.identifier || null, source: data?.source });
      } catch (_) {}
    });

    // Unified sidebar events (namespaced only)
    eventBus.on('ui:sidebar:toggle-request', this.handleMenuToggle.bind(this));
    eventBus.on('ui:menu:visibility-changed', this.handleMenuVisibilityChanged.bind(this));

    // Unified header intent events (namespaced only)
    eventBus.on('ui:inspector:toggle-request', () => this.openScormInspector());
    eventBus.on('ui:theme:toggle-request', () => this.toggleTheme());

    // HeaderControls -> intent events (rewrite): course load/reload
    eventBus.on('course:open-zip:request', () => {
      const courseLoader = this.services.get('courseLoader');
      if (!courseLoader) {
        try { this.logger.error('AppManager: courseLoader service not available for open-zip'); } catch (_) {}
        return;
      }
      courseLoader.handleCourseLoad().catch(error => {
        try { this.logger.error('AppManager: Course load error (open-zip)', error?.message || error); } catch (_) {}
      });
    });

    eventBus.on('course:open-folder:request', () => {
      const courseLoader = this.services.get('courseLoader');
      if (!courseLoader) {
        try { this.logger.error('AppManager: courseLoader service not available for open-folder'); } catch (_) {}
        return;
      }
      courseLoader.handleFolderLoad().catch(error => {
        try { this.logger.error('AppManager: Folder load error (open-folder)', error?.message || error); } catch (_) {}
      });
    });

    eventBus.on('course:reload:request', () => {
      this.handleCourseReload().catch(error => {
        try { this.logger.error('AppManager: Course reload error (header intent)', error?.message || error); } catch (_) {}
      });
    });

    // console.log('AppManager: Event handlers setup complete'); // Removed debug log
  }

  /**
   * Centralized SN status polling controller
   * - Single owner
   * - Min interval enforcement
   * - Lifecycle gating (init, navigation, content load)
   * - Backoff on errors/rate limit
   * - App log only (no console)
   */
  setupSnPollingController() {
    // Configuration
    this._SN_MIN_INTERVAL_MS = 800; // >= 750ms to respect IPC rate limits
    this._SN_MAX_INTERVAL_MS = 5000;
    this._SN_BACKOFF_BASE_MS = 1200;
    this._SN_BACKOFF_FACTOR = 1.75;
    this._SN_BACKOFF_MAX_MS = 8000;

    // State
    this._snPollTimer = null;
    this._snPollingActive = false;
    this._snBackoffMs = 0;
    this._snLastTickAt = 0;
    this._snNavInFlight = false;
    this._snContentLoading = false;
    this._snInitialized = false;
    this._snLastNavigationAt = 0;

    // Helper guards
    const canPoll = () => {
      if (!this._snInitialized) return false;
      if (this._snNavInFlight) return false;
      if (this._snContentLoading) return false;
      return true;
    };

    const scheduleNext = (delayMs) => {
      const ms = Math.max(this._SN_MIN_INTERVAL_MS, delayMs || 0);
      clearTimeout(this._snPollTimer);
      this._snPollTimer = setTimeout(tick, ms);
    };

    const applyBackoff = () => {
      if (this._snBackoffMs <= 0) {
        this._snBackoffMs = this._SN_BACKOFF_BASE_MS;
      } else {
        this._snBackoffMs = Math.min(
          Math.floor(this._snBackoffMs * this._SN_BACKOFF_FACTOR),
          this._SN_BACKOFF_MAX_MS
        );
      }
      try { this.logger.info('AppManager: SN polling backoff applied', { backoffMs: this._snBackoffMs }); } catch (_) {}
    };

    const resetBackoff = () => {
      if (this._snBackoffMs !== 0) {
        this._snBackoffMs = 0;
        try { this.logger.info('AppManager: SN polling backoff reset'); } catch (_) {}
      }
    };

    const tick = async () => {
      // If deactivated, skip
      if (!this._snPollingActive) return;

      // Enforce min spacing
      const now = Date.now();
      if (now - this._snLastTickAt < this._SN_MIN_INTERVAL_MS) {
        scheduleNext(this._SN_MIN_INTERVAL_MS - (now - this._snLastTickAt));
        return;
      }

      // Lifecycle gates
      if (!canPoll()) {
        // If cannot poll, reschedule with min interval (or backoff if present)
        const next = this._snBackoffMs > 0 ? this._snBackoffMs : this._SN_MIN_INTERVAL_MS;
        scheduleNext(next);
        return;
      }


      this._snLastTickAt = now;
      try { this.logger.debug('AppManager: SN polling tick'); } catch (_) {}

      // Use scormAPIBridge if available, else scormClient as fallback
      let status = null;
      try {
        // Resolve from the service registry to avoid referencing out-of-scope globals
        const scormAPIBridge = this.services.get('scormAPIBridge');
        const scormClient = this.services.get('scormClient');

        if (scormAPIBridge && typeof scormAPIBridge.getStatus === 'function') {
          status = await scormAPIBridge.getStatus();
        } else if (scormClient && typeof scormClient.getStatus === 'function') {
          status = await scormClient.getStatus();
        } else {
          // No API available; pause polling
          applyBackoff();
          scheduleNext(this._snBackoffMs);
          return;
        }
      } catch (err) {
        // Handle rate limit or generic errors with backoff
        const msg = err && (err.message || String(err));
        const isRateLimit = /rate limit/i.test(msg || '') || /614/.test(msg || '');
        try { this.logger.error('AppManager: SN polling error', { message: msg, isRateLimit }); } catch (_) {}
        applyBackoff();
        scheduleNext(this._snBackoffMs);
        return;
      }

      // Successful status retrieval
      resetBackoff();

      // Reflect available navigation into UIState if present
      try {
        const available = status && (status.availableNavigation || status.available || []);
        const normalized = this.normalizeAvailableNavigation(available);
        const presentation = status?.presentation || null;
        const hiddenControls = status?.hiddenControls || [];
        this.uiState.updateNavigation({
          ...normalized,
          presentation,
          hiddenControls,
          _fromComponent: true
        });
      } catch (e) {
        try { this.logger.warn('AppManager: Failed to apply SN status to UIState', e?.message || e); } catch (_) {}
      }

      // Schedule next
      scheduleNext(this._SN_MIN_INTERVAL_MS);
    };

    // Public controls
    this.startSnPolling = () => {
      if (this._snPollingActive) return;
      this._snPollingActive = true;
      try { this.logger.info('AppManager: SN polling started'); } catch (_) {}
      // First run after a small delay to allow init to settle
      scheduleNext(200);
    };

    this.stopSnPolling = () => {
      this._snPollingActive = false;
      clearTimeout(this._snPollTimer);
      this._snPollTimer = null;
      try { this.logger.info('AppManager: SN polling stopped'); } catch (_) {}
    };

    this.pauseSnPolling = (reason = 'unknown') => {
      this._snPollingActive = false;
      try { this.logger.info('AppManager: SN polling paused', { reason }); } catch (_) {}
    };

    this.resumeSnPolling = () => {
      if (this._snPollingActive) return;
      this._snPollingActive = true;
      try { this.logger.info('AppManager: SN polling resumed'); } catch (_) {}
      scheduleNext(this._snBackoffMs > 0 ? this._snBackoffMs : this._SN_MIN_INTERVAL_MS);
    };

    // Lifecycle hooks
    // 1) Detect SN initialized
    const eventBus = this.services.get('eventBus');
    if (!eventBus) {
      this.logger.error('AppManager: eventBus not found in services. Cannot set up SN polling controller.');
      return;
    }
    eventBus.on('sn:initialized', () => {
      this._snInitialized = true;
      this.startSnPolling();
    });

    // Some implementations may not emit sn:initialized. Fallback: after course:loaded and SCORM Initialize
    eventBus.on('course:loaded', () => {
      // Do not start yet, wait for Initialize event from ContentViewer (via scormAPIBridge) if available
      // But if absent, attempt delayed start
      setTimeout(() => {
        if (!this._snInitialized) {
          this._snInitialized = true; // optimistic start
          this.startSnPolling();
        }
      }, 1500);
    });

    // 2) Navigation in-flight gating
    eventBus.on('navigation:request', () => {
      this._snNavInFlight = true;
      this._snLastNavigationAt = Date.now(); // Set timestamp for cooldown
      this.pauseSnPolling('navigation');
    });
    eventBus.on('navigation:launch', () => {
      // content will load; keep paused until contentViewer signals ready
      this._snNavInFlight = false;
      this._snContentLoading = true;
    });

    // 3) ContentViewer load lifecycle
    eventBus.on('content:load:start', () => {
      this._snContentLoading = true;
      this.pauseSnPolling('content-load');
    });
    eventBus.on('content:load:ready', () => {
      this._snContentLoading = false;
      this.resumeSnPolling();
    });
    eventBus.on('content:load:error', () => {
      this._snContentLoading = false;
      // keep polling paused briefly to avoid thrash
      applyBackoff();
      scheduleNext(this._snBackoffMs);
    });

    // 4) Commit/Terminate gating (UI-scoped events from scormClient)
    eventBus.on('ui:scorm:committed', () => this.resumeSnPolling());
    eventBus.on('ui:scorm:terminated', () => this.stopSnPolling());

    // CRITICAL FIX: Handle navigation availability updates from main process
    // This propagates navigation changes when activities complete
    // Use preload bridge instead of eventBus since navigation events are blocked by eventBus validation
    try {
      ipcClient.onNavigationAvailabilityUpdated((data) => {
        try {
          this.logger.info('AppManager: RECEIVED navigation:availability:updated event via preload bridge', {
            data,
            hasAvailableNavigation: Array.isArray(data?.availableNavigation),
            availableNavigation: data?.availableNavigation
          });

          const { availableNavigation, presentation, hiddenControls } = data || {};
          if (Array.isArray(availableNavigation)) {
            const normalized = this.normalizeAvailableNavigation(availableNavigation);

            this.logger.debug('AppManager: Normalized navigation data', {
              availableNavigation,
              normalized,
              canNavigateNext: normalized.canNavigateNext,
              canNavigatePrevious: normalized.canNavigatePrevious,
              presentation,
              hiddenControls
            });

            // Update UI state for other components
            this.uiState.updateNavigation({
              ...normalized,
              presentation: presentation || null,
              hiddenControls: hiddenControls || [],
              _fromNavigationAvailabilityUpdate: true
            });

            // Update sidebar visibility based on course sequencing (learner mode only)
            this.updateSidebarVisibilityFromNavigation(availableNavigation);

            // Rewrite: Broadcast availability update via EventBus for decoupled components
            const eventBus = this.services.get('eventBus');
            try {
              eventBus?.emit('navigation:availability:updated', data);
            } catch (_) {}

            this.logger.info('AppManager: Navigation availability update processing complete', {
              availableNavigation,
              normalized,
              directNotification: false
            });
          } else {
            this.logger.warn('AppManager: Invalid availableNavigation data received', {
              data,
              availableNavigationType: typeof availableNavigation
            });
          }
        } catch (error) {
          this.logger.error('AppManager: Failed to process navigation availability update', {
            error: error.message,
            stack: error.stack,
            data
          });
        }
      });
    } catch (err) {
      try { this.logger?.warn('AppManager: Navigation availability preload bridge not available'); } catch (_) {}
    }
  }

  /**
   * Setup UI event listeners
   */
  async setupUIEventListeners() {
    // Deprecated in rewrite: Header actions are rendered and handled by HeaderControls component via EventBus
    // Kept as a no-op to preserve initialization flow.
    return;
  }

  /**
   * Handle course reload request
   */
  async handleCourseReload() {
    try {
      this.logger.info('AppManager: Course reload requested');

      // Clear all errors when reloading a course
      if (this.uiState && typeof this.uiState.clearAllErrors === 'function') {
        this.uiState.clearAllErrors();
        this.logger.info('AppManager: Cleared all errors for course reload');
      }

      // Get current course data
      const courseLoader = this.services.get('courseLoader');
      if (!courseLoader) {
        throw new Error('Course loader service not available');
      }

      const currentCourse = courseLoader.getCurrentCourse();
      if (!currentCourse) {
        this.logger.warn('AppManager: No course currently loaded');
        this.showError('Reload Failed', 'No course is currently loaded');
        return;
      }

      // DO NOT reset SCORM client here - the old content needs a valid session
      // to handle its unload events (which typically call Commit/Terminate).
      // The scormClient will be reset in ContentViewer.teardownScormAPIs()
      // AFTER the old content has been unloaded.

      // Set loading state on the reload button
      const reloadBtn = document.getElementById('course-reload-btn');
      if (reloadBtn) {
        reloadBtn.disabled = true;
        const svg = reloadBtn.querySelector('svg');
        if (svg) {
          // Change SVG to loading spinner
          svg.innerHTML = '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" stroke-dasharray="31.416" stroke-dashoffset="31.416"><animate attributeName="stroke-dashoffset" dur="1s" repeatCount="indefinite" values="31.416;0"/></circle>';
        }
        reloadBtn.title = 'Reloading...';
      }

      // Determine course type and reload accordingly
      const { originalFilePath, path: folderPath } = currentCourse;

      if (originalFilePath) {
        // Reload from ZIP file
        this.logger.info('AppManager: Reloading from ZIP file', originalFilePath);
        await courseLoader.loadCourseFromPath(originalFilePath);
      } else if (folderPath) {
        // Reload from folder
        this.logger.info('AppManager: Reloading from folder', folderPath);
        await courseLoader.loadCourseFromFolder(folderPath);
      } else {
        throw new Error('Unable to determine course source for reload');
      }

      this.logger.info('AppManager: Course reload completed successfully');

    } catch (error) {
      this.logger.error('AppManager: Error reloading course', error);
      this.showError('Reload Failed', error.message || 'Failed to reload course');
    } finally {
      // Reset button state
      const reloadBtn = document.getElementById('course-reload-btn');
      if (reloadBtn) {
        reloadBtn.disabled = false;
        const svg = reloadBtn.querySelector('svg');
        if (svg) {
          // Restore original reload icon
          svg.innerHTML = '<path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/>';
        }
        reloadBtn.title = 'Reload Current Course';
      }
    }
  }

  /**
   * Handle course loaded event
   */
  handleCourseLoaded(courseData) {
    try { this.logger.debug('AppManager - handleCourseLoaded invoked'); } catch (_) {}

    try {

      // Update components with course data
      const contentViewer = this.components.get('contentViewer');
      if (contentViewer && courseData.launchUrl) {
        try {
          this.logger.debug('AppManager: Instructing ContentViewer.loadContent with launchUrl');
          contentViewer.loadContent(courseData.launchUrl);
        } catch (e) {
          this.logger.error('AppManager: ContentViewer.loadContent threw', e?.message || e);
        }
      }

      // Do NOT directly update CourseOutline here.
      // CourseOutline subscribes to 'course:loaded' and will render itself once.
      const courseOutline = this.components.get('courseOutline');
      if (!courseOutline) {
        this.logger.error('AppManager: courseOutline component not found in components map at course:loaded');
      } else {
        try { this.logger.info('AppManager: Relying on CourseOutline event subscription for course:loaded'); } catch (_) {}
      }

      // Enable reload button since a course is now loaded
      const reloadBtn = document.getElementById('course-reload-btn');
      if (reloadBtn) {
        reloadBtn.disabled = false;
        reloadBtn.title = 'Reload Current Course';

	      // Hide recent courses panel when a course is loaded
	      try {
	        const rc = document.getElementById('recent-courses');
	        if (rc) rc.style.display = 'none';
	      } catch (_) {}

      }

      // Set sidebar visibility based on course sequencing (deferred to allow SN initialization)
      // This will be called after SN service provides availableNavigation
      this._pendingCourseLoadedSidebarUpdate = true;

      // Success notification removed per user request - course loads should not show a notification

    } catch (error) {
      try { this.logger.error('AppManager: Error handling course loaded', error?.message || error); } catch (_) {}
    }
  }

  /**
   * Handle course cleared event
   */
  handleCourseCleared() {

      // Show and refresh recent courses when no course is loaded
      try {
        const rc = document.getElementById('recent-courses');
        if (rc) {
          rc.style.removeProperty('display');
          // Re-render to reflect latest MRU
          this.renderRecentCourses().catch(() => {});
        }
      } catch (_) {}

    try {
      // Disable reload button since no course is loaded
      const reloadBtn = document.getElementById('course-reload-btn');
      if (reloadBtn) {
        reloadBtn.disabled = true;
        reloadBtn.title = 'No course loaded';
      }

      this.logger.info('AppManager: Course cleared, reload button disabled');
    } catch (error) {
      try { this.logger.error('AppManager: Error handling course cleared', error?.message || error); } catch (_) {}
    }
  }

  /**
   * Handle course exit event from main process
   * @param {Object} exitData - Exit data from ScormService
   */
  async handleCourseExit(exitData) {
    try {
      this.logger.info('AppManager: Course exit event received', {
        sessionId: exitData.sessionId,
        completionStatus: exitData.completionStatus,
        successStatus: exitData.successStatus,
        exitType: exitData.exitType
      });

      // Hide the course content when it exits
      const contentViewer = this.services.get('contentViewer');
      if (contentViewer) {
        // Clear the iframe content
        contentViewer.clearContent();
      }

      // Get the already-initialized CourseExitSummary component
      const courseExitSummary = this.components.get('courseExitSummary');
      if (!courseExitSummary) {
        this.logger.error('AppManager: CourseExitSummary component not found');
        return;
      }

      // Show the exit summary
      courseExitSummary.show(exitData);

    } catch (error) {
      this.logger.error('AppManager: Error handling course exit', error);
    }
  }

  /**
   * Handle test resume request
   * @param {Object} data - Resume data
   */
  async handleTestResume(data) {
    try {
      try { rendererLogger.info('AppManager: [DIAG] handleTestResume begin', { sessionId: data?.sessionId }); } catch (_) {}
      this.logger.info('AppManager: Test resume requested', {
        sessionId: data.sessionId
      });

      // Get current course path
      const currentCoursePath = this.uiState.getState('currentCoursePath');
      if (!currentCoursePath) {
        this.showError('Resume Failed', 'No course path available for resume');
        return;
      }

      this.logger.info('AppManager: Requesting resume from main process', {
        coursePath: currentCoursePath,
        sessionId: data.sessionId
      });
      try { rendererLogger.info('AppManager: [DIAG] invoking scorm:resume-session', { coursePath: currentCoursePath, sessionId: data?.sessionId }); } catch (_) {}

      // Request resume from main process
      const result = await ipcClient.invoke('scorm:resume-session', {
        coursePath: currentCoursePath,
        sessionId: data.sessionId
      });
      try { rendererLogger.info('AppManager: [DIAG] scorm:resume-session result', { success: !!result?.success }); } catch (_) {}

      this.logger.info('AppManager: Resume result received', result);

      if (result.success) {
        this.logger.info('AppManager: Resume test successful');
        this.showSuccess('Resume Test', 'Course resumed successfully with saved progress');
      } else {
        this.logger.error('AppManager: Resume test failed', result.error);
        this.showError('Resume Failed', result.error || 'Failed to resume course');
      }

    } catch (error) {
      this.logger.error('AppManager: Error handling test resume', error);
      this.showError('Resume Failed', error.message);
    }
  }

  /**
   * Handle exit summary closed (cleanup terminated session)
   * @param {Object} data - Close data with sessionId
   */
  async handleExitSummaryClosed(data) {
    try {
      if (!data?.sessionId) {
        return;
      }

      this.logger.info('AppManager: Exit summary closed, cleaning up session', {
        sessionId: data.sessionId
      });

      // Request session cleanup from main process
      await ipcClient.invoke('scorm:cleanup-terminated-session', {
        sessionId: data.sessionId
      });

    } catch (error) {
      // Non-critical error, just log it
      this.logger.warn('AppManager: Error cleaning up terminated session', error);
    }
  }

  /**
   * Setup error handlers
   */
  setupErrorHandlers() {
    // Global error handler
    window.addEventListener('error', (event) => {
      try {
        this.logger.error('AppManager: Global error detected', (event && (event.error && event.error.message)) || event?.error || 'unknown');
        this.logger.error('AppManager: Error source', { file: event && event.filename, line: event && event.lineno });
      } catch (_) {}
    });

    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
      try { this.logger.error('AppManager: Unhandled promise rejection', event?.reason?.message || event?.reason || 'unknown'); } catch (_) {}
    });
  }

  /**
   * Handle initialization errors
   */
  handleInitializationError(error) {
    // Prevent recursive handling loops
    if (this._handlingInitError) return;
    this._handlingInitError = true;

    try {
      this.logger.error('AppManager: Initialization error', (error && (error.message || error)));
      if (error && error.stack) this.logger.error('AppManager: Error details stack', error.stack);
    } catch (_) {}

    // Track startup error for diagnostics
    this.startupErrors.push({
      message: error?.message || String(error),
      stack: error?.stack || null,
      timestamp: Date.now()
    });

    // Initialization errors are catastrophic - they prevent the app from working
    try {
      if (this.uiState && typeof this.uiState.addCatastrophicError === 'function') {
        const initError = error instanceof Error ? error : new Error(String(error));
        initError.context = {
          source: 'app-initialization',
          phase: 'startup',
          timestamp: new Date().toISOString()
        };
        this.uiState.addCatastrophicError(initError);
      } else if (this.uiState && typeof this.uiState.showNotification === 'function') {
        // Fallback to old notification system
        if (typeof this.uiState.setError === 'function') {
          this.uiState.setError(error);
        }
        this.uiState.showNotification({
          message: `Initialization Error: ${error?.message || 'Unknown error'}`,
          type: 'error',
          duration: 0
        });
      }
    } catch (_) {}

    // Emit app error for any listeners (avoid re-emitting inside an app:error handling path)
    try {
      const eventBus = this.services.get('eventBus');
      if (eventBus) {
        eventBus.emit('app:error', { error });
      }
    } catch (_) {}

    // Allow future error handling after this tick
    setTimeout(() => { this._handlingInitError = false; }, 0);
  }

  /**
   * Show loading state
   */
  showLoading(message = 'Loading...') {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
      // Resolve message element robustly: prefer id, fallback to class within overlay
      let messageElement = document.getElementById('loading-message');
      if (!messageElement) {
        try {
          messageElement = loadingElement.querySelector('.loading-message');
        } catch (_) {
          messageElement = null;
        }
      }
      if (messageElement) {
        messageElement.textContent = message;
      }
      loadingElement.style.display = 'flex';
      loadingElement.classList.remove('hidden');
    }
  }

  /**
   * Hide loading state
   */
  hideLoading() {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
      loadingElement.style.display = 'none';
      loadingElement.classList.add('hidden');
    }
  }

  /**
   * Show error message
   */
  showError(title, message) {
    import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
      rendererLogger.error(`AppManager: ${title}`, message);
    });

    // Add to error tracking system as non-catastrophic error
    if (this.uiState && typeof this.uiState.addNonCatastrophicError === 'function') {
      this.uiState.addNonCatastrophicError({
        message: `${title}: ${message}`,
        stack: null,
        context: {
          source: 'app-manager',
          timestamp: new Date().toISOString()
        },
        component: 'AppManager'
      });
    }

    // Also show notification for immediate feedback
    this.uiState.showNotification({
      message: `${title}: ${message}`,
      type: 'error',
      duration: 0 // Persistent until dismissed
    });
  }

  /**
   * Show success message
   */
  showSuccess(title, message) {
    // console.log(`AppManager: ${title}:`, message); // Removed debug log
    this.uiState.showNotification({
      message: `${title}: ${message}`,
      type: 'success',
      duration: 2000 // Auto-dismiss after 2 seconds
    });
  }

  /**
   * Display any startup errors that were captured
   */
  displayStartupErrors() {
    if (!this.startupErrors || this.startupErrors.length === 0) {
      return;
    }

    try {
      this.logger.info(`AppManager: Displaying ${this.startupErrors.length} startup error(s)`);

      // Add each startup error to the error tracking system
      this.startupErrors.forEach((error, index) => {
        if (this.uiState && typeof this.uiState.addNonCatastrophicError === 'function') {
          this.uiState.addNonCatastrophicError({
            message: error.message || 'Unknown startup error',
            stack: error.stack || null,
            context: {
              source: 'app-startup',
              errorIndex: index,
              timestamp: new Date(error.timestamp).toISOString()
            },
            component: 'app-manager'
          });
        }
      });
    } catch (err) {
      this.logger.error('AppManager: Failed to display startup errors', err);
    }
  }


  /**
   * Get service instance
   */
  getService(name) {
    return this.services.get(name);
  }

  /**
   * Get component instance
   */
  getComponent(name) {
    return this.components.get(name);
  }



  /**
   * Open SCORM Inspector window
   */
  async openScormInspector() {
    try {
      // Prefer integrated panel if present
      const inspector = this.components?.get('inspectorPanel');
      if (inspector && typeof inspector.toggleVisibility === 'function') {
        inspector.toggleVisibility();
        try { this.logger.info('AppManager: Toggled integrated Inspector panel'); } catch (_) {}
        return;
      }

    } catch (_) {
      // No legacy window fallback; integrated panel is the only inspector UI.
    }
  }

  /**
   * Apply theme to document root
   */
  applyTheme(theme) {
    try {
      const t = (theme === 'dark' || theme === 'system' || theme === 'default') ? theme : 'default';
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.className = document.documentElement.className.replace(/theme-\w+/, `theme-${t}`);
    } catch (_) {}
  }

  /**
   * Initialize UI from main AppState (theme, sidebar visibility, and more)
   */
  async initializeUiFromMain() {
    try {
      const res = await ipcClient.uiGetSettings();
      const ui = res && res.settings ? (res.settings.ui || {}) : {};
      if (ui.theme) this.applyTheme(ui.theme || 'default');
      if (typeof ui.sidebarVisible === 'boolean') {
        await this.handleMenuToggle({ visible: ui.sidebarVisible });
      }
      if (typeof ui.devModeEnabled === 'boolean') {
        this.uiState?.setState('ui.devModeEnabled', ui.devModeEnabled, true);
      }
      if (typeof ui.sidebarCollapsed === 'boolean') {
        this.uiState?.setState('ui.sidebarCollapsed', ui.sidebarCollapsed, true);
      }
      if (typeof ui.debugPanelVisible === 'boolean') {
        this.uiState?.setState('ui.debugPanelVisible', ui.debugPanelVisible, true);
      }
    } catch (error) {
      try { this.logger.warn('AppManager: Failed to initialize UI from main', error?.message || error); } catch (_) {}
    }
  }

  /**
   * Keep main AppState in sync with renderer UI changes for centralized keys
   */
  setupUiSettingsSync() {
    try {
      if (!this.uiState || typeof this.uiState.subscribe !== 'function') return;
      const CENTRAL_KEYS = ['theme','sidebarVisible','sidebarCollapsed','debugPanelVisible','devModeEnabled'];
      let last = {};
      const getCurrent = () => {
        const ui = (this.uiState && this.uiState.getState && this.uiState.getState('ui')) || (this.uiState?.state?.ui) || {};
        const pick = {};
        for (const k of CENTRAL_KEYS) pick[k] = ui[k];
        return pick;
      };
      last = getCurrent();

      this.uiState.subscribe(async (newState) => {
        try {
          const ui = newState && newState.ui ? newState.ui : {};
          const delta = {};
          let changed = false;
          for (const k of CENTRAL_KEYS) {
            if (ui[k] !== last[k]) { delta[k] = ui[k]; changed = true; }
          }
          if (changed) {
            await ipcClient.uiSetSettings({ ui: delta });
            last = { ...last, ...delta };
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  /**
   * Toggle application theme
   */
  async toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'default';
    const newTheme = currentTheme === 'dark' ? 'default' : 'dark';

    this.applyTheme(newTheme);

    // Persist to main AppState
    try {
      await ipcClient.uiSetSettings({ ui: { theme: newTheme } });
    } catch (error) {
      try { this.logger.warn('Failed to persist theme to main AppState', error?.message || error); } catch (_) {}
    }
  }

  /**
   * Toggle sidebar visibility (mobile)
  */
  toggleSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
      // Use the responsive mobile open class that matches CSS
      sidebar.classList.toggle('app-sidebar--open');
    }

    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
      overlay.classList.toggle('active');
    } else {
      // Create overlay if it doesn't exist
      const newOverlay = document.createElement('div');
      newOverlay.className = 'sidebar-overlay active';
      // Use intent-based flow to close sidebar via overlay
      newOverlay.addEventListener('click', async () => {
        const { eventBus } = await import('../services/event-bus.js');
        eventBus.emit('ui:sidebar:toggle-request', { visible: false });
      });
      document.body.appendChild(newOverlay);
    }
  }

  /**
   * Handle menu toggle event from navigation controls
   */
  async handleMenuToggle(data) {
    const sidebar = document.getElementById('app-sidebar');
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

    let targetVisible = true;

    if (sidebar) {
      // Determine current visibility from DOM, then compute target
      let currentVisible = true;
      if (isMobile) {
        currentVisible = sidebar.classList.contains('app-sidebar--open');
      } else {
        currentVisible = !sidebar.classList.contains('app-sidebar--hidden');
      }
      targetVisible = (typeof data?.visible === 'boolean') ? data.visible : !currentVisible;

      if (isMobile) {
        // Mobile uses slide-in panel
        sidebar.classList.toggle('app-sidebar--open', targetVisible);

        // Manage overlay on mobile
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay && targetVisible) {
          overlay = document.createElement('div');
          overlay.className = 'sidebar-overlay active';
          // Use intent-based flow for closing via overlay
          import('../services/event-bus.js').then(({ eventBus }) => {
            overlay.addEventListener('click', () => { eventBus.emit('ui:sidebar:toggle-request', { visible: false }); });
          }).catch(() => {
            overlay.addEventListener('click', () => this.handleMenuToggle({ visible: false }));
          });
          document.body.appendChild(overlay);
        } else if (overlay) {
          overlay.classList.toggle('active', targetVisible);
          if (!targetVisible) {
            // Allow CSS transition, then remove
            setTimeout(() => {
              if (overlay && !overlay.classList.contains('active')) {
                overlay.remove();
              }
            }, 250);
          }
        }
      } else {
        // Desktop: toggle hidden class and expand content area
        sidebar.classList.toggle('app-sidebar--hidden', !targetVisible);

        const appContent = document.querySelector('.app-content');
        if (appContent) {
          appContent.classList.toggle('app-content--full-width', !targetVisible);
        }
      }

      // Update UI state and persist centrally to main AppState
      if (this.uiState) {
        this.uiState.setState('ui.sidebarVisible', targetVisible, true); // silent update to avoid loops
      }
      try {
        await ipcClient.uiSetSettings({ ui: { sidebarVisible: targetVisible } });
      } catch (_) {}
    }

    try {
      this.logger.debug('AppManager: Menu toggled', { visible: targetVisible });
    } catch (_) {}

    // Broadcast visibility change for other components (e.g., NavigationControls) to react
    try {
      const eventBus = this.services.get('eventBus');
      eventBus?.emit('ui:menu:visibility-changed', { visible: targetVisible });
    } catch (_) {}
  }

  /**
   * Handle menu visibility change event from navigation controls
   */
  handleMenuVisibilityChanged(data) {
    const sidebar = document.getElementById('app-sidebar');
    const isVisible = data.visible;
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

    if (sidebar) {
      if (isMobile) {
        sidebar.classList.toggle('app-sidebar--open', isVisible);
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay && isVisible) {
          overlay = document.createElement('div');
          overlay.className = 'sidebar-overlay active';
          overlay.addEventListener('click', () => this.handleMenuVisibilityChanged({ visible: false }));
          document.body.appendChild(overlay);
        } else if (overlay) {
          overlay.classList.toggle('active', isVisible);
          if (!isVisible) {
            setTimeout(() => {
              if (overlay && !overlay.classList.contains('active')) {
                overlay.remove();
              }
            }, 250);
          }
        }
      } else {
        sidebar.classList.toggle('app-sidebar--hidden', !isVisible);

        const appContent = document.querySelector('.app-content');
        if (appContent) {
          appContent.classList.toggle('app-content--full-width', !isVisible);
        }
      }
    }

    try {
      this.logger.info('AppManager: Menu visibility changed', { visible: isVisible });
    } catch (_) {}
  }

  /**
   * Update sidebar visibility based on course sequencing and browse mode
   * @param {Array<string>} availableNavigation - Available navigation types from SN service
   */
  async updateSidebarVisibilityFromNavigation(availableNavigation) {
    try {
      const browseMode = this.uiState?.getState('browseMode')?.enabled || false;
      const choiceAvailable = Array.isArray(availableNavigation) && availableNavigation.includes('choice');

      // Determine if sidebar should be visible
      let shouldShowSidebar = false;

      if (browseMode) {
        // Browse mode: always show sidebar (unrestricted navigation)
        shouldShowSidebar = true;
        this.logger.debug('AppManager: Sidebar visible - browse mode enabled');
      } else if (choiceAvailable) {
        // Learner mode with choice: show sidebar (course allows menu navigation)
        shouldShowSidebar = true;
        this.logger.debug('AppManager: Sidebar visible - choice navigation allowed by course');
      } else {
        // Learner mode without choice: hide sidebar (sequential navigation only)
        shouldShowSidebar = false;
        this.logger.debug('AppManager: Sidebar hidden - sequential navigation only');
      }

      // Only update if pending course load or if visibility needs to change
      const currentVisibility = this.uiState?.getState('ui.sidebarVisible');
      if (this._pendingCourseLoadedSidebarUpdate || currentVisibility !== shouldShowSidebar) {
        this._pendingCourseLoadedSidebarUpdate = false;
        await this.handleMenuToggle({ visible: shouldShowSidebar });
        this.logger.info('AppManager: Sidebar visibility updated based on course sequencing', {
          browseMode,
          choiceAvailable,
          shouldShowSidebar
        });
      }
    } catch (error) {
      try {
        this.logger.error('AppManager: Failed to update sidebar visibility from navigation', error?.message || error);
      } catch (_) {}
    }
  }

  /**
   * Check if application is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Shutdown the application
   */
  async shutdown() {
    // console.log('AppManager: Shutting down application...'); // Removed debug log

    try {
      // Stop polling before tearing down
      if (typeof this.stopSnPolling === 'function') {
        this.stopSnPolling();
      }

      // Cleanup components
      for (const component of this.components.values()) {
        if (component.destroy) {
          await component.destroy();
        }
      }

      // Cleanup services
      const { eventBus } = await import('./event-bus.js');
      eventBus.destroy();

      this.initialized = false;
      // console.log('AppManager: Application shutdown complete'); // Removed debug log

    } catch (error) {
      try { this.logger.error('AppManager: Error during shutdown', error?.message || error); } catch (_) {}
    }
  }
  /**
   * BUG-005 FIX: Setup centralized browse mode management
   */
  setupBrowseModeManagement(eventBus) {
    // Listen for browse mode toggle requests
    eventBus.on('browseMode:toggle', async (data) => {
      const enabled = data?.enabled !== undefined ? data.enabled : !this.browseMode.enabled;
      await this.setBrowseMode(enabled, data?.config);
    });

    // Listen for browse mode queries
    eventBus.on('browseMode:query', () => {
      eventBus.emit('browseMode:status', this.browseMode);
    });

    // Initialize browse mode state from main process if available
    this.initializeBrowseModeFromMain();
  }

  /**
   * BUG-005 FIX: Initialize browse mode state from main process
   */
  async initializeBrowseModeFromMain() {
    try {
      const status = await ipcClient.invoke('browse-mode-status');
      if (status && status.enabled) {
        this.browseMode = {
          enabled: status.enabled,
          session: status.session,
          config: status.config || {}
        };

        // Update UI state to reflect browse mode
        this.uiState.setState('browseMode', this.browseMode);

        // Broadcast browse mode change
        const eventBus = this.services.get('eventBus');
        if (eventBus) {
          eventBus.emit('browseMode:changed', this.browseMode);
        }

        this.logger.info('AppManager: Browse mode initialized from main process', this.browseMode);
      }
    } catch (error) {
      this.logger.warn('AppManager: Failed to initialize browse mode from main process', error);
    }
  }

  /**
   * BUG-005 FIX: Set browse mode (centralized state management)
   */
  async setBrowseMode(enabled, config = {}) {
    try {

      if (enabled) {
        // Enable browse mode via IPC
        const result = await ipcClient.invoke('browse-mode-enable', {
          navigationUnrestricted: true,
          trackingDisabled: true,
          dataIsolation: true,
          visualIndicators: true,
          ...config
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to enable browse mode');
        }

        // Update internal state
        this.browseMode = {
          enabled: true,
          session: result.session || Date.now().toString(),
          config: { navigationUnrestricted: true, trackingDisabled: true, ...config }
        };

        this.logger.info('AppManager: Browse mode enabled', this.browseMode);

      } else {
        // Disable browse mode via IPC
        const result = await ipcClient.invoke('browse-mode-disable');

        if (!result.success) {
          throw new Error(result.error || 'Failed to disable browse mode');
        }

        // Update internal state
        this.browseMode = {
          enabled: false,
          session: null,
          config: {}
        };

        this.logger.info('AppManager: Browse mode disabled');
      }

      // Update UI state (single source of truth)
      this.uiState.setState('browseMode', this.browseMode);

      // Broadcast change to all components
      const eventBus = this.services.get('eventBus');
      if (eventBus) {
        eventBus.emit('browseMode:changed', this.browseMode);
      }

      // Update navigation availability based on browse mode
      if (enabled) {
        // In browse mode, enable all navigation
        this.uiState.updateNavigation({
          canNavigatePrevious: true,
          canNavigateNext: true,
          _fromComponent: true
        });
        // Show sidebar in browse mode (unrestricted navigation)
        await this.updateSidebarVisibilityFromNavigation(['choice', 'continue', 'previous']);
      } else {
        // In normal mode, refresh from SN service
        await this.refreshNavigationFromSNService();
        // Sidebar visibility will be updated by refreshNavigationFromSNService
      }

      return { success: true, browseMode: this.browseMode };

    } catch (error) {
      this.logger.error('AppManager: Failed to set browse mode', error);

      // Revert state on error
      this.browseMode = { enabled: false, session: null, config: {} };
      this.uiState.setState('browseMode', this.browseMode);

      // Show error notification
      this.uiState.showNotification({
        type: 'error',
        message: `Failed to ${enabled ? 'enable' : 'disable'} browse mode: ${error.message}`,
        duration: 5000
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * BUG-005 FIX: Get current browse mode state
   */
  getBrowseMode() {
    return { ...this.browseMode };
  }

  /**
   * BUG-005 FIX: Check if browse mode is enabled
   */
  isBrowseModeEnabled() {
    return this.browseMode.enabled;
  }

  /**
   * BUG-005 FIX: Refresh navigation state from SN service
   */
  async refreshNavigationFromSNService() {
    try {
      const snBridgeModule = await import('./sn-bridge.js');
      const snBridge = snBridgeModule.snBridge;

      const state = await snBridge.getSequencingState();
      if (state && state.success && Array.isArray(state.availableNavigation)) {
        const normalized = this.normalizeAvailableNavigation(state.availableNavigation);
        const presentation = state.presentation || null;
        const hiddenControls = state.hiddenControls || [];
        this.uiState.updateNavigation({
          ...normalized,
          presentation,
          hiddenControls,
          _fromComponent: true
        });
        // Update sidebar visibility based on navigation availability
        await this.updateSidebarVisibilityFromNavigation(state.availableNavigation);
      }
    } catch (error) {
      this.logger.warn('AppManager: Failed to refresh navigation from SN service', error);
    }
  }

  /**
   * BUG-003 FIX: Setup unified navigation pipeline with state machine
   */
  setupUnifiedNavigationPipeline(eventBus) {
    // Listen for unified navigation:request events (namespaced only)
    eventBus.on('navigation:request', async (payload) => {
      await this.processNavigationRequest(payload);
    });
  }

  /**
   * BUG-003 FIX: Process navigation request with state machine and queuing
   */
  async processNavigationRequest(payload) {
    try {
      // Validate payload
      if (!payload || !payload.requestType) {
        this.logger.warn('AppManager: Invalid navigation request payload', payload);
        return { success: false, reason: 'Invalid request payload' };
      }

      const { requestType, activityId, activityObject, source } = payload;

      this.logger.info('AppManager: Processing navigation request', {
        requestType,
        activityId,
        source,
        currentState: this.navigationState,
        queueLength: this.navigationQueue.length
      });

      // Check navigation state - queue if busy
      if (this.navigationState === 'PROCESSING') {
        this.logger.info('AppManager: Navigation in progress, queuing request');
        this.navigationQueue.push(payload);
        return { success: true, reason: 'Request queued' };
      }

      // Set state to processing
      this.setNavigationState('PROCESSING', payload);

      try {
        // BUG-004 FIX: Handle activity exit before loading new activity
        if (this.currentActivity && this.currentActivity.id !== activityId) {
          await this.handleActivityExit(this.currentActivity.id, 'navigation');
        }

        // Determine if SN service processing is needed
        const needsSNProcessing = this.needsSNProcessing(requestType);
        let result;

        if (needsSNProcessing) {
          result = await this.processThroughSNService(requestType, activityId, activityObject);
        } else {
          result = await this.processDirectNavigation(requestType, activityId, activityObject, payload);
        }

        // Update navigation state consistently
        await this.updateNavigationStateFromResult(result);

        // Handle successful navigation result
        if (result && result.success) {
          await this.handleSuccessfulNavigation(result, payload);

          // BUG-004 FIX: Update activity location after successful navigation
          if (activityId && activityId !== this.currentActivity?.id) {
            await this.updateActivityLocation(activityId, window.location.href);

            // Update current activity tracking
            this.currentActivity = {
              id: activityId,
              object: activityObject || result.targetActivity,
              launchedAt: Date.now()
            };
          }
        } else {
          this.logger.warn('AppManager: Navigation request failed', result?.reason);
        }

        return result;

      } finally {
        // Always reset state and process queue
        this.setNavigationState('IDLE');
        await this.processNavigationQueue();
      }

    } catch (error) {
      this.logger.error('AppManager: Error processing navigation request', error);
      this.setNavigationState('IDLE');

      // BUG-024 FIX: Emit navigation error event for error handling
      const eventBus = this.services.get('eventBus');
      if (eventBus) {
        eventBus.emit('navigation:error', {
          error: error.message,
          source: 'AppManager',
          originalRequest: payload
        });
      }

      return { success: false, reason: error.message, error };
    }
  }

  /**
   * BUG-003 FIX: Set navigation state with logging
   * BUG-019 FIX: Add navigation state broadcasting
   */
  setNavigationState(state, request = null) {
    const prevState = this.navigationState;
    this.navigationState = state;
    this.currentNavigationRequest = request;

    if (prevState !== state) {
      this.logger.debug('AppManager: Navigation state changed', {
        from: prevState,
        to: state,
        requestType: request?.requestType
      });

      // BUG-019 FIX: Broadcast navigation state changes to other components
      const eventBus = this.services.get('eventBus');
      if (eventBus) {
        eventBus.emit('navigation:state:updated', {
          state: this.navigationState,
          previousState: prevState,
          currentRequest: request
        });
      }
    }
  }

  /**
   * BUG-003 FIX: Determine if request needs SN service processing
   */
  needsSNProcessing(requestType) {
    return ['previous', 'continue', 'choice'].includes(requestType);
  }

  /**
   * BUG-003 FIX: Process navigation through SN service
   */
  async processThroughSNService(requestType, activityId, activityObject) {
    try {
      // Get SN bridge
      const snBridgeModule = await import('./sn-bridge.js');
      const snBridge = snBridgeModule.snBridge;

      // Initialize if needed
      const init = await snBridge.initialize().catch(() => ({ success: false }));

      if (!init || !init.success) {
        this.logger.warn('AppManager: SN service unavailable; navigation unavailable (fail-fast)');
        return { success: false, reason: 'SN service unavailable' };
      }

      // Process through SN service
      const result = await snBridge.processNavigation(requestType, activityId);

      if (result && result.success) {
        return result;
      } else {
        this.logger.warn('AppManager: SN processing failed (fail-fast)', result?.reason);
        return { success: false, reason: result?.reason || 'SN processing failed' };
      }

    } catch (error) {
      this.logger.error('AppManager: Error in SN processing (fail-fast)', error);
      return { success: false, reason: 'SN processing error', error: error.message };
    }
  }

  /**
   * BUG-003 FIX: Process direct navigation without SN service
   */
  async processDirectNavigation(requestType, activityId, activityObject, payload) {
    try {
      if (requestType === 'activityLaunch' && activityObject) {
        // Direct activity launch
        return {
          success: true,
          action: 'launch',
          targetActivity: activityObject,
          source: 'direct-navigation'
        };
      } else if (requestType === 'directContent' && payload.url) {
        // Direct content load
        return {
          success: true,
          action: 'loadContent',
          url: payload.url,
          scormData: payload.scormData,
          source: 'direct-navigation'
        };
      } else {
        return {
          success: false,
          reason: `Unsupported direct navigation type: ${requestType}`
        };
      }
    } catch (error) {
      // BUG-024 FIX: Emit navigation error event
      const eventBus = this.services.get('eventBus');
      if (eventBus) {
        eventBus.emit('navigationError', {
          error: error.message,
          source: 'AppManager',
          context: 'processDirectNavigation'
        });
        eventBus.emit('navigation:error', {
          error: error.message,
          source: 'AppManager',
          context: 'processDirectNavigation'
        });
      }

      return {
        success: false,
        reason: 'Direct navigation error',
        error: error.message
      };
    }
  }



  /**
   * BUG-003 FIX: Update navigation state from result
   */
  async updateNavigationStateFromResult(result) {
    try {
      if (result && result.availableNavigation) {
        const normalized = this.normalizeAvailableNavigation(result.availableNavigation);
        const presentation = result.presentation || null;
        const hiddenControls = result.hiddenControls || [];
        this.uiState.updateNavigation({
          ...normalized,
          presentation,
          hiddenControls,
          _fromComponent: true
        });
      }
    } catch (error) {
      this.logger.warn('AppManager: Failed to update navigation state from result', error);
    }
  }

  /**
   * BUG-003 FIX: Handle successful navigation
   */
  async handleSuccessfulNavigation(result, _originalPayload) {
    try {
      if (result.action === 'launch' && result.targetActivity) {
        // Emit launch event
        const eventBus = this.services.get('eventBus');
        if (eventBus) {
          eventBus.emit('navigation:launch', {
            activity: result.targetActivity,
            sequencing: result.sequencing,
            source: 'app-manager-unified'
          });
        }

        // Instruct ContentViewer
        const contentViewer = this.components.get('contentViewer');
        if (contentViewer && typeof contentViewer.loadActivity === 'function') {
          await contentViewer.loadActivity(result.targetActivity);
        } else if (contentViewer && typeof contentViewer.loadContent === 'function' && result.targetActivity.launchUrl) {
          await contentViewer.loadContent(result.targetActivity.launchUrl);
        }

      } else if (result.action === 'loadContent') {
        // Direct content loading
        const contentViewer = this.components.get('contentViewer');
        if (contentViewer && typeof contentViewer.loadContent === 'function') {
          await contentViewer.loadContent(result.url, result.scormData);
        }
      }
    } catch (error) {
      this.logger.error('AppManager: Error handling successful navigation', error);
    }
  }

  /**
   * BUG-003 FIX: Process queued navigation requests
   */
  async processNavigationQueue() {
    if (this.navigationQueue.length === 0) {
      return;
    }

    this.logger.debug('AppManager: Processing navigation queue', {
      queueLength: this.navigationQueue.length
    });

    // Process next request in queue
    const nextRequest = this.navigationQueue.shift();
    if (nextRequest) {
      // Process with a small delay to avoid overwhelming the system
      setTimeout(() => {
        this.processNavigationRequest(nextRequest);
      }, 100);
    }
  }

  /**
   * BUG-004 FIX: Handle activity exit for SCORM lifecycle tracking
   */
  async handleActivityExit(activityId, exitType = 'navigation') {
    try {
      if (!this.snService) {
        this.logger.debug('AppManager: SN service not available, skipping activity exit tracking');
        return { success: true, reason: 'SN service unavailable' };
      }

      // Call SN service to handle activity exit
      const result = await ipcClient.invoke('sn:handleActivityExit', {
        activityId,
        exitType
      });

      if (result.success) {
        this.logger.debug('AppManager: Activity exit handled successfully', { activityId, exitType });
      } else {
        this.logger.warn('AppManager: Activity exit handling failed', result.reason);
      }

      return result;
    } catch (error) {
      // Never block navigation due to SCORM API failures
      this.logger.warn('AppManager: Error handling activity exit, continuing navigation', error);
      return { success: true, reason: 'Error handled gracefully' };
    }
  }

  /**
   * BUG-004 FIX: Update activity location for SCORM lifecycle tracking
   */
  async updateActivityLocation(activityId, location) {
    try {
      if (!this.snService) {
        this.logger.debug('AppManager: SN service not available, skipping location update');
        return { success: true, reason: 'SN service unavailable' };
      }

      // Call SN service to update activity location
      const result = await ipcClient.invoke('sn:updateActivityLocation', {
        activityId,
        location
      });

      if (result.success) {
        this.logger.debug('AppManager: Activity location updated successfully', { activityId, location });
      } else {
        this.logger.warn('AppManager: Activity location update failed', result.reason);
      }

      return result;
    } catch (error) {
      // Never block navigation due to SCORM API failures
      this.logger.warn('AppManager: Error updating activity location, continuing navigation', error);
      return { success: true, reason: 'Error handled gracefully' };
    }
  }

  /**
   * Normalize availableNavigation array into booleans for UIState authority.
   * Mirrors NavigationControls.normalizeAvailableNavigation to avoid duplication drift.
   */
  normalizeAvailableNavigation(availableNavigation = []) {
    const a = Array.isArray(availableNavigation) ? availableNavigation : [];
    const canNavigatePrevious = a.includes('previous') || a.includes('choice.previous');
    // Treat only flow 'continue' as next; 'choice' handled by outline/menu
    const canNavigateNext = a.includes('continue');
    return { canNavigatePrevious, canNavigateNext };
  }

  /**
   * Render Recent Courses on welcome screen if container exists.
   * Expects a container with id 'recent-courses'.
   * Each item should have data-type ('zip'|'folder') and data-path.
   */
  async renderRecentCourses() {
    const container = document.getElementById('recent-courses');
    if (!container) {
      try { this.logger.debug('AppManager: recent-courses container not found; skipping render'); } catch (_) {}
      return;
    }

    // Lazy-load store to avoid circular deps
    const { recentCoursesStore } = await import('./recent-courses.js');
    // Ensure the store has loaded its data from the main process
    await recentCoursesStore.ensureLoaded(); // Await initial load via public API

    const items = recentCoursesStore.getAll();
    // Clear
    container.innerHTML = '';

    // Add welcome content wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'recent-courses-wrapper';

    // Add title
    const title = document.createElement('h2');
    title.className = 'recent-courses-title';
    title.textContent = 'Recent Courses';
    wrapper.appendChild(title);

    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = 'No recent courses. Load a SCORM package to get started.';
      wrapper.appendChild(empty);
      container.appendChild(wrapper);
      return;
    }

      const list = document.createElement('ul');
      list.className = 'recent-list';
      items.forEach((rc) => {
        const li = document.createElement('li');
        li.className = 'recent-item';
        li.dataset.type = rc.type;
        li.dataset.path = rc.path;

        const title = rc.meta?.title || rc.displayName || rc.path.split(/[\\/]/).pop();
        const kind = rc.type === 'zip' ? 'ZIP' : 'Folder';

        li.textContent = `${title} (${kind})`;
        li.title = rc.path;

        li.addEventListener('click', async () => {
          try {
            const courseLoader = this.services.get('courseLoader');
            if (!courseLoader) {
              this.logger.error('AppManager: courseLoader not found in services. Cannot load course.');
              return;
            }
            await courseLoader.loadCourseBySource({ type: rc.type, path: rc.path });
            await recentCoursesStore.touch(rc.path, rc.type); // Await touch as it saves
            // refresh list to move to top
            await this.renderRecentCourses(); // Await render as it loads
          } catch (e) {
            try { this.logger.error('AppManager: recent course load failed', e?.message || e); } catch (_) {}
          }
        });

        list.appendChild(li);
      });

      wrapper.appendChild(list);
      container.appendChild(wrapper);
  }

  /**
   * Find an item by identifier within a course structure tree.
   * Ensures the found item belongs to the currently loaded course to prevent course switching.
   */
  _findItemById(structure, id) {
    if (!structure || !id) return null;

    // Get current course context to validate the found item belongs to the right course
    const currentCoursePath = this.uiState?.getState('currentCoursePath');
    const currentCourseInfo = this.uiState?.getState('courseInfo');

    if (!currentCoursePath || !currentCourseInfo) {
      // No current course loaded, cannot safely navigate
      this.logger?.warn('AppManager: No current course context available for navigation');
      return null;
    }

    const stack = [];
    if (Array.isArray(structure.items)) stack.push(...structure.items);
    if (Array.isArray(structure.children)) stack.push(...structure.children);

    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;

      // Check if this node matches the requested ID
      if (node.identifier === id || node.identifierref === id) {
        // Validate that this activity belongs to the current course
        // Check if the activity's launch URL or href contains the current course path
        const activityUrl = node.href || node.launchUrl || '';
        const belongsToCurrentCourse = activityUrl.includes(currentCoursePath) ||
                                     activityUrl.startsWith('scorm-app://') ||
                                     !activityUrl.includes('/') || // Relative URLs are safe
                                     activityUrl === 'about:blank'; // Test activities

        if (!belongsToCurrentCourse) {
          this.logger?.warn('AppManager: Activity does not belong to current course', {
            activityId: id,
            activityUrl,
            currentCoursePath,
            node: node.identifier
          });
          return null;
        }

        // Additional validation: ensure the activity has a valid launch mechanism
        if (!node.href && !node.launchUrl && !node.identifierref) {
          this.logger?.warn('AppManager: Activity missing launch information', {
            activityId: id,
            node: node.identifier
          });
          return null;
        }

        this.logger?.debug('AppManager: Found valid activity in current course', {
          activityId: id,
          activityUrl,
          currentCoursePath
        });

        return node;
      }

      // Continue searching in child nodes
      const kids = Array.isArray(node.items) ? node.items : (Array.isArray(node.children) ? node.children : []);
      if (kids.length) stack.push(...kids);
    }

    this.logger?.debug('AppManager: Activity not found in current course structure', {
      activityId: id,
      currentCoursePath
    });

    return null;
  }

  /**
   * Test helper method to load a course programmatically
   * This is exposed for testing purposes only
   * @param {string} coursePath - Path to course ZIP file or directory
   * @returns {Promise<Object>} Load result
   */
  async testLoadCourse(coursePath, type = 'zip') {
    if (!this.initialized) {
      return { success: false, error: 'AppManager not initialized' };
    }

    try {
      const courseLoader = this.services.get('courseLoader');
      if (!courseLoader) {
        return { success: false, error: 'Course loader service not available' };
      }

      if (type === 'folder') {
        // Load from folder
        await courseLoader.loadCourseFromFolder(coursePath);
      } else {
        // Load from file (ZIP)
        await courseLoader.loadCourseFromPath(coursePath);
      }

      return { success: true, message: 'Course loading initiated' };
    } catch (error) {
      return { success: false, error: error.message || String(error) };
    }
  }
}

// Create and export singleton instance
const appManager = new AppManager();

// Make test helper available globally for e2e tests and console debugging


if (typeof window !== 'undefined') {
  window.appManager = appManager;

  // Add global test helper function
  window.testLoadCourse = async (coursePath, type = 'zip') => {
    const result = await appManager.testLoadCourse(coursePath, type);
    try { rendererLogger.info('testLoadCourse result:', result); } catch (_) {}
    return result;
  };

  // Add helper to load the sample course for quick testing
  window.loadSampleCourse = async () => {
    const samplePath = 'references/real_course_examples/SL360_LMS_SCORM_2004.zip';
    try { rendererLogger.info('Loading sample course from:', samplePath); } catch (_) {}
    return await window.testLoadCourse(samplePath);
  };
  try {
    rendererLogger.info('Test helpers available:');
    rendererLogger.info('  window.testLoadCourse(path) - Load course from path');
    rendererLogger.info('  window.loadSampleCourse() - Load the sample SL360 course');
  } catch (_) {}
}

export { AppManager, appManager };
