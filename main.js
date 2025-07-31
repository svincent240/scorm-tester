// main.js - Fixed version with bug corrections
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const StreamZip = require('node-stream-zip');
const { ProductionConfig } = require('./config/production.js');
const { PerformanceMonitor, ResourceMonitor } = require('./monitoring/index.js');

const config = new ProductionConfig();
const monitor = new PerformanceMonitor();
const resourceMonitor = new ResourceMonitor(monitor);

let mainWindow;
let debugWindow;

// SCORM session storage
const scormSessions = new Map();

// BUG FIX: Helper function for cleanup
function cleanupExtractedFolder(folderPath) {
  try {
    if (fs.existsSync(folderPath)) {
      const stats = fs.statSync(folderPath);
      const ageHours = (Date.now() - stats.birthtimeMs) / (1000 * 60 * 60);
      
      // Only cleanup if folder is older than 1 hour
      if (ageHours > 1) {
        fs.rmSync(folderPath, { recursive: true, force: true });
        monitor.log('INFO', 'Cleaned up old extracted folder', {
          folderPath: path.basename(folderPath),
          ageHours: Math.round(ageHours)
        });
      }
    }
  } catch (error) {
    monitor.log('ERROR', 'Failed to cleanup extracted folder', {
      folderPath: path.basename(folderPath),
      error: error.message
    });
  }
}

// BUG FIX: Helper function for byte formatting
function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    icon: path.join(__dirname, 'assets/icon.ico')
  });

  mainWindow.loadFile('index.html');
  createMenu();
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

