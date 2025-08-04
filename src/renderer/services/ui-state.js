/**
 * UI State Manager Service
 * 
 * Manages application state, component coordination, and persistence
 * of UI preferences. Provides centralized state management for the renderer.
 * 
 * @fileoverview UI state management service
 */

import { eventBus } from './event-bus.js';

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
    
    this.loadPersistedState();
    this.setupEventListeners();
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
      maxApiCallHistory: 100
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
    
    eventBus.emit('session:updated', sessionData);
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
    
    eventBus.emit('course:loaded', courseData);
  }

  /**
   * Update navigation state
   * @param {Object} navData - Navigation data
   */
  updateNavigation(navData) {
    console.log('UIState: updateNavigation called with:', navData);
    console.log('UIState: Current navigation state:', this.state.navigationState);
    
    // Check if the navigation state actually changed to prevent infinite loops
    const currentNav = this.state.navigationState;
    const hasChanged = Object.keys(navData).some(key =>
      currentNav[key] !== navData[key]
    );
    
    if (!hasChanged) {
      console.log('UIState: Navigation state unchanged, skipping update');
      return;
    }
    
    this.setState({
      navigationState: {
        ...this.state.navigationState,
        ...navData
      }
    });
    
    console.log('UIState: Emitting navigation:updated event');
    eventBus.emit('navigation:updated', navData);
  }

  /**
   * Update progress data
   * @param {Object} progressData - Progress data
   */
  updateProgress(progressData) {
    this.setState({
      progressData: {
        ...this.state.progressData,
        ...progressData
      }
    });
    
    eventBus.emit('progress:updated', progressData);
  }

  /**
   * Update UI state
   * @param {Object} uiData - UI data
   */
  updateUI(uiData) {
    this.setState({
      ui: {
        ...this.state.ui,
        ...uiData
      }
    });
    
    eventBus.emit('ui:updated', uiData);
  }

  /**
   * Add API call to history
   * @param {Object} apiCall - API call data
   */
  addApiCall(apiCall) {
    const history = [...this.state.apiCallHistory];
    history.push({
      ...apiCall,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    });
    
    // Limit history size
    if (history.length > this.state.maxApiCallHistory) {
      history.shift();
    }
    
    this.setState({ apiCallHistory: history });
    eventBus.emit('api:call', apiCall);
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
      eventBus.emit('error', errorData);
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
    
    eventBus.emit('state:reset');
  }

  /**
   * Setup event listeners
   * @private
   */
  setupEventListeners() {
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
        console.error('UIStateManager: Error in state subscriber:', error);
      }
    }
    
    eventBus.emit('state:changed', { previous: previousState, current: newState });
  }

  /**
   * Load persisted state from localStorage
   * @private
   */
  loadPersistedState() {
    try {
      // DIAGNOSTIC: Log security context and localStorage availability
      console.log('UI STATE: Loading persisted state...');
      console.log('UI STATE: Current URL:', window.location.href);
      console.log('UI STATE: Protocol:', window.location.protocol);
      
      // Skip localStorage access in custom protocol context
      if (window.location.protocol === 'scorm-app:') {
        console.log('UI STATE: Custom protocol detected, skipping localStorage access');
        return;
      }
      
      console.log('UI STATE: localStorage type:', typeof localStorage);
      console.log('UI STATE: localStorage available:', typeof localStorage !== 'undefined');
      
      // Check if localStorage is available
      if (typeof localStorage === 'undefined') {
        console.warn('UIStateManager: localStorage not available, skipping state restoration');
        return;
      }
      
      const persisted = localStorage.getItem(this.persistenceKey);
      console.log('UI STATE: Retrieved persisted data:', persisted ? 'found' : 'not found');
      
      if (persisted) {
        const parsed = JSON.parse(persisted);
        console.log('UI STATE: Parsed persisted data:', parsed);
        
        // Only restore UI preferences, not session data
        if (parsed.ui) {
          this.state.ui = { ...this.state.ui, ...parsed.ui };
          console.log('UI STATE: Successfully restored UI preferences');
        }
      }
    } catch (error) {
      console.warn('UIStateManager: Failed to load persisted state:', error);
      console.warn('UI STATE: Error details:', error.name, error.message);
      console.log('UI STATE: Continuing with default state');
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
      // DIAGNOSTIC: Log persistence attempt
      console.log('UI STATE: Attempting to persist state...');
      
      // Skip localStorage access in custom protocol context
      if (window.location.protocol === 'scorm-app:') {
        console.log('UI STATE: Custom protocol detected, skipping localStorage persistence');
        return;
      }
      
      console.log('UI STATE: localStorage type:', typeof localStorage);
      
      // Check if localStorage is available
      if (typeof localStorage === 'undefined') {
        console.warn('UIStateManager: localStorage not available, skipping state persistence');
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
      
      console.log('UI STATE: Data to persist:', toPersist);
      localStorage.setItem(this.persistenceKey, JSON.stringify(toPersist));
      console.log('UI STATE: Successfully persisted state');
    } catch (error) {
      console.warn('UIStateManager: Failed to persist state:', error);
      console.warn('UI STATE: Error details:', error.name, error.message);
      console.log('UI STATE: Continuing with in-memory state only');
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
    
    eventBus.emit('state:destroyed');
  }
}

// Create and export singleton instance
const uiState = new UIStateManager();

export { UIStateManager, uiState };