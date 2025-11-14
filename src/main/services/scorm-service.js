/**
 * SCORM Service Integration Layer
 * 
 * Provides unified interface for SCORM workflow coordination between
 * RTE (Phase 1), CAM (Phase 2), and SN (Phase 3) services.
 * 
 * Manages SCORM sessions, LMS profiles, workflow orchestration,
 * and cross-service state synchronization.
 * 
 * @fileoverview SCORM service integration layer for main process
 */

const EventEmitter = require('events');
const BaseService = require('./base-service');
const ScormErrorHandler = require('./scorm/rte/error-handler');
const { ScormSNService } = require('./scorm/sn/index');
const { ScormCAMService } = require('./scorm/cam/index'); // Added ScormCAMService
const BrowseModeService = require('./browse-mode-service');
const ErrorHandler = require('../../shared/utils/error-handler');
const {
  SERVICE_DEFAULTS,
  SERVICE_EVENTS
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');

/**
 * SCORM Service Integration Class
 * 
 * Orchestrates SCORM workflows and manages integration between
 * all SCORM service phases with unified session management.
 */
class ScormService extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('ScormService', errorHandler, logger, options);
    
    // Configuration
    this.config = {
      ...SERVICE_DEFAULTS.SCORM_SERVICE,
      ...options
    };
    
    // SCORM service instances
    this.rteService = null;
    this.camService = null; // Will be initialized in initializeScormServices
    this.snService = null;
    this.browseModeService = null; // Browse mode service for testing functionality
    // Per-session RTE handler instances (system-of-record for data model)
    this.rteInstances = new Map();
    
    // Session management
    this.sessions = new Map();
    this.sessionCounter = 0;
    
    // LMS profiles
    this.lmsProfiles = this.initializeLmsProfiles();
    
    // Active workflows
    this.activeWorkflows = new Map();
    this.eventEmitter = new EventEmitter(); // Add EventEmitter to ScormService
    
    // Viewport size tracking
    this.viewportSize = { width: 1366, height: 768 }; // Default desktop size
  }

  /**
   * Validate dependencies
   * @protected
   * @returns {boolean} True if dependencies are valid
   */
  validateDependencies() {
    // SCORM service requires window manager for debug window communication
    const windowManager = this.getDependency('windowManager');
    
    if (!windowManager) {
      this.logger?.error('ScormService: WindowManager dependency missing');
      return false;
    }
    
    return true;
  }

  /**
   * Initialize SCORM service
   * @protected
   */
  async doInitialize() {
    this.logger?.debug('ScormService: Starting initialization');
    
    // Initialize SCORM service components
    await this.initializeScormServices();
    
    // Set up session cleanup
    this.setupSessionCleanup();
    
    this.logger?.debug('ScormService: Initialization completed');
  }

  /**
   * Shutdown SCORM service
   * @protected
   */
  async doShutdown() {
    this.logger?.debug('ScormService: Starting shutdown');

    // Snapshot active session IDs for diagnostic visibility
    try {
      const ids = Array.from(this.sessions.keys());
      this.logger?.info(`ScormService: Active sessions at shutdown: [${ids.join(', ')}]`);
    } catch (_) { /* intentionally empty */ }

    // Terminate all active sessions (idempotent)
    for (const [sessionId] of this.sessions) {
      try {
        await this.terminate(sessionId);
      } catch (error) {
        const msg = (error && error.message) ? error.message : String(error);
        // Downgrade benign shutdown races to warn
        if (msg.includes('already terminated') || msg.includes('window destroyed') || msg.includes('webContents destroyed')) {
          this.logger?.warn(`ScormService: Benign shutdown race during terminate(${sessionId}): ${msg}`);
        } else {
          this.logger?.error(`ScormService: Failed to terminate session ${sessionId}:`, error);
        }
      }
    }

    // Shutdown SCORM services
    if (this.snService) {
      this.snService.reset();
    }

    // BUG-017 FIX: Clear session cleanup interval to prevent memory leak
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }

    this.sessions.clear();
    this.activeWorkflows.clear();

    this.logger?.debug('ScormService: Shutdown completed');
  }

  /**
   * Initialize SCORM session
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Session options
   * @param {string} options.launchMode - Launch mode ('normal', 'browse', 'review')
   * @param {boolean} options.memoryOnlyStorage - Use memory-only storage
   * @returns {Promise<Object>} Initialization result
   */
  async initializeSession(sessionId, options = {}) {
    try {
      this.logger?.info(`ScormService: Initializing SCORM session: ${sessionId}`);
      
      // Check if session already exists
      if (this.sessions.has(sessionId)) {
        return {
          success: false,
          errorCode: '103', // Already initialized
          reason: 'Session already initialized'
        };
      }
      
      // Check session limit
      if (this.sessions.size >= this.config.maxSessions) {
        return {
          success: false,
          errorCode: '101', // General exception
          reason: 'Maximum sessions exceeded'
        };
      }
      
      // Create session metadata
      const session = {
        id: sessionId,
        startTime: new Date(),
        state: 'initialized',
        apiCalls: [],
        errors: [],
        lmsProfile: null,
        lastActivity: Date.now(),
        launchMode: options.launchMode || 'normal',
        browseMode: options.launchMode === 'browse',
        memoryOnlyStorage: options.memoryOnlyStorage || false
      };
      
      this.sessions.set(sessionId, session);
      
      // Create and initialize a per-session RTE handler instance and map it
      try {
        // Lazy-require the RTE API handler class
        // eslint-disable-next-line global-require, import/no-commonjs
        const ScormApiHandler = require('./scorm/rte/api-handler');
        const sessionManager = {
          registerSession: (id, handler) => {
            // store handler reference for debugging if needed
            try { this.rteInstances.set(id, handler); } catch (_) { /* intentionally empty */ }
            return true;
          },
          unregisterSession: (id) => {
            try { this.rteInstances.delete(id); } catch (_) { /* intentionally empty */ }
          },
          persistSessionData: (id, data) => {
            // Prefer telemetryStore for persistence/inspection
            try {
              const telemetry = this.getDependency && this.getDependency('telemetryStore');
              if (telemetry && typeof telemetry.storeApiCall === 'function') {
                telemetry.storeApiCall({ type: 'rte:commit', sessionId: id, data, timestamp: Date.now() });
                return true;
              }
            } catch (e) {
              this.logger?.warn('ScormService: telemetry store persist failed', e?.message || e);
            }
            // Fallback: log and succeed
            this.logger?.info('ScormService: Persist session data (no telemetry store):', id);
            return true;
          },
          getLearnerInfo: () => {
            return { id: session.lmsProfile?.learnerId || 'unknown', name: session.lmsProfile?.learnerName || 'Learner' };
          }
        };
        
        const telemetryStore = this.getDependency('telemetryStore');

        // Configure RTE options with browse mode support
        const rteOptions = {
          strictMode: this.config.strictRteMode,
          launchMode: options.launchMode || 'normal',
          memoryOnlyStorage: options.memoryOnlyStorage || false,
          browseModeService: this.browseModeService // Pass browse mode service reference
        };

        const rte = new ScormApiHandler(sessionManager, this.logger, rteOptions, telemetryStore, this);
        // Initialize RTE session and then bind its internal session id to our session id for mapping
        try { rte.Initialize(''); } catch (_) { /* intentionally empty */ }
        // Override generated sessionId with our provided sessionId for consistency
        try { rte.sessionId = sessionId; } catch (_) { /* intentionally empty */ }
        this.rteInstances.set(sessionId, rte);
        // Subscribe to scorm-api-call-logged events from this RTE instance
        rte.eventEmitter.on('scorm-api-call-logged', (payload) => {
          this.eventEmitter.emit('scorm-api-call-logged', payload);
        });
      } catch (e) {
        this.logger?.warn('ScormService: Failed to initialize per-session RTE handler; falling back to session-local storage', e?.message || e);
      }
      
      // Set default current activity in SN service if available
      if (this.snService) {
        const snState = this.snService.getSequencingState();
        if (snState.sessionState === 'active' && !snState.currentActivity) {
          // Try to set the first available activity as current
          const treeStats = snState.activityTreeStats;
          if (treeStats && treeStats.totalActivities > 0) {
            // Navigate to the first activity to set it as current
            const navResult = await this.snService.processNavigation('start');
            if (navResult.success) {
              this.logger?.info(`ScormService: Set default current activity in SN service`);
            }
          }
        }
      }
      
      
      
      this.logger?.info(`ScormService: Session ${sessionId} initialized successfully`, {
        launchMode: options.launchMode || 'normal',
        browseMode: options.launchMode === 'browse'
      });
      this.recordOperation('initializeSession', true);

      return {
        success: true,
        errorCode: '0',
        sessionId: sessionId,
        launchMode: options.launchMode || 'normal',
        browseMode: options.launchMode === 'browse'
      };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SCORM_SESSION_MANAGEMENT_FAILED,
        `Session initialization failed: ${error.message}`,
        'ScormService.initializeSession'
      );
      
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('initializeSession', {
        sessionId,
        scormApiMethod: 'Initialize'
      }));
      
      this.recordOperation('initializeSession', false);
      
      return { success: false, errorCode: '101', reason: error.message };
    }
  }

  /**
   * Get SCORM data model value
   * @param {string} sessionId - Session identifier
   * @param {string} element - Data model element
   * @returns {Promise<Object>} Get value result
   */
  async getValue(sessionId, element) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, value: '', errorCode: '301' };
      }
      
      // Update last activity
      session.lastActivity = Date.now();
      
      // Prefer RTE instance as system-of-record if available
      const rte = this.rteInstances.get(sessionId);
      let value = '';
      let errorCode = '0';
      try {
        if (rte && typeof rte.GetValue === 'function') {
          // Delegate to RTE and use its error state
          value = rte.GetValue(element);
          if (typeof rte.GetLastError === 'function') {
            errorCode = rte.GetLastError();
          } else {
            errorCode = '0';
          }
        } else {
          // Fallback to session-local data model if present
          value = session.data ? (session.data[element] ?? '') : '';
          const hasElement = !!(session.data && Object.prototype.hasOwnProperty.call(session.data, element));
          errorCode = hasElement ? '0' : '404';
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE GetValue failed for ${element}: ${e?.message || e}`);
        value = '';
        errorCode = '101';
      }
      
      // Log API call
      this.logApiCall(session, 'GetValue', element, value, errorCode);
      
      const ok = errorCode === '0';
      this.recordOperation('getValue', ok);
      return { success: ok, value, errorCode };
      
    } catch (error) {
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('getValue', {
        sessionId,
        element,
        scormApiMethod: 'GetValue'
      }));
      
      this.recordOperation('getValue', false);
      return { success: false, value: '', errorCode: '101' };
    }
  }

  /**
   * Set SCORM data model value
   * @param {string} sessionId - Session identifier
   * @param {string} element - Data model element
   * @param {string} value - Value to set
   * @returns {Promise<Object>} Set value result
   */
  async setValue(sessionId, element, value) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, errorCode: '301' };
      }
      
      // Update last activity
      session.lastActivity = Date.now();
      
      // Prefer RTE instance as system-of-record if available
      const rte = this.rteInstances.get(sessionId);
      let success = false;
      let errorCode = '0';
      try {
        if (rte && typeof rte.SetValue === 'function') {
          const res = rte.SetValue(element, String(value));
          success = (res === 'true');
          if (typeof rte.GetLastError === 'function') {
            errorCode = rte.GetLastError();
          } else {
            errorCode = success ? '0' : '351';
          }
        } else {
          // Fallback to session-local data model
          session.data = session.data || {};
          session.data[element] = value;
          success = true;
          errorCode = '0';
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE SetValue failed for ${element}: ${e?.message || e}`);
        success = false;
        errorCode = '101';
      }
      
      // Log API call
      this.logApiCall(session, 'SetValue', element, value, errorCode);
      
      // Process special elements (ensure SN updates still happen)
      await this.processSpecialElement(session, element, value);
      
      this.recordOperation('setValue', success);
      return { success, errorCode };
      
    } catch (error) {
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('setValue', {
        sessionId,
        element,
        value,
        scormApiMethod: 'SetValue'
      }));
      
      this.recordOperation('setValue', false);
      return { success: false, errorCode: '101' };
    }
  }

  /**
   * Commit SCORM data
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Commit result
   */
  async commit(sessionId) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, errorCode: '301' };
      }
      
      // Update last activity
      session.lastActivity = Date.now();
      
      // Prefer RTE commit when available
      const rte = this.rteInstances.get(sessionId);
      let success = true;
      let errorCode = '0';
      try {
        if (rte && typeof rte.Commit === 'function') {
          const res = rte.Commit('');
          success = (res === 'true');
          if (typeof rte.GetLastError === 'function') {
            errorCode = rte.GetLastError();
          } else {
            errorCode = success ? '0' : '391';
          }
        } else {
          // Fallback: nothing to do, treat as success
          success = true;
          errorCode = '0';
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE Commit failed for session ${sessionId}: ${e?.message || e}`);
        success = false;
        errorCode = '101';
      }
      
      // Log API call with authoritative error
      this.logApiCall(session, 'Commit', '', '', errorCode);
      
      this.recordOperation('commit', success);
      return { success, errorCode };
      
    } catch (error) {
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('commit', {
        sessionId,
        scormApiMethod: 'Commit'
      }));
      
      this.recordOperation('commit', false);
      return { success: false, errorCode: '101' };
    }
  }

  /**
   * Terminate SCORM session
   * @param {string} sessionId - Session identifier
   * @param {string} exitValue - Optional exit value from renderer (cmi.exit)
   * @returns {Promise<Object>} Termination result
   */
  async terminate(sessionId, exitValue = '') {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        // Idempotent soft-ok: already removed/terminated
        this.logger?.warn(`ScormService: Terminate called for non-existent session ${sessionId} (idempotent)`);
        return { success: true, errorCode: '0', alreadyTerminated: true };
      }

      // Guard against double-terminate races
      if (session.__terminating || session.state === 'terminated') {
        this.logger?.info(`ScormService: Session ${sessionId} already terminating/terminated (idempotent)`);
        // Ensure map no longer holds terminated
        this.sessions.delete(sessionId);
        // Also cleanup associated RTE instance
        try { this.rteInstances.delete(sessionId); } catch (_) { /* intentionally empty */ }
        return { success: true, errorCode: '0', alreadyTerminated: true };
      }
      session.__terminating = true;

      // Log API call
      this.logApiCall(session, 'Terminate', '', '', '0');

      // Collect session data before termination for exit summary
      const exitData = await this.collectExitData(sessionId, exitValue);

      // Perform RTE termination if present
      let rteSuccess = true;
      try {
        const rte = this.rteInstances.get(sessionId);
        if (rte && typeof rte.Terminate === 'function') {
          const res = rte.Terminate('');
          rteSuccess = (res === 'true');
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE Terminate failed for session ${sessionId}: ${e?.message || e}`);
        rteSuccess = false;
      }

      // Process navigation request after termination (SCORM 2004 4th Edition requirement)
      await this.processNavigationRequestAfterTermination(sessionId);

      // Update session state
      const preState = session.state;
      session.state = 'terminated';
      session.endTime = new Date();

      // Emit course exit event with collected data
      this.emitCourseExitEvent(sessionId, exitData);

      // Keep session in memory for potential resume testing (don't delete immediately)
      // The session cleanup interval will remove it after timeout
      // Store exit data in session for resume functionality
      session.exitData = exitData;

      // Keep RTE instance in memory for resume (don't delete it yet)
      // It will be cleaned up when the session is explicitly cleaned up or times out
      this.logger?.info(`ScormService: Session ${sessionId} terminated (prevState=${preState}), RTE and data preserved for resume testing`);
      this.recordOperation('terminate', rteSuccess);

      return { success: rteSuccess, errorCode: '0' };
 
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error);
      // Benign shutdown races: downgrade to soft-ok
      if (msg.includes('already terminated') || msg.includes('window destroyed') || msg.includes('webContents destroyed')) {
        this.logger?.warn(`ScormService: Soft-ok terminate(${sessionId}) during shutdown/race: ${msg}`);
        // Ensure cleanup
        this.sessions.delete(sessionId);
        try { this.rteInstances.delete(sessionId); } catch (_) { /* intentionally empty */ }
        this.recordOperation('terminate', true);
        return { success: true, errorCode: '0', softOk: true };
      }
      // Preserve detailed error
      this.logger?.error(`ScormService: Terminate failed for session ${sessionId}:`, {
        message: msg,
        name: error?.name,
        code: error?.code,
        stackHead: (error?.stack ? String(error.stack).split('\n').slice(0,3) : null)
      });
      this.recordOperation('terminate', false);
      return { success: false, errorCode: '101', reason: msg };
    } finally {
      // Best-effort: clear flag if still present
      const s = this.sessions.get(sessionId);
      if (s && s.__terminating) delete s.__terminating;
    }
  }

  /**
   * Validate SCORM compliance (delegated to CAM service)
   * @param {string} manifestPath - Path to imsmanifest.xml file
   * @returns {Promise<Object>} Validation result
   */
  async validateCompliance(manifestPath) {
    try {
      this.logger?.info(`ScormService: Validating SCORM compliance for manifest: ${manifestPath}`);
      if (!this.camService) {
        throw new Error('CAM Service not initialized');
      }
      const manifestContent = require('fs').readFileSync(manifestPath, 'utf8');
      const result = await this.camService.validatePackage(manifestPath, manifestContent);
      this.recordOperation('validateCompliance', result.validation.isValid);
      return {
        valid: result.validation.isValid,
        errors: result.validation.errors.map(e => e.message),
        warnings: result.validation.warnings.map(w => w.message),
        scormVersion: result.manifest.schemaversion,
        hasValidEntry: true // This would be determined by SN service later
      };
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SCORM_VALIDATION_FAILED,
        `SCORM compliance validation failed: ${error.message}`,
        'ScormService.validateCompliance'
      );
      
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('validateCompliance', {
        manifestPath,
        scormDataValidation: true
      }));
      
      this.recordOperation('validateCompliance', false);
      return { valid: false, errors: [`Validation error: ${error.message}`], warnings: [] };
    }
  }

  /**
   * Analyze SCORM content (delegated to CAM service)
   * @param {string} manifestPath - Path to imsmanifest.xml file
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeContent(manifestPath) {
    try {
      this.logger?.info(`ScormService: Analyzing SCORM content for manifest: ${manifestPath}`);
      if (!this.camService) {
        throw new Error('CAM Service not initialized');
      }
      const manifestContent = require('fs').readFileSync(manifestPath, 'utf8');
      const result = await this.camService.analyzePackage(manifestPath, manifestContent);
      this.recordOperation('analyzeContent', true);
      return result.analysis;
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SCORM_ANALYSIS_FAILED,
        `SCORM content analysis failed: ${error.message}`,
        'ScormService.analyzeContent'
      );
      
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('analyzeContent', {
        manifestPath,
        manifestParsing: true
      }));
      
      this.recordOperation('analyzeContent', false);
      return { error: error.message };
    }
  }

  /**
   * Process SCORM manifest (delegated to CAM service)
   * @param {string} folderPath - Path to extracted SCORM package directory
   * @param {string} manifestContent - Content of imsmanifest.xml
   * @returns {Promise<Object>} Full package processing result from CAM service
   */
  async processScormManifest(folderPath, manifestContent) {
    try {
      this.logger?.info(`ScormService: Processing SCORM manifest for ${folderPath}`);
      if (!this.camService) {
        throw new Error('CAM Service not initialized');
      }
      const result = await this.camService.processPackage(folderPath, manifestContent);

      // Initialize SN service with the processed manifest if successful
      if (result.success && result.manifest && this.snService) {
        const snInitResult = await this.snService.initialize(result.manifest, { folderPath });
        if (snInitResult.success) {
          this.logger?.info(`ScormService: SN service initialized with manifest`);

          // Extract launch URL from CAM analysis
          const launchUrl = Array.isArray(result.analysis?.launchSequence) && result.analysis.launchSequence.length > 0
            ? result.analysis.launchSequence[0].href
            : null;

          if (!launchUrl) {
            this.logger?.error('ScormService: No launch URL found in CAM analysis');
            throw new Error('No launch URL found in course');
          }

          // Extract course info for the event payload
          const courseInfo = {
            title: (result.manifest?.organizations?.organizations?.[0]?.title)
                   || result.manifest?.organizations?.organization?.title
                   || result.manifest?.identifier
                   || 'Course',
            version: result.manifest?.version,
            scormVersion: result.manifest?.metadata?.schemaversion || 'Unknown',
            hasManifest: true
          };

          this.eventEmitter.emit('course:loaded', {
            folderPath,
            manifest: result.manifest,
            launchUrl,
            info: courseInfo
          });

          // Emit sn:initialized event to renderer process for course outline integration
          const windowManager = this.getDependency('windowManager');
          if (windowManager?.broadcastToAllWindows) {
            windowManager.broadcastToAllWindows('sn:initialized', {});
            this.logger?.info(`ScormService: Emitted sn:initialized event to renderer`);
          }
        } else {
          this.logger?.warn(`ScormService: SN service initialization failed: ${snInitResult.reason}`);
        }
      }
      
      this.recordOperation('processScormManifest', result.success && result.validation?.isValid);
      return { success: true, ...result };
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SCORM_MANIFEST_PROCESSING_FAILED,
        `SCORM manifest processing failed: ${error.message}`,
        'ScormService.processScormManifest'
      );
      
      // Route error through ErrorRouter for proper classification
      ErrorHandler.handleError(error, this.buildErrorContext('processScormManifest', {
        folderPath,
        manifestParsing: true
      }));
      
      this.recordOperation('processScormManifest', false);
      return { success: false, error: error.message, reason: error.message };
    }
  }
 
   /**
    * Resume a terminated session for testing
    * Creates a new session with the same data but sets cmi.entry='resume'
    * @param {string} oldSessionId - The terminated session to resume from
    * @param {Object} options - Resume options (coursePath, launchUrl, etc.)
    * @returns {Promise<Object>} Resume result with new sessionId
    */
   async resumeSession(oldSessionId, options = {}) {
     try {
       // Get the terminated session data
       const oldSession = this.sessions.get(oldSessionId);
       if (!oldSession) {
         return {
           success: false,
           errorCode: '301',
           reason: 'Original session not found (may have been cleaned up)'
         };
       }

       if (oldSession.state !== 'terminated') {
         return {
           success: false,
           errorCode: '103',
           reason: 'Can only resume from terminated sessions'
         };
       }

       // Create a new session ID for the resumed session
       const newSessionId = `session_${++this.sessionCounter}`;
       this.logger?.info(`ScormService: Resuming session ${oldSessionId} as ${newSessionId}`);

       // Create new session with same structure
       const newSession = {
         id: newSessionId,
         state: 'initialized',
         startTime: new Date(),
         lastActivity: Date.now(),
         launchMode: options.launchMode || 'normal',
         browseMode: false,
         memoryOnlyStorage: true,
         isResumed: true,
         resumedFrom: oldSessionId
       };

       this.sessions.set(newSessionId, newSession);

       // Create new RTE instance (match initializeSession pattern)
       const ScormApiHandler = require('./scorm/rte/api-handler');
       const telemetryStore = this.getDependency && this.getDependency('telemetryStore');
       const sessionManager = {
         registerSession: (id, handler) => { try { this.rteInstances.set(id, handler); } catch (_) { /* intentionally empty */ } return true; },
         unregisterSession: (id) => { try { this.rteInstances.delete(id); } catch (_) { /* intentionally empty */ } },
         persistSessionData: (id, data) => {
           try {
             const telemetry = this.getDependency && this.getDependency('telemetryStore');
             if (telemetry && typeof telemetry.storeApiCall === 'function') {
               telemetry.storeApiCall({ type: 'rte:commit', sessionId: id, data, timestamp: Date.now() });
               return true;
             }
           } catch (e) {
             this.logger?.warn('ScormService: telemetry store persist failed', e?.message || e);
           }
           this.logger?.info('ScormService: Persist session data (no telemetry store):', id);
           return true;
         },
         getLearnerInfo: () => {
           return { id: oldSession?.lmsProfile?.learnerId || 'unknown', name: oldSession?.lmsProfile?.learnerName || 'Learner' };
         }
       };
       const rteOptions = {
         launchMode: newSession.launchMode,
         memoryOnlyStorage: true,
         browseModeService: this.browseModeService
       };
       const rte = new ScormApiHandler(sessionManager, this.logger, rteOptions, telemetryStore, this);

       // Get old RTE data - try RTE instance first, then fall back to stored exitData
       const oldRte = this.rteInstances.get(oldSessionId);
       let dataToRestore = null;

       if (oldRte && typeof oldRte.dataModel?.getAllData === 'function') {
         // RTE instance still exists - get full data model
         dataToRestore = oldRte.dataModel.getAllData();
         this.logger?.info(`ScormService: Resume using RTE instance data for ${oldSessionId}`);
       } else if (oldSession?.exitData) {
         // RTE was deleted, but we have exitData from termination
         this.logger?.info(`ScormService: Resume using stored exitData for ${oldSessionId}`);
         // Convert exitData format to dataToRestore format
         dataToRestore = {
           coreData: new Map([
             ['cmi.location', oldSession.exitData.location],
             ['cmi.suspend_data', oldSession.exitData.suspendData],
             ['cmi.completion_status', oldSession.exitData.completionStatus],
             ['cmi.success_status', oldSession.exitData.successStatus],
             ['cmi.score.scaled', oldSession.exitData.scoreScaled],
             ['cmi.score.raw', oldSession.exitData.scoreRaw],
             ['cmi.score.max', oldSession.exitData.scoreMax],
             ['cmi.score.min', oldSession.exitData.scoreMin],
             ['cmi.total_time', oldSession.exitData.totalTime]
           ]),
           objectives: oldSession.exitData.objectives || []
         };
       } else {
         this.logger?.warn(`ScormService: No data available to restore for session ${oldSessionId}`);
       }

       // Restore data model values BEFORE Initialize so determineEntryMode can detect resume
       if (dataToRestore && dataToRestore.coreData) {
         this.logger?.info(`ScormService: Pre-populating data model for resume session ${newSessionId}`);

         // Pre-populate key data elements using internal method (before Initialize)
         const elementsToPrePopulate = [
           'cmi.location',
           'cmi.suspend_data',
           'cmi.completion_status',
           'cmi.success_status',
           'cmi.score.scaled',
           'cmi.score.raw',
           'cmi.score.max',
           'cmi.score.min',
           'cmi.progress_measure',
           'cmi.total_time'
         ];

         for (const element of elementsToPrePopulate) {
           const value = dataToRestore.coreData.get(element);
           if (value !== undefined && value !== null && value !== '') {
             // Use internal method to bypass validation and state checks
             if (rte.dataModel && typeof rte.dataModel._setInternalValue === 'function') {
               rte.dataModel._setInternalValue(element, String(value));
             }
           }
         }

         // Pre-populate objectives if present
         if (dataToRestore.objectives && dataToRestore.objectives.length > 0) {
           dataToRestore.objectives.forEach((obj, index) => {
             if (rte.dataModel && typeof rte.dataModel._setInternalValue === 'function') {
               if (obj.id) rte.dataModel._setInternalValue(`cmi.objectives.${index}.id`, obj.id);
               if (obj.success_status) rte.dataModel._setInternalValue(`cmi.objectives.${index}.success_status`, obj.success_status);
               if (obj.completion_status) rte.dataModel._setInternalValue(`cmi.objectives.${index}.completion_status`, obj.completion_status);
               if (obj.score_scaled !== undefined) rte.dataModel._setInternalValue(`cmi.objectives.${index}.score.scaled`, String(obj.score_scaled));
             }
           });
         }
       }

       // Initialize the new RTE (this will detect resume mode based on pre-populated data)
       const initResult = rte.Initialize('');
       try {
         this.logger?.info('ScormService: Resume Initialize result', {
           initResult,
           lastError: rte?.errorHandler?.getLastError ? rte.errorHandler.getLastError() : 'n/a',
           lastErrorString: rte?.errorHandler?.getErrorString && rte?.errorHandler?.getLastError
             ? rte.errorHandler.getErrorString(rte.errorHandler.getLastError())
             : 'n/a',
           entryMode: rte.dataModel ? rte.dataModel.getValue('cmi.entry') : 'unknown'
         });
       } catch (_) { /* intentionally empty */ }
       if (initResult !== 'true') {
         this.sessions.delete(newSessionId);
         return {
           success: false,
           errorCode: '102',
           reason: 'Failed to initialize resumed session'
         };
       }

       if (dataToRestore && dataToRestore.coreData) {
         this.logger?.info(`ScormService: Restored data model for resumed session ${newSessionId}`, {
           location: dataToRestore.coreData.get('cmi.location'),
           suspendData: dataToRestore.coreData.get('cmi.suspend_data') ? 'present' : 'empty',
           completionStatus: dataToRestore.coreData.get('cmi.completion_status')
         });
       }

       // Store the new RTE instance
       this.rteInstances.set(newSessionId, rte);

       // Update session state
       newSession.state = 'active';

       this.logger?.info(`ScormService: Session ${newSessionId} resumed from ${oldSessionId}`);

       return {
         success: true,
         sessionId: newSessionId,
         errorCode: '0',
         resumedFrom: oldSessionId
       };

     } catch (error) {
       this.logger?.error('ScormService: Resume session failed:', error);
       return {
         success: false,
         errorCode: '101',
         reason: error.message || 'Resume failed'
       };
     }
   }

   /**
    * Get session data
    * @param {string} sessionId - Session identifier
    * @returns {Object|null} Session data or null
    */
   getSessionData(sessionId) {
     return this.sessions.get(sessionId) || null;
   }

  /**
   * Reset session
   * @param {string} sessionId - Session identifier
   * @returns {boolean} True if session was reset
   */
  resetSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      // Also clean up the RTE instance if it exists
      try {
        this.rteInstances.delete(sessionId);
        this.logger?.debug(`ScormService: RTE instance deleted for session ${sessionId}`);
      } catch (_) { /* intentionally empty */ }
      this.logger?.info(`ScormService: Session ${sessionId} reset`);
      this.eventEmitter.emit('session:reset', { sessionId });
      return true;
    }
    return false;
  }

  /**
   * Get all sessions
   * @returns {Array} Array of all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * Apply LMS profile
   * @param {string} sessionId - Session identifier
   * @param {string} profileName - Profile name
   * @returns {Object} Application result
   */
  applyLmsProfile(sessionId, profileName) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      
      const profile = this.lmsProfiles[profileName] || this.lmsProfiles.generic;
      
      // Apply profile settings
      const dataSettings = Object.keys(profile.settings)
        .filter(key => !['strictValidation', 'maxSuspendDataLength', 'commitOnEverySet'].includes(key))
        .reduce((obj, key) => {
          obj[key] = profile.settings[key];
          return obj;
        }, {});
      
      Object.assign(session.data, dataSettings);
      session.lmsProfile = profile;
      
      
      
      this.logger?.info(`ScormService: Applied LMS profile ${profile.name} to session ${sessionId}`);
      this.recordOperation('applyLmsProfile', true);
      
      return { success: true, profile: profile.name };
      
    } catch (error) {
      this.logger?.error('ScormService: Apply LMS profile failed:', error);
      this.recordOperation('applyLmsProfile', false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get available LMS profiles
   * @returns {Array} Array of LMS profiles
   */
  getLmsProfiles() {
    return Object.keys(this.lmsProfiles).map(key => ({
      id: key,
      name: this.lmsProfiles[key].name,
      settings: this.lmsProfiles[key].settings
    }));
  }

  /**
   * Run test scenario
   * @param {string} sessionId - Session identifier
   * @param {string} scenarioType - Scenario type
   * @returns {Promise<Object>} Scenario result
   */
  async runTestScenario(sessionId, scenarioType) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      
      const scenarios = {
        'quick-completion': async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          session.data['cmi.core.lesson_status'] = 'completed';
          session.data['cmi.core.score.raw'] = '85';
          session.data['cmi.core.session_time'] = '0000:05:30.00';
          return 'Course completed with 85% score in 5:30';
        },
        
        'suspend-resume': async () => {
          session.data['cmi.core.exit'] = 'suspend';
          session.data['cmi.suspend_data'] = 'lesson_3,question_5,attempt_2';
          session.data['cmi.core.lesson_location'] = 'page_3';
          await new Promise(resolve => setTimeout(resolve, 2000));
          session.data['cmi.core.entry'] = 'resume';
          return 'Suspended at page 3, then resumed successfully';
        }
      };
      
      if (scenarios[scenarioType]) {
        const result = await scenarios[scenarioType]();
        
        // Log scenario
        this.logApiCall(session, 'TestScenario', scenarioType, result, '0');
        
        
        
        this.recordOperation('runTestScenario', true);
        return { success: true, result };
      }
      
      return { success: false, error: 'Unknown scenario type' };
      
    } catch (error) {
      this.logger?.error('ScormService: Test scenario failed:', error);
      this.recordOperation('runTestScenario', false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Initialize SCORM service components
   * @private
   */
  async initializeScormServices() {
    // Initialize CAM service
    this.camService = new ScormCAMService(this.errorHandler, this.logger);

    // Initialize Browse Mode service for testing functionality (before SN service)
    this.browseModeService = new BrowseModeService(this.logger, {
      defaultTimeout: this.config.browseModeTimeout || (30 * 60 * 1000), // 30 minutes
      maxSessions: this.config.maxBrowseSessions || 10,
      scormService: this // Pass reference to SCORM service for navigation refresh
    });

    // Initialize SN service for sequencing support with browse mode integration
    this.snService = new ScormSNService(this.errorHandler, this.logger, {
      enableGlobalObjectives: this.config.enableGlobalObjectives,
      enableRollupProcessing: this.config.enableRollupProcessing,
      maxSequencingDepth: this.config.maxSequencingDepth
    }, this.browseModeService, this); // Pass reference to ScormService for IPC access

    // Set up browse mode event handlers
    this.browseModeService.on('browse-mode-enabled', (data) => {
      this.logger?.info('Browse mode enabled', data);
      this.eventEmitter.emit('browse-mode-enabled', data);
    });

    this.browseModeService.on('browse-mode-disabled', (data) => {
      this.logger?.info('Browse mode disabled', data);
      this.eventEmitter.emit('browse-mode-disabled', data);
    });

    this.logger?.debug('ScormService: SCORM service components initialized');
  }

  /**
   * Initialize LMS profiles
   * @private
   * @returns {Object} LMS profiles configuration
   */
  initializeLmsProfiles() {
    return {
      litmos: {
        name: 'Litmos LMS',
        settings: {
          'cmi.core.student_name': 'Test Learner',
          'cmi.core.student_id': 'learner123',
          'cmi.launch_data': '',
          'cmi.core.lesson_mode': 'normal',
          strictValidation: true,
          maxSuspendDataLength: 4096,
          commitOnEverySet: true
        }
      },
      moodle: {
        name: 'Moodle',
        settings: {
          'cmi.core.student_name': 'Test User',
          'cmi.core.student_id': 'user123',
          'cmi.launch_data': '',
          'cmi.core.lesson_mode': 'normal',
          strictValidation: false,
          maxSuspendDataLength: 65536,
          commitOnEverySet: false
        }
      },
      scormcloud: {
        name: 'SCORM Cloud',
        settings: {
          'cmi.core.student_name': 'Test Student',
          'cmi.core.student_id': 'student_001',
          'cmi.launch_data': '',
          'cmi.core.lesson_mode': 'normal',
          strictValidation: true,
          maxSuspendDataLength: 65536,
          commitOnEverySet: false
        }
      },
      generic: {
        name: 'Generic LMS',
        settings: {
          'cmi.core.student_name': 'Test User',
          'cmi.core.student_id': 'test_001',
          'cmi.launch_data': '',
          'cmi.core.lesson_mode': 'normal',
          strictValidation: true,
          maxSuspendDataLength: 4096,
          commitOnEverySet: false
        }
      }
    };
  }

  /**
   * Log API call
   * @private
   * @param {Object} session - Session object
   * @param {string} method - API method
   * @param {string} parameter - Parameter
   * @param {string} value - Value
   * @param {string} errorCode - Error code
   */
  logApiCall(session, method, parameter, value, errorCode) {
    const logEntry = {
      timestamp: Date.now(),
      method,
      parameter,
      value,
      errorCode
    };
    
    // Keep session-local trace for quick inspection
    try {
      session.apiCalls.push(logEntry);
    } catch (_) {
      // ignore push failures to avoid breaking API paths
    }
    
    // Publish to telemetry store when available (preferred)
    try {
      const telemetryStore = this.getDependency && this.getDependency('telemetryStore');
      if (telemetryStore && typeof telemetryStore.storeApiCall === 'function') {
        telemetryStore.storeApiCall({
          type: 'api:call',
          sessionId: session.id,
          method,
          parameter,
          value,
          errorCode,
          timestamp: logEntry.timestamp
        });
        return;
      }
    } catch (e) {
      this.logger?.warn('ScormService: telemetryStore.storeApiCall failed, falling back to direct notify', e?.message || e);
    }
    
    // Fallback: directly notify debug window (legacy behavior)
    try {
      this.notifyDebugWindow('api-call', {
        sessionId: session.id,
        method,
        parameter,
        value,
        errorCode,
        timestamp: logEntry.timestamp
      });
    } catch (_) {
      // swallow to avoid breaking runtime
    }
  }

  /**
   * Process special data model elements
   * @private
   * @param {Object} session - Session object
   * @param {string} element - Element name
   * @param {string} value - Element value
   */
  async processSpecialElement(session, element, value) {
    // Handle special elements like completion status, score, etc.
    if (this.snService) {
      const currentActivityId = this.snService.getSequencingState().currentActivity?.identifier;

      if (currentActivityId) {
        const progressData = {};
        switch (element) {
          case 'cmi.completion_status':
            progressData.completed = (value === 'completed');
            break;
          case 'cmi.success_status':
            progressData.satisfied = (value === 'passed');
            break;
          case 'cmi.progress_measure':
            progressData.measure = parseFloat(value);
            break;
          case 'cmi.score.raw':
            // Assuming raw score can influence satisfaction, or is just reported
            // For now, just report, more complex logic would be in SN's rollup
            break;
          case 'cmi.location':
            // Update activity location in SN service
            this.snService.updateActivityLocation(currentActivityId, value);
            break;
          case 'cmi.exit':
            // Handle activity exit in SN service
            this.snService.handleActivityExit(currentActivityId, value);
            break;
          // Add other relevant CMI elements that affect SN
        }

        if (Object.keys(progressData).length > 0) {
          this.logger?.debug(`ScormService: Updating SN activity progress for ${currentActivityId} with ${element}=${value}`);
          const snUpdateResult = this.snService.updateActivityProgress(currentActivityId, progressData);
          if (!snUpdateResult.success) {
            this.logger?.warn(`ScormService: SN activity progress update failed: ${snUpdateResult.reason}`);
          }
        }
      } else {
        this.logger?.warn(`ScormService: No current activity found in SN service to update for element: ${element}`);
      }
    }
  }

  

  /**
   * Get SN service instance
   * @returns {ScormSNService|null} SN service instance or null if not available
   */
  getSNService() {
    return this.snService;
  }

  /**
   * Setup session cleanup
   * @private
   */
  setupSessionCleanup() {
    this.sessionCleanupInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.sessionTimeout;

      for (const [sessionId, session] of this.sessions) {
        if (now - session.lastActivity > timeout) {
          this.logger?.info(`ScormService: Cleaning up inactive session: ${sessionId}`);
          this.sessions.delete(sessionId);
          // Also clean up the RTE instance
          try {
            this.rteInstances.delete(sessionId);
            this.logger?.debug(`ScormService: RTE instance deleted for inactive session ${sessionId}`);
          } catch (_) { /* intentionally empty */ }
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Build context for ErrorRouter classification
   * @private
   * @param {string} operation - The operation that failed
   * @param {Object} additionalContext - Additional context information
   * @returns {Object} Context object for ErrorRouter
   */
  buildErrorContext(operation, additionalContext = {}) {
    const baseContext = {
      logger: this.logger,
      scormInspectorStore: this.getDependency('telemetryStore'),
      component: 'ScormService',
      operation,
      ...additionalContext
    };

    // Add operation-specific context clues for classification
    if (operation.includes('ApiCall') || operation.includes('GetValue') || operation.includes('SetValue') || operation.includes('Commit')) {
      baseContext.scormApiMethod = operation;
    }

    if (operation.includes('manifest') || operation.includes('Manifest')) {
      baseContext.manifestParsing = true;
    }

    if (operation.includes('validation') || operation.includes('Validation')) {
      baseContext.scormDataValidation = true;
    }

    if (operation.includes('sequencing') || operation.includes('Sequencing')) {
      baseContext.scormSequencing = true;
    }

    return baseContext;
  }

  /**
   * Subscribe to SCORM API call logged events from ScormService.
   * @param {Function} callback - The callback function to be called when an event is emitted.
   */
  onScormApiCallLogged(callback) {
    this.eventEmitter.on('scorm-api-call-logged', callback);
  }

  /**
   * Collect session data for exit summary
   * @private
   * @param {string} sessionId - Session identifier
   * @param {string} exitValueFromRenderer - Optional exit value from renderer (cmi.exit)
   * @returns {Promise<Object>} Exit data object
   */
  async collectExitData(sessionId, exitValueFromRenderer = '') {
    try {
      const session = this.sessions.get(sessionId);
      const rte = this.rteInstances.get(sessionId);

      // Get all data from RTE if available
      let allData = null;
      if (rte && typeof rte.dataModel?.getAllData === 'function') {
        allData = rte.dataModel.getAllData();
      }

      // Extract key values
      const completionStatus = await this.getValue(sessionId, 'cmi.completion_status');
      const successStatus = await this.getValue(sessionId, 'cmi.success_status');
      const scoreRaw = await this.getValue(sessionId, 'cmi.score.raw');
      const scoreScaled = await this.getValue(sessionId, 'cmi.score.scaled');
      const scoreMin = await this.getValue(sessionId, 'cmi.score.min');
      const scoreMax = await this.getValue(sessionId, 'cmi.score.max');
      const sessionTime = await this.getValue(sessionId, 'cmi.session_time');
      const totalTime = await this.getValue(sessionId, 'cmi.total_time');
      const location = await this.getValue(sessionId, 'cmi.location');
      const suspendData = await this.getValue(sessionId, 'cmi.suspend_data');
      // cmi.exit is write-only, so we use the value from renderer if provided, otherwise try _getInternalValue
      const exitType = exitValueFromRenderer ||
        ((rte && rte.dataModel && typeof rte.dataModel._getInternalValue === 'function')
          ? rte.dataModel._getInternalValue('cmi.exit')
          : '');
      // Do NOT read 'adl.nav.request' here — it is write-only per SCORM 2004 and causes 408 errors.
      // The exit summary does not require the current navigation request; default to '_none_'.
      const navRequest = { value: '_none_' };

      // Get course info from session
      const courseInfo = session?.courseInfo || null;

      return {
        sessionId,
        courseTitle: courseInfo?.title || 'SCORM Course',
        completionStatus: completionStatus.value || 'unknown',
        successStatus: successStatus.value || 'unknown',
        scoreRaw: scoreRaw.value ? parseFloat(scoreRaw.value) : null,
        scoreScaled: scoreScaled.value ? parseFloat(scoreScaled.value) : null,
        scoreMin: scoreMin.value ? parseFloat(scoreMin.value) : null,
        scoreMax: scoreMax.value ? parseFloat(scoreMax.value) : null,
        sessionTime: sessionTime.value || 'PT0H0M0S',
        totalTime: totalTime.value || 'PT0H0M0S',
        location: location.value || '',
        suspendData: suspendData.value || '',
        exitType: (typeof exitType === 'string' ? exitType : (exitType?.value || '')),
        navigationRequest: navRequest.value || '_none_',
        objectives: allData?.objectives || [],
        startTime: session?.startTime || null,
        endTime: new Date()
      };
    } catch (error) {
      this.logger?.error(`ScormService: Error collecting exit data for session ${sessionId}:`, error);
      return {
        sessionId,
        courseTitle: 'SCORM Course',
        completionStatus: 'unknown',
        successStatus: 'unknown',
        error: error.message
      };
    }
  }

  /**
   * Emit course exit event to renderer
   * @private
   * @param {string} sessionId - Session identifier
   * @param {Object} exitData - Exit data object
   */
  emitCourseExitEvent(sessionId, exitData) {
    try {
      this.logger?.info(`ScormService: Emitting course:exited event for session ${sessionId}`, {
        completionStatus: exitData.completionStatus,
        successStatus: exitData.successStatus,
        exitType: exitData.exitType,
        navigationRequest: exitData.navigationRequest
      });

      // Emit to renderer via windowManager
      const windowManager = this.getDependency('windowManager');
      if (windowManager?.broadcastToAllWindows) {
        windowManager.broadcastToAllWindows('course:exited', exitData);
      } else {
        this.logger?.warn('ScormService: WindowManager not available for course:exited event');
      }
    } catch (error) {
      this.logger?.error(`ScormService: Error emitting course exit event for session ${sessionId}:`, error);
    }
  }

  /**
   * Process navigation request after SCO termination (SCORM 2004 4th Edition requirement)
   * @private
   * @param {string} sessionId - Session identifier
   * @returns {Promise<void>}
   */
  async processNavigationRequestAfterTermination(sessionId) {
    try {
      // Get the navigation request value without violating SCORM write-only constraints.
      // adl.nav.request is write-only to content; use RTE internal value instead of GetValue.
      let navRequest = '_none_';
      try {
        const rte = this.rteInstances.get(sessionId);
        if (rte && rte.dataModel && typeof rte.dataModel._getInternalValue === 'function') {
          const v = rte.dataModel._getInternalValue('adl.nav.request');
          navRequest = (typeof v === 'string') ? v : (v?.value ?? '_none_');
        }
      } catch (_) { /* keep default */ }

      // If no navigation request was set (default '_none_'), do nothing
      if (!navRequest || navRequest === '_none_') {
        this.logger?.debug(`ScormService: No navigation request set for session ${sessionId}`);
        return;
      }

      this.logger?.info(`ScormService: Processing navigation request '${navRequest}' after termination for session ${sessionId}`);

      // Process the navigation request
      const navResult = await this.processNavigationRequest(sessionId, navRequest);

      if (navResult.success) {
        this.logger?.info(`ScormService: Navigation request '${navRequest}' processed successfully for session ${sessionId}`);
      } else {
        this.logger?.warn(`ScormService: Navigation request '${navRequest}' failed for session ${sessionId}: ${navResult.reason}`);
      }

    } catch (error) {
      this.logger?.error(`ScormService: Error processing navigation request after termination for session ${sessionId}:`, error);
    }
  }

  /**
   * Process a specific navigation request
   * @private
   * @param {string} sessionId - Session identifier
   * @param {string} navRequest - Navigation request value
   * @returns {Promise<Object>} Navigation processing result
   */
  async processNavigationRequest(sessionId, navRequest) {
    try {
      // Validate the navigation request
      const validRequests = ['continue', 'previous', 'choice', 'exit', 'exitAll', 'abandon', 'abandonAll', 'suspendAll'];
      if (!validRequests.includes(navRequest)) {
        return {
          success: false,
          reason: `Invalid navigation request: ${navRequest}`
        };
      }

      // Check if SN service is available
      if (!this.snService) {
        this.logger?.warn(`ScormService: SN service not available for navigation request processing`);
        return {
          success: false,
          reason: 'SN service not available'
        };
      }

      // Get current sequencing state to validate navigation availability
      const sequencingState = this.snService.getSequencingState();

      // Process based on navigation request type
      switch (navRequest) {
        case 'continue':
          // Check if continue is available
          if (!sequencingState.availableNavigation?.continue) {
            this.logger?.debug(`ScormService: Continue navigation not available for session ${sessionId}`);
            return {
              success: true, // Not an error, just no action needed
              reason: 'Continue navigation not available (expected for single SCO courses)'
            };
          }
          const continueResult = await this.snService.processNavigation('continue');
          if (continueResult.success) {
            // Emit navigation:completed event to renderer for course outline updates
            const windowManager = this.getDependency('windowManager');
            if (windowManager?.broadcastToAllWindows) {
              windowManager.broadcastToAllWindows('navigation:completed', { 
                activityId: continueResult.targetActivity?.identifier,
                navigationRequest: 'continue',
                result: continueResult 
              });
            }
          }
          return continueResult;

        case 'previous':
          // Check if previous is available
          if (!sequencingState.availableNavigation?.previous) {
            this.logger?.debug(`ScormService: Previous navigation not available for session ${sessionId}`);
            return {
              success: true, // Not an error, just no action needed
              reason: 'Previous navigation not available'
            };
          }
          const previousResult = await this.snService.processNavigation('previous');
          if (previousResult.success) {
            // Emit navigation:completed event to renderer for course outline updates
            const windowManager = this.getDependency('windowManager');
            if (windowManager?.broadcastToAllWindows) {
              windowManager.broadcastToAllWindows('navigation:completed', { 
                activityId: previousResult.targetActivity?.identifier,
                navigationRequest: 'previous',
                result: previousResult 
              });
            }
          }
          return previousResult;

        case 'exit':
          // Exit current activity (for single SCO, this is equivalent to exitAll)
          this.logger?.info(`ScormService: Processing exit navigation request for session ${sessionId}`);
          return this.snService.terminateSequencing();

        case 'exitAll':
          // Exit the entire course
          this.logger?.info(`ScormService: Processing exitAll navigation request for session ${sessionId}`);
          return this.snService.terminateSequencing();

        case 'suspendAll':
          // Suspend all activities
          this.logger?.info(`ScormService: Processing suspendAll navigation request for session ${sessionId}`);
          // For single SCO courses, suspend is handled by the SCO setting cmi.exit = 'suspend'
          // The LMS should preserve the session state for resumption
          return {
            success: true,
            reason: 'SuspendAll processed (session state preserved for single SCO course)'
          };

        case 'abandon':
        case 'abandonAll':
          // Abandon the course/session
          this.logger?.info(`ScormService: Processing ${navRequest} navigation request for session ${sessionId}`);
          return this.snService.terminateSequencing();

        default:
          return {
            success: false,
            reason: `Unsupported navigation request: ${navRequest}`
          };
      }

    } catch (error) {
      this.logger?.error(`ScormService: Error processing navigation request '${navRequest}' for session ${sessionId}:`, error);
      return {
        success: false,
        reason: `Navigation processing error: ${error.message}`
      };
    }
  }

  /**
   * Get current data model from the active session
   * @returns {Object} Current data model or empty object if no active session
   */
  getCurrentDataModel() {
    try {
      // Get the most recent/active session
      const sessions = this.getAllSessions();
      this.logger?.debug(`getCurrentDataModel: Found ${sessions ? sessions.length : 0} sessions`);

      if (!sessions || sessions.length === 0) {
        this.logger?.debug('getCurrentDataModel: No sessions available, returning empty object');
        return {};
      }

      // BUG FIX: Session object has 'id' property, not 'sessionId'
      // Find the most recently used session using correct property name
      const mostRecentSession = sessions.reduce((latest, current) => {
        const latestTime = latest.lastActivity || 0;
        const currentTime = current.lastActivity || 0;
        return currentTime > latestTime ? current : latest;
      });

      this.logger?.debug(`getCurrentDataModel: Most recent session ID: ${mostRecentSession?.id || 'unknown'}`);

      // Get RTE instance from this.rteInstances.get(sessionId) - correct access pattern
      const sessionId = mostRecentSession?.id;
      if (sessionId) {
        const rte = this.rteInstances.get(sessionId);
        
        if (rte && rte.dataModel && typeof rte.dataModel.getAllData === 'function') {
          const dataModel = rte.dataModel.getAllData();
          this.logger?.debug(`getCurrentDataModel: Retrieved data model with ${Object.keys(dataModel.coreData || {}).length} core data items`);
          
          // Add null safety checks and SCORM 2004 compliance validation
          if (dataModel && typeof dataModel === 'object') {
            // Ensure all 15 required SCORM 2004 data elements are present
            const requiredElements = [
              'cmi.completion_status', 'cmi.completion_threshold', 'cmi.credit',
              'cmi.entry', 'cmi.exit', 'cmi.launch_data', 'cmi.learner_id',
              'cmi.learner_name', 'cmi.location', 'cmi.max_time_allowed',
              'cmi.mode', 'cmi.progress_measure', 'cmi.scaled_passing_score',
              'cmi.session_time', 'cmi.success_status'
            ];
            
            // Log any missing elements for debugging
            const missingElements = requiredElements.filter(element => 
              !(dataModel.coreData && dataModel.coreData[element] !== undefined)
            );
            if (missingElements.length > 0) {
              this.logger?.debug(`getCurrentDataModel: Missing SCORM elements: ${missingElements.join(', ')}`);
            }
          }
          
          return dataModel;
        } else {
          this.logger?.debug(`getCurrentDataModel: No valid RTE instance found for session ${sessionId}`);
        }
      } else {
        this.logger?.debug('getCurrentDataModel: No valid session ID found');
      }
      
      return {};
    } catch (error) {
      this.logger?.error('Error getting current data model:', error);
      return {};
    }
  }

  // ===== BROWSE MODE METHODS =====

  /**
   * Enable browse mode
   * @param {Object} options - Browse mode options
   * @returns {Promise<Object>} Result with session information
   */
  async enableBrowseMode(options = {}) {
    try {
      if (!this.browseModeService) {
        return {
          success: false,
          error: 'Browse mode service not initialized'
        };
      }

      const result = await this.browseModeService.enableBrowseMode(options);

      if (result.success) {
        this.logger?.info('Browse mode enabled via ScormService', {
          sessionId: result.session?.id,
          options
        });
      }

      return result;
    } catch (error) {
      this.logger?.error('Failed to enable browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Disable browse mode
   * @returns {Promise<Object>} Result of disable operation
   */
  async disableBrowseMode() {
    try {
      if (!this.browseModeService) {
        return {
          success: false,
          error: 'Browse mode service not initialized'
        };
      }

      const result = await this.browseModeService.disableBrowseMode();

      if (result.success) {
        this.logger?.info('Browse mode disabled via ScormService', {
          sessionId: result.sessionId
        });
      }

      return result;
    } catch (error) {
      this.logger?.error('Failed to disable browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get browse mode status
   * @returns {Object} Browse mode status information
   */
  getBrowseModeStatus() {
    if (!this.browseModeService) {
      return {
        enabled: false,
        error: 'Browse mode service not initialized'
      };
    }

    return this.browseModeService.getBrowseModeStatus();
  }

  /**
   * Check if browse mode is enabled
   * @returns {boolean} True if browse mode is enabled
   */
  isBrowseModeEnabled() {
    return this.browseModeService?.isBrowseModeEnabled() || false;
  }

  /**
   * Create SCORM session with browse mode support
   * @param {Object} options - Session options
   * @param {string} options.launchMode - Launch mode ('normal', 'browse', 'review')
   * @param {boolean} options.memoryOnlyStorage - Use memory-only storage
   * @returns {Promise<Object>} Session creation result
   */
  async createSessionWithBrowseMode(options = {}) {
    try {
      // BUG-008 FIX: Use correct method name - initializeSession instead of createSession
      const sessionId = this.generateSessionId();
      const sessionResult = await this.initializeSession(sessionId, options);

      if (!sessionResult.success) {
        return sessionResult;
      }


      // If browse mode requested, configure the RTE instance
      if (options.launchMode === 'browse') {
        const rte = this.rteInstances.get(sessionId);
        if (rte && typeof rte.enableBrowseMode === 'function') {
          const browseResult = rte.enableBrowseMode({
            memoryOnlyStorage: options.memoryOnlyStorage !== false
          });

          if (!browseResult) {
            this.logger?.warn('Failed to enable browse mode for RTE instance');
          }
        }
      }

      return {
        ...sessionResult,
        launchMode: options.launchMode || 'normal',
        browseMode: options.launchMode === 'browse'
      };

    } catch (error) {
      this.logger?.error('Failed to create session with browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Set viewport size for content window
   * @param {Object} size - Viewport size
   * @param {number} size.width - Width in pixels
   * @param {number} size.height - Height in pixels
   * @returns {Object} Result of operation
   */
  setViewportSize(size) {
    try {
      if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') {
        return {
          success: false,
          error: 'Invalid viewport size'
        };
      }

      this.viewportSize = { width: size.width, height: size.height };
      
      // Broadcast to all windows
      const windowManager = this.getDependency('windowManager');
      if (windowManager?.broadcastToAllWindows) {
        windowManager.broadcastToAllWindows('viewport:size-changed', this.viewportSize);
      }

      this.logger?.info('Viewport size updated', this.viewportSize);
      
      return {
        success: true,
        size: this.viewportSize
      };
    } catch (error) {
      this.logger?.error('Failed to set viewport size:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current viewport size
   * @returns {Object} Current viewport size
   */
  getViewportSize() {
    return { ...this.viewportSize };
  }
}

module.exports = ScormService;
