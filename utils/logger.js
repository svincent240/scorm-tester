// utils/logger.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class Logger {
    constructor() {
        if (Logger.instance) {
            return Logger.instance;
        }

        const logDir = app.getPath('userData');
        this.logFile = path.join(logDir, 'app.log');
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.initLogFile();

        Logger.instance = this;
    }

    initLogFile() {
        try {
            if (!fs.existsSync(this.logFile)) {
                fs.writeFileSync(this.logFile, `Log file created at ${new Date().toISOString()}\n`);
            }
        } catch (error) {
            console.error('Failed to initialize log file:', error);
        }
    }

    log(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `${timestamp} [${level.toUpperCase()}] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;

        try {
            fs.appendFileSync(this.logFile, formattedMessage);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }

        if (process.env.NODE_ENV === 'development') {
            console.log(`[${level.toUpperCase()}]`, message, ...args);
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

const logger = new Logger();
module.exports = logger;