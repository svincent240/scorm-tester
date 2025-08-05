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
    
    // Terminate all active sessions
    for (const [sessionId, session] of this.sessions) {
      try {
        await this.terminateSession(sessionId);
      } catch (error) {
        this.logger?.error(`ScormService: Failed to terminate session ${sessionId}:`, error);
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
      
      // Create session
      const session = {
        id: sessionId,
        startTime: new Date(),
        state: 'initialized',
        data: {},
        apiCalls: [],
        errors: [],
        lmsProfile: null,
        interactions: {},
        objectives: {},
        lastActivity: Date.now()
      };
      
      this.sessions.set(sessionId, session);
      
      // Notify debug window if available
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
      
      // Get value from session data
      const value = session.data[element] || '';
      const errorCode = value === '' && !session.data.hasOwnProperty(element) ? '401' : '0';
      
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
      
      // Set value in session data
      session.data[element] = value;
      
      // Log API call
      this.logApiCall(session, 'SetValue', element, value, '0');
      
      // Process special elements
      await this.processSpecialElement(session, element, value);
      
      this.recordOperation('setValue', true);
      return { success: true, errorCode: '0' };
      
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
      
      // Notify debug window
      this.notifyDebugWindow('data-committed', { sessionId, data: session.data });
      
      this.recordOperation('commit', true);
      return { success: true, errorCode: '0' };
      
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
        return { success: false, errorCode: '301' };
      }
      
      // Log API call
      this.logApiCall(session, 'Terminate', '', '', '0');
      
      // Update session state
      session.state = 'terminated';
      session.endTime = new Date();
      
      // Notify debug window
      this.notifyDebugWindow('session-terminated', { sessionId });
      
      // Remove session
      this.sessions.delete(sessionId);
      
      this.logger?.info(`ScormService: Session ${sessionId} terminated`);
      this.recordOperation('terminate', true);
      
      return { success: true, errorCode: '0' };
      
    } catch (error) {
      this.logger?.error(`ScormService: Terminate failed for session ${sessionId}:`, error);
      this.recordOperation('terminate', false);
      return { success: false, errorCode: '101' };
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
      timestamp: new Date(),
      method,
      parameter,
      value,
      errorCode
    };
    
    session.apiCalls.push(logEntry);
    
    // Notify debug window
    this.notifyDebugWindow('api-call', {
      sessionId: session.id,
      method,
      parameter,
      value,
      errorCode
    });
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
    const windowManager = this.getDependency('windowManager');
    if (windowManager) {
      const debugWindow = windowManager.getWindow('debug');
      if (debugWindow && !debugWindow.isDestroyed()) {
        debugWindow.webContents.send(event, data);
      }
    }
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