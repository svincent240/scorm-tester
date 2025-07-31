// Fixed SCORM API implementation with proper synchronous behavior
class ScormApiHandler {
  constructor(electronAPI, sessionId, logger) {
    this.electronAPI = electronAPI;
    this.sessionId = sessionId;
    this.logger = logger;
    this.isConnected = true;
    
    // BUG FIX: Maintain local state cache for synchronous access
    this.localDataCache = new Map();
    this.lastError = '0';
    this.initialized = false;
    
    // BUG FIX: Track pending operations to prevent race conditions
    this.pendingOperations = new Map();
    
    // BUG FIX: Initialize with default SCORM data model
    this.initializeLocalCache();
  }

  initializeLocalCache() {
    // Pre-populate cache with SCORM 1.2 default values
    const defaultData = {
      'cmi.core.student_id': 'test_user_001',
      'cmi.core.student_name': 'Test User',
      'cmi.core.lesson_location': '',
      'cmi.core.credit': 'credit',
      'cmi.core.lesson_status': 'incomplete',
      'cmi.core.entry': 'ab-initio',
      'cmi.core.score.raw': '',
      'cmi.core.score.max': '',
      'cmi.core.score.min': '',
      'cmi.core.total_time': '0000:00:00.00',
      'cmi.core.lesson_mode': 'normal',
      'cmi.core.exit': '',
      'cmi.core.session_time': '0000:00:00.00',
      'cmi.suspend_data': '',
      'cmi.launch_data': '',
      'cmi.comments': '',
      'cmi.comments_from_lms': '',
      
      // SCORM 2004 equivalents
      'cmi.learner_id': 'test_user_001',
      'cmi.learner_name': 'Test User',
      'cmi.location': '',
      'cmi.completion_status': 'incomplete',
      'cmi.success_status': 'unknown',
      'cmi.score.scaled': '',
      'cmi.score.raw': '',
      'cmi.score.min': '',
      'cmi.score.max': '',
      'cmi.progress_measure': '',
      'cmi.mode': 'normal',
      'cmi.exit': '',
      'cmi.session_time': 'PT0H0M0S',
      'cmi.total_time': 'PT0H0M0S',
      'cmi.suspend_data': '',
      'cmi.launch_data': ''
    };

    // BUG FIX: Store in local cache for immediate synchronous access
    Object.entries(defaultData).forEach(([key, value]) => {
      this.localDataCache.set(key, value);
    });

    // BUG FIX: Also initialize array counters
    this.localDataCache.set('cmi.interactions._count', '0');
    this.localDataCache.set('cmi.objectives._count', '0');
    
    this.interactions = [];
    this.objectives = [];
  }

  // BUG FIX: Synchronous Initialize implementation
  LMSInitialize(parameter) {
    this.logger('init', 'LMSInitialize', parameter);
    
    if (this.initialized) {
      this.lastError = '101'; // Already initialized
      return "false";
    }
    
    if (!this.isConnected) {
      this.lastError = '301'; // General failure
      return "false";
    }

    this.initialized = true;
    this.lastError = '0';
    
    // BUG FIX: Asynchronously sync with backend without blocking
    this.syncWithBackend();
    
    return "true";
  }

  // BUG FIX: Synchronous GetValue with local cache
  LMSGetValue(element) {
    if (!this.initialized) {
      this.lastError = '301'; // Not initialized
      this.logger('get', 'LMSGetValue', element, 'NOT_INITIALIZED');
      return "";
    }

    if (!this.isConnected) {
      this.lastError = '301'; // General failure
      this.logger('get', 'LMSGetValue', element, 'CONNECTION_ERROR');
      return "";
    }

    let value = "";
    this.lastError = '0';

    try {
      // BUG FIX: Handle interactions array access
      if (element.startsWith('cmi.interactions.')) {
        const match = element.match(/cmi\.interactions\.(\d+)\.(.+)/);
        if (match) {
          const index = parseInt(match[1], 10);
          const property = match[2];
          
          if (index >= 0 && index < this.interactions.length && this.interactions[index]) {
            value = this.interactions[index][property] || "";
          } else {
            this.lastError = '301'; // Data not available
          }
        } else if (element === 'cmi.interactions._count') {
          value = this.interactions.length.toString();
        }
      }
      // BUG FIX: Handle objectives array access
      else if (element.startsWith('cmi.objectives.')) {
        const match = element.match(/cmi\.objectives\.(\d+)\.(.+)/);
        if (match) {
          const index = parseInt(match[1], 10);
          const property = match[2];
          
          if (index >= 0 && index < this.objectives.length && this.objectives[index]) {
            if (property.startsWith('score.')) {
              const scoreProp = property.replace('score.', '');
              value = this.objectives[index].score?.[scoreProp] || "";
            } else {
              value = this.objectives[index][property] || "";
            }
          } else {
            this.lastError = '301'; // Data not available
          }
        } else if (element === 'cmi.objectives._count') {
          value = this.objectives.length.toString();
        }
      }
      // BUG FIX: Handle regular data model elements
      else {
        if (this.localDataCache.has(element)) {
          value = this.localDataCache.get(element);
        } else {
          this.lastError = '401'; // Undefined data model element
        }
      }
    } catch (error) {
      console.error('LMSGetValue error:', error);
      this.lastError = '301'; // General failure
    }

    this.logger('get', 'LMSGetValue', element, value);
    
    // BUG FIX: Trigger background sync for fresh data (non-blocking)
    this.requestBackgroundSync(element);
    
    return value;
  }

