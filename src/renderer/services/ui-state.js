// @ts-check

/**
 * UI State Manager Service
 *
 * Manages application state, component coordination, and persistence
 * of UI preferences. Provides centralized state management for the renderer.
 *
 * @fileoverview UI state management service
 */


import { deepMerge, getNestedValue, setNestedValue, safeLoadPersistedUI, safePersistState } from './ui-state.helpers.js';
import { getInitialUIState } from './ui-state.initial.js';
import { showNotification, removeNotification } from './ui-state.notifications.js';
// setupDebugMirroring removed - SCORM Inspector architecture handles content analysis

/**
 * UI State Manager Class
 *
 * Centralized state management with event-driven updates and persistence.
 */
class UIStateManager {
  constructor(helpers) {
    this.helpers = helpers; // Store dynamically loaded helpers
    this.state = {}; // Initialize empty state
    this.subscribers = new Map();
    this.persistenceKey = 'scorm-tester-ui-state';
    this.debounceTimeout = null;
    this.eventBus = null; // Will be loaded dynamically
    // Reentrancy guard to prevent progress:updated <-> state:changed ABAB cycles
    this._emittingProgress = false;

    // Environment flags
    this.isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    this.loadPersistedState();
    // Event listeners that don't depend on eventBus can be set up here
    // Only attach DOM listeners when running in a browser/renderer context
    if (this.isBrowser) {
      this.setupGlobalEventListeners();
    } else {
      // Write to renderer/app log without using console (per logging rules)
      try {
        this.helpers.rendererLogger.info('UIStateManager: DOM environment not detected; global listeners disabled for non-browser context');
      } catch (_) { /* no-op */ }
    }
  }

  /**
   * Internal method to initialize the state after helpers are loaded.
   * @private
   */
  _initializeState() {
    this.state = this.getInitialState();
    this.loadPersistedState(); // Load persisted state after initial state is set
  }

  /**
   * Get initial application state
   * @returns {Object} Initial state object
   */
  getInitialState() {
    // Moved into ui-state.initial.js to reduce file size per architecture rules
    return this.helpers.getInitialUIState();
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

    return this.helpers.getNestedValue(this.state, path);
  }

  /**
   * Update state with new values
   * @param {Object|string} updates - State updates or path for single value
   * @param {*} [value] - Value when using path notation
   * @param {boolean} [silent] - Skip event emission
   */
  setState(updates, value = undefined, silent = false) {
    // Deep copy the previous state to prevent mutation issues (must be a true deep clone; tests mock deepMerge shallowly)
    const previousState = JSON.parse(JSON.stringify(this.state));

    if (typeof updates === 'string') {
      // Single value update using path notation
      this.helpers.setNestedValue(this.state, updates, value);
    } else if (typeof updates === 'object' && updates !== null) {
      // Merge object updates
      this.state = this.helpers.deepMerge(this.state, updates);
    } else {
      throw new Error('Invalid state update parameters');
    }

    if (!silent) {
      if (typeof updates === 'string') {
        // Build delta payloads for subscribers to avoid leaking unrelated fields (aligns with tests expecting minimal slices)
        const prevDelta = {};
        const newDelta = {};
        try {
          const prevVal = this.helpers.getNestedValue(previousState, updates);
          const newVal = this.helpers.getNestedValue(this.state, updates);
          this.helpers.setNestedValue(prevDelta, updates, prevVal);
          this.helpers.setNestedValue(newDelta, updates, newVal);
        } catch (_) { /* no-op */ }
        // Notify subscribers with deltas only
        this._notifySubscribers(newDelta, prevDelta);
        // Emit full state change event for EventBus consumers
        this._emitStateChanged(previousState, this.state);
        this.debouncedPersist();
      } else {
        this.notifyStateChange(previousState, this.state);
        this.debouncedPersist();
      }
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
        this.helpers.rendererLogger.debug('UIState.updateProgress: no-op (no diff); emit skipped');
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
        this.helpers.rendererLogger.debug('UIState.updateUI: no-op (no diff); emit skipped');
      } catch (_) { /* no-op */ }
      return;
    }