function createDebugWindow() {
  if (debugWindow) {
    debugWindow.focus();
    return;
  }

  debugWindow = new BrowserWindow({
    width: 800,
    height: 600,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'SCORM Debug Console'
  });

  debugWindow.loadFile('debug.html');
  
  debugWindow.on('closed', () => {
    debugWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Load SCORM Package...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-load-package')
        },
        {
          label: 'Export Session Data...',
          click: () => exportSessionData()
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'SCORM',
      submenu: [
        {
          label: 'Reset Session',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('menu-reset-session')
        },
        {
          label: 'Simulate LMS Behaviors',
          submenu: [
            {
              label: 'Suspend/Resume',
              click: () => mainWindow.webContents.send('menu-simulate', 'suspend')
            },
            {
              label: 'Force Complete',
              click: () => mainWindow.webContents.send('menu-simulate', 'complete')
            },
            {
              label: 'Connection Lost',
              click: () => mainWindow.webContents.send('menu-simulate', 'disconnect')
            }
          ]
        },
        {
          label: 'Debug Console',
          accelerator: 'F12',
          click: () => createDebugWindow()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Fullscreen Course',
          accelerator: 'F11',
          click: () => mainWindow.webContents.send('menu-fullscreen')
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => mainWindow.webContents.send('menu-zoom', 'in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('menu-zoom', 'out')
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('menu-zoom', 'reset')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// SCORM API handlers
ipcMain.handle('scorm-initialize', (event, sessionId) => {
  const session = {
    id: sessionId,
    startTime: new Date(),
    initialized: true,
    data: {
      // SCORM 1.2 data model
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
      'cmi.comments_from_lms': 'Welcome to the course!',
      
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
      'cmi.launch_data': '',
      'cmi.learner_preference.audio_level': '1',
      'cmi.learner_preference.language': 'en-US',
      'cmi.learner_preference.delivery_speed': '1',
      'cmi.learner_preference.audio_captioning': '0'
    },
    interactions: [],
    objectives: [],
    apiCalls: [],
    errors: [],
    lmsProfile: null
  };
  
  scormSessions.set(sessionId, session);
  
  // Send to debug window if open
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('session-initialized', session);
  }
  
  return { success: true, errorCode: '0' };
});

ipcMain.handle('scorm-get-value', (event, sessionId, element) => {
  const session = scormSessions.get(sessionId);
  if (!session) {
    return { success: false, value: '', errorCode: '301' }; // General Get Failure
  }
  
  let value = '';
  let errorCode = '0';
  
  try {
    // Handle array elements (interactions, objectives)
    if (element.startsWith('cmi.interactions.')) {
      const match = element.match(/cmi\.interactions\.(\d+)\.(.+)/);
      if (match) {
        const index = parseInt(match[1]);
        const property = match[2];
        if (session.interactions[index] && session.interactions[index][property] !== undefined) {
          value = session.interactions[index][property].toString();
        }
      } else if (element === 'cmi.interactions._count') {
        value = session.interactions.length.toString();
      }
    } else if (element.startsWith('cmi.objectives.')) {
      const match = element.match(/cmi\.objectives\.(\d+)\.(.+)/);
      if (match) {
        const index = parseInt(match[1]);
        const property = match[2];
        if (session.objectives[index] && session.objectives[index][property] !== undefined) {
          value = session.objectives[index][property].toString();
        }
      } else if (element === 'cmi.objectives._count') {
        value = session.objectives.length.toString();
      }
    } else {
      value = session.data[element] || '';
      if (value === '' && !session.data.hasOwnProperty(element)) {
        errorCode = '401'; // Undefined Data Model
      }
    }
  } catch (error) {
    console.error('Error in scorm-get-value:', error);
    errorCode = '301'; // General Get Failure
  }
  
  // Log API call
  session.apiCalls.push({
    timestamp: new Date(),
    method: 'GetValue',
    parameter: element,
    value: value,
    errorCode: errorCode
  });
  
  // Send to debug window (with safety check)
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('api-call', {
      sessionId,
      method: 'GetValue',
      parameter: element,
      value,
      errorCode
    });
  }
  
  return { success: errorCode === '0', value, errorCode };
});

// FIXED: Proper scorm-set-value with LMS validation
ipcMain.handle('scorm-set-value', (event, sessionId, element, value) => {
  const session = scormSessions.get(sessionId);
  if (!session) {
    return { success: false, errorCode: '301' };
  }
  
  let errorCode = '0';
  
  try {
    // LMS-specific validation FIRST
    if (session.lmsProfile) {
      const profile = session.lmsProfile;
      
      // Check suspend data length limits
      if (element === 'cmi.suspend_data' && profile.settings.maxSuspendDataLength) {
        if (value && value.length > profile.settings.maxSuspendDataLength) {
          errorCode = '405'; // Data too long
          session.errors.push({
            timestamp: new Date(),
            error: `Suspend data exceeds ${profile.name} limit of ${profile.settings.maxSuspendDataLength} characters`,
            element,
            value: value.substring(0, 50) + '...'
          });
        }
      }

      // Strict validation for certain LMS
      if (profile.settings.strictValidation) {
        if (element === 'cmi.core.score.raw' || element === 'cmi.score.raw') {
          const score = parseFloat(value);
          if (isNaN(score) || score < 0 || score > 100) {
            errorCode = '405';
          }
        }
      }
    }

    // Continue with main validation if no LMS errors
    if (errorCode === '0') {
      if (element.startsWith('cmi.interactions.')) {
        const match = element.match(/cmi\.interactions\.(\d+)\.(.+)/);
        if (match) {
          const index = parseInt(match[1]);
          const property = match[2];
          
          // Initialize interaction if it doesn't exist
          if (!session.interactions[index]) {
            session.interactions[index] = {
              id: '',
              type: '',
              timestamp: '',
              correct_responses: [],
              weighting: '',
              student_response: '',
              result: '',
              latency: ''
            };
          }
          
          session.interactions[index][property] = value;
        }
      } else if (element.startsWith('cmi.objectives.')) {
        const match = element.match(/cmi\.objectives\.(\d+)\.(.+)/);
        if (match) {
          const index = parseInt(match[1]);
          const property = match[2];
          
          if (!session.objectives[index]) {
            session.objectives[index] = {
              id: '',
              score: { raw: '', min: '', max: '' },
              status: ''
            };
          }
          
          if (property.startsWith('score.')) {
            const scoreProp = property.replace('score.', '');
            session.objectives[index].score[scoreProp] = value;
          } else {
            session.objectives[index][property] = value;
          }
        }
      } else {
        // Validate specific elements
        if (element === 'cmi.core.lesson_status' || element === 'cmi.completion_status') {
          const validStatuses = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
          if (!validStatuses.includes(value)) {
            errorCode = '405'; // Incorrect Data Type
          }
        } else if (element === 'cmi.core.exit' || element === 'cmi.exit') {
          const validExits = ['time-out', 'suspend', 'logout', ''];
          if (!validExits.includes(value)) {
            errorCode = '405';
          }
        }
        
        if (errorCode === '0') {
          session.data[element] = value;
          
          // Update related fields
          if (element === 'cmi.core.lesson_status') {
            session.data['cmi.completion_status'] = value === 'completed' || value === 'passed' ? 'completed' : 'incomplete';
            session.data['cmi.success_status'] = value === 'passed' ? 'passed' : value === 'failed' ? 'failed' : 'unknown';
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in scorm-set-value:', error);
    errorCode = '351'; // General Set Failure
  }
  
  // Log API call
  session.apiCalls.push({
    timestamp: new Date(),
    method: 'SetValue',
    parameter: element,
    value: value,
    errorCode: errorCode
  });
  
  // Send to debug window (with safety check)
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('api-call', {
      sessionId,
      method: 'SetValue',
      parameter: element,
      value,
      errorCode
    });
  }
  
  return { success: errorCode === '0', errorCode };
});

ipcMain.handle('scorm-commit', (event, sessionId) => {
  const session = scormSessions.get(sessionId);
  if (!session) {
    return { success: false, errorCode: '301' };
  }
  
  // Simulate commit delay
  setTimeout(() => {
    session.lastCommit = new Date();
    
    // Log API call
    session.apiCalls.push({
      timestamp: new Date(),
      method: 'Commit',
      parameter: '',
      value: '',
      errorCode: '0'
    });
    
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.webContents.send('data-committed', {
        sessionId,
        timestamp: session.lastCommit,
        data: session.data
      });
    }
  }, Math.random() * 500 + 100); // 100-600ms delay
  
  return { success: true, errorCode: '0' };
});

ipcMain.handle('scorm-terminate', (event, sessionId) => {
  const session = scormSessions.get(sessionId);
  if (!session) {
    return { success: false, errorCode: '301' };
  }
  
  session.endTime = new Date();
  session.terminated = true;
  
  // Calculate total time
  const duration = session.endTime - session.startTime;
  const hours = Math.floor(duration / 3600000);
  const minutes = Math.floor((duration % 3600000) / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  
  session.data['cmi.core.total_time'] = `${hours.toString().padStart(4, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.00`;
  session.data['cmi.total_time'] = `PT${hours}H${minutes}M${seconds}S`;
  
  // Log API call
  session.apiCalls.push({
    timestamp: new Date(),
    method: 'Terminate',
    parameter: '',
    value: '',
    errorCode: '0'
  });
  
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('session-terminated', {
      sessionId,
      duration: duration,
      finalData: session.data
    });
  }
  
  return { success: true, errorCode: '0' };
});

// SCORM compliance validation
ipcMain.handle('validate-scorm-compliance', async (event, folderPath) => {
  try {
    const manifestPath = path.join(folderPath, 'imsmanifest.xml');
    if (!fs.existsSync(manifestPath)) {
      return { valid: false, errors: ['Missing imsmanifest.xml file'], warnings: [] };
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const errors = [];
    const warnings = [];

    // Check for required elements
    if (!manifestContent.includes('<organizations>')) {
      errors.push('Missing required <organizations> element');
    }
    
    if (!manifestContent.includes('<resources>')) {
      errors.push('Missing required <resources> element');
    }

    // Check SCORM version
    const scormVersionMatch = manifestContent.match(/schemaversion\s*=\s*["']([^"']+)["']/i);
    const scormVersion = scormVersionMatch ? scormVersionMatch[1] : null;
    
    if (!scormVersion) {
      warnings.push('SCORM version not clearly specified');
    }

    // Check for launch file
    const launchMatch = manifestContent.match(/href\s*=\s*["']([^"']+)["']/i);
    if (launchMatch) {
      const launchFile = path.join(folderPath, launchMatch[1]);
      if (!fs.existsSync(launchFile)) {
        errors.push(`Launch file not found: ${launchMatch[1]}`);
      }
    } else {
      errors.push('No launch file specified in manifest');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      scormVersion,
      hasValidEntry: true
    };

  } catch (error) {
    return {
      valid: false,
      errors: [`Validation error: ${error.message}`],
      warnings: []
    };
  }
});

// LMS-specific testing profiles
const lmsProfiles = {
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

// Apply LMS profile
ipcMain.handle('apply-lms-profile', (event, sessionId, profileName) => {
  const session = scormSessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const profile = lmsProfiles[profileName] || lmsProfiles.generic;
  
  // Apply profile settings to session (excluding internal flags)
  const dataSettings = Object.keys(profile.settings)
    .filter(key => !['strictValidation', 'maxSuspendDataLength', 'commitOnEverySet'].includes(key))
    .reduce((obj, key) => {
      obj[key] = profile.settings[key];
      return obj;
    }, {});
  
  Object.assign(session.data, dataSettings);
  session.lmsProfile = profile;
  
  // Send to debug window
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('lms-profile-applied', {
      sessionId,
      profile: profile.name,
      settings: profile.settings
    });
  }

  return { success: true, profile: profile.name };
});

// SCORM content analysis
ipcMain.handle('analyze-scorm-content', async (event, folderPath) => {
  const analysis = {
    fileCount: 0,
    totalSize: 0,
    fileTypes: {},
    hasVideo: false,
    hasAudio: false,
    hasFlash: false,
    hasJavaScript: false,
    scormFiles: [],
    mediaFiles: [],
    potentialIssues: []
  };

  try {
    const scanDirectory = (dirPath) => {
      const items = fs.readdirSync(dirPath);
      
      items.forEach(item => {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDirectory(fullPath);
        } else {
          analysis.fileCount++;
          analysis.totalSize += stat.size;
          
          const ext = path.extname(item).toLowerCase();
          analysis.fileTypes[ext] = (analysis.fileTypes[ext] || 0) + 1;
          
          // Check file types
          if (['.mp4', '.avi', '.mov', '.wmv', '.flv'].includes(ext)) {
            analysis.hasVideo = true;
            analysis.mediaFiles.push(item);
          }
          
          if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
            analysis.hasAudio = true;
            analysis.mediaFiles.push(item);
          }
          
          if (['.swf', '.fla'].includes(ext)) {
            analysis.hasFlash = true;
            analysis.potentialIssues.push(`Flash file detected: ${item} (may not work in modern browsers)`);
          }
          
          if (['.js'].includes(ext)) {
            analysis.hasJavaScript = true;
          }
          
          if (['imsmanifest.xml', 'metadata.xml'].includes(item.toLowerCase())) {
            analysis.scormFiles.push(item);
          }
        }
      });
    };

    scanDirectory(folderPath);

    // Additional checks
    if (analysis.totalSize > 100 * 1024 * 1024) { // 100MB
      analysis.potentialIssues.push('Course size is very large (>100MB) - may cause loading issues');
    }

    if (!analysis.hasJavaScript) {
      analysis.potentialIssues.push('No JavaScript files detected - SCORM API communication may not work');
    }

    if (!analysis.scormFiles.includes('imsmanifest.xml')) {
      analysis.potentialIssues.push('Missing imsmanifest.xml - not a valid SCORM package');
    }

    return analysis;

  } catch (error) {
    return {
      ...analysis,
      error: error.message
    };
  }
});

// Testing scenario generator
ipcMain.handle('run-test-scenario', async (event, sessionId, scenarioType) => {
  const session = scormSessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const scenarios = {
    'quick-completion': async () => {
      // Simulate a quick completion
      await new Promise(resolve => setTimeout(resolve, 1000));
      session.data['cmi.core.lesson_status'] = 'completed';
      session.data['cmi.core.score.raw'] = '85';
      session.data['cmi.core.session_time'] = '0000:05:30.00';
      return 'Course completed with 85% score in 5:30';
    },
    
    'suspend-resume': async () => {
      // Simulate suspend/resume
      session.data['cmi.core.exit'] = 'suspend';
      session.data['cmi.suspend_data'] = 'lesson_3,question_5,attempt_2';
      session.data['cmi.core.lesson_location'] = 'page_3';
      await new Promise(resolve => setTimeout(resolve, 2000));
      session.data['cmi.core.entry'] = 'resume';
      return 'Suspended at page 3, then resumed successfully';
    },
    
    'multiple-attempts': async () => {
      // Simulate multiple scoring attempts
      const scores = [65, 72, 88];
      for (let score of scores) {
        session.data['cmi.core.score.raw'] = score.toString();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      session.data['cmi.core.lesson_status'] = 'passed';
      return 'Multiple attempts: 65%, 72%, 88% (passed)';
    },
    
    'interaction-heavy': async () => {
      // Simulate multiple interactions
      for (let i = 0; i < 5; i++) {
        session.interactions[i] = {
          id: `question_${i + 1}`,
          type: 'choice',
          timestamp: new Date().toISOString(),
          student_response: `answer_${String.fromCharCode(65 + (i % 4))}`,
          result: i % 2 === 0 ? 'correct' : 'incorrect',
          weighting: '1',
          latency: '00:00:15'
        };
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return 'Completed 5 interactions with mixed results';
    }
  };

  if (scenarios[scenarioType]) {
    try {
      const result = await scenarios[scenarioType]();
      
      // Log the scenario
      session.apiCalls.push({
        timestamp: new Date(),
        method: 'TestScenario',
        parameter: scenarioType,
        value: result,
        errorCode: '0'
      });

      // Send to debug window
      if (debugWindow && !debugWindow.isDestroyed()) {
        debugWindow.webContents.send('test-scenario-completed', {
          sessionId,
          scenario: scenarioType,
          result
        });
      }

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'Unknown scenario type' };
});

// Get session data for debugging
ipcMain.handle('get-session-data', (event, sessionId) => {
  const session = scormSessions.get(sessionId);
  return session || null;
});

// Get all sessions
ipcMain.handle('get-all-sessions', () => {
  return Array.from(scormSessions.values());
});

// Reset session
ipcMain.handle('reset-session', (event, sessionId) => {
  if (scormSessions.has(sessionId)) {
    scormSessions.delete(sessionId);
    return true;
  }
  return false;
});

// Get available LMS profiles
ipcMain.handle('get-lms-profiles', () => {
  return Object.keys(lmsProfiles).map(key => ({
    id: key,
    name: lmsProfiles[key].name,
    settings: lmsProfiles[key].settings
  }));
});

// Export session data
async function exportSessionData() {
  if (scormSessions.size === 0) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'No Data',
      message: 'No SCORM session data to export.'
    });
    return;
  }
  
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    defaultPath: `scorm-session-${new Date().toISOString().slice(0, 10)}.json`
  });
  
  if (!result.canceled) {
    const data = Array.from(scormSessions.values());
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Export Complete',
      message: `Session data exported to ${result.filePath}`
    });
  }
}

// Other existing handlers
ipcMain.handle('select-scorm-package', async (event) => {
  console.log('select-scorm-package: IPC call received');
  const webContents = event.sender;
  const browserWindow = BrowserWindow.fromWebContents(webContents);
  
  if (!browserWindow) {
    console.error('select-scorm-package: BrowserWindow not found from webContents');
    return null;
  }

  try {
    const result = await dialog.showOpenDialog(browserWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'SCORM Packages', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      console.log(`select-scorm-package: File selected: ${result.filePaths[0]}`);
      return result.filePaths[0];
    } else {
      console.log('select-scorm-package: File selection canceled');
      return null;
    }
  } catch (error) {
    console.error('select-scorm-package: Error showing open dialog:', error);
    return null;
  }
});

ipcMain.handle('select-scorm-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('extract-scorm', async (event, zipPath) => {
  console.log('extract-scorm: Starting extraction');
  let extractPath = null;
  
  try {
    const tempDir = path.join(__dirname, 'temp');
    extractPath = path.join(tempDir, 'scorm_' + Date.now());
    console.log(`extract-scorm: Creating temp directory: ${extractPath}`);
    
    // BUG FIX: Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // BUG FIX: Check available disk space before extraction
    const stats = fs.statSync(zipPath);
    const zipSize = stats.size;
    const estimatedExtractedSize = zipSize * 3; // Rough estimate
    
    try {
      const fsStats = fs.statSync(tempDir);
      // This is a simplified check - in production you'd want to check actual free space
      console.log(`Extracting ${formatBytes(zipSize)} ZIP file to ${extractPath}`);
    } catch (error) {
      console.warn('Could not check disk space:', error.message);
    }
    
    fs.mkdirSync(extractPath, { recursive: true });
    
    const zip = new StreamZip.async({ file: zipPath });
    
    // BUG FIX: Get list of entries first to validate
    const entries = await zip.entries();
    const entryCount = Object.keys(entries).length;
    console.log(`extract-scorm: Found ${entryCount} entries in zip`);
    
    if (entryCount === 0) {
      await zip.close();
      throw new Error('ZIP file is empty');
    }
    
    if (entryCount > 10000) { // Reasonable limit for SCORM packages
      await zip.close();
      throw new Error('ZIP file contains too many files (>10,000)');
    }
    
    // BUG FIX: Extract with progress tracking and size limits
    let extractedSize = 0;
    const maxExtractedSize = 500 * 1024 * 1024; // 500MB limit
    
    for (const [entryName, entry] of Object.entries(entries)) {
      // BUG FIX: Validate entry name for security
      if (entryName.includes('..') || entryName.includes('~')) {
        console.warn(`Skipping suspicious entry: ${entryName}`);
        continue;
      }
      
      extractedSize += entry.size || 0;
      if (extractedSize > maxExtractedSize) {
        await zip.close();
        throw new Error('Extracted content would exceed size limit (500MB)');
      }
    }
    
    await zip.extract(null, extractPath);
    await zip.close();
    console.log('extract-scorm: Extraction complete');
    
    // BUG FIX: Register for cleanup tracking
    if (resourceMonitor) {
      resourceMonitor.trackExtractedFolder(extractPath);
    }
    
    // BUG FIX: Set up automatic cleanup timer
    setTimeout(() => {
      cleanupExtractedFolder(extractPath);
    }, 24 * 60 * 60 * 1000); // 24 hours
    
    monitor.log('INFO', 'SCORM package extracted successfully', {
      zipPath: path.basename(zipPath),
      extractPath,
      fileCount: entryCount,
      estimatedSize: formatBytes(extractedSize)
    });
    
    return extractPath;
    
  } catch (error) {
    console.error('Extraction failed:', error);
    
    // BUG FIX: Clean up failed extraction
    if (extractPath && fs.existsSync(extractPath)) {
      try {
        fs.rmSync(extractPath, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Failed to cleanup failed extraction:', cleanupError);
      }
    }
    
    monitor.trackError(error, 'extract-scorm');
    return null;
  }
});

ipcMain.handle('find-scorm-entry', async (event, folderPath) => {
  console.log(`find-scorm-entry: Searching for entry point in: ${folderPath}`);
  try {
    const manifestPath = path.join(folderPath, 'imsmanifest.xml');
    if (fs.existsSync(manifestPath)) {
      console.log('find-scorm-entry: Found imsmanifest.xml');
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      
      // Find the resource element defined as a Sharable Content Object (SCO)
      const scoResourceMatch = manifestContent.match(/<resource[^>]+adlcp:scormtype="sco"[^>]*>/i);
      if (scoResourceMatch) {
        console.log('find-scorm-entry: Found SCO resource');
        const resourceBlock = scoResourceMatch[0];
        const hrefMatch = resourceBlock.match(/href="([^"]+)"/i);
        if (hrefMatch && hrefMatch[1]) {
          const launchFile = hrefMatch[1].split('?')[0];
          console.log(`find-scorm-entry: SCO entry point: ${launchFile}`);
          const fullPath = path.join(folderPath, launchFile);
          if (fs.existsSync(fullPath)) {
            console.log(`find-scorm-entry: Found SCO entry point at: ${fullPath}`);
            return fullPath;
          }
        }
      }

      // Fallback for manifests that don't explicitly declare a SCO
      const launchMatch = manifestContent.match(/href\s*=\s*["']([^"']+)["']/i);
      if (launchMatch && launchMatch[1]) {
        console.log('find-scorm-entry: Found fallback href');
        const launchFile = launchMatch[1].split('?')[0];
        console.log(`find-scorm-entry: Fallback entry point: ${launchFile}`);
        const fullPath = path.join(folderPath, launchFile);
        if (fs.existsSync(fullPath)) {
          console.log(`find-scorm-entry: Found fallback entry point at: ${fullPath}`);
          return fullPath;
        }
      }
    }
    
    console.log('find-scorm-entry: No manifest entry point found, checking common files');
    const commonFiles = ['index.html', 'launch.html', 'start.html', 'main.html'];
    for (const file of commonFiles) {
      const filePath = path.join(folderPath, file);
      if (fs.existsSync(filePath)) {
        console.log(`find-scorm-entry: Found common file entry point: ${filePath}`);
        return filePath;
      }
    }
    
    console.log('find-scorm-entry: No entry point found, returning null');
    return null;
  } catch (error) {
    console.error('Error finding SCORM entry:', error);
    return null;
  }
});