  // BUG FIX: Synchronous SetValue with immediate local update
  LMSSetValue(element, value) {
    if (!this.initialized) {
      this.lastError = '301'; // Not initialized
      this.logger('set', 'LMSSetValue', `${element} = ${value}`, 'NOT_INITIALIZED');
      return "false";
    }

    if (!this.isConnected) {
      this.lastError = '301'; // General failure
      this.logger('set', 'LMSSetValue', `${element} = ${value}`, 'CONNECTION_ERROR');
      return "false";
    }

    this.lastError = '0';

    try {
      // BUG FIX: Validate data type and constraints
      if (!this.validateScormValue(element, value)) {
        this.lastError = '405'; // Incorrect data type
        this.logger('set', 'LMSSetValue', `${element} = ${value}`, 'VALIDATION_ERROR');
        return "false";
      }

      // BUG FIX: Handle interactions array
      if (element.startsWith('cmi.interactions.')) {
        const match = element.match(/cmi\.interactions\.(\d+)\.(.+)/);
        if (match) {
          const index = parseInt(match[1], 10);
          const property = match[2];
          
          // Ensure interaction exists
          while (this.interactions.length <= index) {
            this.interactions.push({
              id: '',
              type: '',
              timestamp: '',
              correct_responses: [],
              weighting: '',
              student_response: '',
              result: '',
              latency: ''
            });
          }
          
          this.interactions[index][property] = value;
          this.localDataCache.set('cmi.interactions._count', this.interactions.length.toString());
        }
      }
      // BUG FIX: Handle objectives array
      else if (element.startsWith('cmi.objectives.')) {
        const match = element.match(/cmi\.objectives\.(\d+)\.(.+)/);
        if (match) {
          const index = parseInt(match[1], 10);
          const property = match[2];
          
          // Ensure objective exists
          while (this.objectives.length <= index) {
            this.objectives.push({
              id: '',
              score: { raw: '', min: '', max: '' },
              status: ''
            });
          }
          
          if (property.startsWith('score.')) {
            const scoreProp = property.replace('score.', '');
            this.objectives[index].score[scoreProp] = value;
          } else {
            this.objectives[index][property] = value;
          }
          
          this.localDataCache.set('cmi.objectives._count', this.objectives.length.toString());
        }
      }
      // BUG FIX: Handle regular data model elements
      else {
        // Update local cache immediately
        this.localDataCache.set(element, value);
        
        // BUG FIX: Handle lesson status changes
        if (element === 'cmi.core.lesson_status') {
          if (value === 'completed' || value === 'passed') {
            this.localDataCache.set('cmi.completion_status', 'completed');
          }
          if (value === 'passed') {
            this.localDataCache.set('cmi.success_status', 'passed');
          } else if (value === 'failed') {
            this.localDataCache.set('cmi.success_status', 'failed');
          }
        }
      }

      // BUG FIX: Asynchronously persist to backend (non-blocking)
      this.persistToBackend(element, value);
      
      this.logger('set', 'LMSSetValue', `${element} = ${value}`, 'SUCCESS');
      return "true";
      
    } catch (error) {
      console.error('LMSSetValue error:', error);
      this.lastError = '351'; // General set failure
      this.logger('set', 'LMSSetValue', `${element} = ${value}`, 'ERROR');
      return "false";
    }
  }

  // BUG FIX: Synchronous Commit
  LMSCommit(parameter) {
    if (!this.initialized) {
      this.lastError = '301'; // Not initialized
      this.logger('commit', 'LMSCommit', parameter, 'NOT_INITIALIZED');
      return "false";
    }

    if (!this.isConnected) {
      this.lastError = '301'; // General failure
      this.logger('commit', 'LMSCommit', parameter, 'CONNECTION_ERROR');
      return "false";
    }

    this.lastError = '0';
    
    // BUG FIX: Trigger immediate background commit (non-blocking)
    this.commitToBackend();
    
    this.logger('commit', 'LMSCommit', parameter, 'SUCCESS');
    return "true";
  }

