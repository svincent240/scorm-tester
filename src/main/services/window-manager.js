/**
 * Window Manager Service
 * 
 * Manages all Electron window lifecycle operations including main window,
 * debug window, and window state persistence.
 * 
 * @fileoverview Window management service for SCORM Tester main process
 */

const { BrowserWindow, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const BaseService = require('./base-service');
const MenuBuilder = require('./menu-builder');
const { 
  WINDOW_TYPES, 
  WINDOW_STATES, 
  SERVICE_DEFAULTS,
  SERVICE_EVENTS 
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');

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
    return true; // No external dependencies
  }

  /**
   * Initialize window manager service
   */
  async doInitialize() {
    this.logger?.debug('WindowManager: Starting initialization');
    this.initializeWindowStates();
    await this.registerCustomProtocol();
    this.logger?.debug('WindowManager: Initialization completed');
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
      
      const mainWindow = new BrowserWindow({
        width: this.config.mainWindow.width,
        height: this.config.mainWindow.height,
        minWidth: this.config.mainWindow.minWidth,
        minHeight: this.config.mainWindow.minHeight,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          preload: path.join(__dirname, '../../preload.js')
        },
        show: false
      });

      this.windows.set(WINDOW_TYPES.MAIN, mainWindow);
      this.setupMainWindowEvents(mainWindow);
      this.setupConsoleLogging(mainWindow);
      
      // Load the main application HTML file using custom protocol
      const indexPath = path.join(__dirname, '../../../index.html');
      const resolvedPath = path.resolve(indexPath);
      
      if (!require('fs').existsSync(resolvedPath)) {
        throw new Error(`index.html not found at path: ${resolvedPath}`);
      }
      
      try {
        // Register custom protocol before loading
        await this.registerCustomProtocol();
        
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
      
      // This code is now handled in the Promise above
      
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
   * Create debug console window
   */
  async createDebugWindow() {
    try {
      const existingDebugWindow = this.windows.get(WINDOW_TYPES.DEBUG);
      if (existingDebugWindow && !existingDebugWindow.isDestroyed()) {
        existingDebugWindow.focus();
        return existingDebugWindow;
      }

      this.logger?.info('WindowManager: Creating debug window');
      this.setWindowState(WINDOW_TYPES.DEBUG, WINDOW_STATES.CREATING);
      
      const mainWindow = this.windows.get(WINDOW_TYPES.MAIN);
      const debugWindow = new BrowserWindow({
        ...this.config.debugWindow,
        parent: mainWindow,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../../preload.js')
        },
        title: 'SCORM Debug Console',
        show: false
      });

      this.windows.set(WINDOW_TYPES.DEBUG, debugWindow);
      this.setupDebugWindowEvents(debugWindow);
      
      await debugWindow.loadFile('debug.html');
      debugWindow.show();
      
      this.setWindowState(WINDOW_TYPES.DEBUG, WINDOW_STATES.READY);
      this.emit(SERVICE_EVENTS.WINDOW_CREATED, { 
        windowType: WINDOW_TYPES.DEBUG, 
        windowId: debugWindow.id 
      });
      
      this.logger?.info(`WindowManager: Debug window created successfully (ID: ${debugWindow.id})`);
      this.recordOperation('createDebugWindow', true);
      
      return debugWindow;
      
    } catch (error) {
      this.setWindowState(WINDOW_TYPES.DEBUG, WINDOW_STATES.CLOSED);
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.WINDOW_CREATION_FAILED,
        `Debug window creation failed: ${error.message}`,
        'WindowManager.createDebugWindow'
      );
      
      this.logger?.error('WindowManager: Debug window creation failed:', error);
      this.recordOperation('createDebugWindow', false);
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
   * Get window state by type
   */
  getWindowState(windowType) {
    return this.windowStates.get(windowType) || WINDOW_STATES.CLOSED;
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
      // Register the custom protocol
      const success = protocol.registerFileProtocol('scorm-app', (request, callback) => {
        try {
          // Extract the path from the custom protocol URL
          const url = request.url.substr(12); // Remove 'scorm-app://'
          const filePath = path.join(__dirname, '../../../', url);
          const normalizedPath = path.normalize(filePath);
          
          // Security check: ensure the path is within our app directory
          const appRoot = path.resolve(__dirname, '../../../');
          const resolvedPath = path.resolve(normalizedPath);
          
          if (!resolvedPath.startsWith(appRoot)) {
            this.logger?.error('WindowManager: Security violation - path outside app directory:', resolvedPath);
            callback({ error: -6 }); // ERR_FILE_NOT_FOUND
            return;
          }
          
          // Check if file exists
          if (!fs.existsSync(resolvedPath)) {
            this.logger?.error('WindowManager: File not found:', resolvedPath);
            callback({ error: -6 }); // ERR_FILE_NOT_FOUND
            return;
          }
          
          this.logger?.debug('WindowManager: Serving file via custom protocol:', resolvedPath);
          callback({ path: resolvedPath });
          
        } catch (error) {
          this.logger?.error('WindowManager: Error in custom protocol handler:', error);
          callback({ error: -2 }); // ERR_FAILED
        }
      });

      if (success) {
        this.protocolRegistered = true;
        this.logger?.info('WindowManager: Custom protocol "scorm-app://" registered successfully');
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
    this.windowStates.set(WINDOW_TYPES.DEBUG, WINDOW_STATES.CLOSED);
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
    mainWindow.on('ready-to-show', () => {
      this.emit(SERVICE_EVENTS.WINDOW_READY, { 
        windowType: WINDOW_TYPES.MAIN, 
        windowId: mainWindow.id 
      });
    });

    mainWindow.on('closed', () => {
      this.windows.delete(WINDOW_TYPES.MAIN);
      this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.CLOSED);
      this.emit(SERVICE_EVENTS.WINDOW_CLOSED, { windowType: WINDOW_TYPES.MAIN });
    });

    mainWindow.on('focus', () => {
      this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.FOCUSED);
    });

    mainWindow.on('minimize', () => {
      this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.MINIMIZED);
    });

    mainWindow.on('maximize', () => {
      this.setWindowState(WINDOW_TYPES.MAIN, WINDOW_STATES.MAXIMIZED);
    });
  }

  /**
   * Set up debug window event handlers
   */
  setupDebugWindowEvents(debugWindow) {
    debugWindow.on('closed', () => {
      this.windows.delete(WINDOW_TYPES.DEBUG);
      this.setWindowState(WINDOW_TYPES.DEBUG, WINDOW_STATES.CLOSED);
      this.emit(SERVICE_EVENTS.WINDOW_CLOSED, { windowType: WINDOW_TYPES.DEBUG });
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
}

module.exports = WindowManager;