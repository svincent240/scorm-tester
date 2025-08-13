import { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ConsoleMessage {
  type: string;
  text: string;
  location?: string;
}

export interface LogError {
  line: string;
  timestamp?: string;
}

export class ConsoleMonitor {
  private messages: ConsoleMessage[] = [];
  private page: Page;
  private logFilePath: string;
  private initialLogSize: number = 0;

  constructor(page: Page) {
    this.page = page;
    this.logFilePath = this.getLogFilePath();
    this.recordInitialLogSize();
    this.setupConsoleListeners();
  }

  private getLogFilePath(): string {
    // Path to the app log file
    const appDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'scorm-tester');
    return path.join(appDataPath, 'app.log');
  }

  private recordInitialLogSize() {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        this.initialLogSize = stats.size;
      }
    } catch (error) {
      // Log file doesn't exist or can't be read, that's okay
      this.initialLogSize = 0;
    }
  }

  private setupConsoleListeners() {
    // Listen to console messages
    this.page.on('console', (msg) => {
      this.messages.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url
      });
    });

    // Listen to page errors (uncaught exceptions)
    this.page.on('pageerror', (error) => {
      this.messages.push({
        type: 'error',
        text: `Uncaught exception: ${error.message}`,
        location: error.stack?.split('\n')[0]
      });
    });
  }

  /**
   * Get all console messages
   */
  getMessages(): ConsoleMessage[] {
    return [...this.messages];
  }

  /**
   * Get only error and warning messages
   */
  getErrorsAndWarnings(): ConsoleMessage[] {
    return this.messages.filter(msg => 
      msg.type === 'error' || 
      msg.type === 'warning' || 
      msg.type === 'warn'
    );
  }

  /**
   * Get only error messages
   */
  getErrors(): ConsoleMessage[] {
    return this.messages.filter(msg => msg.type === 'error');
  }

  /**
   * Check if there are any critical errors (excluding known safe errors)
   */
  hasCriticalErrors(): boolean {
    const errors = this.getErrors();
    
    // Filter out known safe/expected errors
    const criticalErrors = errors.filter(error => {
      const text = error.text.toLowerCase();
      
      // Known safe errors to ignore
      const safeErrors = [
        'failed to load resource', // Common for missing favicon, etc.
        'net::err_file_not_found', // Expected for some file operations
        'violates the following content security policy', // Expected CSP warnings
        'refused to evaluate a string as javascript', // Expected CSP restriction
        'test helpers available', // Our own test logging
        'loading sample course', // Our test messages
        'testloadcourse result' // Our test messages
      ];
      
      return !safeErrors.some(safe => text.includes(safe));
    });

    return criticalErrors.length > 0;
  }

  /**
   * Get new log entries since test started
   */
  private getNewLogContent(): string {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return '';
      }

      const stats = fs.statSync(this.logFilePath);
      const currentSize = stats.size;

      if (currentSize <= this.initialLogSize) {
        return '';
      }

      // Read only the new content
      const fd = fs.openSync(this.logFilePath, 'r');
      const buffer = Buffer.alloc(currentSize - this.initialLogSize);
      fs.readSync(fd, buffer, 0, buffer.length, this.initialLogSize);
      fs.closeSync(fd);

      return buffer.toString('utf8');
    } catch (error) {
      console.warn('Failed to read log file:', error);
      return '';
    }
  }

  /**
   * Check for [ERROR] entries in the app log file
   */
  getLogErrors(): LogError[] {
    const newLogContent = this.getNewLogContent();
    if (!newLogContent) {
      return [];
    }

    const lines = newLogContent.split('\n');
    const errorLines: LogError[] = [];

    for (const line of lines) {
      if (line.includes('[ERROR]')) {
        // Try to extract timestamp if present
        const timestampMatch = line.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
        errorLines.push({
          line: line.trim(),
          timestamp: timestampMatch ? timestampMatch[0] : undefined
        });
      }
    }

    return errorLines;
  }

  /**
   * Check if there are any [ERROR] entries in the log file
   */
  hasLogErrors(): boolean {
    return this.getLogErrors().length > 0;
  }

  /**
   * Get a summary of console activity and log errors
   */
  getSummary() {
    const byType = this.messages.reduce((acc, msg) => {
      acc[msg.type] = (acc[msg.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const logErrors = this.getLogErrors();

    return {
      total: this.messages.length,
      byType,
      errors: this.getErrors().length,
      warnings: this.messages.filter(m => m.type === 'warning' || m.type === 'warn').length,
      criticalErrors: this.hasCriticalErrors(),
      logErrors: logErrors.length,
      hasAnyErrors: this.hasCriticalErrors() || this.hasLogErrors()
    };
  }

  /**
   * Clear collected messages
   */
  clear() {
    this.messages = [];
  }

  /**
   * Print console and log summary to test output
   */
  printSummary(testName: string) {
    const summary = this.getSummary();
    console.log(`\n📊 Error Summary for "${testName}":`);
    console.log(`  Console messages: ${summary.total}`);
    console.log(`  By type:`, summary.byType);
    console.log(`  Log file: ${this.logFilePath}`);
    
    if (summary.criticalErrors) {
      console.log(`  ❌ Critical console errors found!`);
      this.getErrors().forEach(error => {
        console.log(`    - Console ${error.type}: ${error.text}`);
      });
    } else {
      console.log(`  ✅ No critical console errors`);
    }

    if (summary.logErrors > 0) {
      console.log(`  ❌ Log file errors found!`);
      this.getLogErrors().forEach(logError => {
        console.log(`    - Log [ERROR]: ${logError.line}`);
      });
    } else {
      console.log(`  ✅ No log file errors`);
    }

    if (summary.warnings > 0) {
      console.log(`  ⚠️  ${summary.warnings} warning(s)`);
    }

    if (!summary.hasAnyErrors) {
      console.log(`  🎉 No errors found anywhere!`);
    }
  }

  /**
   * Assert no critical errors occurred in console or log file
   */
  assertNoCriticalErrors(testName: string) {
    const hasCriticalConsole = this.hasCriticalErrors();
    const hasLogErrors = this.hasLogErrors();
    
    if (hasCriticalConsole || hasLogErrors) {
      const errorMessages: string[] = [];
      
      if (hasCriticalConsole) {
        const consoleErrors = this.getErrors();
        errorMessages.push('Console Errors:');
        consoleErrors.forEach(e => {
          errorMessages.push(`  - ${e.type}: ${e.text}`);
        });
      }
      
      if (hasLogErrors) {
        const logErrors = this.getLogErrors();
        errorMessages.push('Log File Errors:');
        logErrors.forEach(e => {
          errorMessages.push(`  - ${e.line}`);
        });
      }
      
      throw new Error(`Critical errors found in test "${testName}":\n${errorMessages.join('\n')}`);
    }
  }
}