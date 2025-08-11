/**
 * Window Manager Service
 * 
 * Manages all Electron window lifecycle operations including main window,
 * debug window, and window state persistence.
 * 
 * @fileoverview Window management service for SCORM Tester main process
 */

const { BrowserWindow, protocol, screen } = require('electron');
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

    // Singleflight guard for debug window creation to avoid duplicate windows under concurrency
    try {
      const createSingleflight = require('../../shared/utils/singleflight');
      this._createDebugSingleflight = (typeof createSingleflight === 'function') ? createSingleflight() : null;
    } catch (_) {
      this._createDebugSingleflight = null;
    }
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
      
      // Calculate optimal window size based on screen dimensions
      const optimalSize = this.calculateOptimalWindowSize();
      this.logger?.info(`WindowManager: Calculated optimal size: ${optimalSize.width}x${optimalSize.height}`);
      
      const mainWindow = new BrowserWindow({
        width: optimalSize.width,
        height: optimalSize.height,
        minWidth: this.config.mainWindow.minWidth,
        minHeight: this.config.mainWindow.minHeight,
        center: true,
        maximizable: true,
        resizable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          webSecurity: false, // Disable web security for custom protocol
          allowRunningInsecureContent: true, // Allow content from custom protocol
          preload: PathUtils.getPreloadPath(__dirname)
        },
        show: false
      });

      this.windows.set(WINDOW_TYPES.MAIN, mainWindow);
      this.setupMainWindowEvents(mainWindow);
      this.setupConsoleLogging(mainWindow);
      
      // Load the main application HTML file using custom protocol
      const appRoot = PathUtils.getAppRoot(__dirname);
      const indexPath = path.join(appRoot, 'index.html');
      
      if (!PathUtils.fileExists(indexPath)) {
        throw new Error(`index.html not found at path: ${indexPath}`);
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
    // Use singleflight to coalesce concurrent create requests and guarantee a single trailing execution
    if (this._createDebugSingleflight) {
      return this._createDebugSingleflight('createDebugWindow', async () => {
        // Inner implementation preserved from legacy createDebugWindow
        try {
          const existingDebugWindow = this.windows.get(WINDOW_TYPES.DEBUG);
          if (existingDebugWindow && !existingDebugWindow.isDestroyed()) {
            try { existingDebugWindow.focus(); } catch (_) {}
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
              webSecurity: false, // Disable web security for custom protocol
              allowRunningInsecureContent: true, // Allow content from custom protocol
              preload: PathUtils.getPreloadPath(__dirname)
            },
            title: 'SCORM Debug Console',
            show: false
          });
     
          this.windows.set(WINDOW_TYPES.DEBUG, debugWindow);
          this.setupDebugWindowEvents(debugWindow);
          this.setupConsoleLogging(debugWindow);
          
          // Use custom protocol like main window
          await debugWindow.loadURL('scorm-app://debug.html');
          debugWindow.show();
          
          this.setWindowState(WINDOW_TYPES.DEBUG, WINDOW_STATES.READY);
          this.emit(SERVICE_EVENTS.WINDOW_CREATED, {
            windowType: WINDOW_TYPES.DEBUG,
            windowId: debugWindow.id
          });
          
          // Send any buffered API calls to the newly created debug window
          this.sendBufferedApiCallsToDebugWindow(debugWindow);
          
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
      });
    }
 
    // Fallback when singleflight unavailable: use legacy behavior
    try {
      const existingDebugWindow = this.windows.get(WINDOW_TYPES.DEBUG);
      if (existingDebugWindow && !existingDebugWindow.isDestroyed()) {
        existingDebugWindow.focus();
        return existingDebugWindow;
      }
      this.logger?.warn('WindowManager: createDebugWindow invoked without singleflight guard (fallback)');
      // Reuse the same creation logic by recursively calling the singleflight-wrapped path when possible
      return await this.createDebugWindow();
    } catch (e) {
      // If recursion above fails due to no singleflight, throw original error
      throw e;
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
      // Register the custom protocol using consolidated PathUtils
      const success = protocol.registerFileProtocol('scorm-app', (request, callback) => {
        const appRoot = PathUtils.getAppRoot(__dirname);
        const result = PathUtils.handleProtocolRequest(request.url, appRoot);
        
        if (result.success) {
          callback({ path: result.resolvedPath });
        } else {
          // Handle undefined path errors more gracefully
          if (result.isUndefinedPath) {
            this.logger?.warn('WindowManager: Undefined path blocked - SCORM content JavaScript issue');
            this.logger?.warn('WindowManager: Requested path:', result.requestedPath);
            // Return a 404 but don't spam the logs with errors
            callback({ error: -6 }); // ERR_FILE_NOT_FOUND
          } else {
            // Handle other types of errors normally
            this.logger?.error('WindowManager: Protocol request failed:', result.error);
            this.logger?.error('WindowManager: Requested path:', result.requestedPath);
            if (result.resolvedPath) {
              this.logger?.error('WindowManager: Resolved path:', result.resolvedPath);
            }
            callback({ error: -6 }); // ERR_FILE_NOT_FOUND
          }
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

  /**
   * Send buffered API calls to debug window
   * @private
   */
  sendBufferedApiCallsToDebugWindow(debugWindow) {
    try {
      // Prefer a telemetry store if available (DebugTelemetryStore.flushTo)
      // Use the directly set telemetryStore instance
      if (this.telemetryStore && typeof this.telemetryStore.flushTo === 'function' && debugWindow && !debugWindow.isDestroyed()) {
        this.logger?.info('WindowManager: Flushing telemetry store to debug window');
        try {
          this.telemetryStore.flushTo(debugWindow.webContents);
          return;
        } catch (e) {
          // Do not fall back to IpcHandler buffered calls; telemetryStore is the single source of truth now.
          this.logger?.warn('WindowManager: telemetryStore.flushTo failed', e?.message || e);
        }
      }
 
      this.logger?.debug('WindowManager: No telemetry store available to send to debug window');
    } catch (error) {
      this.logger?.error('WindowManager: Failed to send buffered API calls:', error);
    }
  }
}
 
/**
 * Set the telemetry store instance.
 * This is called after the telemetry store is initialized in the main process.
 * @param {DebugTelemetryStore} telemetryStore - The telemetry store instance.
 */
WindowManager.prototype.setTelemetryStore = function(telemetryStore) {
  this.telemetryStore = telemetryStore;
  this.logger?.debug('WindowManager: TelemetryStore instance set.');
};
 
module.exports = WindowManager;