    // Silent update to avoid generic state:changed feedback immediately
    // notifyStateChange will still compute and emit state:changed if needed elsewhere,
    // but we guard ABAB cycles by not emitting a separate ui:updated when no consumers require it.
    // Instead, emit ui:updated only when there is a meaningful change and mark it as originating from UI to prevent loops.
    this.setState({ ui: mergedUI }, undefined, true); // silent

    // Emit generic UI update with correlation and origin flag to help EventBus cycle guard
    const uiUpdatedPayload = { ...mergedUI, _origin: 'ui-state', _corr: `ui:updated:${Date.now()}` };
    this.eventBus?.emit('ui:updated', uiUpdatedPayload);

    // Emit specific dev mode change to keep EventBus in sync (Step 8)
    const nextDev = !!mergedUI.devModeEnabled;
    if (nextDev !== prevDev) {
      try {
        // Gate EventBus debug mirroring on toggle
        this.eventBus?.setDebugMode?.(nextDev);
      } catch (_) { /* no-op */ }
      this.eventBus?.emit('ui:devModeChanged', { enabled: nextDev, _origin: 'ui-state', _corr: uiUpdatedPayload._corr });
      // Also emit a lightweight debug:update signal for panels listening
      this.eventBus?.emit('debug:update', { mode: nextDev, _origin: 'ui-state', _corr: uiUpdatedPayload._corr });
    }

