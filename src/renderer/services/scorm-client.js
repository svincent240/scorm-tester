/**
 * SCORM Client Service
 * 
 * Provides SCORM API implementation for the renderer process.
 * Handles IPC communication with main process while maintaining
 * synchronous SCORM API behavior through local caching.
 * 
 * @fileoverview SCORM API client for renderer process
 */

import { eventBus } from './event-bus.js';
import { uiState } from './ui-state.js';

/**
 * SCORM Client Class
 * 
 * Implements full SCORM 2004 4th Edition API with asynchronous IPC
 * communication and synchronous interface through local caching.
 */
class ScormClient {
  constructor() {
    this.sessionId = null;
    this.isInitialized = false;
    this.localCache = new Map();
    this.lastError = '0';
    this.apiCallQueue = [];
    this.isProcessingQueue = false;
    this.sessionTimer = null;
    
    this.setupEventListeners();
  }

  /**
   * Initialize SCORM session
   * @param {string} sessionId - Session identifier
   * @returns {string} "true" or "false"
   */
  Initialize(sessionId) {
    if (this.isInitialized) {
      this.setLastError('103'); // Already initialized
      return 'false';
    }

    if (!sessionId || typeof sessionId !== 'string') {
      this.setLastError('101'); // General exception
      return 'false';
    }

    this.sessionId = sessionId;
    this.isInitialized = true;
    this.lastError = '0';

    // Asynchronously initialize with main process
    this.asyncInitialize(sessionId);

    // Update UI state
    uiState.updateSession({
      id: sessionId,
      startTime: Date.now(),
      connected: true
    });

    this.logApiCall('Initialize', sessionId, 'true');
    eventBus.emit('scorm:initialized', { sessionId });

    return 'true';
  }

  /**
   * Terminate SCORM session
   * @param {string} parameter - Empty string parameter
   * @returns {string} "true" or "false"
   */
  Terminate(parameter) {
    if (!this.isInitialized) {
      this.setLastError('112'); // Termination before initialization
      return 'false';
    }

    if (parameter !== '') {
      this.setLastError('201'); // Invalid argument error
      return 'false';
    }

    // Commit any pending data
    this.Commit('');

    this.isInitialized = false;
    this.lastError = '0';

    // Asynchronously terminate with main process
    this.asyncTerminate();

    this.logApiCall('Terminate', parameter, 'true');
    eventBus.emit('scorm:terminated', { sessionId: this.sessionId });

    return 'true';
  }

  /**
   * Get value from SCORM data model
   * @param {string} element - Data model element
   * @returns {string} Element value
   */
  GetValue(element) {
    if (!this.isInitialized) {
      this.setLastError('122'); // Get before initialization
      return '';
    }

    if (!element || typeof element !== 'string') {
      this.setLastError('201'); // Invalid argument
      return '';
    }

    // Validate element name
    if (!this.isValidElement(element)) {
      this.setLastError('401'); // Undefined data model element
      return '';
    }

    // Return cached value immediately for synchronous behavior
    const cachedValue = this.localCache.get(element) || '';
    this.lastError = '0';

    // Asynchronously refresh from main process
    this.asyncGetValue(element);

    this.logApiCall('GetValue', element, cachedValue);
    return cachedValue;
  }

  /**
   * Set value in SCORM data model
   * @param {string} element - Data model element
   * @param {string} value - Value to set
   * @returns {string} "true" or "false"
   */
  SetValue(element, value) {
    if (!this.isInitialized) {
      this.setLastError('132'); // Set before initialization
      return 'false';
    }

    if (!element || typeof element !== 'string') {
      this.setLastError('201'); // Invalid argument
      return 'false';
    }

    if (value === null || value === undefined) {
      this.setLastError('201'); // Invalid argument
      return 'false';
    }

    // Convert to string
    value = String(value);

    // Validate element name
    if (!this.isValidElement(element)) {
      this.setLastError('401'); // Undefined data model element
      return 'false';
    }

    // Validate value format
    if (!this.isValidValue(element, value)) {
      this.setLastError('405'); // Incorrect data type
      return 'false';
    }

    // Update local cache immediately
    this.localCache.set(element, value);
    this.lastError = '0';

    // Update UI state for key elements
    this.updateUIFromElement(element, value);

    // Asynchronously send to main process
    this.asyncSetValue(element, value);

    this.logApiCall('SetValue', `${element} = ${value}`, 'true');
    eventBus.emit('scorm:dataChanged', { element, value });

    return 'true';
  }

