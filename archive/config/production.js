// config/production.js - Production configuration and optimizations
const path = require('path');
const { app } = require('electron');

class ProductionConfig {
  constructor() {
    this.config = {
      // Application settings
      app: {
        name: 'SCORM Testing & Preview Tool',
        version: app.getVersion(),
        environment: process.env.NODE_ENV || 'production',
        maxSessions: 10,
        sessionTimeoutMinutes: 120,
        autoCleanupIntervalMinutes: 60
      },

      // Security settings (environment-aware)
      security: {
        enableContextIsolation: process.env.ELECTRON_CONTEXT_ISOLATION !== 'false',
        disableNodeIntegration: process.env.ELECTRON_NODE_INTEGRATION !== 'true',
        enableWebSecurity: process.env.ELECTRON_WEB_SECURITY !== 'false',
        allowedProtocols: ['file:', 'data:'],
        maxUploadSizeMB: parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 500,
        maxManifestSizeKB: parseInt(process.env.MAX_MANIFEST_SIZE_KB) || 1024,
        maxSuspendDataLength: parseInt(process.env.MAX_SUSPEND_DATA_LENGTH) || 65536,
        sessionIdPattern: /^[a-zA-Z0-9_-]{1,100}$/,
        scormElementPattern: /^cmi\.[\w\.\[\]_-]{1,255}$/,
        enableAuditLog: process.env.ENABLE_AUDIT_LOG === 'true',
        auditLogLevel: process.env.AUDIT_LOG_LEVEL || 'INFO',
        rateLimitApiCalls: parseInt(process.env.RATE_LIMIT_API_CALLS) || 1000,
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000
      },

      // Performance settings
      performance: {
        maxApiCallsPerSession: 10000,
        maxLogEntries: 1000,
        memoryWarningThresholdMB: 500,
        responseTimeWarningMs: 1000,
        cleanupIntervalMs: 300000, // 5 minutes
        statsCollectionIntervalMs: 30000 // 30 seconds
      },

      // File system settings
      filesystem: {
        tempDirName: 'scorm-temp',
        maxTempFiles: 50,
        maxExtractedPackages: 5,
        allowedFileExtensions: [
          '.html', '.htm', '.js', '.css', '.xml',
          '.jpg', '.jpeg', '.png', '.gif', '.svg',
          '.mp4', '.mp3', '.pdf', '.swf', '.json'
        ],
        blockedFileExtensions: ['.exe', '.bat', '.cmd', '.scr', '.com']
      },

      // Logging settings
      logging: {
        level: 'INFO', // DEBUG, INFO, WARN, ERROR, CRITICAL
        maxLogFileSizeMB: 10,
        maxLogFiles: 5,
        enableFileLogging: true,
        enableConsoleLogging: process.env.NODE_ENV === 'development',
        logRotationIntervalHours: 24
      },

      // SCORM API settings
      scorm: {
        supportedVersions: ['1.2', '2004'],
        defaultLmsProfile: 'generic',
        enableStrictValidation: true,
        maxInteractions: 1000,
        maxObjectives: 100,
        commitDelayMs: 200,
        timeoutMs: 30000
      }
    };

    this.validateConfig();
  }

  validateConfig() {
    // Validate numeric values
    if (this.config.app.maxSessions < 1 || this.config.app.maxSessions > 100) {
      throw new Error('Invalid maxSessions value');
    }

    if (this.config.security.maxUploadSizeMB < 1 || this.config.security.maxUploadSizeMB > 2000) {
      throw new Error('Invalid maxUploadSizeMB value');
    }

    // Validate patterns
    if (!(this.config.security.sessionIdPattern instanceof RegExp)) {
      throw new Error('sessionIdPattern must be a RegExp');
    }

    console.log('Production configuration validated successfully');
  }

  get(path) {
    return this.getNestedValue(this.config, path);
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  isProduction() {
    return this.config.app.environment === 'production';
  }

  isDevelopment() {
    return this.config.app.environment === 'development';
  }
}

// Resource Manager for production optimization
class ResourceManager {
  constructor(config, monitor) {
    this.config = config;
    this.monitor = monitor;
    this.activeSessions = new Map();
    this.tempFiles = new Set();
    this.extractedPackages = new Set();
    this.startCleanupTimer();
  }

  createSession(sessionId) {
    // Check session limits
    if (this.activeSessions.size >= this.config.get('app.maxSessions')) {
      throw new Error('Maximum session limit reached');
    }

    const session = {
      id: sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      apiCallCount: 0,
      memoryUsage: 0
    };

    this.activeSessions.set(sessionId, session);
    this.monitor.trackSessionCreation();
    
    return session;
  }

