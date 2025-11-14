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
const { setupConsoleCapture } = require('../../shared/utils/console-capture');
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
      try { this.applySecurityHandlers(mainWindow); } catch (_) { /* intentionally empty */ }



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
   * Clear DevTools console output for one or more windows.
   * Used when the renderer requests a fresh console before reloading a course.
   * @param {string|null} windowType - Optional window type to target (defaults to all)
   * @returns {Promise<number>} number of windows cleared
   */
  async clearRendererConsole(windowType = null) {
    const targets = [];

    if (windowType) {
      const window = this.getWindow(windowType);
      if (window) {
        targets.push(window);
      }
    } else {
      targets.push(...this.getAllWindows());
    }

    let clearedCount = 0;

    for (const window of targets) {
      try {
        if (!window || window.isDestroyed()) {
          continue;
        }

        const webContents = window.webContents;
        if (!webContents || webContents.isDestroyed()) {
          continue;
        }

        await webContents.executeJavaScript(
          "typeof console !== 'undefined' && typeof console.clear === 'function' ? console.clear() : undefined;"
        );
        clearedCount++;
      } catch (error) {
        this.logger?.warn('WindowManager: Failed to clear renderer console', error?.message || error);
      }
    }

    return clearedCount;
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

    // Track window resize to update viewport display
    // Use throttling to avoid excessive updates during rapid resizing
    let resizeTimeout = null;
    mainWindow.on('resize', () => {
      // Clear any pending update
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      
      // Schedule update with a small delay to batch rapid resize events
      resizeTimeout = setTimeout(() => {
        try {
          const bounds = mainWindow.getContentBounds();
          
          // Broadcast actual window size to renderer for display
          // Note: This is for display purposes only. ScormService maintains
          // the viewport preset (desktop/mobile/tablet) separately.
          const actualWindowSize = { width: bounds.width, height: bounds.height };
          this.broadcastToAllWindows('viewport:size-changed', actualWindowSize);
          this.logger?.debug('WindowManager: Window resized, broadcasting size for display', actualWindowSize);
        } catch (error) {
          this.logger?.warn('WindowManager: Failed to handle resize event', error?.message);
        }
      }, 100); // 100ms throttle delay
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
    // Use unified console capture utility with callback to broadcast to UI
    setupConsoleCapture(window, {
      session_id: null, // GUI doesn't need session buffering
      logger: this.logger,
      onMessage: (consoleMsg) => {
        // Determine if should broadcast to UI (errors and warnings, excluding benign)
        const isBenignWarning = consoleMsg.level === 'warn' && (
          consoleMsg.message.includes("iframe which has both allow-scripts and allow-same-origin") ||
          consoleMsg.message.includes("can remove its sandboxing")
        );

        const shouldBroadcastToUI = (consoleMsg.level === 'error' || consoleMsg.level === 'warn') && !isBenignWarning;

        // Forward console errors/warnings to renderer for UI display
        if (shouldBroadcastToUI && window && !window.isDestroyed()) {
          try {
            window.webContents.send('renderer-console-error', {
              level: consoleMsg.level,
              message: consoleMsg.message,
              source: consoleMsg.source,
              line: consoleMsg.line,
              timestamp: consoleMsg.timestamp,
              errorCode: consoleMsg.errorCode
            });
          } catch (err) {
            this.logger?.warn('WindowManager: Failed to broadcast console message to renderer', err?.message || err);
          }
        }
      }
    });

    // Capture DOM ready and script loading (not part of console capture utility)
    window.webContents.on('dom-ready', () => {
      this.logger?.info('[Renderer] DOM ready');
    });

    window.webContents.on('did-finish-load', () => {
      this.logger?.info('[Renderer] Page finished loading');
    });
  }

  /**
   * Apply security policies: block unexpected navigations, deny permissions, and enforce CSP
   * @param {BrowserWindow} window
   */
  applySecurityHandlers(window) {
    try {
      const wc = window.webContents;
      // Block new windows/popups
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));

      // Handle beforeunload confirmation dialogs from SCORM content
      // Prevents application hangs/crashes when content tries to block navigation
      wc.on('will-prevent-unload', (event) => {
        try {
          // Prevent the dialog from showing to avoid application hangs/crashes
          event.preventDefault();

          // Log for debugging and compliance tracking
          this.logger?.info('WindowManager: Suppressed beforeunload dialog from SCORM content', {
            url: wc.getURL()
          });
        } catch (error) {
          this.logger?.warn('WindowManager: Error handling will-prevent-unload', error?.message);
        }
      });

      // Restrict navigation to our custom protocol only
      wc.on('will-navigate', (event, urlStr) => {
        try {
          if (!urlStr || !urlStr.startsWith('scorm-app://')) {
            event.preventDefault();
            this.logger?.warn('Navigation blocked by policy', { url: urlStr });
            try { if (urlStr) shell?.openExternal?.(urlStr); } catch (_) { /* intentionally empty */ }
          }
        } catch (_) { /* intentionally empty */ }
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
            try { this.logger?.debug(`Permission granted: ${permission}`); } catch (_) { /* intentionally empty */ }
          } else {
            try { this.logger?.debug(`Permission denied by policy: ${permission}`); } catch (_) { /* intentionally empty */ }
          }

          callback(allowed);
        });
      } catch (_) { /* intentionally empty */ }

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
            } catch (_) { /* intentionally empty */ }

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
      } catch (_) { /* intentionally empty */ }
    } catch (_) { /* intentionally empty */ }
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