  /**
   * Commit data to persistent store
   * @param {string} parameter - Empty string parameter
   * @returns {string} "true" or "false"
   */
  Commit(parameter) {
    if (!this.isInitialized) {
      this.setLastError('142'); // Commit before initialization
      return 'false';
    }

    if (parameter !== '') {
      this.setLastError('201'); // Invalid argument
      return 'false';
    }

    this.lastError = '0';

    // Asynchronously commit to main process
    this.asyncCommit();

    this.logApiCall('Commit', parameter, 'true');
    eventBus.emit('scorm:committed', { sessionId: this.sessionId });

    return 'true';
  }

  /**
   * Get last error code
   * @returns {string} Error code
   */
  GetLastError() {
    return this.lastError;
  }

  /**
   * Get error string for error code
   * @param {string} errorCode - Error code
   * @returns {string} Error description
   */
  GetErrorString(errorCode) {
    const errorStrings = {
      '0': 'No error',
      '101': 'General exception',
      '102': 'General initialization failure',
      '103': 'Already initialized',
      '104': 'Content instance terminated',
      '111': 'General termination failure',
      '112': 'Termination before initialization',
      '113': 'Termination after termination',
      '122': 'Retrieve data before initialization',
      '123': 'Retrieve data after termination',
      '132': 'Store data before initialization',
      '133': 'Store data after termination',
      '142': 'Commit before initialization',
      '143': 'Commit after termination',
      '201': 'Invalid argument error',
      '301': 'General get failure',
      '351': 'General set failure',
      '391': 'General commit failure',
      '401': 'Undefined data model element',
      '402': 'Unimplemented data model element',
      '403': 'Data model element value not initialized',
      '404': 'Data model element is read only',
      '405': 'Incorrect data type'
    };

    return errorStrings[errorCode] || 'Unknown error';
  }

  /**
   * Get diagnostic information for error code
   * @param {string} errorCode - Error code
   * @returns {string} Diagnostic information
   */
  GetDiagnostic(errorCode) {
    return `Diagnostic information for error ${errorCode}: ${this.GetErrorString(errorCode)}`;
  }

  /**
   * Asynchronously initialize with main process
   * @private
   */
  async asyncInitialize(sessionId) {
    try {
      const result = await window.electronAPI.scormInitialize(sessionId);
      if (result.success) {
        // Pre-populate cache with common elements
        await this.preloadCommonElements();
      } else {
        console.error('SCORM initialization failed:', result.errorCode);
      }
    } catch (error) {
      console.error('Error initializing SCORM session:', error);
    }
  }

  /**
   * Asynchronously terminate with main process
   * @private
   */
  async asyncTerminate() {
    try {
      if (this.sessionId) {
        await window.electronAPI.scormTerminate(this.sessionId);
      }
    } catch (error) {
      console.error('Error terminating SCORM session:', error);
    }
  }

  /**
   * Asynchronously get value from main process
   * @private
   */
  async asyncGetValue(element) {
    try {
      const result = await window.electronAPI.scormGetValue(this.sessionId, element);
      if (result.success) {
        this.localCache.set(element, result.value);
        this.updateUIFromElement(element, result.value);
        eventBus.emit('scorm:dataRefreshed', { element, value: result.value });
      }
    } catch (error) {
      console.error(`Error getting SCORM value for ${element}:`, error);
    }
  }

