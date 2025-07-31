// preload.js - Security-hardened version with input validation
const { contextBridge, ipcRenderer } = require('electron');

// SECURITY: Input validation functions
const validateString = (input, maxLength = 1000) => {
  return typeof input === 'string' && input.length <= maxLength;
};

const validateSessionId = (sessionId) => {
  return validateString(sessionId, 100) && /^[a-zA-Z0-9_-]+$/.test(sessionId);
};

const validateScormElement = (element) => {
  return validateString(element, 255) && /^cmi\.[\w\.\[\]_-]+$/.test(element);
};

const validateFilePath = (filePath) => {
  return validateString(filePath, 500) && !filePath.includes('..');
};

// SECURITY: Enhanced wrapper for IPC calls with comprehensive error handling
const safeInvoke = async (channel, ...args) => {
  const startTime = Date.now();
  const callId = `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Validate channel name
    if (typeof channel !== 'string' || channel.length === 0) {
      throw new Error('Invalid IPC channel name');
    }

    // Log the call for debugging
    console.debug(`[IPC-${callId}] Invoking ${channel}`, { args: args.length });

    const result = await Promise.race([
      ipcRenderer.invoke(channel, ...args),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('IPC call timeout')), 30000)
      )
    ]);

    const duration = Date.now() - startTime;
    console.debug(`[IPC-${callId}] Completed in ${duration}ms`);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Enhanced error context
    const enhancedError = new Error(
      `IPC communication failed: ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.channel = channel;
    enhancedError.duration = duration;
    enhancedError.callId = callId;
    enhancedError.timestamp = new Date().toISOString();

    console.error(`[IPC-${callId}] Failed after ${duration}ms:`, error);
    throw enhancedError;
  }
};

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations with validation
  selectScormPackage: () => safeInvoke('select-scorm-package'),
  
  selectScormFolder: () => safeInvoke('select-scorm-folder'),
  
  extractScorm: (zipPath) => {
    if (!validateFilePath(zipPath)) {
      throw new Error('Invalid file path');
    }
    return safeInvoke('extract-scorm', zipPath);
  },
  
  findScormEntry: (folderPath) => {
    if (!validateFilePath(folderPath)) {
      throw new Error('Invalid folder path');
    }
    return safeInvoke('find-scorm-entry', folderPath);
  },
  
  getCourseInfo: (folderPath) => {
    if (!validateFilePath(folderPath)) {
      throw new Error('Invalid folder path');
    }
    return safeInvoke('get-course-info', folderPath);
  },
  
  openExternal: (url) => {
    if (!validateString(url, 2000)) {
      throw new Error('Invalid URL');
    }
    // SECURITY: Additional URL validation
    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
        throw new Error('Unsupported URL protocol');
      }
    } catch (error) {
      throw new Error('Invalid URL format');
    }
    return safeInvoke('open-external', url);
  },

  // SCORM API operations with validation
  scormInitialize: (sessionId) => {
    if (!validateSessionId(sessionId)) {
      throw new Error('Invalid session ID');
    }
    return safeInvoke('scorm-initialize', sessionId);
  },
  
  scormGetValue: (sessionId, element) => {
    if (!validateSessionId(sessionId) || !validateScormElement(element)) {
      throw new Error('Invalid parameters');
    }
    return safeInvoke('scorm-get-value', sessionId, element);
  },
  
  scormSetValue: (sessionId, element, value) => {
    if (!validateSessionId(sessionId) || !validateScormElement(element) || !validateString(value, 65536)) {
      throw new Error('Invalid parameters');
    }
    return safeInvoke('scorm-set-value', sessionId, element, value);
  },
  
  scormCommit: (sessionId) => {
    if (!validateSessionId(sessionId)) {
      throw new Error('Invalid session ID');
    }
    return safeInvoke('scorm-commit', sessionId);
  },
  
  scormTerminate: (sessionId) => {
    if (!validateSessionId(sessionId)) {
      throw new Error('Invalid session ID');
    }
    return safeInvoke('scorm-terminate', sessionId);
  },

  // Session management with validation
  getSessionData: (sessionId) => {
    if (!validateSessionId(sessionId)) {
      throw new Error('Invalid session ID');
    }
    return safeInvoke('get-session-data', sessionId);
  },
  
  getAllSessions: () => safeInvoke('get-all-sessions'),
  
  resetSession: (sessionId) => {
    if (!validateSessionId(sessionId)) {
      throw new Error('Invalid session ID');
    }
    return safeInvoke('reset-session', sessionId);
  },

  // Enhanced testing features with validation
  validateScormCompliance: (folderPath) => {
    if (!validateFilePath(folderPath)) {
      throw new Error('Invalid folder path');
    }
    return safeInvoke('validate-scorm-compliance', folderPath);
  },
  
  analyzeScormContent: (folderPath) => {
    if (!validateFilePath(folderPath)) {
      throw new Error('Invalid folder path');
    }
    return safeInvoke('analyze-scorm-content', folderPath);
  },
  
  applyLmsProfile: (sessionId, profileName) => {
    if (!validateSessionId(sessionId) || !validateString(profileName, 50)) {
      throw new Error('Invalid parameters');
    }
    // SECURITY: Validate profile name against allowed list
    const allowedProfiles = ['litmos', 'moodle', 'scormcloud', 'generic'];
    if (!allowedProfiles.includes(profileName)) {
      throw new Error('Invalid LMS profile');
    }
    return safeInvoke('apply-lms-profile', sessionId, profileName);
  },
  
  runTestScenario: (sessionId, scenarioType) => {
    if (!validateSessionId(sessionId) || !validateString(scenarioType, 50)) {
      throw new Error('Invalid parameters');
    }
    // SECURITY: Validate scenario type against allowed list
    const allowedScenarios = ['quick-completion', 'suspend-resume', 'multiple-attempts', 'interaction-heavy'];
    if (!allowedScenarios.includes(scenarioType)) {
      throw new Error('Invalid test scenario');
    }
    return safeInvoke('run-test-scenario', sessionId, scenarioType);
  },
  
  getLmsProfiles: () => safeInvoke('get-lms-profiles'),

  // Menu event handling (no validation needed for menu events)
  onMenuEvent: (callback) => {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    const eventHandlers = {
      'menu-load-package': () => callback('load-package'),
      'menu-reset-session': () => callback('reset-session'),
      'menu-simulate': (event, type) => callback('simulate', type),
      'menu-fullscreen': () => callback('fullscreen'),
      'menu-zoom': (event, direction) => callback('zoom', direction)
    };

    // SECURITY: Use specific event handlers instead of generic listener
    Object.keys(eventHandlers).forEach(event => {
      ipcRenderer.on(event, eventHandlers[event]);
    });

    // Return cleanup function
    return () => {
      Object.keys(eventHandlers).forEach(event => {
        ipcRenderer.removeListener(event, eventHandlers[event]);
      });
    };
  },

  // Debug window events with validation
  onSessionEvent: (callback) => {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    const sessionEventHandlers = {
      'session-initialized': (event, data) => {
        // SECURITY: Validate data structure before passing to callback
        if (data && typeof data === 'object' && data.id) {
          callback('session-initialized', data);
        }
      },
      'api-call': (event, data) => {
        if (data && typeof data === 'object' && data.sessionId && data.method) {
          callback('api-call', data);
        }
      },
      'data-committed': (event, data) => {
        if (data && typeof data === 'object' && data.sessionId) {
          callback('data-committed', data);
        }
      },
      'session-terminated': (event, data) => {
        if (data && typeof data === 'object' && data.sessionId) {
          callback('session-terminated', data);
        }
      },
      'lms-profile-applied': (event, data) => {
        if (data && typeof data === 'object' && data.sessionId && data.profile) {
          callback('lms-profile-applied', data);
        }
      },
      'test-scenario-completed': (event, data) => {
        if (data && typeof data === 'object' && data.sessionId && data.scenario) {
          callback('test-scenario-completed', data);
        }
      }
    };

    // Register handlers
    Object.keys(sessionEventHandlers).forEach(event => {
      ipcRenderer.on(event, sessionEventHandlers[event]);
    });

    // Return cleanup function
    return () => {
      Object.keys(sessionEventHandlers).forEach(event => {
        ipcRenderer.removeListener(event, sessionEventHandlers[event]);
      });
    };
  }
});

// SECURITY: Prevent access to Node.js globals
delete global.require;
delete global.exports;
delete global.module;

// SECURITY: Freeze the API to prevent tampering
Object.freeze(window.electronAPI);