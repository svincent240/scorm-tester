/**
 * SCORM Tester Logger Utility
 *
 * Provides centralized logging functionality with file and console output.
 * Implements singleton pattern to ensure consistent logging across the application.
 *
 * @fileoverview Logger utility for SCORM Tester application
 */

const path = require('path');
const fs = require('fs');

// Max file size before truncation (default 8MB). Retain only one file.
const MAX_LOG_BYTES = parseInt(process.env.SCORM_TESTER_MAX_LOG_BYTES || '8388608', 10);

function ensureSizeLimit(filePath, headerLine) {
  try {
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    if (size > MAX_LOG_BYTES) {
      fs.writeFileSync(filePath, headerLine + '\n');
    }
  } catch (_) { /* intentionally empty */ }
}

class Logger {
    constructor(logDir) {
        if (Logger.instance) {
            return Logger.instance;
        }

        const baseDir = logDir || getDefaultLogDir();
        this.logFile = path.join(baseDir, 'app.log');
        this.ndjsonFile = path.join(baseDir, 'app.ndjson');
        this.errorsFile = path.join(baseDir, 'errors.ndjson');
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.defaultContext = {};
        this.processType = (typeof process !== 'undefined' && process.type) ? process.type : 'node';
        this.initLogFile();

        Logger.instance = this;
    }

    initLogFile() {
        try {
            const logDirectory = path.dirname(this.logFile);
            if (!fs.existsSync(logDirectory)) {
                fs.mkdirSync(logDirectory, { recursive: true });
            }
            // Always clear files at startup for fresh debugging; retain only one file
            const startLine = `Log start ${new Date().toISOString()}`;
            fs.writeFileSync(this.logFile, `${startLine}\n`);
            try { fs.writeFileSync(this.ndjsonFile, JSON.stringify({ ts: Date.now(), event: 'LOG_START', process: this.processType }) + '\n'); } catch (_) { /* intentionally empty */ }
            try { fs.writeFileSync(this.errorsFile, JSON.stringify({ ts: Date.now(), event: 'ERROR_LOG_START', process: this.processType }) + '\n'); } catch (_) { /* intentionally empty */ }
        } catch (error) {
            try { console.error('Failed to initialize log files:', error); } catch (_) { /* intentionally empty */ }
        }
    }