  /**
   * Asynchronously set value to main process
   * @private
   */
  async asyncSetValue(element, value) {
    try {
      const result = await window.electronAPI.scormSetValue(this.sessionId, element, value);
      if (!result.success) {
        console.warn(`Failed to set SCORM value ${element}:`, result.errorCode);
      }
    } catch (error) {
      console.error(`Error setting SCORM value ${element}:`, error);
    }
  }

  /**
   * Asynchronously commit to main process
   * @private
   */
  async asyncCommit() {
    try {
      const result = await window.electronAPI.scormCommit(this.sessionId);
      if (!result.success) {
        console.warn('Failed to commit SCORM data:', result.errorCode);
      }
    } catch (error) {
      console.error('Error committing SCORM data:', error);
    }
  }

  /**
   * Preload common SCORM elements into cache
   * @private
   */
  async preloadCommonElements() {
    const commonElements = [
      'cmi.completion_status',
      'cmi.success_status',
      'cmi.score.scaled',
      'cmi.score.raw',
      'cmi.score.min',
      'cmi.score.max',
      'cmi.progress_measure',
      'cmi.location',
      'cmi.suspend_data',
      'cmi.session_time',
      'cmi.total_time',
      'cmi.learner_id',
      'cmi.learner_name',
      'cmi.credit',
      'cmi.mode'
    ];

    for (const element of commonElements) {
      try {
        const result = await window.electronAPI.scormGetValue(this.sessionId, element);
        if (result.success) {
          this.localCache.set(element, result.value);
        }
      } catch (error) {
        // Continue with other elements
      }
    }
  }

  /**
   * Update UI state from SCORM element changes
   * @private
   */
  updateUIFromElement(element, value) {
    const progressUpdates = {};

    switch (element) {
      case 'cmi.completion_status':
        progressUpdates.completionStatus = value;
        break;
      case 'cmi.success_status':
        progressUpdates.successStatus = value;
        break;
      case 'cmi.score.raw':
        progressUpdates.scoreRaw = parseFloat(value) || null;
        break;
      case 'cmi.progress_measure':
        progressUpdates.progressMeasure = parseFloat(value) || 0;
        break;
      case 'cmi.location':
        progressUpdates.location = value;
        break;
      case 'cmi.suspend_data':
        progressUpdates.suspendData = value;
        break;
      case 'cmi.session_time':
        progressUpdates.sessionTime = value;
        break;
      case 'cmi.total_time':
        progressUpdates.totalTime = value;
        break;
    }

    if (Object.keys(progressUpdates).length > 0) {
      uiState.updateProgress(progressUpdates);
    }
  }

  /**
   * Validate SCORM element name
   * @private
   */
  isValidElement(element) {
    const validPatterns = [
      // Core CMI elements
      /^cmi\.completion_status$/,
      /^cmi\.success_status$/,
      /^cmi\.score\.(scaled|raw|min|max)$/,
      /^cmi\.progress_measure$/,
      /^cmi\.location$/,
      /^cmi\.suspend_data$/,
      /^cmi\.session_time$/,
      /^cmi\.total_time$/,
      /^cmi\.exit$/,
      /^cmi\.entry$/,
      /^cmi\.learner_id$/,
      /^cmi\.learner_name$/,
      /^cmi\.credit$/,
      /^cmi\.mode$/,
      /^cmi\.launch_data$/,
      /^cmi\.scaled_passing_score$/,
      /^cmi\.time_limit_action$/,
      /^cmi\.max_time_allowed$/,
      
      // Learner preferences
      /^cmi\.learner_preference\.(audio_level|language|delivery_speed|audio_captioning)$/,
      
      // Comments from learner
      /^cmi\.comments_from_learner\._count$/,
      /^cmi\.comments_from_learner\.\d+\.(comment|location|timestamp)$/,
      
      // Comments from LMS
      /^cmi\.comments_from_lms\._count$/,
      /^cmi\.comments_from_lms\.\d+\.(comment|location|timestamp)$/,
      
      // Interactions (expanded)
      /^cmi\.interactions\._count$/,
      /^cmi\.interactions\.\d+\.(id|type|timestamp|weighting|learner_response|result|latency|description)$/,
      /^cmi\.interactions\.\d+\.objectives\._count$/,
      /^cmi\.interactions\.\d+\.objectives\.\d+\.id$/,
      /^cmi\.interactions\.\d+\.correct_responses\._count$/,
      /^cmi\.interactions\.\d+\.correct_responses\.\d+\.pattern$/,
      
      // Objectives (expanded)
      /^cmi\.objectives\._count$/,
      /^cmi\.objectives\.\d+\.(id|description|success_status|completion_status|progress_measure)$/,
      /^cmi\.objectives\.\d+\.score\.(scaled|raw|min|max)$/,
      
      // ADL Navigation (expanded)
      /^adl\.nav\.request$/,
      /^adl\.nav\.request_valid\.(continue|previous|choice|jump|exit|exitAll|abandon|abandonAll)$/,
      
      // Additional SCORM 2004 elements that may be requested
      /^cmi\._version$/,
      /^cmi\.comments$/,
      /^cmi\.core\./,  // SCORM 1.2 compatibility
      /^cmi\.student_data\./,  // SCORM 1.2 compatibility
      /^cmi\.student_preference\./  // SCORM 1.2 compatibility
    ];

    return validPatterns.some(pattern => pattern.test(element));
  }

