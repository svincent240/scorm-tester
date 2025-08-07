/**
 * File Manager Service
 * 
 * Handles all file system operations including SCORM package extraction,
 * manifest parsing, file validation, and temporary file management.
 * 
 * Extracted from monolithic main.js to provide modular file management
 * with enhanced security, validation, and resource management.
 * 
 * @fileoverview File management service for SCORM Tester main process
 */

const { dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const StreamZip = require('node-stream-zip');
// Removed xml2js import
const BaseService = require('./base-service');
const PathUtils = require('../../shared/utils/path-utils');
const {
  FILE_OPERATIONS,
  SERVICE_DEFAULTS,
  SECURITY_CONFIG
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');

/**
 * File Manager Service Class
 * 
 * Manages all file system operations with security validation,
 * resource management, and comprehensive error handling.
 */
class FileManager extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('FileManager', errorHandler, logger, options);
    
    // Configuration
    this.config = {
      ...SERVICE_DEFAULTS.FILE_MANAGER,
      ...options
    };
    
    // Security configuration
    this.securityConfig = SECURITY_CONFIG.FILE_SYSTEM;
    
    // Active operations tracking
    this.activeOperations = new Map();
    this.operationCounter = 0;
    
    // Temporary files tracking
    this.tempFiles = new Set();
    this.cleanupInterval = null;
  }

  /**
   * Validate dependencies
   * @protected
   * @returns {boolean} True if dependencies are valid
   */
  validateDependencies() {
    // File manager has no external service dependencies
    return true;
  }

  /**
   * Initialize file manager service
   * @protected
   */
  async doInitialize() {
    this.logger?.debug('FileManager: Starting initialization');
    
    // Ensure temp directory exists
    await this.ensureTempDirectory();
    
    // Set up cleanup interval
    this.setupCleanupInterval();
    
    this.logger?.debug('FileManager: Initialization completed');
  }

  /**
   * Shutdown file manager service
   * @protected
   */
  async doShutdown() {
    this.logger?.debug('FileManager: Starting shutdown');
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Cancel active operations
    for (const [operationId, operation] of this.activeOperations) {
      this.logger?.debug(`FileManager: Cancelling operation ${operationId}`);
      // Add operation cancellation logic if needed
    }
    
    // Clean up temporary files
    await this.cleanupTempFiles();
    
    this.activeOperations.clear();
    this.tempFiles.clear();
    
    this.logger?.debug('FileManager: Shutdown completed');
  }

  /**
   * Select SCORM package file dialog
   * @returns {Promise<Object>} Result object with success and filePath properties
   */
  async selectScormPackage() {
    try {
      this.logger?.info('FileManager: Opening SCORM package selection dialog');
      
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'SCORM Packages', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        this.logger?.info(`FileManager: SCORM package selected: ${path.basename(filePath)}`);
        this.recordOperation('selectScormPackage', true);
        return { success: true, filePath: filePath };
      }
      
      this.logger?.info('FileManager: SCORM package selection cancelled');
      this.recordOperation('selectScormPackage', true);
      return { success: false, cancelled: true };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `SCORM package selection failed: ${error.message}`,
        'FileManager.selectScormPackage'
      );
      
      this.logger?.error('FileManager: SCORM package selection failed:', error);
      this.recordOperation('selectScormPackage', false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Select a SCORM course folder (unzipped) ensuring imsmanifest.xml exists.
   * @returns {Promise<Object>} Result object with success and folderPath
   */
  async selectScormFolder() {
    try {
      this.logger?.info('FileManager: Opening SCORM folder selection dialog');

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });

      if (result.canceled || result.filePaths.length === 0) {
        this.logger?.info('FileManager: SCORM folder selection cancelled');
        this.recordOperation('selectScormFolder', true);
        return { success: false, cancelled: true };
      }

      const folderPath = result.filePaths[0];

      if (!this.validateFolderPath(folderPath)) {
        this.recordOperation('selectScormFolder', false);
        return { success: false, error: 'Invalid folder path' };
      }

      const manifestCheck = await this.findScormEntry(folderPath);
      if (!manifestCheck.success) {
        this.logger?.warn('FileManager: Selected folder does not contain imsmanifest.xml');
        this.recordOperation('selectScormFolder', false);
        return { success: false, error: 'imsmanifest.xml not found in selected folder' };
      }

      this.logger?.info(`FileManager: SCORM folder selected: ${path.basename(folderPath)}`);
      this.recordOperation('selectScormFolder', true);
      return { success: true, folderPath };

    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `SCORM folder selection failed: ${error.message}`,
        'FileManager.selectScormFolder'
      );
      this.logger?.error('FileManager: SCORM folder selection failed:', error);
      this.recordOperation('selectScormFolder', false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract SCORM package
   * @param {string} zipPath - Path to ZIP file
   * @returns {Promise<Object>} Result object with success and path properties
   */
  async extractScorm(zipPath) {
    const operationId = ++this.operationCounter;
    let extractPath = null;
    
    try {
      this.logger?.info(`FileManager: Starting SCORM extraction (${operationId})`);
      this.activeOperations.set(operationId, { type: FILE_OPERATIONS.EXTRACT, zipPath });
      
      // Validate file path
      if (!this.validateFilePath(zipPath)) {
        throw new Error('Invalid file path');
      }
      
      // Check file size
      const stats = fs.statSync(zipPath);
      if (stats.size > this.config.maxPackageSize) {
        throw new Error(`Package size ${this.formatBytes(stats.size)} exceeds limit ${this.formatBytes(this.config.maxPackageSize)}`);
      }
      
      // Create extraction directory
      const tempDir = path.join(__dirname, '../../../temp');
      extractPath = path.join(tempDir, `scorm_${Date.now()}`);
      
      await this.ensureDirectory(extractPath);
      this.tempFiles.add(extractPath);
      
      // Extract with validation
      await this.extractZipWithValidation(zipPath, extractPath);
      
      this.logger?.info(`FileManager: SCORM extraction completed (${operationId}): ${path.basename(extractPath)}`);
      this.recordOperation('extractScorm', true);
      
      return { success: true, path: extractPath };
      
    } catch (error) {
      // Cleanup failed extraction
      if (extractPath && fs.existsSync(extractPath)) {
        try {
          fs.rmSync(extractPath, { recursive: true, force: true });
          this.tempFiles.delete(extractPath);
        } catch (cleanupError) {
          this.logger?.error('FileManager: Failed to cleanup failed extraction:', cleanupError);
        }
      }
      
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.PACKAGE_EXTRACTION_FAILED,
        `SCORM extraction failed: ${error.message}`,
        'FileManager.extractScorm'
      );
      
      this.logger?.error(`FileManager: SCORM extraction failed (${operationId}):`, error);
      this.recordOperation('extractScorm', false);
      return { success: false, error: error.message };
      
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  /**
   * Find SCORM entry point (file system check only)
   * @param {string} folderPath - Extracted folder path
   * @returns {Promise<Object>} Result object with success and manifestPath
   */
  async findScormEntry(folderPath) {
    try {
      this.logger?.info(`FileManager: Checking for imsmanifest.xml in ${path.basename(folderPath)}`);
      
      if (!this.validateFolderPath(folderPath)) {
        throw new Error('Invalid folder path');
      }
      
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      
      if (!fs.existsSync(manifestPath)) {
        this.recordOperation('findScormEntry', false);
        return { success: false, error: 'No imsmanifest.xml found' };
      }
      
      this.logger?.info(`FileManager: Found imsmanifest.xml at ${manifestPath}`);
      this.recordOperation('findScormEntry', true);
      return { success: true, manifestPath: manifestPath };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `File system check for SCORM entry failed: ${error.message}`,
        'FileManager.findScormEntry'
      );
      
      this.logger?.error('FileManager: File system check for SCORM entry failed:', error);
      this.recordOperation('findScormEntry', false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get course information (file system check only)
   * @param {string} folderPath - Course folder path
   * @returns {Promise<Object>} Result object with success and manifestPath
   */
  async getCourseInfo(folderPath) {
    try {
      this.logger?.info(`FileManager: Checking for imsmanifest.xml for course info in ${path.basename(folderPath)}`);
      
      if (!this.validateFolderPath(folderPath)) {
        throw new Error('Invalid folder path');
      }
      
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      
      if (!fs.existsSync(manifestPath)) {
        this.recordOperation('getCourseInfo', false);
        return { success: false, error: 'No imsmanifest.xml found' };
      }
      
      this.logger?.info(`FileManager: Found imsmanifest.xml for course info at ${manifestPath}`);
      this.recordOperation('getCourseInfo', true);
      return { success: true, manifestPath: manifestPath };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `File system check for course info failed: ${error.message}`,
        'FileManager.getCourseInfo'
      );
      
      this.logger?.error('FileManager: File system check for course info failed:', error);
      this.recordOperation('getCourseInfo', false);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Get course manifest content (file system check only)
   * @param {string} folderPath - Course folder path
   * @returns {Promise<Object>} Result object with success and manifestContent
   */
  async getCourseManifest(folderPath) {
    try {
      this.logger?.info(`FileManager: Reading imsmanifest.xml content from ${path.basename(folderPath)}`);
      
      if (!this.validateFolderPath(folderPath)) {
        throw new Error('Invalid folder path');
      }
      
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      
      if (!fs.existsSync(manifestPath)) {
        this.recordOperation('getCourseManifest', false);
        return { success: false, error: 'Manifest not found' };
      }
      
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      
      this.logger?.info('FileManager: Course manifest content retrieved');
      this.recordOperation('getCourseManifest', true);
      
      return { success: true, manifestContent: manifestContent };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `Read course manifest content failed: ${error.message}`,
        'FileManager.getCourseManifest'
      );
      
      this.logger?.error('FileManager: Read course manifest content failed:', error);
      this.recordOperation('getCourseManifest', false);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Save temporary file from base64 data
   * @param {string} fileName - Original file name
   * @param {string} base64Data - Base64 encoded file data
   * @returns {Promise<Object>} Result with file path
   */
  async saveTemporaryFile(fileName, base64Data) {
    try {
      this.logger?.info(`FileManager: Saving temporary file: ${fileName}`);
      
      // Validate inputs
      if (!fileName || !base64Data) {
        throw new Error('Invalid file name or data');
      }
      
      // Sanitize filename
      const sanitizedName = this.sanitizeFilename(fileName);
      if (!sanitizedName) {
        throw new Error('Invalid filename after sanitization');
      }
      
      // Create temp directory if needed
      const tempDir = path.join(__dirname, '../../../temp');
      await this.ensureDirectory(tempDir);
      
      // Generate unique filename
      const timestamp = Date.now();
      const tempFileName = `${timestamp}_${sanitizedName}`;
      const tempFilePath = path.join(tempDir, tempFileName);
      
      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Check file size
      if (buffer.length > this.config.maxPackageSize) {
        throw new Error(`File size ${this.formatBytes(buffer.length)} exceeds limit ${this.formatBytes(this.config.maxPackageSize)}`);
      }
      
      // Write file
      fs.writeFileSync(tempFilePath, buffer);
      
      // Track temporary file
      this.tempFiles.add(tempFilePath);
      
      this.logger?.info(`FileManager: Temporary file saved: ${tempFileName} (${this.formatBytes(buffer.length)})`);
      this.recordOperation('saveTemporaryFile', true);
      
      return { success: true, path: tempFilePath };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `Save temporary file failed: ${error.message}`,
        'FileManager.saveTemporaryFile'
      );
      
      this.logger?.error('FileManager: Save temporary file failed:', error);
      this.recordOperation('saveTemporaryFile', false);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract ZIP with validation
   * @private
   * @param {string} zipPath - ZIP file path
   * @param {string} extractPath - Extraction directory
   */
  async extractZipWithValidation(zipPath, extractPath) {
    const zip = new StreamZip.async({ file: zipPath });
    
    try {
      // Get entries and validate
      const entries = await zip.entries();
      const entryCount = Object.keys(entries).length;
      
      if (entryCount === 0) {
        throw new Error('ZIP file is empty');
      }
      
      if (entryCount > 10000) {
        throw new Error('ZIP file contains too many files');
      }
      
      // Validate entries and calculate size
      let totalSize = 0;
      for (const [entryName, entry] of Object.entries(entries)) {
        // Security validation
        if (entryName.includes('..') || entryName.includes('~')) {
          this.logger?.warn(`FileManager: Skipping suspicious entry: ${entryName}`);
          continue;
        }
        
        totalSize += entry.size || 0;
        if (totalSize > this.config.maxExtractedSize) {
          throw new Error('Extracted content would exceed size limit');
        }
      }
      
      // Extract files
      await zip.extract(null, extractPath);
      
      this.logger?.info(`FileManager: Extracted ${entryCount} files (${this.formatBytes(totalSize)})`);
      
    } finally {
      await zip.close();
    }
  }

  /**

  /**

  /**

  /**
   * Sanitize filename for security
   * @private
   * @param {string} filename - Filename to sanitize
   * @returns {string} Sanitized filename
   */
  sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
      return null;
    }
    
    // Remove path separators and dangerous characters
    let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
    
    // Remove leading/trailing dots and spaces
    sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');
    
    // Limit length
    if (sanitized.length > 255) {
      const ext = path.extname(sanitized);
      const name = path.basename(sanitized, ext);
      sanitized = name.substring(0, 255 - ext.length) + ext;
    }
    
    // Ensure it's not empty
    if (!sanitized) {
      return null;
    }
    
    return sanitized;
  }

  /**
   * Validate file path
   * @private
   * @param {string} filePath - File path to validate
   * @returns {boolean} True if valid
   */
  validateFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }
    
    if (this.securityConfig.preventTraversal && filePath.includes('..')) {
      return false;
    }
    
    if (filePath.length > this.securityConfig.maxPathLength) {
      return false;
    }
    
    return fs.existsSync(filePath);
  }

  /**
   * Validate folder path
   * @private
   * @param {string} folderPath - Folder path to validate
   * @returns {boolean} True if valid
   */
  validateFolderPath(folderPath) {
    if (!this.validateFilePath(folderPath)) {
      return false;
    }
    
    try {
      const stats = fs.statSync(folderPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Ensure directory exists
   * @private
   * @param {string} dirPath - Directory path
   */
  async ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Ensure temp directory exists
   * @private
   */
  async ensureTempDirectory() {
    const tempDir = path.join(__dirname, '../../../temp');
    await this.ensureDirectory(tempDir);
  }

  /**
   * Setup cleanup interval
   * @private
   */
  setupCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTempFiles();
    }, this.config.tempDirCleanupInterval);
  }

  /**
   * Cleanup old temporary files
   * @private
   */
  cleanupOldTempFiles() {
    const now = Date.now();
    const maxAge = this.config.tempDirCleanupInterval;
    
    for (const tempPath of this.tempFiles) {
      try {
        if (fs.existsSync(tempPath)) {
          const stats = fs.statSync(tempPath);
          const age = now - stats.birthtimeMs;
          
          if (age > maxAge) {
            fs.rmSync(tempPath, { recursive: true, force: true });
            this.tempFiles.delete(tempPath);
            this.logger?.debug(`FileManager: Cleaned up old temp file: ${path.basename(tempPath)}`);
          }
        } else {
          this.tempFiles.delete(tempPath);
        }
      } catch (error) {
        this.logger?.error(`FileManager: Failed to cleanup temp file ${tempPath}:`, error);
      }
    }
  }

  /**
   * Cleanup all temporary files
   * @private
   */
  async cleanupTempFiles() {
    for (const tempPath of this.tempFiles) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { recursive: true, force: true });
          this.logger?.debug(`FileManager: Cleaned up temp file: ${path.basename(tempPath)}`);
        }
      } catch (error) {
        this.logger?.error(`FileManager: Failed to cleanup temp file ${tempPath}:`, error);
      }
    }
    
    this.tempFiles.clear();
  }

  /**
   * Format bytes for display
   * @private
   * @param {number} bytes - Bytes to format
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = FileManager;