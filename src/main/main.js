/**
 * SCORM Tester Main Process Entry Point
 * 
 * Refactored main process that orchestrates all Phase 4 services with
 * dependency injection, lifecycle management, and error handling.
 * 
 * @fileoverview Simplified main process entry point for SCORM Tester
 */

const { app, BrowserWindow } = require('electron');

// Service imports
const WindowManager = require('./services/window-manager');
const IpcHandler = require('./services/ipc-handler');
const FileManager = require('./services/file-manager');
const ScormService = require('./services/scorm-service');
const RecentCoursesService = require('./services/recent-courses-service');

// Shared utilities
const ScormErrorHandler = require('./services/scorm/rte/error-handler');
const getLogger = require('../shared/utils/logger');
const { SERVICE_EVENTS } = require('../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../shared/constants/error-codes');

/**
 * Main Process Application Class
 */
class MainProcess {
  constructor() {
    this.services = new Map();
    this.logger = null;
    this.errorHandler = null;
    this.isInitialized = false;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the main process and all services
   */
  async initialize() {
    try {
      console.log('SCORM Tester: Starting main process initialization');
      
      await this.initializeCoreDependencies();
      await this.initializeServices();
      this.setupApplicationEvents();
      await this.createMainWindow();
      
      this.isInitialized = true;
      this.logger?.info('SCORM Tester: Main process initialization completed successfully');
      
    } catch (error) {
      console.error('SCORM Tester: Main process initialization failed:', error);
      
      if (this.errorHandler) {
        this.errorHandler.setError(
          MAIN_PROCESS_ERRORS.SERVICE_INITIALIZATION_FAILED,
          `Main process initialization failed: ${error.message}`,
          'MainProcess.initialize'
        );
      }
      
      await this.shutdown();
      app.quit();
    }
  }

  /**
   * Initialize core dependencies (logger, error handler)
   */
  async initializeCoreDependencies() {
    try {
      const logDir = app.getPath('userData');
      // Use singleton logger getter with explicit first-init directory
      this.logger = getLogger(logDir);
      console.log(`SCORM Tester: Log file path: ${this.logger.logFile}`);
      
      this.errorHandler = new ScormErrorHandler(this.logger);
      this.logger?.info('SCORM Tester: Core dependencies initialized');
    } catch (error) {
      console.error('SCORM Tester: Failed to initialize core dependencies:', error);
      // Continue without logger if it fails
      this.logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
      };
      this.errorHandler = new ScormErrorHandler(this.logger);
    }
  }

  /**
   * Initialize all services with dependency injection
   */
  async initializeServices() {
    this.logger?.info('SCORM Tester: Initializing services');
    
    // Create and initialize services in dependency order
    const windowManager = new WindowManager(this.errorHandler, this.logger);
    if (!await windowManager.initialize(new Map())) {
      throw new Error('WindowManager initialization failed');
    }
    this.services.set('windowManager', windowManager);
    
    const fileManager = new FileManager(this.errorHandler, this.logger);
    if (!await fileManager.initialize(new Map())) {
      throw new Error('FileManager initialization failed');
    }
    this.services.set('fileManager', fileManager);
    
    const scormService = new ScormService(this.errorHandler, this.logger);
    if (!await scormService.initialize(new Map([['windowManager', windowManager]]))) {
      throw new Error('ScormService initialization failed');
    }
    this.services.set('scormService', scormService);

    const recentCoursesService = new RecentCoursesService(this.errorHandler, this.logger);
    if (!await recentCoursesService.initialize(new Map())) {
      throw new Error('RecentCoursesService initialization failed');
    }
    this.services.set('recentCoursesService', recentCoursesService);
    
    const ipcHandler = new IpcHandler(this.errorHandler, this.logger);
    const ipcDependencies = new Map([
      ['fileManager', fileManager],
      ['scormService', scormService],
      ['windowManager', windowManager],
      ['recentCoursesService', recentCoursesService]
    ]);
    if (!await ipcHandler.initialize(ipcDependencies)) {
      throw new Error('IpcHandler initialization failed');
    }
    this.services.set('ipcHandler', ipcHandler);
    
    // Now update WindowManager with IpcHandler dependency for API call buffering
    const windowManagerDependencies = new Map([['ipcHandler', ipcHandler]]);
    if (!await windowManager.initialize(windowManagerDependencies)) {
      throw new Error('WindowManager re-initialization with IpcHandler failed');
    }
    
    this.logger?.info(`SCORM Tester: ${this.services.size} services initialized successfully`);
  }

