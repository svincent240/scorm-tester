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
        : 'scorm-app://src/renderer/';
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
    eventBus.on('scorm:dataChanged', (data) => {
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

   

   

    // Debounce guard for navigation requests to avoid IPC rate limiting
    this._lastNavAt = 0;
    this._NAV_DEBOUNCE_MS = 300;

    // Centralized navigation intents from UI components (NavigationControls, CourseOutline)
    eventBus.on('navigation:request', async (payload) => {
      const now = Date.now();
      if (now - (this._lastNavAt || 0) < this._NAV_DEBOUNCE_MS) {
        try { this.logger.warn('AppManager: navigation:request debounced'); } catch (_) {}
        return;
      }
      this._lastNavAt = now;

      try {
        const type = payload && payload.type;
        const activityId = payload && payload.activityId ? String(payload.activityId) : null;
        this.logger.info('AppManager: navigation:request received', { type, activityId, source: payload && payload.source });

        // Prefer NavigationControls SN flow (includes internal fallbacks)
        const navControls = this.components.get('navigationControls');

        // Decide path based on SN availability
        const snBridgeModule = await import(`${window.electronAPI.rendererBaseUrl}services/sn-bridge.js`);
        const snBridge = snBridgeModule.snBridge;
        const init = await snBridge.initialize().catch(() => ({ success: false }));
        const snAvailable = !!(init && init.success);

        // Handle CHOICE when SN is unavailable: fall back to direct content load
        if (type === 'choice' && activityId && !snAvailable) {
          try {
            const structure = this.uiState.getState('courseStructure');
            const target = this._findItemById(structure, activityId);
            const launchUrl = target && (target.href || target.launchUrl);
            if (launchUrl) {
              this.logger.warn('AppManager: SN unavailable; falling back to direct content load for choice', { activityId, launchUrl });
              const contentViewer = this.components.get('contentViewer');
              if (contentViewer && typeof contentViewer.loadContent === 'function') {
                await contentViewer.loadContent(launchUrl);
              }
              // Heuristic availability: set next enabled, previous enabled to keep UI responsive
              try { this.uiState.updateNavigation({ canNavigatePrevious: true, canNavigateNext: true, _fromComponent: true }); } catch (_) {}
              // Emit launch signal for any listeners
              eventBus.emit('navigation:launch', { activity: { identifier: activityId, launchUrl }, sequencing: null, source: 'app-manager-fallback' });
              return;
            } else {
              this.logger.warn('AppManager: Could not resolve launchUrl for choice fallback', { activityId });
            }
          } catch (e) {
            this.logger.error('AppManager: Choice fallback error', e?.message || e);
          }
          // If fallback unsuccessful, do not proceed to SN (since unavailable)
          return;
        }

        // If SN available, execute via NavigationControls or directly via snBridge
        if (navControls && typeof navControls.processNavigation === 'function') {
          if (type === 'choice' && activityId) {
            await navControls.processNavigation('choice', activityId);
          } else if (type === 'previous') {
            await navControls.processNavigation('previous');
          } else if (type === 'continue' || type === 'next') {
            await navControls.processNavigation('continue');
          } else {
            this.logger.warn('AppManager: Unknown navigation type; ignoring', type);
          }
          return;
        }

        if (!snAvailable) {
          this.logger.warn('AppManager: SN bridge unavailable; navigation request cannot be processed');
          return;
        }

        let requestType = null;
        let targetId = null;
        if (type === 'choice' && activityId) {
          requestType = 'choice'; targetId = activityId;
        } else if (type === 'previous') {
          requestType = 'previous';
        } else if (type === 'continue' || type === 'next') {
          requestType = 'continue';
        }

        if (!requestType) {
          this.logger.warn('AppManager: Invalid navigation request payload', payload);
          return;
        }

        const result = await snBridge.processNavigation(requestType, targetId);
        if (result && result.success) {
          // Update availability in UIState (authoritative)
          if (result.availableNavigation) {
            const normalized = this.normalizeAvailableNavigation(result.availableNavigation);
            try {
              this.uiState.updateNavigation({ ...normalized, _fromComponent: true });
            } catch (e) {
              this.logger.warn('AppManager: Failed to update UIState after navigation', e?.message || e);
            }
          }
          // Handle launch
          if (result.targetActivity && result.action === 'launch') {
            eventBus.emit('navigation:launch', {
              activity: result.targetActivity,
              sequencing: result.sequencing,
              source: 'app-manager'
            });
            const contentViewer = this.components.get('contentViewer');
            try {
              if (contentViewer && typeof contentViewer.loadActivity === 'function') {
                await contentViewer.loadActivity(result.targetActivity);
              } else if (contentViewer && typeof contentViewer.loadContent === 'function' && result.targetActivity?.launchUrl) {
                await contentViewer.loadContent(result.targetActivity.launchUrl);
              }
            } catch (e) {
              this.logger.error('AppManager: Failed to instruct ContentViewer for launch', e?.message || e);
            }
          }
        } else {
          this.logger.warn('AppManager: Navigation request failed', result && (result.reason || 'unknown'));
        }
      } catch (err) {
        try { this.logger.error('AppManager: Error handling navigation:request', err?.message || err); } catch (_) {}
      }
    });

    // Optional: reflect navigation launch to components that rely on centralized signal
    eventBus.on('navigation:launch', (data) => {
      try {
        this.logger.info('AppManager: navigation:launch propagated', { activityId: data?.activity?.id || data?.activity?.identifier || null, source: data?.source });
      } catch (_) {}
    });
 
    // Menu button toggle event handlers
    eventBus.on('menuToggled', this.handleMenuToggle.bind(this));
    eventBus.on('menuVisibilityChanged', this.handleMenuVisibilityChanged.bind(this));

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
    eventBus.on('navigation:request', () => {
      this._snNavInFlight = true;
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
      eventBus.emit('app:error', { error });
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
      sidebar.classList.toggle('sidebar--mobile-open');
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
    
    if (sidebar) {
      sidebar.classList.toggle('app-sidebar--hidden', !isVisible);
      
      // Also update main content area
      const appContent = document.querySelector('.app-content');
      if (appContent) {
        appContent.classList.toggle('app-content--full-width', !isVisible);
      }
      
      // Update UI state
      if (this.uiState) {
        this.uiState.setState('ui.sidebarVisible', isVisible, true); // silent update to avoid loops
      }
    }
    
    try {
      this.logger.debug('AppManager: Menu toggled', { visible: isVisible });
    } catch (_) {}
  }

  /**
   * Handle menu visibility change event from navigation controls
   */
  handleMenuVisibilityChanged(data) {
    const sidebar = document.getElementById('app-sidebar');
    const isVisible = data.visible;
    
    if (sidebar) {
      sidebar.classList.toggle('app-sidebar--hidden', !isVisible);
      
      // Also update main content area
      const appContent = document.querySelector('.app-content');
      if (appContent) {
        appContent.classList.toggle('app-content--full-width', !isVisible);
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
   * Normalize availableNavigation array into booleans for UIState authority.
   * Mirrors NavigationControls.normalizeAvailableNavigation to avoid duplication drift.
   */
  normalizeAvailableNavigation(availableNavigation = []) {
    const a = Array.isArray(availableNavigation) ? availableNavigation : [];
    const canNavigatePrevious = a.includes('previous') || a.includes('choice.previous');
    const canNavigateNext = a.includes('continue') || a.includes('choice.next') || a.includes('choice');
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
if (typeof window !== 'undefined') {
  window.appManager = appManager;
  
  // Add global test helper function
  window.testLoadCourse = async (coursePath, type = 'zip') => {
    const result = await appManager.testLoadCourse(coursePath, type);
    console.log('testLoadCourse result:', result);
    return result;
  };

  // Add helper to load the sample course for quick testing
  window.loadSampleCourse = async () => {
    const samplePath = 'references/real_course_examples/SL360_LMS_SCORM_2004.zip';
    console.log('Loading sample course from:', samplePath);
    return await window.testLoadCourse(samplePath);
  };

  console.log('Test helpers available:');
  console.log('  window.testLoadCourse(path) - Load course from path');
  console.log('  window.loadSampleCourse() - Load the sample SL360 course');
}

export { AppManager, appManager };