    log(level, message, ...args) {
      const timestamp = new Date().toISOString();

      // Normalize arguments to preserve Error details without huge payloads
      const normalize = (val) => {
        try {
          if (val instanceof Error) {
            return {
              type: 'Error',
              name: val.name,
              message: val.message,
              code: val.code,
              stackHead: typeof val.stack === 'string' ? val.stack.split('\n').slice(0, 3) : null
            };
          }
          if (val && typeof val === 'object') {
            // If looks like an error-shaped object
            if ((val.message && val.stack) || val.name === 'Error') {
              return {
                type: val.type || 'ErrorObject',
                name: val.name,
                message: val.message,
                code: val.code,
                stackHead: typeof val.stack === 'string' ? val.stack.split('\n').slice(0, 3) : null
              };
            }
            // Shallow copy up to a few keys to avoid massive logs
            const keys = Object.keys(val).slice(0, 10);
            const out = {};
            for (const k of keys) out[k] = val[k];
            return out;
          }
          return val;
        } catch (_) {
          return String(val);
        }
      };

      let serialized = '';
      try {
        const norm = args.map(normalize);
        if (norm.length) {
          // Use circular reference protection to prevent massive log entries
          const seen = new WeakSet();
          serialized = JSON.stringify(norm, (key, value) => {
            if (typeof value === 'object' && value !== null) {
              if (seen.has(value)) {
                return '[Circular]';
              }
              seen.add(value);
            }
            return value;
          });
        } else {
          serialized = '';
        }
      } catch (_) {
        serialized = args.length ? String(args[0]) : '';
      }

      const formattedMessage = `${timestamp} [${level.toUpperCase()}] ${message} ${serialized}\n`;

      // Enforce size limits before each write (retain only one file)
      ensureSizeLimit(this.logFile, `Log truncated at ${new Date().toISOString()}`);
      ensureSizeLimit(this.ndjsonFile, JSON.stringify({ ts: Date.now(), event: 'LOG_TRUNCATE', process: this.processType }));
      ensureSizeLimit(this.errorsFile, JSON.stringify({ ts: Date.now(), event: 'ERROR_LOG_TRUNCATE', process: this.processType }));

      // Human-readable log
      try {
        const fd = fs.openSync(this.logFile, 'a');
        fs.writeSync(fd, formattedMessage);
        fs.fsyncSync(fd); // Force immediate flush to disk
        fs.closeSync(fd);
      } catch (error) {
        try { console.error('Failed to write to log file:', error); } catch (_) { /* intentionally empty */ }
      }

      // Structured NDJSON entry
      const entry = {
        ts: Date.now(),
        level,
        msg: message,
        args: (() => { try { return JSON.parse(serialized || '[]'); } catch (_) { return []; } })(),
        context: this.defaultContext || null,
        pid: (typeof process !== 'undefined' && process.pid) ? process.pid : null,
        process: this.processType
      };
      try {
        const fd = fs.openSync(this.ndjsonFile, 'a');
        fs.writeSync(fd, JSON.stringify(entry) + '\n');
        fs.fsyncSync(fd); // Force immediate flush to disk
        fs.closeSync(fd);
      } catch (_) { /* intentionally empty */ }
      if (level === 'error') {
        try {
          const fd = fs.openSync(this.errorsFile, 'a');
          fs.writeSync(fd, JSON.stringify(entry) + '\n');
          fs.fsyncSync(fd); // Force immediate flush to disk
          fs.closeSync(fd);
        } catch (_) { /* intentionally empty */ }
      }

      if (process.env.NODE_ENV === 'development') {
        try {
          // Direct dev console output to STDERR to avoid polluting STDOUT (e.g., MCP JSON-RPC channel)
          // Only log WARN and ERROR to console to prevent spam from thousands of INFO/DEBUG entries
          // when SCORM courses make hundreds of API calls per second. All logs are still written to files.
          if (level === 'warn' || level === 'error') {
            console.error(`[${level.toUpperCase()}]`, message, ...args);
          }
        } catch (_) {
          // ignore console failure
        }
      }
    }

    info(message, ...args) {
        this.log('info', message, ...args);
    }

    warn(message, ...args) {
        this.log('warn', message, ...args);
    }

    error(message, ...args) {
        this.log('error', message, ...args);
    }

    debug(message, ...args) {
        // Only log debug messages if log level allows it
        if (this.shouldLog('debug')) {
            this.log('debug', message, ...args);
        }
    }

    shouldLog(level) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const currentLevel = levels[this.logLevel] || levels.info;
        const messageLevel = levels[level] || levels.info;
        return messageLevel >= currentLevel;
    }

    setLevel(level) {
        this.logLevel = level;
    }

    // Create a child logger with default context merged in structured entries
    child(ctx = {}) {
        const childLogger = Object.create(this);
        childLogger.defaultContext = { ...(this.defaultContext || {}), ...(ctx || {}) };
        return childLogger;
    }

}

// Provide a default log directory resolver compatible with both main and renderer contexts
function getDefaultLogDir() {
  // In development, use project root logs directory
  if (process.env.NODE_ENV === 'development') {
    try {
      // Find project root by looking for package.json
      let currentDir = __dirname;
      while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, 'package.json'))) {
          return path.join(currentDir, 'logs');
        }
        currentDir = path.dirname(currentDir);
      }
    } catch (_) {
      // ignore resolution failure and fallback to standard logic
    }
  }

  try {
    // Use Electron app.getPath('userData') when available
    const electron = require('electron');
    const app = electron?.app || electron?.remote?.app;
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch (_) {
    // ignore resolution failure and fallback to OS tmp
  }
  // Fallback: OS temp directory
  return require('os').tmpdir();
}

// Export a singleton getter with optional first-init override for log directory.
// This maintains a single shared logger instance and allows main to specify app.getPath('userData').
let singleton = null;
function getLogger(logDirOverride) {
  if (singleton) return singleton;
  const dir = logDirOverride || process.env.SCORM_TESTER_LOG_DIR;
  singleton = new Logger(dir);
  return singleton;
}

module.exports = getLogger;