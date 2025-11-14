/**
 * SCORM 2004 4th Edition API Handler
 * 
 * Implements all 8 required SCORM API functions:
 * 1. Initialize("")
 * 2. Terminate("")
 * 3. GetValue(element)
 * 4. SetValue(element, value)
 * 5. Commit("")
 * 6. GetLastError()
 * 7. GetErrorString(errorCode)
 * 8. GetDiagnostic(errorCode)
 * 
 * Based on SCORM 2004 4th Edition RTE specification and
 * IEEE 1484.11.2 standard for API implementation.
 * 
 * @fileoverview SCORM 2004 4th Edition compliant API handler
 */

const ScormDataModel = require('./data-model');
const ScormErrorHandler = require('./error-handler');
const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');
const { COMMON_ERRORS } = require('../../../../shared/constants/error-codes');
const EventEmitter = require('events');

/**
 * SCORM API Handler Class
 * 
 * Provides the complete SCORM 2004 4th Edition API implementation
 * with full compliance to the RTE specification.
 */
class ScormApiHandler {
  /**
   * Initialize the SCORM API handler
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} logger - Logger instance
   * @param {Object} options - Configuration options
   * @param {string} options.launchMode - Launch mode ('normal', 'browse', 'review')
   * @param {boolean} options.memoryOnlyStorage - Use memory-only storage (for browse mode)
   * @param {Object} telemetryStore - SCORM Inspector telemetry store instance
   */
  constructor(sessionManager, logger, options = {}, telemetryStore = null, scormService = null) {
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.telemetryStore = telemetryStore;
    this.scormService = scormService;
    this.options = {
      strictMode: true,
      maxCommitFrequency: 10000, // Max commits per 10 seconds
      launchMode: 'normal', // Default to normal mode
      memoryOnlyStorage: false, // Default to persistent storage
      browseModeService: null, // Browse mode service reference
      ...options
    };

    // Initialize core components
    this.errorHandler = new ScormErrorHandler(logger);

    // Initialize data model with browse mode support
    const dataModelOptions = {
      launchMode: this.options.launchMode,
      memoryOnlyStorage: this.options.memoryOnlyStorage,
      changeListener: this._handleDataModelChange.bind(this),
      changeContextProvider: () => ({ sessionId: this.sessionId }),
      maxChangeValueLength: this.options.maxChangeValueLength || 4096
    };
    this.dataModel = new ScormDataModel(this.errorHandler, logger, dataModelOptions);
    this.eventEmitter = new EventEmitter();

    // API state tracking
    this.isInitialized = false;
    this.isTerminated = false;
    this.lastCommitTime = 0;
    this.commitCount = 0;

    // Session information
    this.sessionId = null;
    this.startTime = null;

    this.logger?.debug('ScormApiHandler initialized', {
      launchMode: this.options.launchMode,
      memoryOnlyStorage: this.options.memoryOnlyStorage
    });
  }

  _withDataModelContext(context, action) {
    if (this.dataModel && typeof this.dataModel.withChangeContext === 'function') {
      return this.dataModel.withChangeContext(context, action);
    }
    return action();
  }

  _setInternalDataModelValue(element, value, meta = {}) {
    if (!this.dataModel || typeof this.dataModel._setInternalValue !== 'function') {
      return false;
    }

    const context = {
      sessionId: this.sessionId,
      source: meta.source || 'internal',
      element,
      ...meta
    };

    return this._withDataModelContext(context, () => this.dataModel._setInternalValue(element, value));
  }

  _handleDataModelChange(change) {
    if (!change || !this.telemetryStore) {
      return;
    }

    const payload = {
      sessionId: this.sessionId,
      ...change
    };

    if (!payload.sessionId) {
      payload.sessionId = this.sessionId;
    }

    if (typeof payload.timestamp !== 'number') {
      payload.timestamp = Date.now();
    }

    try {
      if (typeof this.telemetryStore.storeDataModelChange === 'function') {
        this.telemetryStore.storeDataModelChange(payload);
      }
    } catch (error) {
      this.logger?.warn('ScormApiHandler: Failed to store data model change', error?.message || error);
    }
  }

