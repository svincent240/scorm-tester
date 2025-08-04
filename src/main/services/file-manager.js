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
const xml2js = require('xml2js');
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
   * Find SCORM entry point
   * @param {string} folderPath - Extracted folder path
   * @returns {Promise<Object>} Entry point information
   */
  async findScormEntry(folderPath) {
    try {
      this.logger?.info(`FileManager: Finding SCORM entry point in ${path.basename(folderPath)}`);
      
      if (!this.validateFolderPath(folderPath)) {
        throw new Error('Invalid folder path');
      }
      
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: 'No imsmanifest.xml found' };
      }
      
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      
      // Get app root for URL resolution
      const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
      
      // Find SCO resource
      const scoResourceMatch = manifestContent.match(/<resource[^>]+adlcp:scormtype="sco"[^>]*>/i);
      if (scoResourceMatch) {
        const resourceBlock = scoResourceMatch[0];
        const hrefMatch = resourceBlock.match(/href="([^"]+)"/i);
        
        if (hrefMatch && hrefMatch[1]) {
          const contentPath = hrefMatch[1];
          const urlResult = PathUtils.resolveScormContentUrl(contentPath, folderPath, appRoot);
          
          if (urlResult.success) {
            this.logger?.info(`FileManager: Found SCO entry point: ${contentPath}`);
            this.recordOperation('findScormEntry', true);
            return {
              success: true,
              entryPath: urlResult.resolvedPath,
              launchUrl: urlResult.url,
              originalHref: contentPath
            };
          }
        }
      }
      
      // Fallback to first href found
      const launchMatch = manifestContent.match(/href\s*=\s*["']([^"']+)["']/i);
      if (launchMatch && launchMatch[1]) {
        const contentPath = launchMatch[1];
        const urlResult = PathUtils.resolveScormContentUrl(contentPath, folderPath, appRoot);
        
        if (urlResult.success) {
          this.logger?.info(`FileManager: Found fallback entry point: ${contentPath}`);
          this.recordOperation('findScormEntry', true);
          return {
            success: true,
            entryPath: urlResult.resolvedPath,
            launchUrl: urlResult.url,
            originalHref: contentPath
          };
        }
      }
      
      // Check common files
      const commonFiles = ['index.html', 'launch.html', 'start.html', 'main.html'];
      for (const file of commonFiles) {
        const urlResult = PathUtils.resolveScormContentUrl(file, folderPath, appRoot);
        if (urlResult.success) {
          this.logger?.info(`FileManager: Found common file entry point: ${file}`);
          this.recordOperation('findScormEntry', true);
          return {
            success: true,
            entryPath: urlResult.resolvedPath,
            launchUrl: urlResult.url,
            originalHref: file
          };
        }
      }
      
      this.recordOperation('findScormEntry', false);
      return { success: false, error: 'No SCORM entry point found' };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `Find SCORM entry failed: ${error.message}`,
        'FileManager.findScormEntry'
      );
      
      this.logger?.error('FileManager: Find SCORM entry failed:', error);
      this.recordOperation('findScormEntry', false);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get course information from manifest
   * @param {string} folderPath - Course folder path
   * @returns {Promise<Object>} Course information
   */
  async getCourseInfo(folderPath) {
    try {
      this.logger?.info(`FileManager: Getting course info from ${path.basename(folderPath)}`);
      
      if (!this.validateFolderPath(folderPath)) {
        throw new Error('Invalid folder path');
      }
      
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      
      if (!fs.existsSync(manifestPath)) {
        return {
          title: path.basename(folderPath) || 'Course',
          version: 'Unknown',
          scormVersion: 'Unknown',
          hasManifest: false
        };
      }
      
      // Check file size
      const stats = fs.statSync(manifestPath);
      const maxSize = 1024 * 1024; // 1MB
      
      if (stats.size > maxSize) {
        this.logger?.warn(`FileManager: Manifest file too large (${this.formatBytes(stats.size)})`);
        return {
          title: 'Large Course Package',
          version: 'Unknown',
          scormVersion: 'Unknown',
          hasManifest: true,
          warning: 'Manifest file too large for processing'
        };
      }
      
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      
      // Parse course information
      const courseInfo = this.parseManifestInfo(manifestContent);
      courseInfo.hasManifest = true;
      courseInfo.manifestSize = stats.size;
      
      this.logger?.info(`FileManager: Course info retrieved: ${courseInfo.title}`);
      this.recordOperation('getCourseInfo', true);
      
      return courseInfo;
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `Get course info failed: ${error.message}`,
        'FileManager.getCourseInfo'
      );
      
      this.logger?.error('FileManager: Get course info failed:', error);
      this.recordOperation('getCourseInfo', false);
      
      return {
        title: 'Error Reading Course',
        version: 'Unknown',
        scormVersion: 'Unknown',
        hasManifest: false,
        error: error.message
      };
    }
  }

  /**
   * Get course manifest structure
   * @param {string} folderPath - Course folder path
   * @returns {Promise<Object>} Manifest structure
   */
  async getCourseManifest(folderPath) {
    try {
      this.logger?.info(`FileManager: Getting course manifest from ${path.basename(folderPath)}`);
      
      if (!this.validateFolderPath(folderPath)) {
        throw new Error('Invalid folder path');
      }
      
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      
      if (!fs.existsSync(manifestPath)) {
        return { structure: null, error: 'Manifest not found' };
      }
      
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      const structure = await this.parseManifestStructure(manifestContent);
      
      this.logger?.info('FileManager: Course manifest structure retrieved');
      this.recordOperation('getCourseManifest', true);
      
      return { structure, success: true };
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `Get course manifest failed: ${error.message}`,
        'FileManager.getCourseManifest'
      );
      
      this.logger?.error('FileManager: Get course manifest failed:', error);
      this.recordOperation('getCourseManifest', false);
      
      return { structure: null, error: error.message };
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
   * Parse manifest information
   * @private
   * @param {string} manifestContent - Manifest XML content
   * @returns {Object} Parsed course information
   */
  parseManifestInfo(manifestContent) {
    const info = {
      title: 'Unknown Course',
      version: 'Unknown',
      scormVersion: 'Unknown'
    };
    
    try {
      // Extract title
      const titleMatch = manifestContent.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        info.title = titleMatch[1].trim();
      }
      
      // Extract version
      const versionMatch = manifestContent.match(/version\s*=\s*["']([^"']+)["']/i);
      if (versionMatch && versionMatch[1]) {
        info.version = versionMatch[1].trim();
      }
      
      // Extract SCORM version
      const scormMatch = manifestContent.match(/schemaversion\s*=\s*["']([^"']+)["']/i);
      if (scormMatch && scormMatch[1]) {
        info.scormVersion = scormMatch[1].trim();
      }
      
    } catch (error) {
      this.logger?.warn('FileManager: Error parsing manifest info:', error);
    }
    
    return info;
  }

  /**
   * Parse manifest structure
   * @private
   * @param {string} manifestContent - Manifest XML content
   * @returns {Promise<Object>} Parsed manifest structure
   */
  async parseManifestStructure(manifestContent) {
    try {
      const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
      const result = await parser.parseStringPromise(manifestContent);
      
      const organization = result.manifest?.organizations?.organization;
      if (!organization) {
        return { items: [], isFlowOnly: true };
      }
      
      // Check for flow-only navigation
      let isFlowOnly = false;
      if (organization['imsss:sequencing']?.['imsss:controlMode']) {
        const controlMode = organization['imsss:sequencing']['imsss:controlMode'];
        isFlowOnly = controlMode.flow === 'true' && controlMode.choice === 'false';
      }
      
      const items = this.parseItems(organization.item || []);
      
      return {
        items,
        isFlowOnly,
        title: organization.title || 'Course'
      };
      
    } catch (error) {
      this.logger?.error('FileManager: Failed to parse manifest structure:', error);
      return { items: [], isFlowOnly: true };
    }
  }

  /**
   * Parse manifest items recursively
   * @private
   * @param {Array|Object} xmlItems - XML items
   * @returns {Array} Parsed items
   */
  parseItems(xmlItems) {
    const items = [];
    const itemArray = Array.isArray(xmlItems) ? xmlItems : [xmlItems];
    
    itemArray.forEach(xmlItem => {
      if (!xmlItem) return;
      
      const isVisible = xmlItem.isvisible !== 'false';
      const item = {
        identifier: xmlItem.identifier || null,
        identifierref: xmlItem.identifierref || null,
        title: xmlItem.title || 'No Title',
        isVisible: isVisible,
        children: []
      };
      
      if (xmlItem.item) {
        item.children = this.parseItems(xmlItem.item);
      }
      
      if (!item.isVisible && item.children.length > 0) {
        items.push(...item.children);
      } else if (item.isVisible) {
        items.push(item);
      }
    });
    
    return items;
  }

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