  // BUG FIX: Synchronous Finish
  LMSFinish(parameter) {
    if (!this.initialized) {
      this.lastError = '301'; // Not initialized
      this.logger('finish', 'LMSFinish', parameter, 'NOT_INITIALIZED');
      return "false";
    }

    if (!this.isConnected) {
      this.lastError = '301'; // General failure
      this.logger('finish', 'LMSFinish', parameter, 'CONNECTION_ERROR');
      return "false";
    }

    // BUG FIX: Auto-commit before terminating
    this.LMSCommit('');
    
    // BUG FIX: Asynchronously terminate session (non-blocking)
    this.terminateBackendSession();
    
    this.initialized = false;
    this.lastError = '0';
    
    this.logger('finish', 'LMSFinish', parameter, 'SUCCESS');
    return "true";
  }

  LMSGetLastError() {
    return this.lastError;
  }

  LMSGetErrorString(errorCode) {
    const errors = {
      "0": "No error",
      "101": "General exception",
      "301": "General get failure",
      "351": "General set failure", 
      "401": "Undefined data model element",
      "405": "Incorrect data type"
    };
    return errors[errorCode] || "Unknown error";
  }

  LMSGetDiagnostic(errorCode) {
    return `Diagnostic information for error ${errorCode}`;
  }

  // BUG FIX: Non-blocking backend synchronization
  async syncWithBackend() {
    try {
      if (this.electronAPI && this.sessionId) {
        // Refresh cache from backend without blocking
        const result = await this.electronAPI.scormInitialize(this.sessionId);
        if (result.success) {
          console.debug('Backend sync completed');
        }
      }
    } catch (error) {
      console.warn('Backend sync failed:', error);
    }
  }

  // BUG FIX: Non-blocking value persistence
  async persistToBackend(element, value) {
    try {
      if (this.electronAPI && this.sessionId) {
        // Don't await - let it complete in background
        this.electronAPI.scormSetValue(this.sessionId, element, value)
          .catch(error => console.warn('Backend persist failed:', error));
      }
    } catch (error) {
      console.warn('Persist operation failed:', error);
    }
  }

  // BUG FIX: Non-blocking commit
  async commitToBackend() {
    try {
      if (this.electronAPI && this.sessionId) {
        this.electronAPI.scormCommit(this.sessionId)
          .catch(error => console.warn('Backend commit failed:', error));
      }
    } catch (error) {
      console.warn('Commit operation failed:', error);
    }
  }

  // BUG FIX: Non-blocking session termination
  async terminateBackendSession() {
    try {
      if (this.electronAPI && this.sessionId) {
        this.electronAPI.scormTerminate(this.sessionId)
          .catch(error => console.warn('Backend terminate failed:', error));
      }
    } catch (error) {
      console.warn('Terminate operation failed:', error);
    }
  }

  // BUG FIX: Background data refresh
  async requestBackgroundSync(element) {
    try {
      if (this.electronAPI && this.sessionId && !this.pendingOperations.has(element)) {
        this.pendingOperations.set(element, true);
        
        const result = await this.electronAPI.scormGetValue(this.sessionId, element);
        if (result.success && result.value !== undefined) {
          // Update cache if we got fresher data
          this.localDataCache.set(element, result.value);
        }
        
        this.pendingOperations.delete(element);
      }
    } catch (error) {
      this.pendingOperations.delete(element);
      console.warn('Background sync failed:', error);
    }
  }

  // BUG FIX: SCORM value validation
  validateScormValue(element, value) {
    if (typeof value !== 'string') {
      return false;
    }

    // Validate lesson status
    if (element === 'cmi.core.lesson_status' || element === 'cmi.completion_status') {
      const validStatuses = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
      return validStatuses.includes(value);
    }

    // Validate exit codes
    if (element === 'cmi.core.exit' || element === 'cmi.exit') {
      const validExits = ['time-out', 'suspend', 'logout', ''];
      return validExits.includes(value);
    }

    // Validate scores
    if (element.includes('score.raw')) {
      const score = parseFloat(value);
      return !isNaN(score) && score >= 0 && score <= 100;
    }

    // Validate session time formats
    if (element.includes('session_time')) {
      if (element.includes('core')) {
        // SCORM 1.2 format: HHHH:MM:SS.SS
        return /^\d{4}:\d{2}:\d{2}\.\d{2}$/.test(value);
      } else {
        // SCORM 2004 format: PT#H#M#S
        return /^PT\d+H\d+M\d+(\.\d+)?S$/.test(value);
      }
    }

    return true; // Default to valid for unknown elements
  }
}

module.exports = ScormApiHandler;