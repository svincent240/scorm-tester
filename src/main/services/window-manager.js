/**
 * Window Manager Service
 * 
 * Manages all Electron window lifecycle operations including main window,
 * debug window, and window state persistence.
 * 
 * @fileoverview Window management service for SCORM Tester main process
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const BaseService = require('./base-service');
const MenuBuilder = require('./menu-builder');
const PathUtils = require('../../shared/utils/path-utils');
const {
  WINDOW_TYPES,
  WINDOW_STATES,
  SERVICE_DEFAULTS,
  SERVICE_EVENTS
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');
const { protocol } = require('electron'); // Add protocol import back for registerFileProtocol

/**
 * Window Manager Service Class
 * 
 * Handles creation, management, and lifecycle of all application windows.
 */
class WindowManager extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('WindowManager', errorHandler, logger, options);
    
    this.windows = new Map();
    this.windowStates = new Map();
    this.config = { ...SERVICE_DEFAULTS.WINDOW_MANAGER, ...options };
    this.menuBuilder = new MenuBuilder(this, logger);
    this.protocolRegistered = false;

    
  }

  /**
   * Validate dependencies
   */
  validateDependencies() {
    // WindowManager can optionally use IpcHandler for API call buffering
    return true;
  }

  /**
   * Initialize window manager service
   */
  async doInitialize() {
    this.initializeWindowStates();
    await this.registerCustomProtocol();
  }

  /**
   * Shutdown window manager service
   */
  async doShutdown() {
    this.logger?.debug('WindowManager: Starting shutdown');
    
    for (const [windowType, window] of this.windows) {
      if (window && !window.isDestroyed()) {
        this.logger?.debug(`WindowManager: Closing ${windowType} window`);
        window.close();
      }
    }
    
    this.windows.clear();
    this.windowStates.clear();
    this.logger?.debug('WindowManager: Shutdown completed');
  }

  /**
   * Create main application window
   */
  async createMainWindow() {
    try {
      this.logger?.info('WindowManager: Creating main window');
      this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.CREATING);
      
      // Calculate optimal window size based on screen dimensions
      const optimalSize = this.calculateOptimalWindowSize();
      
      const mainWindow = new BrowserWindow({
        width: optimalSize.width,
        height: optimalSize.height,
        minWidth: this.config.mainWindow.minWidth,
        minHeight: this.config.mainWindow.minHeight,
        center: true,
        maximizable: true,
        resizable: true,
        webPreferences: {
          nodeIntegration: !!this.config.mainWindow.nodeIntegration,
          contextIsolation: !!this.config.mainWindow.contextIsolation,
          enableRemoteModule: false,
          webSecurity: !!this.config.mainWindow.webSecurity,
          allowRunningInsecureContent: !!this.config.mainWindow.allowRunningInsecureContent,
          preload: PathUtils.getPreloadPath(__dirname)
        },
        show: false
      });

      this.windows.set(WINDOW_TYPES.MAIN, mainWindow);
      this.setupMainWindowEvents(mainWindow);
      this.setupConsoleLogging(mainWindow);
      
      // Validate index.html exists before loading
      const appRoot = PathUtils.getAppRoot(__dirname);
      const indexPath = path.join(appRoot, 'index.html');
      if (!PathUtils.fileExists(indexPath)) {
        throw new Error(`index.html not found at path: ${indexPath}`);
      }
      
      try {
        // Use custom protocol to avoid Windows file:// issues
        await mainWindow.loadURL('scorm-app://index.html');
        
        this.menuBuilder.createApplicationMenu(mainWindow);
        
        if (process.env.NODE_ENV === 'development') {
          mainWindow.webContents.openDevTools();
        }
        
        mainWindow.show();
        
        this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.READY);
        this.emit(SERVICE_EVENTS.WINDOW_CREATED, {
          windowType: WINDOW_TYPES.MAIN,
          windowId: mainWindow.id
        });
        
        this.logger?.info(`WindowManager: Main window created successfully (ID: ${mainWindow.id})`);
        this.recordOperation('createMainWindow', true);
        
        return mainWindow;
        
      } catch (error) {
        this.logger?.error('WindowManager: Failed to load main application file:', error);
        throw error;
      }
    } catch (error) {
      this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.CLOSED);
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.WINDOW_CREATION_FAILED,
        `Main window creation failed: ${error.message}`,
        'WindowManager.createMainWindow'
      );
      
      this.logger?.error('WindowManager: Main window creation failed:', error);
      this.recordOperation('createMainWindow', false);
      throw error;
    }
  }

  /**
   * Create SCORM Inspector window
   */
  async createScormInspectorWindow() {
    try {
      const existingInspectorWindow = this.windows.get(WINDOW_TYPES.SCORM_INSPECTOR);
      if (existingInspectorWindow && !existingInspectorWindow.isDestroyed()) {
        try { existingInspectorWindow.focus(); } catch (_) {}
        return existingInspectorWindow;
      }

      this.logger?.info('WindowManager: Creating SCORM Inspector window');
      this.setWindowState(WINDOW_TYPES.SCORM_INSPECTOR, WINDOW_STATES.CREATING);
      
      const mainWindow = this.windows.get(WINDOW_TYPES.MAIN);
      const inspectorWindow = new BrowserWindow({
        ...this.config.scormInspectorWindow,
        parent: mainWindow,
        webPreferences: {
          nodeIntegration: !!this.config.scormInspectorWindow.nodeIntegration,
          contextIsolation: !!this.config.scormInspectorWindow.contextIsolation,
          webSecurity: typeof this.config.scormInspectorWindow.webSecurity !== 'undefined' ? !!this.config.scormInspectorWindow.webSecurity : !!this.config.mainWindow.webSecurity,
          allowRunningInsecureContent: typeof this.config.scormInspectorWindow.allowRunningInsecureContent !== 'undefined' ? !!this.config.scormInspectorWindow.allowRunningInsecureContent : !!this.config.mainWindow.allowRunningInsecureContent,
          preload: PathUtils.getPreloadPath(__dirname)
        },
        title: 'SCORM Inspector',
        show: false
      });

      this.windows.set(WINDOW_TYPES.SCORM_INSPECTOR, inspectorWindow);
      this.setupScormInspectorWindowEvents(inspectorWindow);
      this.setupConsoleLogging(inspectorWindow);
      
      // Load SCORM Inspector window content using simple protocol format
      await inspectorWindow.loadURL('scorm-app://scorm-inspector.html');
      
      inspectorWindow.show();
      this.setWindowState(WINDOW_TYPES.SCORM_INSPECTOR, WINDOW_STATES.READY);
      
      this.logger?.info(`WindowManager: SCORM Inspector window created successfully (ID: ${inspectorWindow.id})`);
      this.recordOperation('createScormInspectorWindow', true);
      
      return inspectorWindow;
      
    } catch (error) {
      this.setWindowState(WINDOW_TYPES.SCORM_INSPECTOR, WINDOW_STATES.CLOSED);
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.WINDOW_CREATION_FAILED,
        `SCORM Inspector window creation failed: ${error.message}`,
        'WindowManager.createScormInspectorWindow'
      );
      
      this.logger?.error('WindowManager: SCORM Inspector window creation failed:', error);
      this.recordOperation('createScormInspectorWindow', false);
      throw error;
    }
  }

  /**
   * Get window instance by type
   */
  getWindow(windowType) {
    const window = this.windows.get(windowType);
    return (window && !window.isDestroyed()) ? window : null;
  }

  /**
   * Get all active windows for broadcasting
   * @returns {Array} Array of active window instances
   */
  getAllWindows() {
    const activeWindows = [];
    
    for (const [windowType, window] of this.windows) {
      if (window && !window.isDestroyed()) {
        activeWindows.push(window);
      }
    }
    
    return activeWindows;
  }

  /**
   * Get window state by type
   */
  getWindowState(windowType) {
    return this.windowStates.get(windowType) || WINDOW_STATES.CLOSED;
  }

  /**
   * Broadcast message to all active windows
   * @param {string} channel - IPC channel to send message on
   * @param {any} data - Data to send
   * @returns {number} Number of windows the message was sent to
   */
  broadcastToAllWindows(channel, data) {
    const activeWindows = this.getAllWindows();
    let successCount = 0;

    for (const window of activeWindows) {
      try {
        if (window && window.webContents && !window.webContents.isDestroyed()) {
          window.webContents.send(channel, data);
          successCount++;
        }
      } catch (error) {
        this.logger?.warn(`Failed to send message to window on channel '${channel}':`, error.message);
      }
    }

    this.logger?.debug(`Broadcasted message on channel '${channel}' to ${successCount} windows`);
    return successCount;
  }

  /**
   * Register custom protocol for app resources
   * @private
   */
  async registerCustomProtocol() {
    if (this.protocolRegistered) {
      return;
    }

    try {
      const success = protocol.registerFileProtocol('scorm-app', (request, callback) => {
        try {
          const appRoot = PathUtils.getAppRoot(__dirname);
          const result = PathUtils.handleProtocolRequest(request.url, appRoot);
          
          if (result.success && result.resolvedPath) {
            callback({ path: result.resolvedPath });
          } else {
            this.logger?.debug('WindowManager: Protocol request failed', { 
              url: request.url, 
              error: result.error 
            });
            callback({ error: -6 }); // ERR_FILE_NOT_FOUND
          }
        } catch (error) {
          this.logger?.error('WindowManager: Protocol handler error:', error.message);
          callback({ error: -6 }); // ERR_FILE_NOT_FOUND
        }
      });

      if (success) {
        this.protocolRegistered = true;
        this.logger?.info('WindowManager: Custom protocol "scorm-app://" registered successfully');
        this.logger?.info('WindowManager: Storage-capable origin feature is active');
      } else {
        throw new Error('Failed to register custom protocol');
      }
      
    } catch (error) {
      this.logger?.error('WindowManager: Failed to register custom protocol:', error);
      throw error;
    }
  }

  /**
   * Initialize window state tracking
   */
  initializeWindowStates() {
    this.windowStates.set(WINDOW_TYPES.MAIN, WINDOW_STATES.CLOSED);
  }

  /**
   * Set window state and emit event
   */
  setWindowState(windowType, state) {
    const oldState = this.windowStates.get(windowType);
    this.windowStates.set(windowType, state);
    
    this.logger?.debug(`WindowManager: ${windowType} window state: ${oldState} -> ${state}`);
    this.emit('windowStateChanged', { windowType, oldState, newState: state });
  }

  /**
   * Set up main window event handlers
   */
  setupMainWindowEvents(mainWindow) {
    this.setupCommonWindowEvents(mainWindow, WINDOW_TYPES.MAIN);
    
    mainWindow.on('ready-to-show', () => {
      this.emit(SERVICE_EVENTS.WINDOW_READY, { 
        windowType: WINDOW_TYPES.MAIN, 
        windowId: mainWindow.id 
      });
    });
  }

  /**
   * Set up SCORM Inspector window event handlers
   */
  setupScormInspectorWindowEvents(inspectorWindow) {
    this.setupCommonWindowEvents(inspectorWindow, WINDOW_TYPES.SCORM_INSPECTOR);
  }

  /**
   * Set up common window event handlers
   * @private
   */
  setupCommonWindowEvents(window, windowType) {
    window.on('closed', () => {
      this.windows.delete(windowType);
      this.setWindowState(windowType, WINDOW_STATES.CLOSED);
      this.emit(SERVICE_EVENTS.WINDOW_CLOSED, { windowType });
    });

    window.on('focus', () => {
      this.setWindowState(windowType, WINDOW_STATES.FOCUSED);
    });

    window.on('minimize', () => {
      this.setWindowState(windowType, WINDOW_STATES.MINIMIZED);
    });

    window.on('maximize', () => {
      this.setWindowState(windowType, WINDOW_STATES.MAXIMIZED);
    });
  }

  /**
   * Set up console logging redirection to main log file
   */
  setupConsoleLogging(window) {
    // Capture all console messages from renderer process
    window.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const logLevel = this.mapConsoleLevel(level);
      const source = sourceId ? `${sourceId}:${line}` : 'renderer';
      this.logger?.[logLevel](`[Renderer Console] ${message} (${source})`);
    });

    // Capture JavaScript errors
    window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.logger?.error(`[Renderer Load Error] ${errorDescription} (${errorCode}) - URL: ${validatedURL}`);
    });

    // Capture unhandled exceptions
    window.webContents.on('crashed', (event, killed) => {
      this.logger?.error(`[Renderer Crash] Renderer process crashed. Killed: ${killed}`);
    });

    // Capture DOM ready and script loading
    window.webContents.on('dom-ready', () => {
      this.logger?.info('[Renderer] DOM ready');
    });

    window.webContents.on('did-finish-load', () => {
      this.logger?.info('[Renderer] Page finished loading');
    });
  }

  /**
   * Map Electron console levels to logger levels
   */
  mapConsoleLevel(level) {
    switch (level) {
      case 0: return 'debug';  // verbose
      case 1: return 'info';   // info
      case 2: return 'warn';   // warning
      case 3: return 'error';  // error
      default: return 'info';
    }
  }

  /**
   * Calculate optimal window size based on screen dimensions
   * @private
   */
  calculateOptimalWindowSize() {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      
      this.logger?.info(`WindowManager: Screen work area: ${screenWidth}x${screenHeight}`);
      
      // Calculate optimal size as percentage of screen size
      // Use 85% of screen width and 90% of screen height for good usability
      const optimalWidth = Math.floor(screenWidth * 0.85);
      const optimalHeight = Math.floor(screenHeight * 0.90);
      
      // Constrain to configured min/max values
      const finalWidth = Math.max(
        this.config.mainWindow.minWidth,
        Math.min(optimalWidth, this.config.mainWindow.width || 1200)
      );
      
      const finalHeight = Math.max(
        this.config.mainWindow.minHeight,
        Math.min(optimalHeight, this.config.mainWindow.height || 800)
      );
      
      return {
        width: finalWidth,
        height: finalHeight,
        screenWidth,
        screenHeight
      };
      
    } catch (error) {
      this.logger?.error('WindowManager: Failed to calculate optimal window size:', error);
      // Fallback to configured defaults
      return {
        width: this.config.mainWindow.width,
        height: this.config.mainWindow.height,
        screenWidth: 1920, // Assume common resolution
        screenHeight: 1080
      };
    }
  }


  
}
 
/**
 * Set the telemetry store instance.
 * This is called after the telemetry store is initialized in the main process.
 * @param {ScormInspectorTelemetryStore} telemetryStore - The SCORM Inspector telemetry store instance.
 */
WindowManager.prototype.setTelemetryStore = function(telemetryStore) {
  this.telemetryStore = telemetryStore;
  this.logger?.debug('WindowManager: TelemetryStore instance set.');
};
 
module.exports = WindowManager;