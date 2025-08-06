/**
 * UI State Manager Service
 * 
 * Manages application state, component coordination, and persistence
 * of UI preferences. Provides centralized state management for the renderer.
 * 
 * @fileoverview UI state management service
 */


/**
 * UI State Manager Class
 * 
 * Centralized state management with event-driven updates and persistence.
 */
class UIStateManager {
  constructor() {
    this.state = this.getInitialState();
    this.subscribers = new Map();
    this.persistenceKey = 'scorm-tester-ui-state';
    this.debounceTimeout = null;
    this.eventBus = null; // Will be loaded dynamically
    // Reentrancy guard to prevent progress:updated <-> state:changed ABAB cycles
    this._emittingProgress = false;
    
    this.loadPersistedState();
    // Event listeners that don't depend on eventBus can be set up here
    this.setupGlobalEventListeners();
  }

  /**
   * Get initial application state
   * @returns {Object} Initial state object
   */
  getInitialState() {
    return {
      // Session state
      currentSession: null,
      sessionStartTime: null,
      isConnected: true,
      
      // Course state
      courseInfo: null,
      courseStructure: null,
      currentCoursePath: null,
      entryPoint: null,
      
      // Navigation state
      navigationState: {
        canNavigatePrevious: false,
        canNavigateNext: false,
        currentItem: null,
        isFlowOnly: false,
        menuVisible: false
      },
      
      // Progress state
      progressData: {
        completionStatus: 'not attempted',
        successStatus: 'unknown',
        scoreRaw: null,
        progressMeasure: 0,
        sessionTime: '00:00:00',
        totalTime: '00:00:00',
        location: null,
        suspendData: null
      },
      
      // UI state
      ui: {
        theme: 'default',

        sidebarCollapsed: false,
        courseOutlineVisible: false,
        devModeEnabled: false,
        loading: false,
        error: null,
        notifications: []
      },
      
      // LMS simulation state
      lmsProfile: null,
      networkDelay: 0,
      
      // Debug state
      apiCallHistory: [],
      maxApiCallHistory: 500,
      debug: {
        // placeholders for diagnostics and logger view snapshots
        lastEvents: [],
        maxEvents: 200,
        lastLogs: [],
        maxLogs: 500
      }
    };
  }

  /**
   * Get current state or specific state slice
   * @param {string} [path] - Dot notation path to specific state
   * @returns {*} State value
   */
  getState(path = null) {
    if (!path) {
      return { ...this.state };
    }
    
    return this.getNestedValue(this.state, path);
  }

  /**
   * Update state with new values
   * @param {Object|string} updates - State updates or path for single value
   * @param {*} [value] - Value when using path notation
   * @param {boolean} [silent] - Skip event emission
   */
  setState(updates, value = undefined, silent = false) {
    const previousState = { ...this.state };
    
    if (typeof updates === 'string') {
      // Single value update using path notation
      this.setNestedValue(this.state, updates, value);
    } else if (typeof updates === 'object' && updates !== null) {
      // Merge object updates
      this.state = this.deepMerge(this.state, updates);
    } else {
      throw new Error('Invalid state update parameters');
    }
    
    if (!silent) {
      this.notifyStateChange(previousState, this.state);
      this.debouncedPersist();
    }
  }

  /**
   * Subscribe to state changes
   * @param {Function} callback - Callback function
   * @param {string} [path] - Optional path to watch specific state slice
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback, path = null) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    const id = Date.now() + Math.random();
    this.subscribers.set(id, { callback, path });
    
    return () => this.subscribers.delete(id);
  }

  /**
   * Update session information
   * @param {Object} sessionData - Session data
   */
  updateSession(sessionData) {
    this.setState({
      currentSession: sessionData.id,
      sessionStartTime: sessionData.startTime || Date.now(),
      isConnected: sessionData.connected !== false
    });
    
    this.eventBus?.emit('session:updated', sessionData);
  }

  /**
   * Update course information
   * @param {Object} courseData - Course data
   */
  updateCourse(courseData) {
    this.setState({
      courseInfo: courseData.info,
      courseStructure: courseData.structure,
      currentCoursePath: courseData.path,
      entryPoint: courseData.entryPoint
    });
    
    this.eventBus?.emit('course:loaded', courseData);
  }