  /**
   * Validate SCORM element value
   * @private
   */
  isValidValue(element, value) {
    // Basic validation - could be expanded
    if (element.includes('score.scaled')) {
      const num = parseFloat(value);
      return !isNaN(num) && num >= -1 && num <= 1;
    }

    if (element === 'cmi.completion_status') {
      return ['completed', 'incomplete', 'not attempted', 'unknown'].includes(value);
    }

    if (element === 'cmi.success_status') {
      return ['passed', 'failed', 'unknown'].includes(value);
    }

    if (element === 'cmi.progress_measure') {
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0 && num <= 1;
    }

    return true; // Default to valid
  }

  /**
   * Set last error code
   * @private
   */
  setLastError(errorCode) {
    this.lastError = errorCode;
    eventBus.emit('scorm:error', { errorCode, message: this.GetErrorString(errorCode) });
  }

  /**
   * Log API call
   * @private
   */
  logApiCall(method, parameter, result) {
    const apiCall = {
      method,
      parameter,
      result,
      errorCode: this.lastError,
      timestamp: Date.now()
    };

    uiState.addApiCall(apiCall);
    
    // Emit event for debug panel
    eventBus.emit('api:call', { data: apiCall });
  }

  /**
   * Setup event listeners
   * @private
   */
  setupEventListeners() {
    // Listen for session timer updates
    this.sessionTimer = setInterval(() => {
      if (this.isInitialized && this.sessionId) {
        this.updateSessionTime();
      }
    }, 1000);
  }

  /**
   * Update session time
   * @private
   */
  updateSessionTime() {
    const sessionData = uiState.getState('currentSession');
    if (sessionData) {
      const startTime = uiState.getState('sessionStartTime');
      if (startTime) {
        const elapsed = Date.now() - startTime;
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        uiState.updateProgress({ sessionTime: timeString });
      }
    }
  }

  /**
   * Get current session ID
   * @returns {string|null} Session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Check if initialized
   * @returns {boolean} Initialization state
   */
  getInitialized() {
    return this.isInitialized;
  }

  /**
   * Get cached value
   * @param {string} element - Element name
   * @returns {string} Cached value
   */
  getCachedValue(element) {
    return this.localCache.get(element) || '';
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.localCache.clear();
    eventBus.emit('scorm:cacheCleared');
  }

  /**
   * Destroy the SCORM client
   */
  destroy() {
    if (this.isInitialized) {
      this.Terminate('');
    }
    
    // Clear the session timer
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
    
    this.clearCache();
    eventBus.emit('scorm:destroyed');
  }
}

// Create and export singleton instance
const scormClient = new ScormClient();

export { ScormClient, scormClient };