  /**
   * Initialize the SCORM session (SCORM API Function 1)
   * @param {string} parameter - Must be empty string per SCORM spec
   * @returns {string} "true" if successful, "false" if error
   */
  Initialize(parameter) {
    const startTime = process.hrtime.bigint();
    let result = "false"; // Default to false
    let errorCode = COMMON_ERRORS.GENERAL_EXCEPTION;
    let errorMessage = `Initialize failed: Unknown error`;

    try {
      // Validate parameter (must be empty string)
      if (parameter !== "") {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Initialize parameter must be empty string', 'Initialize');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.NOT_INITIALIZED, 'Initialize')) {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Initialize session
      this.sessionId = this.generateSessionId();
      this.startTime = new Date();
      this.isInitialized = true;
      this.isTerminated = false;

      // Update session state
      this.errorHandler.setSessionState(SCORM_CONSTANTS.SESSION_STATES.RUNNING);

      // Initialize data model with session-specific data
      this.initializeSessionData();

      // In browse mode, check for saved location and update entry mode accordingly
      if (this.isBrowseMode() && this.options.browseModeService) {
        const lastLocation = this.options.browseModeService.getLastLocation();
        if (lastLocation && lastLocation.activityId) {
          // Update entry mode to resume since we have a saved location
          this._setInternalDataModelValue('cmi.entry', 'resume', {
            source: 'internal:browse-resume',
            reason: 'browse-mode-resume'
          });
          this.logger?.info('Browse mode: Entry mode set to resume due to saved location', {
            sessionId: this.sessionId,
            lastLocation: lastLocation.activityId
          });
        }
      }

      // Register with session manager (handle failures gracefully)
      if (this.sessionManager) {
        try {
          this.sessionManager.registerSession(this.sessionId, this);
        } catch (error) {
          this.logger?.warn('Session manager registration failed:', error.message);
          // Continue without session manager - this is not a fatal error
        }
      }

      this.logger?.info(`SCORM session initialized: ${this.sessionId}`);
      this.errorHandler.clearError();
      result = "true";
      errorCode = "0"; // No error
      errorMessage = "";
      return result;

    } catch (error) {
      this.logger?.error('Error in Initialize:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Initialize failed: ${error.message}`, 'Initialize');
      errorCode = this.errorHandler.getLastError();
      errorMessage = this.errorHandler.getErrorString(errorCode);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('Initialize', [parameter], result, errorCode, errorMessage, durationMs);
    }
  }

  /**
   * Terminate the SCORM session (SCORM API Function 2)
   * @param {string} parameter - Must be empty string per SCORM spec
   * @returns {string} "true" if successful, "false" if error
   */
  Terminate(parameter) {
    const startTime = process.hrtime.bigint();
    let result = "false"; // Default to false
    let errorCode = COMMON_ERRORS.GENERAL_EXCEPTION;
    let errorMessage = `Terminate failed: Unknown error`;

    try {
      this.logger?.debug('Terminate called with parameter:', parameter);

      // Validate parameter (must be empty string)
      if (parameter !== "") {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Terminate parameter must be empty string', 'Terminate');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'Terminate')) {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Perform final commit (but don't count it as a regular commit)
      try {
        // Get all data for final persistence without incrementing commit count
        const dataToCommit = {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          data: this.dataModel.getAllData(),
          errorState: this.errorHandler.getErrorState(),
          launchMode: this.options.launchMode,
          browseMode: this.isBrowseMode()
        };

        // Browse mode data isolation - no persistence to production data
        if (this.isBrowseMode() || this.options.memoryOnlyStorage) {
          this.logger?.debug('Browse mode termination - data not persisted to production storage', {
            sessionId: this.sessionId,
            launchMode: this.options.launchMode
          });

          // Clean up browse session data
          this.dataModel.destroyBrowseSessionData();
        } else {
          // Normal mode - persist via session manager
          if (this.sessionManager) {
            const result = this.sessionManager.persistSessionData(this.sessionId, dataToCommit);
            if (!result) {
              this.logger?.warn('Final commit failed during termination');
            }
          }
        }
      } catch (error) {
        this.logger?.warn('Final commit failed during termination:', error.message);
        // Continue with termination even if commit fails
      }

      // Calculate session time
      this.calculateSessionTime();

      // Update session state
      this.isTerminated = true;
      this.errorHandler.setSessionState(SCORM_CONSTANTS.SESSION_STATES.TERMINATED);

      // Unregister from session manager
      if (this.sessionManager && this.sessionId) {
        this.sessionManager.unregisterSession(this.sessionId);
      }

      this.logger?.info(`SCORM session terminated: ${this.sessionId}`);
      this.errorHandler.clearError();
      result = "true";
      errorCode = "0"; // No error
      errorMessage = "";
      return result;

    } catch (error) {
      this.logger?.error('Error in Terminate:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Terminate failed: ${error.message}`, 'Terminate');
      errorCode = this.errorHandler.getLastError();
      errorMessage = this.errorHandler.getErrorString(errorCode);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('Terminate', [parameter], result, errorCode, errorMessage, durationMs);
    }
  }

  /**
   * Get value from data model (SCORM API Function 3)
   * @param {string} element - Data model element name
   * @returns {string} Element value or empty string on error
   */
  GetValue(element) {
    const startTime = process.hrtime.bigint();
    let result = ""; // Default to empty string
    let errorCode = COMMON_ERRORS.GENERAL_EXCEPTION;
    let errorMessage = `GetValue failed: Unknown error`;

    try {
      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'GetValue')) {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Validate element parameter
      if (typeof element !== 'string') {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'GetValue element must be a string', 'GetValue');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Special handling for cmi.session_time (write-only, but internal read is needed)
      let value;
      if (element === 'cmi.session_time') {
        value = this.dataModel._getInternalValue(element);
      } else {
        // Get value from data model (standard external access)
        value = this.dataModel.getValue(element);
      }
      result = value;

      if (!this.errorHandler.hasError()) {
        errorCode = "0"; // No error
        errorMessage = "";
      } else {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
      }

      return result;

    } catch (error) {
      this.logger?.error('Error in GetValue:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `GetValue failed: ${error.message}`, 'GetValue');
      errorCode = this.errorHandler.getLastError();
      errorMessage = this.errorHandler.getErrorString(errorCode);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('GetValue', [element], result, errorCode, errorMessage, durationMs);
    }
  }

  /**
   * Set value in data model (SCORM API Function 4)
   * @param {string} element - Data model element name
   * @param {string} value - Value to set
   * @returns {string} "true" if successful, "false" if error
   */
  SetValue(element, value) {
    const startTime = process.hrtime.bigint();
    let result = "false"; // Default to false
    let errorCode = COMMON_ERRORS.GENERAL_EXCEPTION;
    let errorMessage = `SetValue failed: Unknown error`;

    try {
      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'SetValue')) {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Validate parameters
      if (typeof element !== 'string') {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'SetValue element must be a string', 'SetValue');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      if (typeof value !== 'string') {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'SetValue value must be a string', 'SetValue');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      const context = {
        sessionId: this.sessionId,
        source: 'api:SetValue',
        element
      };

      // Set value in data model
      const success = this._withDataModelContext(context, () => this.dataModel.setValue(element, value));

      if (success) {
        result = "true";
        errorCode = "0"; // No error
        errorMessage = "";
        // Broadcast data model update for successful SetValue
        this._broadcastDataModelUpdate();
        
        // Update activity tree state and emit progress events for course outline real-time sync
        if (element === 'cmi.completion_status' || element === 'cmi.success_status') {
          this._updateActivityTreeState(element, value);
          this._emitProgressUpdateEvent(element, value);

          // When completion or success status changes, trigger full course outline refresh
          // because completing an activity may unlock other activities via prerequisites
          if ((element === 'cmi.completion_status' && (value === 'completed' || value === 'incomplete')) ||
              (element === 'cmi.success_status' && (value === 'passed' || value === 'failed'))) {
            this._emitCourseOutlineRefreshEvent();
            // CRITICAL FIX: Refresh navigation availability after completion/success status changes
            // This ensures the UI components (course outline and navigation controls) get updated
            const activityId = this.getCurrentActivityId();
            if (activityId) {
              this._refreshNavigationAvailabilityAfterStateChange(activityId);
            }
          }
        }
        
        // Emit objective update events
        if (element.startsWith('cmi.objectives.')) {
          this._emitObjectiveUpdateEvent();
          
          // CRITICAL FIX: Objectives changes can affect navigation prerequisites
          // Refresh navigation availability when objectives are updated
          const activityId = this.getCurrentActivityId();
          if (activityId) {
            this._refreshNavigationAvailabilityAfterStateChange(activityId);
          }
        }
      } else {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
      }
      return result;

    } catch (error) {
      this.logger?.error('Error in SetValue:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `SetValue failed: ${error.message}`, 'SetValue');
      errorCode = this.errorHandler.getLastError();
      errorMessage = this.errorHandler.getErrorString(errorCode);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('SetValue', [element, value], result, errorCode, errorMessage, durationMs);
    }
  }

  /**
   * Commit data to persistent storage (SCORM API Function 5)
   * @param {string} parameter - Must be empty string per SCORM spec
   * @returns {string} "true" if successful, "false" if error
   */
  Commit(parameter) {
    const startTime = process.hrtime.bigint();
    let result = "false"; // Default to false
    let errorCode = COMMON_ERRORS.GENERAL_EXCEPTION;
    let errorMessage = `Commit failed: Unknown error`;

    try {
      // Validate parameter (must be empty string)
      if (parameter !== "") {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Commit parameter must be empty string', 'Commit');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Check session state
      if (!this.errorHandler.validateSessionState(
        SCORM_CONSTANTS.SESSION_STATES.RUNNING, 'Commit')) {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Check commit frequency (prevent spam)
      if (this.options.strictMode && !this.canCommit()) {
        this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
          'Commit called too frequently', 'Commit');
        errorMessage = this.errorHandler.getErrorString(errorCode);
        return result;
      }

      // Perform the commit
      const success = this.performCommit();

      if (success) {
        this.errorHandler.clearError();
        result = "true";
        errorCode = "0"; // No error
        errorMessage = "";
        // Broadcast data model update for successful Commit
        this._broadcastDataModelUpdate();
      } else {
        errorCode = this.errorHandler.getLastError();
        errorMessage = this.errorHandler.getErrorString(errorCode);
      }
      return result;

    } catch (error) {
      this.logger?.error('Error in Commit:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Commit failed: ${error.message}`, 'Commit');
      errorCode = this.errorHandler.getLastError();
      errorMessage = this.errorHandler.getErrorString(errorCode);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('Commit', [parameter], result, errorCode, errorMessage, durationMs);
    }
  }

  /**
   * Get last error code (SCORM API Function 6)
   * @returns {string} Last error code as string
   */
  GetLastError() {
    const startTime = process.hrtime.bigint();
    let result = "";
    let errorCode = "0"; // Default to no error
    let errorMessage = "";

    try {
      result = this.errorHandler.getLastError();
      errorCode = result; // The result of GetLastError is the errorCode
      errorMessage = this.errorHandler.getErrorString(errorCode);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('GetLastError', [], result, errorCode, errorMessage, durationMs);
    }
  }

  /**
   * Get error string for error code (SCORM API Function 7)
   * @param {string} errorCode - Error code to get string for
   * @returns {string} Error string or empty string if invalid
   */
  GetErrorString(errorCode) {
    const startTime = process.hrtime.bigint();
    let result = "";
    const eventErrorCode = errorCode; // The parameter is the error code for the event
    let errorMessage = "";

    try {
      result = this.errorHandler.getErrorString(errorCode);
      errorMessage = result; // The result is the error string for the event
      this.logger?.debug('GetErrorString for', errorCode, ':', result);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('GetErrorString', [errorCode], result, eventErrorCode, errorMessage, durationMs);
    }
  }

  /**
   * Get diagnostic information for error code (SCORM API Function 8)
   * @param {string} errorCode - Error code to get diagnostic for
   * @returns {string} Diagnostic information or empty string
   */
  GetDiagnostic(errorCode) {
    const startTime = process.hrtime.bigint();
    let result = "";
    const eventErrorCode = errorCode; // The parameter is the error code for the event
    let errorMessage = "";

    try {
      result = this.errorHandler.getDiagnostic(errorCode);
      errorMessage = result; // The result is the diagnostic message for the event
      this.logger?.debug('GetDiagnostic for', errorCode, ':', result);
      return result;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this._emitApiCallLoggedEvent('GetDiagnostic', [errorCode], result, eventErrorCode, errorMessage, durationMs);
    }
  }

  /**
   * Initialize session-specific data
   * @private
   */
  initializeSessionData() {
    // Set entry mode based on previous session state
    const entryMode = this.determineEntryMode();
    this._setInternalDataModelValue('cmi.entry', entryMode, { source: 'internal:session-init' });

    // Set credit mode (could come from launch parameters)
    this._setInternalDataModelValue('cmi.credit', 'credit', { source: 'internal:session-init' });

    // Set lesson mode using dynamic launch mode (SCORM-compliant)
    this._setInternalDataModelValue('cmi.mode', this.options.launchMode, { source: 'internal:session-init' });

    // Create browse session if in browse mode
    if (this.options.launchMode === 'browse') {
      this.dataModel.createBrowseSessionData();
    }

    // Initialize learner information if available
    if (this.sessionManager) {
      const learnerInfo = this.sessionManager.getLearnerInfo();
      if (learnerInfo) {
  this.dataModel.setLearnerInfo(learnerInfo);
      }
    }

    this.logger?.debug('Session data initialized', {
      launchMode: this.options.launchMode,
      entryMode: entryMode
    });
  }

  /**
   * Determine entry mode for the session
   * @private
   * @returns {string} Entry mode ('ab-initio' or 'resume')
   */
  determineEntryMode() {
    // In browse mode, always start fresh since data is not persisted
    if (this.isBrowseMode()) {
      this.logger?.debug('Browse mode: Always starting fresh (ab-initio) due to data isolation');
      return 'ab-initio';
    }

    // Check if there's previous suspend data
    const suspendData = this.dataModel.getValue('cmi.suspend_data');
    const completionStatus = this.dataModel.getValue('cmi.completion_status');

    if (suspendData && completionStatus !== 'completed') {
      return 'resume';
    }

    return 'ab-initio';
  }

  /**
   * Calculate and set session time
   * @private
   */
  calculateSessionTime() {
    if (this.startTime) {
      const endTime = new Date();
      const sessionDuration = endTime - this.startTime;
      
      // Convert to ISO 8601 duration format (PT[H]H[M]M[S]S)
      const hours = Math.floor(sessionDuration / (1000 * 60 * 60));
      const minutes = Math.floor((sessionDuration % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((sessionDuration % (1000 * 60)) / 1000);
      
      const sessionTime = `PT${hours}H${minutes}M${seconds}S`;
  this._setInternalDataModelValue('cmi.session_time', sessionTime, { source: 'internal:commit' });
      
      this.logger?.debug('Session time calculated:', sessionTime);
    }
  }

  /**
   * Check if commit is allowed (rate limiting)
   * @private
   * @returns {boolean} True if commit is allowed
   */
  canCommit() {
    const now = Date.now();
    const timeSinceLastCommit = now - this.lastCommitTime;
    
    // Reset counter every 10 seconds
    if (timeSinceLastCommit > 10000) {
      this.commitCount = 0;
      this.lastCommitTime = now;
    }
    
    // Allow up to maxCommitFrequency commits per 10 seconds
    return this.commitCount < this.options.maxCommitFrequency;
  }

  /**
   * Perform the actual commit operation
   * @private
   * @returns {boolean} True if successful
   */
  performCommit() {
    try {
      // Update commit tracking
      this.commitCount++;
      this.lastCommitTime = Date.now();

      // Get all data for persistence
      const dataToCommit = {
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        data: this.dataModel.getAllData(),
        errorState: this.errorHandler.getErrorState(),
        launchMode: this.options.launchMode,
        browseMode: this.isBrowseMode()
      };

      // Browse mode data isolation - no persistence to production data
      if (this.isBrowseMode() || this.options.memoryOnlyStorage) {
        this.logger?.debug('Browse mode commit - data not persisted to production storage', {
          sessionId: this.sessionId,
          launchMode: this.options.launchMode,
          dataSize: Object.keys(dataToCommit.data).length
        });

        // Store in browse session temporary data if available
        if (this.dataModel.browseSession) {
          this.dataModel.browseSession.temporaryData.set('lastCommit', dataToCommit);
          this.dataModel.browseSession.temporaryData.set('commitCount', this.commitCount);
        }

        return true; // Always succeed for browse mode
      }

      // Normal mode - persist via session manager
      if (this.sessionManager) {
        try {
          const result = this.sessionManager.persistSessionData(this.sessionId, dataToCommit);
          // Handle both sync and async results
          if (result && typeof result.then === 'function') {
            // Async result - for now return true and handle errors in background
            result.catch(error => {
              this.logger?.error('Async commit failed:', error);
              this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
                `Async commit failed: ${error.message}`, 'performCommit');
            });
            return true;
          }
          return result;
        } catch (error) {
          this.logger?.error('Sync commit failed:', error);
          this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
            `Sync commit failed: ${error.message}`, 'performCommit');
          return false;
        }
      }

      // If no session manager, just log the data
      this.logger?.info('Data committed (no persistence):', dataToCommit);
      return true;

    } catch (error) {
      this.logger?.error('Error in performCommit:', error);
      this.errorHandler.setError(COMMON_ERRORS.GENERAL_EXCEPTION,
        `Commit operation failed: ${error.message}`, 'performCommit');
      return false;
    }
  }

  /**
   * Generate unique session ID
   * @private
   * @returns {string} Unique session ID
   */
  generateSessionId() {
    return `scorm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get current API state (for debugging)
   * @returns {Object} Current API state
   */
  getApiState() {
    return {
      sessionId: this.sessionId,
      isInitialized: this.isInitialized,
      isTerminated: this.isTerminated,
      sessionState: this.errorHandler.getSessionState(),
      errorState: this.errorHandler.getErrorState(),
      startTime: this.startTime,
      commitCount: this.commitCount
    };
  }

  /**
   * Reset API to initial state
   */
  reset() {
    this.isInitialized = false;
    this.isTerminated = false;
    this.sessionId = null;
    this.startTime = null;
    this.lastCommitTime = 0;
    this.commitCount = 0;
    
    this.errorHandler.reset();
    this.dataModel.reset();
    
    this.logger?.debug('ScormApiHandler reset to initial state');
  }

  /**
   * Emits a custom event for SCORM API calls and stores in SCORM Inspector.
   * @private
   * @param {string} method - The name of the SCORM API method called.
   * @param {Array} parameters - An array of parameters passed to the method.
   * @param {string} result - The return value of the API method.
   * @param {string} errorCode - The SCORM error code.
   * @param {string} errorMessage - The corresponding error string or diagnostic message.
   * @param {number} durationMs - The time taken for the API call to execute in milliseconds.
   */
  _emitApiCallLoggedEvent(method, parameters, result, errorCode, errorMessage, durationMs) {
    const payload = {
      method,
      parameters,
      result,
      errorCode,
      errorMessage,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      durationMs: parseFloat(durationMs.toFixed(3)) // Round to 3 decimal places
    };

    // Store in SCORM Inspector telemetry store for proper classification and broadcasting
    if (this.telemetryStore && typeof this.telemetryStore.storeApiCall === 'function') {
      try {
        this.telemetryStore.storeApiCall(payload);
      } catch (error) {
        this.logger?.warn(`Failed to store API call in telemetry: ${error.message}`);
        // Continue with fallback event emission
      }
    }

    // Maintain backwards compatibility with event emitter
    this.eventEmitter.emit('scorm-api-call-logged', payload);
  }

  /**
   * Broadcast data model changes to inspector windows
   * @private
   */
  _broadcastDataModelUpdate() {
   try {
     if (this.telemetryStore && typeof this.telemetryStore.broadcastToAllWindows === 'function') {
       const dataModel = this.dataModel.getAllData();
       this.telemetryStore.broadcastToAllWindows('scorm-data-model-updated', dataModel);
     }
   } catch (error) {
     this.logger?.warn('Failed to broadcast data model update:', error.message);
   }
 }

  /**
   * Emit progress update event for course outline real-time synchronization
   * @private
   * @param {string} element - Data model element that was updated
   * @param {string} value - New value
   */
  _emitProgressUpdateEvent(element, value) {
   try {
     if (this.telemetryStore && typeof this.telemetryStore.broadcastToAllWindows === 'function') {
       // Assemble complete progress snapshot in main process per architectural spec
       // Main process is the single source of truth and should push complete state
       const progressData = {
         activityId: this.getCurrentActivityId(),
         element,
         value,
         completionStatus: this.dataModel.getValue('cmi.completion_status'),
         successStatus: this.dataModel.getValue('cmi.success_status'),
         scoreRaw: this.dataModel.getValue('cmi.score.raw'),
         progressMeasure: this.dataModel.getValue('cmi.progress_measure'),
         sessionTime: this.dataModel.getValue('cmi.session_time'),
         totalTime: this.dataModel.getValue('cmi.total_time'),
         location: this.dataModel.getValue('cmi.location'),
         suspendData: this.dataModel.getValue('cmi.suspend_data'),
         timestamp: Date.now()
       };
       this.telemetryStore.broadcastToAllWindows('activity:progress:updated', progressData);
     }
   } catch (error) {
     this.logger?.warn('Failed to emit progress update event:', error.message);
   }
 }

  /**
   * Emit objective update event for course outline real-time synchronization
   * @private
   */
  _emitObjectiveUpdateEvent() {
   try {
     if (this.telemetryStore && typeof this.telemetryStore.broadcastToAllWindows === 'function') {
       const objectiveData = {
         activityId: this.getCurrentActivityId(),
         objectives: this.dataModel.getObjectivesData(),
         timestamp: Date.now()
       };
       this.telemetryStore.broadcastToAllWindows('objectives:updated', objectiveData);
     }
   } catch (error) {
     this.logger?.warn('Failed to emit objectives update event:', error.message);
   }
 }

  /**
   * Emit course outline refresh event to trigger full prerequisite re-evaluation
   * @private
   */
  _emitCourseOutlineRefreshEvent() {
   try {
     if (this.telemetryStore && typeof this.telemetryStore.broadcastToAllWindows === 'function') {
       this.telemetryStore.broadcastToAllWindows('course-outline:refresh-required', {
         reason: 'completion_status_changed',
         timestamp: Date.now()
       });
     }
   } catch (error) {
     this.logger?.warn('Failed to emit course outline refresh event:', error.message);
   }
 }

  /**
   * Update activity tree state when SCORM data changes
   * @private
   * @param {string} element - The SCORM data element that changed
   * @param {string} value - The new value
   */
  _updateActivityTreeState(element, _value) {
    try {
      const activityId = this.getCurrentActivityId();
      if (!activityId) {
        this.logger?.warn('Cannot update activity tree state: no current activity ID');
        return;
      }

      // Get the SN service to update activity tree
      // Note: SN service access needs to be provided through constructor or other means
      // For now, we'll skip activity tree updates until proper service injection is implemented
      this.logger?.warn('Cannot update activity tree state: SN service access not available through telemetry store');

      // Activity tree updates are disabled until proper SN service injection is implemented
      // Navigation availability refresh is handled in SetValue() after this method returns
      // (see lines 385-394 and 398-407) - no need to duplicate the call here

    } catch (error) {
      this.logger?.warn('Failed to update activity tree state:', error.message);
    }
  }

  /**
   * Refresh navigation availability after activity state changes and broadcast to UI
   * This is the critical missing piece that enables navigation after completion
   */
  _refreshNavigationAvailabilityAfterStateChange(activityId) {
    try {
      const snService = this.scormService?.getSNService();
      if (!snService?.navigationHandler) {
        this.logger?.warn('Cannot refresh navigation availability: SN service not available');
        return;
      }

      // Refresh navigation availability in the SN service
      snService.refreshNavigationAvailability();

      // Get the updated sequencing state
      const sequencingState = snService.getSequencingState();
      const availableNavigation = sequencingState.availableNavigation || [];

      // Broadcast updated navigation availability to renderer components
      if (this.telemetryStore?.broadcastToAllWindows) {
        // Emit navigation:availability:updated for immediate UI refresh
        this.telemetryStore.broadcastToAllWindows('navigation:availability:updated', {
          availableNavigation,
          trigger: 'activity_state_change',
          activityId,
          timestamp: Date.now()
        });

        // NOTE: Do NOT emit navigation:completed here - it creates an event loop with CourseOutline
        // CourseOutline subscribes to navigation:completed and calls refreshScormStates()
        // which triggers objectives:updated, which triggers navigation:completed again
        // navigation:availability:updated is sufficient for UI updates
      } else {
        this.logger?.warn('Cannot broadcast navigation availability: telemetry store broadcast method not available');
      }
    } catch (error) {
      this.logger?.warn('Failed to refresh navigation availability after state change:', error.message);
    }
  }

  // ===== BROWSE MODE METHODS =====

  /**
   * Check if currently in browse mode
   * @returns {boolean} True if in browse mode
   */
  isBrowseMode() {
    return this.options.launchMode === 'browse';
  }

  /**
   * Get current launch mode
   * @returns {string} Current launch mode
   */
  getLaunchMode() {
    return this.options.launchMode;
  }

  /**
   * Switch to browse mode (SCORM-compliant)
   * @param {Object} browseOptions - Browse mode options
   * @returns {boolean} True if successful
   */
  enableBrowseMode(browseOptions = {}) {
    try {
      this.options.launchMode = 'browse';
      this.options.memoryOnlyStorage = browseOptions.memoryOnlyStorage !== false;

      // Update data model
      this.dataModel.setLaunchMode('browse');
      this.dataModel.createBrowseSessionData();

      this.logger?.info('Browse mode enabled', browseOptions);
      return true;
    } catch (error) {
      this.logger?.error('Failed to enable browse mode:', error.message);
      return false;
    }
  }

  /**
   * Switch to normal mode
   * @returns {boolean} True if successful
   */
  disableBrowseMode() {
    try {
      this.options.launchMode = 'normal';
      this.options.memoryOnlyStorage = false;

      // Clean up browse session
      this.dataModel.destroyBrowseSessionData();
      this.dataModel.setLaunchMode('normal');

      this.logger?.info('Browse mode disabled');
      return true;
    } catch (error) {
      this.logger?.error('Failed to disable browse mode:', error.message);
      return false;
    }
  }

  /**
   * Get browse mode status
   * @returns {Object} Browse mode status information
   */
  getBrowseModeStatus() {
    return {
      enabled: this.isBrowseMode(),
      launchMode: this.options.launchMode,
      memoryOnlyStorage: this.options.memoryOnlyStorage,
      sessionId: this.sessionId,
      browseSession: this.dataModel.getBrowseSessionStatus()
    };
  }

  /**
   * Get current activity ID for event emission
   * @private
   * @returns {string} Current activity ID or 'unknown'
   */
  getCurrentActivityId() {
    try {
      // For single SCO courses, use session ID as activity identifier
      return this.sessionId || 'unknown';
    } catch (error) {
      this.logger?.warn('Failed to get current activity ID:', error.message);
      return 'unknown';
    }
  }
}

module.exports = ScormApiHandler;