  /**
   * Update navigation state (simplified to prevent infinite loops)
   * @param {Object} navData - Navigation data
   */
  updateNavigation(navData) {
    // Skip internal properties used for loop prevention
    const cleanNavData = Object.keys(navData)
      .filter(key => !key.startsWith('_'))
      .reduce((obj, key) => {
        obj[key] = navData[key];
        return obj;
      }, {});
    
    // Check if the navigation state actually changed
    const currentNav = this.state.navigationState;
    const hasChanged = Object.keys(cleanNavData).some(key =>
      JSON.stringify(currentNav[key]) !== JSON.stringify(cleanNavData[key])
    );
    
    if (!hasChanged) {
      return; // No change, skip update
    }
    
    // Update state silently to prevent event loop
    this.setState({
      navigationState: {
        ...this.state.navigationState,
        ...cleanNavData
      }
    }, null, true); // silent = true
    
    // Emit event only if not coming from a component update
    if (!navData._fromComponent) {
      this.eventBus?.emit('navigation:updated', cleanNavData);
    }
  }

  /**
   * Update progress data
   * @param {Object} progressData - Progress data
   */
  updateProgress(progressData) {
    // Compute shallow diff on progress slice to avoid redundant emits
    const prev = this.state.progressData || {};
    const next = { ...prev, ...progressData };
    const changed = (() => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const k of keys) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) return true;
      }
      return false;
    })();

    if (!changed) {
      // Log via renderer logger (no console) that emit is skipped
      try {
        import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.debug('UIState.updateProgress: no-op (no diff); emit skipped');
        });
      } catch (_) { /* no-op */ }
      return;
    }

    // Mark this transaction as a progress-originating update to prevent ABAB with state:changed
    this._emittingProgress = true;
    try {
      // Silent state update: avoid notifyStateChange; progress-specific event covers subscribers
      this.setState({ progressData: next }, undefined, true);
      // Only emit when changed to prevent state:changed <-> progress:updated loops
      this.eventBus?.emit('progress:updated', next);
    } finally {
      // Release guard after current microtask
      setTimeout(() => { this._emittingProgress = false; }, 0);
    }
  }

  /**
   * Update UI state
   * @param {Object} uiData - UI data
   */
  updateUI(uiData) {
    // Compute shallow diff on ui slice to avoid redundant emits
    const prevUI = this.state.ui || {};
    const mergedUI = { ...prevUI, ...uiData };
    const uiChanged = (() => {
      const keys = new Set([...Object.keys(prevUI), ...Object.keys(mergedUI)]);
      for (const k of keys) {
        if (JSON.stringify(prevUI[k]) !== JSON.stringify(mergedUI[k])) return true;
      }
      return false;
    })();

    const prevDev = !!prevUI.devModeEnabled;

    if (!uiChanged) {
      // Skip state update and emit if there is no actual UI change
      try {
        import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.debug('UIState.updateUI: no-op (no diff); emit skipped');
        });
      } catch (_) { /* no-op */ }
      return;
    }

    this.setState({ ui: mergedUI });

    // Emit generic UI update only when changed
    this.eventBus?.emit('ui:updated', mergedUI);

    // Emit specific dev mode change to keep EventBus in sync (Step 8)
    const nextDev = !!mergedUI.devModeEnabled;
    if (nextDev !== prevDev) {
      try {
        // Gate EventBus debug mirroring on toggle
        this.eventBus?.setDebugMode?.(nextDev);
      } catch (_) { /* no-op */ }
      this.eventBus?.emit('ui:devModeChanged', { enabled: nextDev });
      // Also emit a lightweight debug:update signal for panels listening
      this.eventBus?.emit('debug:update', { mode: nextDev });
    }
  }

  /**
   * Add API call to history
   * @param {Object} apiCall - API call data
   */
  addApiCall(apiCall) {
    const ts = Number(apiCall?.timestamp) || Date.now();
    const id = apiCall?.id || (ts + Math.random());
    const normalized = {
      id,
      timestamp: ts,
      method: String(apiCall?.method || ''),
      parameter: typeof apiCall?.parameter === 'string' ? apiCall.parameter : (apiCall?.parameter != null ? String(apiCall.parameter) : ''),
      result: String(apiCall?.result ?? ''),
      errorCode: String(apiCall?.errorCode ?? '0'),
      seq: apiCall?.seq || ts
    };

    const history = [...this.state.apiCallHistory, normalized];
    // Limit history size with ring semantics
    const max = this.state.maxApiCallHistory || 500;
    while (history.length > max) history.shift();

    this.setState({ apiCallHistory: history });
    // Emit normalized payload to EventBus for subscribers
    this.eventBus?.emit('api:call', { data: normalized });
  }

  /**
   * Show notification
   * @param {Object} notification - Notification data
   */
  showNotification(notification) {
    const notifications = [...this.state.ui.notifications];
    const id = Date.now() + Math.random();
    
    notifications.push({
      id,
      type: 'info',
      duration: 5000,
      ...notification,
      timestamp: Date.now()
    });
    
    this.updateUI({ notifications });
    
    // Auto-remove notification
    if (notification.duration !== 0) {
      setTimeout(() => {
        this.removeNotification(id);
      }, notification.duration || 5000);
    }
    
    return id;
  }

  /**
   * Remove notification
   * @param {string|number} id - Notification ID
   */
  removeNotification(id) {
    const notifications = this.state.ui.notifications.filter(n => n.id !== id);
    this.updateUI({ notifications });
  }

  /**
   * Set loading state
   * @param {boolean} loading - Loading state
   * @param {string} [message] - Loading message
   */
  setLoading(loading, message = null) {
    this.updateUI({ 
      loading,
      loadingMessage: message
    });
  }

  /**
   * Set error state
   * @param {string|Error|null} error - Error message or object
   */
  setError(error) {
    let errorData = null;
    
    if (error) {
      errorData = {
        message: error.message || String(error),
        timestamp: Date.now(),
        stack: error.stack || null
      };
    }
    
    this.updateUI({ error: errorData });
    
    if (error) {
      // Mirror to diagnostics buffer for Debug Window
      try {
        const dbg = { ...(this.state.debug || {}), lastEvents: [...(this.state.debug?.lastEvents || [])] };
        dbg.lastEvents.push({ event: 'error', data: errorData, timestamp: Date.now(), id: Date.now() + Math.random() });
        const maxE = dbg.maxEvents || 200;
        while (dbg.lastEvents.length > maxE) dbg.lastEvents.shift();
        this.setState({ debug: dbg }, null, true);
      } catch (_) { /* no-op */ }
      this.eventBus?.emit('error', errorData);
    }
  }

  /**
   * Reset application state
   */
  reset() {
    const initialState = this.getInitialState();
    // Preserve UI preferences
    initialState.ui.theme = this.state.ui.theme;
    initialState.ui.debugPanelVisible = this.state.ui.debugPanelVisible;
    initialState.ui.sidebarCollapsed = this.state.ui.sidebarCollapsed;
    
    this.state = initialState;
    this.notifyStateChange({}, this.state);
    this.debouncedPersist();
    
    this.eventBus?.emit('state:reset');
  }

  /**
   * Setup global event listeners (not dependent on eventBus)
   * @private
   */
  setupGlobalEventListeners() {
    // Listen for window visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.persistState();
      }
    });
    
    // Listen for beforeunload to persist state
    window.addEventListener('beforeunload', () => {
      this.persistState();
    });
  }

  /**
   * Setup event bus listeners
   * @private
   */
  setupEventBusListeners() {
    if (!this.eventBus) {
      console.warn('UIStateManager: EventBus not available for setting up listeners.');
      return;
    }
    // Listen for state changes to emit a general event
    this.eventBus.on('state:changed', (data) => {
      // This is already handled by notifyStateChange, but keeping for consistency if needed elsewhere
    });

    // Mirror EventBus emissions into diagnostics buffer when dev mode is enabled
    const mirror = (eventName) => {
      this.eventBus.on(eventName, (payload) => {
        try {
          if (!this.state.ui?.devModeEnabled) return;
          const dbg = { ...(this.state.debug || {}), lastEvents: [...(this.state.debug?.lastEvents || [])] };
          dbg.lastEvents.push({
            event: eventName,
            data: payload,
            timestamp: Date.now(),
            id: Date.now() + Math.random()
          });
          const maxE = dbg.maxEvents || 200;
          while (dbg.lastEvents.length > maxE) dbg.lastEvents.shift();
          this.setState({ debug: dbg }, null, true);
        } catch (_) { /* no-op */ }
      });
    };
    // Core events to observe for diagnostics snapshotting
    ['api:call', 'error', 'navigation:updated', 'progress:updated', 'course:loaded', 'session:updated', 'ui:updated']
      .forEach(mirror);

    // Expose lightweight enablement selectors for Attempt lifecycle controls
    this.getRteStatus = () => {
      const initialized = !!(window && window.scormClient && window.scormClient.getInitialized && window.scormClient.getInitialized());
      // Temporary derivation until explicit lifecycle flags are surfaced
      // TODO(rte): replace with main/RTE-surfaced lifecycle flags when available
      let terminated = false;
      let suspended = false;
      try {
        if (window && window.scormClient) {
          // Heuristic: check cached data-model keys
          const exitVal = window.scormClient.getCachedValue && window.scormClient.getCachedValue('cmi.exit');
          const suspendData = window.scormClient.getCachedValue && window.scormClient.getCachedValue('cmi.suspend_data');
          suspended = String(exitVal || '').toLowerCase() === 'suspend' || !!(suspendData && String(suspendData).length > 0);
          terminated = typeof window.scormClient.getTerminated === 'function' ? !!window.scormClient.getTerminated() : false;
        }
      } catch (_) { /* no-op */ }
      return { initialized, terminated, suspended };
    };

    this.getAttemptEnablement = () => {
      const { initialized, terminated, suspended } = this.getRteStatus();
      const canStart = !initialized;
      const canSuspend = initialized && !terminated && !suspended;
      const canResume = initialized && !terminated && suspended;
      const canCommit = initialized && !terminated;
      const canTerminate = initialized && !terminated;
      const reasons = {
        start: initialized ? 'Already initialized (RTE 3.2.1)' : '',
        suspend: !initialized ? 'Initialize first (RTE 3.2.1)' : (terminated ? 'Terminated' : ''),
        resume: !initialized ? 'Initialize first (RTE 3.2.1)' : (!suspended ? 'Not suspended' : ''),
        commit: !initialized ? 'Initialize first (RTE 3.2.1)' : (terminated ? 'Terminated' : ''),
        terminate: !initialized ? 'Initialize first (RTE 3.2.1)' : ''
      };
      return { canStart, canSuspend, canResume, canCommit, canTerminate, reasons };
    };

    // Provide explicit API to toggle dev mode and broadcast (Step 8)
    // Consumers can call uiState.setDevModeEnabled(bool)
    if (!this.setDevModeEnabled) {
      this.setDevModeEnabled = (enabled) => {
        const prev = !!this.state.ui.devModeEnabled;
        const next = !!enabled;
        if (prev === next) return;
        this.updateUI({ devModeEnabled: next });
        // updateUI emits ui:devModeChanged when the flag changes
        try {
          // Keep EventBus in sync and broadcast a debug:update mode payload
          this.eventBus?.setDebugMode?.(next);
          this.eventBus?.emit?.('debug:update', { mode: next });
        } catch (_) { /* no-op */ }
      };
    }
  }

  /**
   * Notify subscribers of state changes
   * @private
   */
  notifyStateChange(previousState, newState) {
    for (const [id, subscriber] of this.subscribers) {
      try {
        if (subscriber.path) {
          const prevValue = this.getNestedValue(previousState, subscriber.path);
          const newValue = this.getNestedValue(newState, subscriber.path);
          
          if (prevValue !== newValue) {
            subscriber.callback(newValue, prevValue, subscriber.path);
          }
        } else {
          subscriber.callback(newState, previousState);
        }
      } catch (error) {
        // Route to renderer logger; avoid console in renderer
        try {
          import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
            rendererLogger.error('UIStateManager: Error in state subscriber', error?.message || error);
          });
        } catch (_) { /* no-op */ }
      }
    }

    // Emit 'state:changed' but include a minimal diff hint to aid diagnostics
    try {
      const uiPrev = previousState?.ui || {};
      const uiCurr = newState?.ui || {};
      const progressPrev = previousState?.progressData || {};
      const progressCurr = newState?.progressData || {};
      const uiChanged = JSON.stringify(uiPrev) !== JSON.stringify(uiCurr);
      const progressChanged = JSON.stringify(progressPrev) !== JSON.stringify(progressCurr);

      // If this tick originated from updateProgress, suppress generic state:changed entirely
      // to prevent ABAB with progress:updated.
      if (this._emittingProgress) {
        return;
      }

      this.eventBus?.emit('state:changed', {
        previous: previousState,
        current: newState,
        _diagnostic: { uiChanged, progressChanged }
      });
    } catch (_) {
      // fallback without diagnostics; still respect the guard
      if (this._emittingProgress) return;
      this.eventBus?.emit('state:changed', { previous: previousState, current: newState });
    }
  }

  /**
   * Load persisted state from localStorage
   * @private
   */
  loadPersistedState() {
    try {
      // Skip localStorage access in custom protocol context
      if (window.location.protocol === 'scorm-app:') {
        return;
      }
      if (typeof localStorage === 'undefined') {
        return;
      }
      const persisted = localStorage.getItem(this.persistenceKey);
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (parsed.ui) {
          this.state.ui = { ...this.state.ui, ...parsed.ui };
        }
      }
    } catch (_e) {
      // swallow to avoid console noise in renderer
    }
  }

  /**
   * Persist state to localStorage (debounced)
   * @private
   */
  debouncedPersist() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.debounceTimeout = setTimeout(() => {
      this.persistState();
    }, 1000);
  }

  /**
   * Persist state to localStorage
   * @private
   */
  persistState() {
    try {
      // Skip localStorage access in custom protocol context
      if (window.location.protocol === 'scorm-app:') {
        return;
      }
      if (typeof localStorage === 'undefined') {
        return;
      }
      // Only persist UI preferences
      const toPersist = {
        ui: {
          theme: this.state.ui.theme,
          debugPanelVisible: this.state.ui.debugPanelVisible,
          sidebarCollapsed: this.state.ui.sidebarCollapsed,
          devModeEnabled: this.state.ui.devModeEnabled
        }
      };
      localStorage.setItem(this.persistenceKey, JSON.stringify(toPersist));
    } catch (_e) {
      // swallow to avoid console noise in renderer
    }
  }

  /**
   * Get nested value from object using dot notation
   * @private
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Set nested value in object using dot notation
   * @private
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      return current[key];
    }, obj);
    
    target[lastKey] = value;
  }

  /**
   * Deep merge objects
   * @private
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Destroy the state manager and clean up
   */
  destroy() {
    this.persistState();
    this.subscribers.clear();
    
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.eventBus?.emit('state:destroyed');
  }
}

// Simplified singleton pattern to reduce complexity
class UIStateSingleton {
  constructor() {
    this.instance = null;
    this.initPromise = null;
  }

  async getInstance() {
    if (this.instance) {
      return this.instance;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initialize();
    return this.initPromise;
  }

  async initialize() {
    try {
      this.instance = new UIStateManager();
      
      // Load EventBus synchronously to avoid timing issues
      const eventBusModule = await import('./event-bus.js');
      this.instance.eventBus = eventBusModule.eventBus;
      this.instance.setupEventBusListeners();
      
      return this.instance;
    } catch (error) {
      console.error('UIStateManager: Failed to initialize:', error);
      // Return a basic instance without EventBus
      this.instance = new UIStateManager();
      return this.instance;
    }
  }
}

// Create singleton
const uiStateSingleton = new UIStateSingleton();
const uiState = uiStateSingleton.getInstance();

export { UIStateManager, uiState };