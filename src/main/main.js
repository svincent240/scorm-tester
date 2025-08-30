/**
 * SCORM Tester Main Process Entry Point
 * 
 * Refactored main process that orchestrates all Phase 4 services with
 * dependency injection, lifecycle management, and error handling.
 * 
 * @fileoverview Simplified main process entry point for SCORM Tester
 */

const { app, BrowserWindow, protocol } = require('electron');

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
      (this.logger || console).info('SCORM Tester: Starting main process initialization');
      
      await this.initializeCoreDependencies();
      await this.initializeServices();
      this.setupApplicationEvents();
      await this.createMainWindow();
      
      this.isInitialized = true;
      this.logger?.info('SCORM Tester: Main process initialization completed successfully');
      
    } catch (error) {
      (this.logger || console).error('SCORM Tester: Main process initialization failed:', error);
      
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
      const logFilePath = this.logger && this.logger.logFile ? this.logger.logFile : 'unknown';
      (this.logger || console).info(`SCORM Tester: Log file path: ${logFilePath}`);
      (this.logger || console).info(`SCORM Tester: process.env.LOG_LEVEL: ${process.env.LOG_LEVEL}`);
      (this.logger || console).info(`SCORM Tester: Logger logLevel: ${this.logger?.logLevel}`);

      // Also output to console for visibility during development
      console.log(`\n🔍 SCORM Tester Log File: ${logFilePath}\n`);
      console.log(`📝 Check this file for detailed debugging information\n`);
      
      this.errorHandler = new ScormErrorHandler(this.logger);
      this.logger?.info('SCORM Tester: Core dependencies initialized');
    } catch (error) {
      (this.logger || console).error('SCORM Tester: Failed to initialize core dependencies:', error);
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
 
    // Core shared services: SCORM Inspector telemetry store and SN snapshot service
    const ScormInspectorTelemetryStore = require('./services/scorm-inspector/scorm-inspector-telemetry-store');
    const SNSnapshotService = require('./services/scorm/sn/snapshot-service');
 
    // Pass the main logger into shared services so logs are consistent
    // Create SCORM Inspector store with enhanced capabilities for package analysis
    const telemetryStore = new ScormInspectorTelemetryStore({ 
      maxHistorySize: 2000,
      enableBroadcast: true,
      logger: this.logger 
    });
    // Wire the telemetry store and window manager together for broadcasting
    windowManager.setTelemetryStore(telemetryStore); // For legacy compatibility
    telemetryStore.setWindowManager(windowManager); // For new broadcasting capabilities
    // Create SNSnapshotService without scormService initially to avoid ordering issues; we'll wire scormService after it's created
    const snSnapshotService = new SNSnapshotService(null, { logger: this.logger });
 
    // Initialize ScormService after core shared services are available so it can publish telemetry
    const scormService = new ScormService(this.errorHandler, this.logger);
    // Pass windowManager and telemetryStore/snSnapshotService via dependency map for initialization
    const scormDeps = new Map([
      ['windowManager', windowManager],
      ['telemetryStore', telemetryStore],
      ['snSnapshotService', snSnapshotService]
    ]);
    if (!await scormService.initialize(scormDeps)) {
      throw new Error('ScormService initialization failed');
    }
    this.services.set('scormService', scormService);

    // Wire scormService into SNSnapshotService now that scormService is available.
    try {
      snSnapshotService.scormService = scormService;
      // Optionally start polling if the SN service is present
      if (typeof snSnapshotService.startPolling === 'function') {
        snSnapshotService.startPolling();
      }
      this.logger?.info && this.logger.info('SCORM Tester: SNSnapshotService wired to ScormService and started');
    } catch (e) {
      this.logger?.warn && this.logger?.warn('SCORM Tester: Failed to wire SNSnapshotService to ScormService', e?.message || e);
    }
 
    const recentCoursesService = new RecentCoursesService(this.errorHandler, this.logger);
    if (!await recentCoursesService.initialize(new Map())) {
      throw new Error('RecentCoursesService initialization failed');
    }
    this.services.set('recentCoursesService', recentCoursesService);
 
    // IPC handler (depends on many services including telemetry and SN snapshot)
    const ipcHandler = new IpcHandler(this.errorHandler, this.logger, { IPC_REFACTOR_ENABLED: true });
    const ipcDependencies = new Map([
      ['fileManager', fileManager],
      ['scormService', scormService],
      ['windowManager', windowManager],
      ['recentCoursesService', recentCoursesService],
      ['telemetryStore', telemetryStore],
      ['snSnapshotService', snSnapshotService],
    ]);
    if (!await ipcHandler.initialize(ipcDependencies)) {
      throw new Error('IpcHandler initialization failed');
    }
    this.services.set('ipcHandler', ipcHandler);
 
    // Provide ipcHandler to SNSnapshotService now that it's available (some implementations expect it)
    if (typeof snSnapshotService.setIpcHandler === 'function') {
      snSnapshotService.setIpcHandler(ipcHandler);
    } else {
      snSnapshotService.ipcHandler = ipcHandler;
    }
 
    // Do NOT re-initialize WindowManager with IpcHandler; WindowManager was initialized once above.
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
      this.logger?.info('SCORM Tester: before-quit event received');
      if (!this.isShuttingDown) {
        this.logger?.info('SCORM Tester: Starting graceful shutdown from before-quit');
        event.preventDefault();
        await this.shutdown();
        this.logger?.info('SCORM Tester: Calling app.quit() after shutdown');
        app.quit();
      } else {
        this.logger?.info('SCORM Tester: Already shutting down, allowing quit');
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

    // Signal renderer that shutdown is starting
    try {
      const windowManager = this.services.get('windowManager');
      if (windowManager && typeof windowManager.broadcastToAllWindows === 'function') {
        windowManager.broadcastToAllWindows('app-quit');
        this.logger?.debug('SCORM Tester: Broadcasted app-quit signal to all windows');
      }
    } catch (error) {
      this.logger?.warn('SCORM Tester: Failed to broadcast app-quit signal:', error);
    }

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

// Register the scheme as privileged so it behaves more like a true origin.
// This enables localStorage access and proper CORS behavior for SCORM content.
// Must be called before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'scorm-app', privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

// Global main process instance
let mainProcess = null;

// Application ready handler
app.whenReady().then(async () => {
  try {
    mainProcess = new MainProcess();
    await mainProcess.initialize();
  } catch (error) {
    if (mainProcess && mainProcess.logger && typeof mainProcess.logger.error === 'function') {
      mainProcess.logger.error('SCORM Tester: Failed to start application:', error);
    } else {
      console.error('SCORM Tester: Failed to start application:', error);
    }
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