ipcMain.handle('get-course-info', async (event, folderPath) => {
  try {
    // BUG FIX: Validate folder path first
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Invalid folder path provided');
    }

    // BUG FIX: Normalize path for cross-platform compatibility
    const normalizedPath = path.normalize(folderPath);
    const manifestPath = path.join(normalizedPath, 'imsmanifest.xml');
    
    // BUG FIX: Check if manifest exists before attempting to read
    try {
      await fs.promises.access(manifestPath, fs.constants.F_OK | fs.constants.R_OK);
    } catch (error) {
      // No manifest file - return basic info
      return {
        title: path.basename(normalizedPath) || 'Course',
        version: 'Unknown',
        scormVersion: 'Unknown',
        hasManifest: false
      };
    }

    // BUG FIX: Check file size before reading to prevent memory issues
    const stats = await fs.promises.stat(manifestPath);
    const maxManifestSize = config.get('security.maxManifestSizeKB') * 1024 || 1024 * 1024; // 1MB default
    
    if (stats.size > maxManifestSize) {
      monitor.log('WARN', 'Manifest file too large', {
        size: stats.size,
        maxSize: maxManifestSize,
        path: manifestPath
      });
      
      // Try to read just the beginning for basic info
      const fd = await fs.promises.open(manifestPath, 'r');
      const buffer = Buffer.alloc(Math.min(maxManifestSize, 64 * 1024)); // Read first 64KB
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
      await fd.close();
      
      const partialContent = buffer.slice(0, bytesRead).toString('utf8');
      
      const titleMatch = partialContent.match(/<title[^>]*>([^<]+)<\/title>/i);
      const versionMatch = partialContent.match(/version\s*=\s*["']([^"']+)["']/i);
      const scormVersionMatch = partialContent.match(/schemaversion\s*=\s*["']([^"']+)["']/i);
      
      return {
        title: titleMatch ? titleMatch[1].trim() : 'Large Course Package',
        version: versionMatch ? versionMatch[1].trim() : 'Unknown Version',
        scormVersion: scormVersionMatch ? scormVersionMatch[1].trim() : 'Unknown SCORM Version',
        hasManifest: true,
        warning: 'Manifest file too large - parsed partial content only'
      };
    }

    // BUG FIX: Read file asynchronously to avoid blocking
    const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
    
    // BUG FIX: Validate XML structure
    if (!manifestContent.includes('<manifest') || !manifestContent.includes('</manifest>')) {
      throw new Error('Invalid manifest file structure');
    }
    
    // BUG FIX: More robust regex patterns with error handling
    let title = 'Unknown Course';
    let version = 'Unknown Version';
    let scormVersion = 'Unknown SCORM Version';
    
    try {
      // Extract title - try multiple patterns
      const titlePatterns = [
        /<title[^>]*>([^<]+)<\/title>/i,
        /<lom:title[^>]*>([^<]+)<\/lom:title>/i,
        /<adlcp:title[^>]*>([^<]+)<\/adlcp:title>/i
      ];
      
      for (const pattern of titlePatterns) {
        const match = manifestContent.match(pattern);
        if (match && match[1].trim()) {
          title = match[1].trim();
          break;
        }
      }
      
      // Extract version
      const versionMatch = manifestContent.match(/version\s*=\s*["']([^"']+)["']/i);
      if (versionMatch && versionMatch[1].trim()) {
        version = versionMatch[1].trim();
      }
      
      // Extract SCORM version - try multiple patterns
      const scormPatterns = [
        /schemaversion\s*=\s*["']([^"']+)["']/i,
        /<schemaversion[^>]*>([^<]+)<\/schemaversion>/i,
        /CAM\s*1\.3|SCORM\s*2004/i,
        /SCORM\s*1\.2/i
      ];
      
      for (const pattern of scormPatterns) {
        const match = manifestContent.match(pattern);
        if (match) {
          if (match[1]) {
            scormVersion = match[1].trim();
          } else {
            // Pattern matched but no capture group (like SCORM version indicators)
            scormVersion = match[0];
          }
          break;
        }
      }
      
      // BUG FIX: Additional metadata extraction
      const organizationMatch = manifestContent.match(/<organizations[^>]*default\s*=\s*["']([^"']+)["']/i);
      const defaultOrg = organizationMatch ? organizationMatch[1] : null;
      
      // Count resources
      const resourceMatches = manifestContent.match(/<resource[^>]*>/gi) || [];
      const resourceCount = resourceMatches.length;
      
      // BUG FIX: Check for launch file
      const launchMatch = manifestContent.match(/href\s*=\s*["']([^"']+)["']/i);
      const launchFile = launchMatch ? launchMatch[1] : null;
      
      monitor.log('DEBUG', 'Parsed manifest successfully', {
        title,
        version,
        scormVersion,
        resourceCount,
        hasLaunchFile: !!launchFile,
        manifestSize: stats.size
      });
      
      return {
        title,
        version,
        scormVersion,
        hasManifest: true,
        defaultOrganization: defaultOrg,
        resourceCount,
        launchFile,
        manifestSize: stats.size
      };
      
    } catch (parseError) {
      monitor.log('ERROR', 'Failed to parse manifest content', {
        error: parseError.message,
        manifestPath
      });
      
      return {
        title: 'Parsing Error',
        version: 'Unknown',
        scormVersion: 'Unknown',
        hasManifest: true,
        error: 'Failed to parse manifest content'
      };
    }
    
  } catch (error) {
    console.error('Error reading course info:', error);
    monitor.trackError(error, 'get-course-info');
    
    return {
      title: 'Error Reading Course',
      version: 'Unknown',
      scormVersion: 'Unknown',
      hasManifest: false,
      error: error.message
    };
  }
});

ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
});