  /**
   * Set up application-level event handlers
   */
  setupApplicationEvents() {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.shutdown().then(() => app.quit());
      }
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await this.createMainWindow();
      }
    });

    app.on('before-quit', async (event) => {
      if (!this.isShuttingDown) {
        event.preventDefault();
        await this.shutdown();
        app.quit();
      }
    });

    // Set up service event listeners
    for (const [serviceName, service] of this.services) {
      service.on(SERVICE_EVENTS.ERROR, (data) => {
        this.logger?.error(`Service error in ${serviceName}:`, data);
      });
      
      service.on('stateChanged', (data) => {
        this.logger?.debug(`Service ${serviceName} state changed:`, data);
      });
    }
    
    this.logger?.debug('SCORM Tester: Application event handlers set up');
  }

  /**
   * Create main application window
   */
  async createMainWindow() {
    const windowManager = this.services.get('windowManager');
    if (!windowManager) {
      throw new Error('WindowManager service not available');
    }
    
    try {
      const mainWindow = await windowManager.createMainWindow();
      this.logger?.info(`SCORM Tester: Main window created (ID: ${mainWindow.id})`);
      return mainWindow;
      
    } catch (error) {
      this.logger?.error('SCORM Tester: Failed to create main window:', error);
      throw error;
    }
  }

  /**
   * Gracefully shutdown all services
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.logger?.info('SCORM Tester: Starting graceful shutdown');
    
    try {
      const shutdownOrder = ['ipcHandler', 'scormService', 'recentCoursesService', 'fileManager', 'windowManager'];
      
      for (const serviceName of shutdownOrder) {
        const service = this.services.get(serviceName);
        if (service) {
          this.logger?.debug(`SCORM Tester: Shutting down ${serviceName}`);
          try {
            await service.shutdown();
          } catch (error) {
            this.logger?.error(`SCORM Tester: Error shutting down ${serviceName}:`, error);
          }
        }
      }
      
      this.services.clear();
      this.logger?.info('SCORM Tester: Graceful shutdown completed');
      
    } catch (error) {
      this.logger?.error('SCORM Tester: Error during shutdown:', error);
    }
  }

  /**
   * Get service status information
   */
  getStatus() {
    const status = {
      isInitialized: this.isInitialized,
      isShuttingDown: this.isShuttingDown,
      services: {}
    };
    
    for (const [serviceName, service] of this.services) {
      status.services[serviceName] = service.getStatus();
    }
    
    return status;
  }

  /**
   * Get service instance by name
   */
  getService(serviceName) {
    return this.services.get(serviceName) || null;
  }
}

// Global main process instance
let mainProcess = null;

// Application ready handler
app.whenReady().then(async () => {
  try {
    mainProcess = new MainProcess();
    await mainProcess.initialize();
  } catch (error) {
    console.error('SCORM Tester: Failed to start application:', error);
    app.quit();
  }
});

// Handle certificate errors (for SCORM content loading)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('file://') || url.startsWith('http://localhost')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    
    if (mainProcess) {
      const logger = mainProcess.logger;
      logger?.warn(`SCORM Tester: Blocked new window creation: ${navigationUrl}`);
    }
  });
});

// Export for testing purposes
module.exports = { MainProcess };