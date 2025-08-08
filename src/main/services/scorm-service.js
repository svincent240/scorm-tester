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

const BaseService = require('./base-service');
const ScormErrorHandler = require('./scorm/rte/error-handler');
const { ScormSNService } = require('./scorm/sn/index');
const { ScormCAMService } = require('./scorm/cam/index'); // Added ScormCAMService
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
    // Per-session RTE handler instances (system-of-record for data model)
    this.rteInstances = new Map();
    
    // Session management
    this.sessions = new Map();
    this.sessionCounter = 0;
    
    // LMS profiles
    this.lmsProfiles = this.initializeLmsProfiles();
    
    // Active workflows
    this.activeWorkflows = new Map();
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
    } catch (_) {}

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

    this.sessions.clear();
    this.activeWorkflows.clear();

    this.logger?.debug('ScormService: Shutdown completed');
  }

  /**
   * Initialize SCORM session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Initialization result
   */
  async initializeSession(sessionId) {
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
        lastActivity: Date.now()
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
            try { this.rteInstances.set(id, handler); } catch (_) {}
            return true;
          },
          unregisterSession: (id) => {
            try { this.rteInstances.delete(id); } catch (_) {}
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
        
        const rte = new ScormApiHandler(sessionManager, this.logger, { strictMode: this.config.strictRteMode });
        // Initialize RTE session and then bind its internal session id to our session id for mapping
        try { rte.Initialize(''); } catch (_) {}
        // Override generated sessionId with our provided sessionId for consistency
        try { rte.sessionId = sessionId; } catch (_) {}
        this.rteInstances.set(sessionId, rte);
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
      
      // Notify debug/telemetry
      this.notifyDebugWindow('session-initialized', session);
      
      this.logger?.info(`ScormService: Session ${sessionId} initialized successfully`);
      this.recordOperation('initializeSession', true);
      
      return { success: true, errorCode: '0' };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SCORM_SESSION_MANAGEMENT_FAILED,
        `Session initialization failed: ${error.message}`,
        'ScormService.initializeSession'
      );
      
      this.logger?.error(`ScormService: Session ${sessionId} initialization failed:`, error);
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
          value = rte.GetValue(element);
          errorCode = value === '' ? '401' : '0';
        } else {
          // Fallback to session-local data model if present
          value = session.data ? (session.data[element] || '') : '';
          errorCode = value === '' && !(session.data && session.data.hasOwnProperty(element)) ? '401' : '0';
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE GetValue failed for ${element}: ${e?.message || e}`);
        value = '';
        errorCode = '101';
      }
      
      // Log API call
      this.logApiCall(session, 'GetValue', element, value, errorCode);
      
      this.recordOperation('getValue', errorCode === '0');
      return { success: errorCode === '0', value, errorCode };
      
    } catch (error) {
      this.logger?.error(`ScormService: GetValue failed for session ${sessionId}:`, error);
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
      try {
        if (rte && typeof rte.SetValue === 'function') {
          const res = rte.SetValue(element, String(value));
          success = (res === 'true');
        } else {
          // Fallback to session-local data model
          session.data = session.data || {};
          session.data[element] = value;
          success = true;
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE SetValue failed for ${element}: ${e?.message || e}`);
        success = false;
      }
      
      // Log API call
      this.logApiCall(session, 'SetValue', element, value, success ? '0' : '101');
      
      // Process special elements (ensure SN updates still happen)
      await this.processSpecialElement(session, element, value);
      
      this.recordOperation('setValue', success);
      return { success, errorCode: success ? '0' : '101' };
      
    } catch (error) {
      this.logger?.error(`ScormService: SetValue failed for session ${sessionId}:`, error);
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
      
      // Log API call
      this.logApiCall(session, 'Commit', '', '', '0');
      
      // Prefer RTE commit when available
      const rte = this.rteInstances.get(sessionId);
      let success = true;
      try {
        if (rte && typeof rte.Commit === 'function') {
          const res = rte.Commit('');
          success = (res === 'true');
        } else {
          // Fallback: nothing to do, treat as success
          success = true;
        }
      } catch (e) {
        this.logger?.warn(`ScormService: RTE Commit failed for session ${sessionId}: ${e?.message || e}`);
        success = false;
      }
      
      // Notify telemetry/debug via notifyDebugWindow (which delegates to telemetryStore)
      try {
        const payload = { sessionId, success, timestamp: Date.now() };
        this.notifyDebugWindow('data-committed', payload);
      } catch (_) {}
      
      this.recordOperation('commit', success);
      return { success, errorCode: success ? '0' : '101' };
      
    } catch (error) {
      this.logger?.error(`ScormService: Commit failed for session ${sessionId}:`, error);
      this.recordOperation('commit', false);
      return { success: false, errorCode: '101' };
    }
  }

  /**
   * Terminate SCORM session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Termination result
   */
  async terminate(sessionId) {
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
        try { this.rteInstances.delete(sessionId); } catch (_) {}
        return { success: true, errorCode: '0', alreadyTerminated: true };
      }
      session.__terminating = true;
 
      // Log API call
      this.logApiCall(session, 'Terminate', '', '', '0');
 
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
 
      // Update session state
      const preState = session.state;
      session.state = 'terminated';
      session.endTime = new Date();
 
      // Notify telemetry/debug
      this.notifyDebugWindow('session-terminated', { sessionId, rteSuccess });
 
      // Remove session and RTE instance
      this.sessions.delete(sessionId);
      try { this.rteInstances.delete(sessionId); } catch (_) {}
 
      this.logger?.info(`ScormService: Session ${sessionId} terminated (prevState=${preState})`);
      this.recordOperation('terminate', rteSuccess);
 
      return { success: rteSuccess, errorCode: '0' };
 
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error);
      // Benign shutdown races: downgrade to soft-ok
      if (msg.includes('already terminated') || msg.includes('window destroyed') || msg.includes('webContents destroyed')) {
        this.logger?.warn(`ScormService: Soft-ok terminate(${sessionId}) during shutdown/race: ${msg}`);
        // Ensure cleanup
        this.sessions.delete(sessionId);
        try { this.rteInstances.delete(sessionId); } catch (_) {}
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
      this.logger?.error('ScormService: Compliance validation failed:', error);
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
      this.logger?.error('ScormService: Content analysis failed:', error);
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
      this.logger?.error('ScormService: SCORM manifest processing failed:', error);
      this.recordOperation('processScormManifest', false);
      return { success: false, error: error.message, reason: error.message };
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
      this.logger?.info(`ScormService: Session ${sessionId} reset`);
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
      
      // Notify debug window
      this.notifyDebugWindow('lms-profile-applied', {
        sessionId,
        profile: profile.name,
        settings: profile.settings
      });
      
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
        
        // Notify debug window
        this.notifyDebugWindow('test-scenario-completed', {
          sessionId,
          scenario: scenarioType,
          result
        });
        
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
    // Initialize SN service for sequencing support
    this.snService = new ScormSNService(this.errorHandler, this.logger, {
      enableGlobalObjectives: this.config.enableGlobalObjectives,
      enableRollupProcessing: this.config.enableRollupProcessing,
      maxSequencingDepth: this.config.maxSequencingDepth
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
        this.logger?.debug('ScormService: API call published to telemetryStore');
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
        let progressData = {};
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
   * Notify debug window
   * @private
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  notifyDebugWindow(event, data) {
    // Prefer publishing to telemetryStore for consistent, bounded storage and later flushTo handling.
    try {
      const telemetryStore = this.getDependency && this.getDependency('telemetryStore');
      if (telemetryStore && typeof telemetryStore.storeApiCall === 'function') {
        telemetryStore.storeApiCall({
          type: event,
          payload: data,
          timestamp: Date.now()
        });
        return;
      }
    } catch (e) {
      this.logger?.warn('ScormService: telemetryStore.storeApiCall failed in notifyDebugWindow', e?.message || e);
    }
    
    // Fallback to legacy direct debug-window send when telemetry store not available
    try {
      const windowManager = this.getDependency('windowManager');
      if (windowManager) {
        const debugWindow = windowManager.getWindow('debug');
        if (debugWindow && !debugWindow.isDestroyed()) {
          debugWindow.webContents.send(event, data);
        }
      }
    } catch (e) {
      this.logger?.warn('ScormService: notifyDebugWindow fallback failed', e?.message || e);
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
    setInterval(() => {
      const now = Date.now();
      const timeout = this.config.sessionTimeout;
      
      for (const [sessionId, session] of this.sessions) {
        if (now - session.lastActivity > timeout) {
          this.logger?.info(`ScormService: Cleaning up inactive session: ${sessionId}`);
          this.sessions.delete(sessionId);
        }
      }
    }, 60000); // Check every minute
  }
}

module.exports = ScormService;