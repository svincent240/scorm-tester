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

class Logger {
    constructor(logDir) {
        if (Logger.instance) {
            return Logger.instance;
        }

        this.logFile = path.join(logDir, 'app.log');
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.initLogFile();

        Logger.instance = this;
    }

    initLogFile() {
        try {
            const logDirectory = path.dirname(this.logFile);
            if (!fs.existsSync(logDirectory)) {
                fs.mkdirSync(logDirectory, { recursive: true });
            }
            // Always clear the log file at startup for fresh debugging
            fs.writeFileSync(this.logFile, `Log file created at ${new Date().toISOString()}\n`);
        } catch (error) {
            console.error('Failed to initialize log file:', error);
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
        serialized = norm.length ? JSON.stringify(norm) : '';
      } catch (_) {
        serialized = args.length ? String(args[0]) : '';
      }
  
      const formattedMessage = `${timestamp} [${level.toUpperCase()}] ${message} ${serialized}\n`;
  
      try {
        fs.appendFileSync(this.logFile, formattedMessage);
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
  
      if (process.env.NODE_ENV === 'development') {
        try {
          console.log(`[${level.toUpperCase()}]`, message, ...args);
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
        if (this.logLevel === 'debug') {
            this.log('debug', message, ...args);
        }
    }
}

module.exports = Logger;