  updateSessionActivity(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      session.apiCallCount++;

      // Check API call limits
      const maxCalls = this.config.get('performance.maxApiCallsPerSession');
      if (session.apiCallCount > maxCalls) {
        this.monitor.log('WARN', 'Session exceeded API call limit', {
          sessionId,
          apiCallCount: session.apiCallCount,
          limit: maxCalls
        });
      }
    }
  }

  removeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.activeSessions.delete(sessionId);
      this.monitor.log('INFO', 'Session removed', {
        sessionId,
        duration: Date.now() - session.createdAt,
        apiCallCount: session.apiCallCount
      });
    }
  }

  registerTempFile(filePath) {
    this.tempFiles.add(filePath);
    
    // Check temp file limits
    const maxFiles = this.config.get('filesystem.maxTempFiles');
    if (this.tempFiles.size > maxFiles) {
      this.monitor.log('WARN', 'Too many temporary files', {
        count: this.tempFiles.size,
        limit: maxFiles
      });
      this.cleanupOldestTempFiles();
    }
  }

  registerExtractedPackage(packagePath) {
    this.extractedPackages.add(packagePath);
    
    // Check extracted package limits
    const maxPackages = this.config.get('filesystem.maxExtractedPackages');
    if (this.extractedPackages.size > maxPackages) {
      this.cleanupOldestPackages();
    }
  }

  startCleanupTimer() {
    const intervalMs = this.config.get('performance.cleanupIntervalMs');
    
    setInterval(() => {
      this.cleanupExpiredSessions();
      this.cleanupTempFiles();
      this.collectGarbage();
    }, intervalMs);
  }

  cleanupExpiredSessions() {
    const timeoutMs = this.config.get('app.sessionTimeoutMinutes') * 60 * 1000;
    const now = Date.now();
    
    for (const [sessionId, session] of this.activeSessions) {
      if (now - session.lastActivity > timeoutMs) {
        this.removeSession(sessionId);
        this.monitor.log('INFO', 'Session expired and removed', { sessionId });
      }
    }
  }

  cleanupTempFiles() {
    const fs = require('fs');
    const filesToRemove = [];
    
    for (const filePath of this.tempFiles) {
      try {
        if (!fs.existsSync(filePath)) {
          filesToRemove.push(filePath);
        }
      } catch (error) {
        filesToRemove.push(filePath);
      }
    }
    
    filesToRemove.forEach(filePath => this.tempFiles.delete(filePath));
  }

  cleanupOldestTempFiles() {
    const fs = require('fs');
    const filesWithStats = [];
    
    for (const filePath of this.tempFiles) {
      try {
        const stats = fs.statSync(filePath);
        filesWithStats.push({ path: filePath, mtime: stats.mtime });
      } catch (error) {
        // File doesn't exist, remove from set
        this.tempFiles.delete(filePath);
      }
    }
    
    // Sort by modification time and remove oldest
    filesWithStats.sort((a, b) => a.mtime - b.mtime);
    
    const maxFiles = this.config.get('filesystem.maxTempFiles');
    const filesToRemove = filesWithStats.slice(0, filesWithStats.length - maxFiles);
    
    filesToRemove.forEach(file => {
      try {
        fs.unlinkSync(file.path);
        this.tempFiles.delete(file.path);
        this.monitor.log('DEBUG', 'Cleaned up old temp file', { path: file.path });
      } catch (error) {
        this.monitor.log('ERROR', 'Failed to cleanup temp file', {
          path: file.path,
          error: error.message
        });
      }
    });
  }

  cleanupOldestPackages() {
    const fs = require('fs');
    const packagesWithStats = [];
    
    for (const packagePath of this.extractedPackages) {
      try {
        const stats = fs.statSync(packagePath);
        packagesWithStats.push({ path: packagePath, mtime: stats.mtime });
      } catch (error) {
        this.extractedPackages.delete(packagePath);
      }
    }
    
    packagesWithStats.sort((a, b) => a.mtime - b.mtime);
    
    const maxPackages = this.config.get('filesystem.maxExtractedPackages');
    const packagesToRemove = packagesWithStats.slice(0, packagesWithStats.length - maxPackages);
    
    packagesToRemove.forEach(pkg => {
      try {
        fs.rmSync(pkg.path, { recursive: true, force: true });
        this.extractedPackages.delete(pkg.path);
        this.monitor.log('DEBUG', 'Cleaned up old extracted package', { path: pkg.path });
      } catch (error) {
        this.monitor.log('ERROR', 'Failed to cleanup extracted package', {
          path: pkg.path,
          error: error.message
        });
      }
    });
  }

  collectGarbage() {
    if (global.gc) {
      global.gc();
      this.monitor.log('DEBUG', 'Garbage collection triggered');
    }
  }

  getResourceStats() {
    return {
      activeSessions: this.activeSessions.size,
      tempFiles: this.tempFiles.size,
      extractedPackages: this.extractedPackages.size,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }
}

