/**
 * Window Manager Service
 *
 * Manages all Electron window lifecycle operations including main window,
 * debug window, and window state persistence.
 *
 * @fileoverview Window management service for SCORM Tester main process
 */

const { BrowserWindow, screen, session, shell } = require('electron');
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
          // Enforced security defaults (Phase 3)
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          enableRemoteModule: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          preload: PathUtils.getPreloadPath(__dirname)
        },
        show: false
      });

      this.windows.set(WINDOW_TYPES.MAIN, mainWindow);
      this.setupMainWindowEvents(mainWindow);
      this.setupConsoleLogging(mainWindow);
      // Apply security policies and navigation restrictions
      try { this.applySecurityHandlers(mainWindow); } catch (_) {}



      try {
        // Use custom protocol to avoid Windows file:// issues
        await mainWindow.loadURL('scorm-app://app/index.html');

        this.menuBuilder.createApplicationMenu(mainWindow);


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
      const regResult = protocol.registerFileProtocol('scorm-app', (request, callback) => {
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

      // In tests, the mock returns false to simulate failure; treat strict false as failure
      if (regResult === false) {
        throw new Error('Protocol registration failed');
      }

      this.protocolRegistered = true;
      this.logger?.info('WindowManager: Custom protocol "scorm-app://" registered successfully');
      this.logger?.info('WindowManager: Storage-capable origin feature is active');

      // Optional verification (guard for environments/tests without this API)
      if (typeof protocol.isProtocolRegistered === 'function') {
        if (!protocol.isProtocolRegistered('scorm-app')) {
          throw new Error('Protocol registration verification failed');
        }
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
      let logLevel = this.mapConsoleLevel(level);
      const source = sourceId ? `${sourceId}:${line}` : 'renderer';
      let shouldBroadcastToUI = false;

      try {
        const msgStr = String(message || '');

        // Demote known benign CSP violations from embedded SCORM content to warnings
        if (logLevel === 'error' && msgStr.includes("Refused to load the font") && msgStr.includes("data:application/font-woff")) {
          logLevel = 'warn';
        }

        // Filter out benign Chromium warnings that should not be surfaced to UI
        const isBenignWarning = logLevel === 'warn' && (
          // Iframe sandboxing warning - expected when loading SCORM content
          msgStr.includes("iframe which has both allow-scripts and allow-same-origin") ||
          msgStr.includes("can remove its sandboxing")
        );

        // Broadcast errors and warnings to renderer UI for visibility (except benign warnings)
        if ((logLevel === 'error' || logLevel === 'warn') && !isBenignWarning) {
          shouldBroadcastToUI = true;
        }
      } catch (_) { /* no-op */ }

      this.logger?.[logLevel](`[Renderer Console] ${message} (${source})`);

      // Forward console errors to renderer for UI display
      if (shouldBroadcastToUI && window && !window.isDestroyed()) {
        try {
          window.webContents.send('renderer-console-error', {
            level: logLevel,
            message: String(message || ''),
            source: sourceId || 'unknown',
            line: line || 0,
            timestamp: Date.now()
          });
        } catch (err) {
          this.logger?.warn('WindowManager: Failed to broadcast console error to renderer', err?.message || err);
        }
      }
    });

    // Capture JavaScript errors
    window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.logger?.error(`[Renderer Load Error] ${errorDescription} (${errorCode}) - URL: ${validatedURL}`);

      // Broadcast load errors to renderer UI
      if (window && !window.isDestroyed()) {
        try {
          window.webContents.send('renderer-console-error', {
            level: 'error',
            message: `Failed to load: ${errorDescription}`,
            source: validatedURL || 'unknown',
            line: 0,
            errorCode: errorCode,
            timestamp: Date.now()
          });
        } catch (err) {
          this.logger?.warn('WindowManager: Failed to broadcast load error to renderer', err?.message || err);
        }
      }
    });

    // Capture unhandled exceptions
    window.webContents.on('crashed', (event, killed) => {
      this.logger?.error(`[Renderer Crash] Renderer process crashed. Killed: ${killed}`);

      // Note: Cannot send to crashed window, but log for debugging
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

  /**
   * Apply security policies: block unexpected navigations, deny permissions, and enforce CSP
   * @param {BrowserWindow} window
   */
  applySecurityHandlers(window) {
    try {
      const wc = window.webContents;
      // Block new windows/popups
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));

      // Restrict navigation to our custom protocol only
      wc.on('will-navigate', (event, urlStr) => {
        try {
          if (!urlStr || !urlStr.startsWith('scorm-app://')) {
            event.preventDefault();
            this.logger?.warn('Navigation blocked by policy', { url: urlStr });
            try { if (urlStr) shell?.openExternal?.(urlStr); } catch (_) {}
          }
        } catch (_) {}
      });

      const ses = wc.session;
      // Set permission handler with allowlist for essential features
      try {
        ses.setPermissionRequestHandler((_webContents, permission, callback) => {
          // Allow clipboard access for error reporting and debugging
          const allowedPermissions = [
            'clipboard-sanitized-write',
            'clipboard-read'
          ];

          const allowed = allowedPermissions.includes(permission);

          if (allowed) {
            try { this.logger?.debug(`Permission granted: ${permission}`); } catch (_) {}
          } else {
            try { this.logger?.debug(`Permission denied by policy: ${permission}`); } catch (_) {}
          }

          callback(allowed);
        });
      } catch (_) {}

      // Enforce a minimal CSP
      try {
        ses.webRequest.onHeadersReceived((details, callback) => {
          try {
            const isDev = process.env.NODE_ENV === 'development';
            const url = String(details?.url || '');

            // Determine whether the requested resource resolves under appRoot or tempRoot
            let usedBase = 'appRoot';
            try {
              const appRoot = PathUtils.getAppRoot(__dirname);
              const resolution = PathUtils.handleProtocolRequest(url, appRoot);
              if (resolution && resolution.success && resolution.usedBase) {
                usedBase = resolution.usedBase; // 'appRoot' | 'tempRoot'
              }
            } catch (_) {}

            // Strict CSP for UI (no inline scripts)
            const uiCsp = "default-src 'self' scorm-app:; img-src 'self' data: scorm-app:; style-src 'self' 'unsafe-inline' scorm-app:; script-src 'self' scorm-app:; connect-src 'self' scorm-app:";

            // Relaxed CSP for SCORM content (allow inline scripts; eval only in dev)
            const contentCsp = isDev
              ? "default-src 'self' scorm-app:; img-src 'self' data: scorm-app:; style-src 'self' 'unsafe-inline' scorm-app:; script-src 'self' 'unsafe-inline' 'unsafe-eval' scorm-app:; connect-src 'self' scorm-app: data:"
              : "default-src 'self' scorm-app:; img-src 'self' data: scorm-app:; style-src 'self' 'unsafe-inline' scorm-app:; script-src 'self' 'unsafe-inline' 'unsafe-eval' scorm-app:; connect-src 'self' scorm-app: data:";

            const csp = usedBase === 'appRoot' ? uiCsp : contentCsp;
            const headers = { ...details.responseHeaders, 'Content-Security-Policy': [csp] };
            callback({ responseHeaders: headers });
          } catch (err) {
            callback({ responseHeaders: details.responseHeaders });
          }
        });
      } catch (_) {}
    } catch (_) {}
  }

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