    // Persist after UI update (debounced) without causing another state:changed emit
    this.debouncedPersist();
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
    this.eventBus?.emit('ui:api:call', { data: normalized });
  }

  /**
   * Show notification
   * @param {Object} notification - Notification data
   */
  showNotification(notification) {
    return this.helpers.showNotification(this, notification);
  }

  /**
   * Remove notification
   * @param {string|number} id - Notification ID
   */
  removeNotification(id) {
    return this.helpers.removeNotification(this, id);
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
    initialState.ui.sidebarVisible = this.state.ui.sidebarVisible;

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
    // Guard again in case called directly
    if (!(typeof window !== 'undefined' && typeof document !== 'undefined')) {
      try {
        this.helpers.rendererLogger.debug('UIStateManager: setupGlobalEventListeners skipped (no DOM)');
      } catch (_) { /* no-op */ }
      return;
    }

    // Listen for window visibility changes
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.hidden) {
          this.persistState();
        }
      } catch (_) { /* no-op */ }
    });

    // Listen for beforeunload to persist state
    window.addEventListener('beforeunload', () => {
      try { this.persistState(); } catch (_) { /* no-op */ }
    });
  }

  /**
   * Setup event bus listeners
   * @private
   */
  setupEventBusListeners() {
    if (!this.eventBus) {
      try {
        this.helpers.rendererLogger.warn('UIStateManager: EventBus not available for setting up listeners.');
      } catch (_) { /* no-op */ }
      return;
    }
    // Listen for state changes to emit a general event
    this.eventBus.on('state:changed', (data) => {
      // kept for consistency
    });

    // Debug mirroring removed - SCORM Inspector handles content analysis separately
    // EventBus debug mode can still be toggled via devModeEnabled UI state
  }

  /**
   * Notify subscribers of state changes
   * @private
   */
  notifyStateChange(previousState, newState) {
    // Notify subscribers with full state payloads
    this._notifySubscribers(newState, previousState);
    // Then emit EventBus signal
    this._emitStateChanged(previousState, newState);
  }

  _notifySubscribers(newState, previousState) {
    for (const [id, subscriber] of this.subscribers) {
      try {
        if (subscriber.path) {
          const prevValue = this.helpers.getNestedValue(previousState, subscriber.path);
          const newValue = this.helpers.getNestedValue(newState, subscriber.path);
          if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
            subscriber.callback(newValue, prevValue, subscriber.path);
          }
        } else {
          subscriber.callback(newState, previousState);
        }
      } catch (error) {
        try { this.helpers.rendererLogger.error('UIStateManager: Error in state subscriber', error?.message || error); } catch (_) {}
      }
    }
  }

  _emitStateChanged(previousState, newState) {
    // Emit 'state:changed' but include a minimal diff hint to aid diagnostics
    try {
      const uiPrev = previousState?.ui || {};
      const uiCurr = newState?.ui || {};
      const progressPrev = previousState?.progressData || {};
      const progressCurr = newState?.progressData || {};
      const uiChanged = JSON.stringify(uiPrev) !== JSON.stringify(uiCurr);
      const progressChanged = JSON.stringify(progressPrev) !== JSON.stringify(progressCurr);
      if (this._emittingProgress) return; // Suppress to prevent ABAB loops
      this.eventBus?.emit('state:changed', { previous: previousState, current: newState, _diagnostic: { uiChanged, progressChanged } });
    } catch (_) {
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
      const persisted = this.helpers.safeLoadPersistedUI(this.persistenceKey);
      if (persisted && persisted.ui) {
        this.state.ui = { ...this.state.ui, ...persisted.ui };
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
      // Centralized in main AppState: do not persist centralized UI prefs here
      const uiSlice = {}; // Reserved for non-centralized UI items if needed later
      this.helpers.safePersistState(this.persistenceKey, uiSlice);
    } catch (_e) {
      // swallow to avoid console noise in renderer
    }
  }

  /**
   * NOTE: Helper methods moved to ui-state.helpers.js to satisfy architecture line-count limits.
   * Importing the helpers keeps behavior identical while reducing this file size.
   */

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
      const { deepMerge, getNestedValue, setNestedValue, safeLoadPersistedUI, safePersistState } = await import('./ui-state.helpers.js');
      const { getInitialUIState } = await import('./ui-state.initial.js');
      const { showNotification, removeNotification } = await import('./ui-state.notifications.js');
      // setupDebugMirroring removed - using SCORM Inspector architecture for content analysis

      const { rendererLogger } = await import(`${window.electronAPI.rendererBaseUrl}utils/renderer-logger.js`);
      this.instance = new UIStateManager({
        deepMerge, getNestedValue, setNestedValue, safeLoadPersistedUI, safePersistState,
        getInitialUIState, showNotification, removeNotification,
        rendererLogger // Pass rendererLogger as a helper
      });

      // Load EventBus synchronously to avoid timing issues
      const eventBusModule = await import(`${window.electronAPI.rendererBaseUrl}services/event-bus.js`);
      this.instance.eventBus = eventBusModule.eventBus;
      this.instance.setupEventBusListeners();
      // Initialize the state after all helpers are loaded
      this.instance._initializeState();
      // Debug mirroring removed - SCORM Inspector handles content analysis
      // UI debugging still available via renderer-logger.js and app.log

      return this.instance;
    } catch (error) {
      let localRendererLogger = { error: () => {}, info: () => {}, debug: () => {}, warn: () => {} }; // Default no-op logger
      try {
        const { rendererLogger } = await import(`${window.electronAPI.rendererBaseUrl}utils/renderer-logger.js`);
        localRendererLogger = rendererLogger;
        localRendererLogger.error('UIStateManager: Failed to initialize:', error);
      } catch (_) { /* no-op */ }
      // Return a basic instance with at least a no-op logger
      this.instance = new UIStateManager({ rendererLogger: localRendererLogger, getInitialUIState: () => ({}), safeLoadPersistedUI: () => ({}), safePersistState: () => ({}), deepMerge: (a,b) => ({...a,...b}), getNestedValue: () => undefined, setNestedValue: () => {}, showNotification: () => {}, removeNotification: () => {} });
      this.instance._initializeState(); // Attempt to initialize state even with fallback helpers
      return this.instance;
    }
  }
}

// Create singleton
const uiStateSingleton = new UIStateSingleton();
// Do NOT auto-initialize in non-renderer or when Electron rendererBaseUrl is not available (prevents async imports during tests)
let uiState = null;
if (typeof window !== 'undefined' && window?.electronAPI?.rendererBaseUrl) {
  uiState = uiStateSingleton.getInstance();
}

export { UIStateManager, uiState, uiStateSingleton };