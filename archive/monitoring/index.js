// monitoring.js - Comprehensive monitoring and logging system
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      scormApiCalls: 0,
      scormApiErrors: 0,
      averageResponseTime: 0,
      memoryUsage: [],
      sessionCount: 0,
      errorLog: [],
      performanceLog: []
    };
    
    this.startTime = Date.now();
    this.logFile = path.join(app.getPath('userData'), 'scorm-tool.log');
    this.metricsFile = path.join(app.getPath('userData'), 'metrics.json');
    
    this.initializeLogging();
    this.startMonitoring();
  }

  initializeLogging() {
    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Initialize log file with header
    this.log('INFO', 'SCORM Testing Tool started', { version: app.getVersion() });
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      uptime: Date.now() - this.startTime
    };

    // Write to file
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${level}] ${message}`, data);
    }

    // Keep in-memory error log for critical issues
    if (level === 'ERROR' || level === 'CRITICAL') {
      this.metrics.errorLog.push(logEntry);
      
      // Keep only last 100 errors
      if (this.metrics.errorLog.length > 100) {
        this.metrics.errorLog.shift();
      }
    }
  }

  trackScormApiCall(method, element, duration, success = true) {
    this.metrics.scormApiCalls++;
    
    if (!success) {
      this.metrics.scormApiErrors++;
    }

    // Update average response time
    const currentAvg = this.metrics.averageResponseTime;
    const count = this.metrics.scormApiCalls;
    this.metrics.averageResponseTime = (currentAvg * (count - 1) + duration) / count;

    // Log slow API calls
    if (duration > 1000) { // Slower than 1 second
      this.log('WARN', 'Slow SCORM API call detected', {
        method,
        element,
        duration,
        success
      });
    }

    // Log performance data
    this.metrics.performanceLog.push({
      timestamp: Date.now(),
      method,
      element,
      duration,
      success
    });

    // Keep only last 1000 performance entries
    if (this.metrics.performanceLog.length > 1000) {
      this.metrics.performanceLog.shift();
    }
  }

  trackMemoryUsage() {
    const usage = process.memoryUsage();
    const timestamp = Date.now();
    
    this.metrics.memoryUsage.push({
      timestamp,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    });

    // Keep only last 100 memory samples
    if (this.metrics.memoryUsage.length > 100) {
      this.metrics.memoryUsage.shift();
    }

    // Alert if memory usage is high
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    if (heapUsedMB > 500) { // More than 500MB
      this.log('WARN', 'High memory usage detected', {
        heapUsedMB: Math.round(heapUsedMB),
        heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024)
      });
    }
  }

  trackSessionCreation() {
    this.metrics.sessionCount++;
    this.log('INFO', 'New SCORM session created', {
      totalSessions: this.metrics.sessionCount
    });
  }

  trackError(error, context = '') {
    this.log('ERROR', `Application error: ${error.message}`, {
      error: error.stack,
      context
    });
  }

  trackSecurityEvent(eventType, details) {
    this.log('SECURITY', `Security event: ${eventType}`, details);
  }

  startMonitoring() {
    // Monitor memory usage every 30 seconds
    setInterval(() => {
      this.trackMemoryUsage();
    }, 30000);

    // Save metrics every 5 minutes
    setInterval(() => {
      this.saveMetrics();
    }, 300000);

    // Cleanup old logs daily
    setInterval(() => {
      this.cleanupLogs();
    }, 24 * 60 * 60 * 1000);
  }

  saveMetrics() {
    try {
      const metricsToSave = {
        ...this.metrics,
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime
      };

      fs.writeFileSync(this.metricsFile, JSON.stringify(metricsToSave, null, 2));
      this.log('DEBUG', 'Metrics saved successfully');
    } catch (error) {
      this.log('ERROR', 'Failed to save metrics', { error: error.message });
    }
  }

  cleanupLogs() {
    try {
      const stats = fs.statSync(this.logFile);
      const fileSizeMB = stats.size / 1024 / 1024;
      
      // Rotate log if larger than 10MB
      if (fileSizeMB > 10) {
        const backupFile = this.logFile + '.old';
        fs.renameSync(this.logFile, backupFile);
        this.log('INFO', 'Log file rotated', { oldSizeMB: Math.round(fileSizeMB) });
      }
    } catch (error) {
      this.log('ERROR', 'Log cleanup failed', { error: error.message });
    }
  }

  getHealthStatus() {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.metrics.scormApiCalls > 0 ? 
      (this.metrics.scormApiErrors / this.metrics.scormApiCalls) * 100 : 0;
    
    const lastMemory = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
    const memoryUsageMB = lastMemory ? Math.round(lastMemory.heapUsed / 1024 / 1024) : 0;

    return {
      status: errorRate < 5 && memoryUsageMB < 500 ? 'healthy' : 'warning',
      uptime,
      scormApiCalls: this.metrics.scormApiCalls,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: Math.round(this.metrics.averageResponseTime),
      memoryUsageMB,
      sessionCount: this.metrics.sessionCount,
      lastErrors: this.metrics.errorLog.slice(-5)
    };
  }

  generateReport() {
    const health = this.getHealthStatus();
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        status: health.status,
        uptime: Math.round(health.uptime / 1000 / 60), // minutes
        totalApiCalls: health.scormApiCalls,
        errorRate: health.errorRate + '%',
        avgResponseTime: health.averageResponseTime + 'ms',
        memoryUsage: health.memoryUsageMB + 'MB',
        sessions: health.sessionCount
      },
      performance: {
        slowestApiCalls: this.metrics.performanceLog
          .filter(call => call.duration > 500)
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 10),
        memoryTrend: this.metrics.memoryUsage.slice(-20)
      },
      errors: this.metrics.errorLog.slice(-10),
      recommendations: this.generateRecommendations(health)
    };

    return report;
  }

  generateRecommendations(health) {
    const recommendations = [];

    if (health.errorRate > 5) {
      recommendations.push('High error rate detected. Review SCORM API implementation.');
    }

    if (health.averageResponseTime > 1000) {
      recommendations.push('Slow API response times. Consider optimizing SCORM data handling.');
    }

    if (health.memoryUsageMB > 300) {
      recommendations.push('High memory usage. Review session cleanup and data retention.');
    }

    if (this.metrics.sessionCount > 50) {
      recommendations.push('Many sessions created. Consider implementing session limits.');
    }

    if (recommendations.length === 0) {
      recommendations.push('All systems operating normally.');
    }

    return recommendations;
  }
}

// Global error tracking
class ErrorTracker {
  constructor(monitor) {
    this.monitor = monitor;
    this.setupGlobalHandlers();
  }

  setupGlobalHandlers() {
    // Catch unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.monitor.log('CRITICAL', 'Unhandled Promise Rejection', {
        reason: reason.toString(),
        stack: reason.stack
      });
    });

    // Catch uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.monitor.log('CRITICAL', 'Uncaught Exception', {
        error: error.message,
        stack: error.stack
      });
      
      // Don't exit in production, but log the critical error
      if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
      }
    });

    // Track memory warnings
    process.on('warning', (warning) => {
      this.monitor.log('WARN', 'Process Warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });
  }
}

// SCORM API Performance Wrapper
class ScormApiMonitor {
  constructor(monitor) {
    this.monitor = monitor;
  }

  wrapApiCall(method, element, apiFunction) {
    const startTime = Date.now();
    let success = true;
    let result;

    try {
      result = apiFunction();
      
      // Check if result indicates an error
      if (method === 'GetLastError' && result !== '0') {
        success = false;
      }
      
    } catch (error) {
      success = false;
      this.monitor.trackError(error, `SCORM API ${method}`);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      this.monitor.trackScormApiCall(method, element, duration, success);
    }

    return result;
  }
}

// Resource Monitor for file operations
class ResourceMonitor {
  constructor(monitor) {
    this.monitor = monitor;
    this.tempFiles = new Set();
    this.extractedFolders = new Set();
  }

  trackTempFile(filePath) {
    this.tempFiles.add(filePath);
    this.monitor.log('DEBUG', 'Temporary file created', { filePath });
  }

  trackExtractedFolder(folderPath) {
    this.extractedFolders.add(folderPath);
    this.monitor.log('DEBUG', 'SCORM package extracted', { folderPath });
  }

  cleanup() {
    // Cleanup temp files
    for (const filePath of this.tempFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.monitor.log('DEBUG', 'Temporary file cleaned up', { filePath });
        }
      } catch (error) {
        this.monitor.log('ERROR', 'Failed to cleanup temp file', { filePath, error: error.message });
      }
    }

    // Cleanup extracted folders
    for (const folderPath of this.extractedFolders) {
      try {
        if (fs.existsSync(folderPath)) {
          fs.rmSync(folderPath, { recursive: true, force: true });
          this.monitor.log('DEBUG', 'Extracted folder cleaned up', { folderPath });
        }
      } catch (error) {
        this.monitor.log('ERROR', 'Failed to cleanup extracted folder', { folderPath, error: error.message });
      }
    }

    this.tempFiles.clear();
    this.extractedFolders.clear();
  }
}

module.exports = {
  PerformanceMonitor,
  ErrorTracker,
  ScormApiMonitor,
  ResourceMonitor
};