// Application Health Checker
class HealthChecker {
  constructor(config, monitor, resourceManager) {
    this.config = config;
    this.monitor = monitor;
    this.resourceManager = resourceManager;
    this.healthStatus = 'healthy';
    this.lastCheck = Date.now();
    
    this.startHealthChecks();
  }

  startHealthChecks() {
    const intervalMs = this.config.get('performance.statsCollectionIntervalMs');
    
    setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
  }

  performHealthCheck() {
    const checks = [
      this.checkMemoryUsage(),
      this.checkSessionLimits(),
      this.checkFileSystemLimits(),
      this.checkErrorRates()
    ];

    const failedChecks = checks.filter(check => !check.passed);
    
    if (failedChecks.length === 0) {
      this.healthStatus = 'healthy';
    } else if (failedChecks.some(check => check.severity === 'critical')) {
      this.healthStatus = 'critical';
    } else {
      this.healthStatus = 'warning';
    }

    this.lastCheck = Date.now();
    
    // Log health status changes
    if (this.healthStatus !== 'healthy') {
      this.monitor.log('WARN', 'Health check failed', {
        status: this.healthStatus,
        failedChecks: failedChecks.map(check => check.name)
      });
    }
  }

  checkMemoryUsage() {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const threshold = this.config.get('performance.memoryWarningThresholdMB');
    
    return {
      name: 'memory_usage',
      passed: heapUsedMB < threshold,
      severity: heapUsedMB > threshold * 1.5 ? 'critical' : 'warning',
      details: { heapUsedMB, threshold }
    };
  }

  checkSessionLimits() {
    const activeCount = this.resourceManager.activeSessions.size;
    const maxSessions = this.config.get('app.maxSessions');
    
    return {
      name: 'session_limits',
      passed: activeCount < maxSessions * 0.8, // Warning at 80% capacity
      severity: activeCount >= maxSessions ? 'critical' : 'warning',
      details: { activeCount, maxSessions }
    };
  }

  checkFileSystemLimits() {
    const tempFileCount = this.resourceManager.tempFiles.size;
    const maxTempFiles = this.config.get('filesystem.maxTempFiles');
    
    return {
      name: 'filesystem_limits',
      passed: tempFileCount < maxTempFiles * 0.8,
      severity: tempFileCount >= maxTempFiles ? 'critical' : 'warning',
      details: { tempFileCount, maxTempFiles }
    };
  }

  checkErrorRates() {
    const healthData = this.monitor.getHealthStatus();
    const errorRate = healthData.errorRate;
    
    return {
      name: 'error_rates',
      passed: errorRate < 5, // Less than 5% error rate
      severity: errorRate > 15 ? 'critical' : 'warning',
      details: { errorRate }
    };
  }

  getHealthReport() {
    return {
      status: this.healthStatus,
      lastCheck: this.lastCheck,
      uptime: process.uptime(),
      resources: this.resourceManager.getResourceStats(),
      performance: this.monitor.getHealthStatus()
    };
  }
}

// Startup Optimization
class StartupOptimizer {
  constructor(config) {
    this.config = config;
  }

  optimizeForProduction() {
    // Set Node.js optimization flags
    if (this.config.isProduction()) {
      // Enable garbage collection optimizations
      if (!global.gc) {
        console.warn('Garbage collection not exposed. Start with --expose-gc for better memory management.');
      }

      // Set memory limits
      const maxOldSpace = Math.min(2048, require('os').totalmem() / 1024 / 1024 / 4);
      process.env.NODE_OPTIONS = `--max-old-space-size=${Math.floor(maxOldSpace)}`;

      console.log('Production optimizations applied');
    }
  }

  validateEnvironment() {
    const requiredModules = ['electron', 'node-stream-zip'];
    const missing = [];

    for (const module of requiredModules) {
      try {
        require.resolve(module);
      } catch (error) {
        missing.push(module);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required modules: ${missing.join(', ')}`);
    }

    console.log('Environment validation passed');
  }

  setupErrorHandling() {
    // Set up comprehensive error handling
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      if (this.config.isProduction()) {
        // Log and continue in production
        return;
      }
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    console.log('Error handling configured');
  }
}

module.exports = {
  ProductionConfig,
  ResourceManager,
  HealthChecker,
  StartupOptimizer
};