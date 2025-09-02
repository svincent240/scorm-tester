/**
 * Application Manager
 * 
 * Main application orchestrator that manages services, components, and lifecycle.
 * Provides clean separation of concerns and centralized application management.
 * 
 * @fileoverview Main application management service
 */


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
      const baseUrl = (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.rendererBaseUrl)
        ? window.electronAPI.rendererBaseUrl
        : 'scorm-app://app/src/renderer/';
      import(`${baseUrl}utils/renderer-logger.js`)
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

    this.setupErrorHandlers();
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      // Dynamically import eventBus first as it's a core dependency
      const { eventBus } = await import('./event-bus.js');
      this.services.set('eventBus', eventBus); // Set it early
      
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

      // Step 5: Setup centralized SN status polling
      this.setupSnPollingController();

      // BUG-005 FIX: Setup centralized browse mode management
      this.setupBrowseModeManagement(eventBus);

      this.initialized = true;

      // Clear any persistent loading states from previous sessions
      this.hideLoading();
      try { this.logger.debug('AppManager - setLoading(false)'); } catch (_) {}
      this.uiState.setLoading(false); // Use the resolved instance

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

      // Emit initialization complete event
      eventBus.emit('app:initialized');
      
    } catch (error) {
      try { this.logger.error('AppManager: Failed to initialize application', error?.message || error); } catch (_) {}
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
   * Initialize all components
   */
  async initializeComponents() {
    try { this.logger.info('AppManager: Initializing components...'); } catch (_) {}

    // Dynamically import component classes
    const { BaseComponent } = await import('../components/base-component.js');
    const { ContentViewer } = await import('../components/scorm/content-viewer.js');
    const { NavigationControls } = await import('../components/scorm/navigation-controls.js');
    const { ProgressTracking } = await import('../components/scorm/progress-tracking.js');
    const { CourseOutline } = await import('../components/scorm/course-outline.js');
    const { FooterProgressBar } = await import('../components/scorm/footer-progress-bar.js');
    const { FooterStatusDisplay } = await import('../components/scorm/footer-status-display.js');
    const componentConfigs = [
      { name: 'contentViewer', class: ContentViewer, elementId: 'content-viewer', required: true },
      { name: 'navigationControls', class: NavigationControls, elementId: 'navigation-controls', required: true },
      // ProgressTracking is a full widget not used in the footer; load only if its container exists elsewhere
      { name: 'progressTracking', class: ProgressTracking, elementId: 'progress-tracking', required: false },
      { name: 'footerProgressBar', class: FooterProgressBar, elementId: 'app-footer', required: true },
      { name: 'footerStatusDisplay', class: FooterStatusDisplay, elementId: 'app-footer', required: true },
      { name: 'courseOutline', class: CourseOutline, elementId: 'course-outline', required: true },
    ];

    // DIAGNOSTIC: verify DOM mount points exist before instantiation
    try {
      ['content-viewer','navigation-controls','app-footer','course-outline'].forEach(id => {
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

   try { this.logger.debug('AppManager: Registering core event handlers'); } catch (_) {}

   // Course loading events
   const eventBus = this.services.get('eventBus');
   if (!eventBus) {
     this.logger.error('AppManager: eventBus not found in services. Cannot set up event handlers.');
     return;
   }
   

    eventBus.on('course:loadError', (errorData) => {
      try { this.logger.error('AppManager: Course load error', (errorData && (errorData.error || errorData.message)) || errorData || 'unknown'); } catch (_) {}
      this.showError('Course Loading Error', (errorData && (errorData.error || errorData.message)) || 'Unknown error');
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

    eventBus.on('scorm:error', (errorData) => {
      try {
        const safeMsg = (errorData && (errorData.message || errorData.error)) || 'Unknown SCORM error';
        this.logger.error('AppManager: SCORM error', safeMsg);
        this.logger.error('AppManager: SCORM error details', {
          code: errorData && errorData.code,
          source: errorData && errorData.source,
          timestamp: new Date().toISOString()
        });
      } catch (_) {}
    });

   

   

    // BUG-003 FIX: Unified navigation pipeline with state machine
    this.setupUnifiedNavigationPipeline(eventBus);

    // BUG-020 FIX: Removed legacy navigation:request support - all events now use standardized navigationRequest

    // Optional: reflect navigation launch to components that rely on centralized signal
    eventBus.on('navigation:launch', (data) => {
      try {
        this.logger.info('AppManager: navigation:launch propagated', { activityId: data?.activity?.id || data?.activity?.identifier || null, source: data?.source });
      } catch (_) {}
    });
 
    // Menu button toggle event handlers
    eventBus.on('menuToggled', this.handleMenuToggle.bind(this));
    eventBus.on('menuVisibilityChanged', this.handleMenuVisibilityChanged.bind(this));

    // Menu action handlers
    if (window.electronAPI && window.electronAPI.onMenuEvent) {
      window.electronAPI.onMenuEvent((menuData) => {
        try { this.logger.info('AppManager: Menu event received', menuData); } catch (_) {}
        if (menuData && menuData.action === 'exit') {
          try { this.logger.info('AppManager: Handling menu exit action'); } catch (_) {}
          // Trigger app quit
          if (window.electronAPI && window.electronAPI.invoke) {
            window.electronAPI.invoke('quit-app').catch((error) => {
              try { this.logger.error('AppManager: Failed to quit app via IPC', error); } catch (_) {}
            });
          }
        }
      });
    }

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
        this.uiState.updateNavigation({ ...normalized, _fromComponent: true });
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
    eventBus.on('navigationRequest', () => {
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

    // 4) Commit/Terminate gating (if emitted by scormAPIBridge)
    eventBus.on('scorm:commit:start', () => this.pauseSnPolling('commit'));
    eventBus.on('scorm:commit:done', () => this.resumeSnPolling());
    eventBus.on('scorm:terminate:start', () => this.pauseSnPolling('terminate'));
    eventBus.on('scorm:terminate:done', () => this.stopSnPolling());

    // CRITICAL FIX: Handle navigation availability updates from main process
    // This propagates navigation changes when activities complete
    // Use preload bridge instead of eventBus since navigation events are blocked by eventBus validation
    if (window.electronAPI && window.electronAPI.onNavigationAvailabilityUpdated) {
      window.electronAPI.onNavigationAvailabilityUpdated((data) => {
        try {
          this.logger.info('AppManager: RECEIVED navigation:availability:updated event via preload bridge', {
            data,
            hasAvailableNavigation: Array.isArray(data?.availableNavigation),
            availableNavigation: data?.availableNavigation
          });

          const { availableNavigation } = data || {};
          if (Array.isArray(availableNavigation)) {
            const normalized = this.normalizeAvailableNavigation(availableNavigation);

            this.logger.debug('AppManager: Normalized navigation data', {
              availableNavigation,
              normalized,
              canNavigateNext: normalized.canNavigateNext,
              canNavigatePrevious: normalized.canNavigatePrevious
            });

            // Update UI state for other components
            this.uiState.updateNavigation({
              ...normalized,
              _fromNavigationAvailabilityUpdate: true
            });

            // CRITICAL FIX: Directly notify navigation-controls component to ensure button states update
            // This bypasses the silent UI state update issue that was preventing button state changes
            const navigationControls = this.components.get('navigationControls');
            this.logger.debug('AppManager: Checking navigation-controls component', {
              componentExists: !!navigationControls,
              hasMethod: typeof navigationControls?.handleNavigationAvailabilityUpdated === 'function',
              componentType: typeof navigationControls
            });

            if (navigationControls && typeof navigationControls.handleNavigationAvailabilityUpdated === 'function') {
              this.logger.info('AppManager: Calling handleNavigationAvailabilityUpdated on navigation-controls');
              navigationControls.handleNavigationAvailabilityUpdated(data);
              this.logger.info('AppManager: Successfully notified navigation-controls component', {
                availableNavigation,
                normalized
              });
            } else {
              this.logger.error('AppManager: Navigation-controls component not available for direct notification', {
                componentExists: !!navigationControls,
                hasMethod: typeof navigationControls?.handleNavigationAvailabilityUpdated === 'function'
              });
            }

            this.logger.info('AppManager: Navigation availability update processing complete', {
              availableNavigation,
              normalized,
              directNotification: !!navigationControls
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
    } else {
      this.logger.warn('AppManager: Navigation availability preload bridge not available');
    }
  }

  /**
   * Setup UI event listeners
   */
  async setupUIEventListeners() {
    // console.log('AppManager: Setting up UI event listeners...'); // Removed debug log
    
    // Course load button (Open ZIP)
    const courseLoader = this.services.get('courseLoader');
    if (!courseLoader) {
      this.logger.error('AppManager: courseLoader not found in services. Cannot set up UI event listeners for course loading.');
      return;
    }

    // Course load button (Open ZIP)
    const courseLoadBtn = document.getElementById('course-load-btn');
    if (courseLoadBtn) {
      courseLoadBtn.addEventListener('click', () => {
        courseLoader.handleCourseLoad().catch(error => {
          try { this.logger.error('AppManager: Course load error', error?.message || error); } catch (_) {}
        });
      });
      // console.log('AppManager: Course load button listener attached'); // Removed debug log
    }

    // New: Open Folder button
    const openFolderBtn = document.getElementById('course-folder-btn');
    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', () => {
        courseLoader.handleFolderLoad().catch(error => {
          try { this.logger.error('AppManager: Folder load error', error?.message || error); } catch (_) {}
        });
      });
    }
 
    // Welcome page buttons (fallback wiring for legacy inline handlers)
    const welcomeButtons = document.querySelectorAll('button[onclick*="course-load-btn"]');
    welcomeButtons.forEach((btn, index) => {
      btn.onclick = null; // Remove inline onclick
      btn.addEventListener('click', () => {
        courseLoader.handleCourseLoad().catch(error => {
          try { this.logger.error('AppManager: Course load error from welcome button', error?.message || error); } catch (_) {}
        });
      });
      // console.log(`AppManager: Welcome button ${index + 1} listener attached`); // Removed debug log
    });

    // Render Recent Courses list if container exists
    await this.renderRecentCourses();
 
    

    // SCORM Inspector toggle
    const scormInspectorToggleBtn = document.getElementById('scorm-inspector-toggle');
    if (scormInspectorToggleBtn) {
      scormInspectorToggleBtn.addEventListener('click', () => {
        this.openScormInspector();
      });
    }

    // Theme toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // Sidebar toggle for mobile
    const sidebarToggleBtn = document.getElementById('sidebar-toggle');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', () => {
        this.toggleSidebar();
      });
    }

    // console.log('AppManager: UI event listeners setup complete'); // Removed debug log
  }

  /**
   * Handle course loaded event
   */
  handleCourseLoaded(courseData) {
    try { this.logger.debug('AppManager - handleCourseLoaded invoked'); } catch (_) {}

    try {
      // Reset fallback notification flag for new course
      this._fallbackNotificationShown = false;

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

      // Show success message
      this.showSuccess('Course Loaded', `Successfully loaded: ${courseData.info?.title || 'Course'}`);
      
    } catch (error) {
      try { this.logger.error('AppManager: Error handling course loaded', error?.message || error); } catch (_) {}
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

    try { this.logger.error('AppManager: Initialization error', error?.message || error); } catch (_) {}

    // Centralized UI handling via UIState notification (no inline HTML)
    try {
      if (this.uiState && typeof this.uiState.showNotification === 'function') {
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
      duration: 5000 // Auto-dismiss after 5 seconds
    });
  }

  /**
   * Show fallback navigation notification
   * BUG-006 FIX: Inform user when advanced navigation is unavailable
   */
  showFallbackNotification() {
    if (!this._fallbackNotificationShown) {
      this._fallbackNotificationShown = true;
      this.uiState.showNotification({
        message: 'Advanced navigation unavailable, using basic mode',
        type: 'warning',
        duration: 8000 // Auto-dismiss after 8 seconds
      });
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
      if (window.electronAPI && window.electronAPI.openScormInspectorWindow) {
        try { this.logger.debug('AppManager: Requesting SCORM Inspector window...'); } catch (_) {}
        const result = await window.electronAPI.openScormInspectorWindow();
        
        if (result && result.success) {
          try { this.logger.info('AppManager: SCORM Inspector opened successfully'); } catch (_) {}
          return;
        }
        
        // Handle failure cases
        if (!result) {
          try { this.logger.error('AppManager: Failed to open SCORM Inspector: No response from main process'); } catch (_) {}
        } else if (!result.success) {
          try { this.logger.error('AppManager: Failed to open SCORM Inspector:', result.error || 'Unknown error'); } catch (_) {}
        }
      } else {
        try { this.logger.warn('AppManager: SCORM Inspector API not available'); } catch (_) {}
      }
    } catch (error) {
      try { this.logger.error('AppManager: Error opening SCORM Inspector:', error.message || error); } catch (_) {}
    }
  }

  /**
   * Toggle application theme
   */
  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'default';
    const newTheme = currentTheme === 'dark' ? 'default' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    document.documentElement.className = document.documentElement.className.replace(/theme-\w+/, `theme-${newTheme}`);
    
    // Save theme preference
    try {
      localStorage.setItem('scorm-tester-theme', newTheme);
    } catch (error) {
      try { this.logger.warn('Failed to save theme preference', error?.message || error); } catch (_) {}
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
      newOverlay.addEventListener('click', () => this.toggleSidebar());
      document.body.appendChild(newOverlay);
    }
  }

  /**
   * Handle menu toggle event from navigation controls
   */
  handleMenuToggle(data) {
    const sidebar = document.getElementById('app-sidebar');
    const isVisible = data.visible;
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    
    if (sidebar) {
      if (isMobile) {
        // Mobile uses slide-in panel
        sidebar.classList.toggle('app-sidebar--open', isVisible);

        // Manage overlay on mobile
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay && isVisible) {
          overlay = document.createElement('div');
          overlay.className = 'sidebar-overlay active';
          overlay.addEventListener('click', () => this.handleMenuToggle({ visible: false }));
          document.body.appendChild(overlay);
        } else if (overlay) {
          overlay.classList.toggle('active', isVisible);
          if (!isVisible) {
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
        sidebar.classList.toggle('app-sidebar--hidden', !isVisible);

        const appContent = document.querySelector('.app-content');
        if (appContent) {
          appContent.classList.toggle('app-content--full-width', !isVisible);
        }
      }
      
      // Update UI state
      if (this.uiState) {
        this.uiState.setState('ui.sidebarVisible', isVisible, true); // silent update to avoid loops
      }
    }
    
    try {
      this.logger.debug('AppManager: Menu toggled', { visible: isVisible });
    } catch (_) {}

    // Broadcast visibility change for other components (e.g., NavigationControls) to react
    try {
      const eventBus = this.services.get('eventBus');
      eventBus?.emit('menuVisibilityChanged', { visible: isVisible });
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
      if (window.electronAPI && window.electronAPI.invoke) {
        const status = await window.electronAPI.invoke('browse-mode-status');
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
        const result = await window.electronAPI.invoke('browse-mode-enable', {
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
        const result = await window.electronAPI.invoke('browse-mode-disable');

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
      } else {
        // In normal mode, refresh from SN service
        await this.refreshNavigationFromSNService();
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
      const snBridgeModule = await import(`${window.electronAPI.rendererBaseUrl}services/sn-bridge.js`);
      const snBridge = snBridgeModule.snBridge;
      
      const state = await snBridge.getSequencingState();
      if (state && state.success && Array.isArray(state.availableNavigation)) {
        const normalized = this.normalizeAvailableNavigation(state.availableNavigation);
        this.uiState.updateNavigation({ ...normalized, _fromComponent: true });
      }
    } catch (error) {
      this.logger.warn('AppManager: Failed to refresh navigation from SN service', error);
    }
  }

  /**
   * BUG-003 FIX: Setup unified navigation pipeline with state machine
   */
  setupUnifiedNavigationPipeline(eventBus) {
    // Listen for unified navigationRequest events
    eventBus.on('navigationRequest', async (payload) => {
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
        eventBus.emit('navigationError', {
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
      const snBridgeModule = await import(`${window.electronAPI.rendererBaseUrl}services/sn-bridge.js`);
      const snBridge = snBridgeModule.snBridge;
      
      // Initialize if needed
      const init = await snBridge.initialize().catch(() => ({ success: false }));
      
      if (!init || !init.success) {
        this.logger.warn('AppManager: SN service unavailable, trying fallback');
        this.showFallbackNotification();
        return await this.processFallbackNavigation(requestType, activityId, activityObject);
      }

      // Process through SN service
      const result = await snBridge.processNavigation(requestType, activityId);
      
      if (result && result.success) {
        return result;
      } else {
        this.logger.warn('AppManager: SN processing failed, trying fallback', result?.reason);
        this.showFallbackNotification();
        return await this.processFallbackNavigation(requestType, activityId, activityObject);
      }

    } catch (error) {
      this.logger.error('AppManager: Error in SN processing, trying fallback', error);
      this.showFallbackNotification();
      return await this.processFallbackNavigation(requestType, activityId, activityObject);
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
      }
      
      return {
        success: false,
        reason: 'Direct navigation error',
        error: error.message
      };
    }
  }

  /**
   * BUG-003 FIX: Process fallback navigation (simplified)
   */
  async processFallbackNavigation(requestType, activityId, _activityObject) {
    try {
      // Simple fallback for when SN service is unavailable
      if (requestType === 'choice' && activityId) {
        // Try to find activity in course structure
        const structure = this.uiState.getState('courseStructure');
        const target = this._findItemById(structure, activityId);
        
        if (target && target.launchUrl) {
          return {
            success: true,
            action: 'launch',
            targetActivity: target,
            availableNavigation: ['previous', 'continue'], // Heuristic
            source: 'fallback-choice'
          };
        }
      }
      
      return {
        success: false,
        reason: `Fallback navigation not available for ${requestType}`,
        fallback: true
      };
    } catch (error) {
      // BUG-024 FIX: Emit navigation error event
      const eventBus = this.services.get('eventBus');
      if (eventBus) {
        eventBus.emit('navigationError', {
          error: error.message,
          source: 'AppManager',
          context: 'processFallbackNavigation'
        });
      }
      
      return {
        success: false,
        reason: 'Fallback navigation error',
        error: error.message,
        fallback: true
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
        this.uiState.updateNavigation({ ...normalized, _fromComponent: true });
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
      const result = await window.electronAPI.invoke('sn:handleActivityExit', {
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
      const result = await window.electronAPI.invoke('sn:updateActivityLocation', {
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
    const { recentCoursesStore } = await import(`${window.electronAPI.rendererBaseUrl}services/recent-courses.js`);
    // Ensure the store has loaded its data from the main process
    await recentCoursesStore._load(); // Explicitly await the load operation

    const items = recentCoursesStore.getAll();
    // Clear
    container.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = 'No recent courses';
      container.appendChild(empty);
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
  
      container.appendChild(list);
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
import { rendererLogger } from '../utils/renderer-logger.js';

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
