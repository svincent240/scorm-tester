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

const { dialog, shell, app } = require('electron');
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
    
    // Clean up any leftover temporary files from previous sessions
    await this.cleanupLeftoverTempFiles();
    
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
    
    // NOTE: Temporary files are no longer cleaned up at shutdown for better post-shutdown troubleshooting
    // They will be cleaned up at next startup instead
    
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
      
      // Create extraction directory using a canonical temp root
      const tempRoot = path.join(app.getPath('temp'), 'scorm-tester');
      extractPath = path.join(tempRoot, `scorm_${Date.now()}`);
      
      await this.ensureDirectory(extractPath);
      this.tempFiles.add(extractPath);
      
      // Extract with validation (return counts and size for transparency)
      const extractStats = await this.extractZipWithValidation(zipPath, extractPath);
      
      this.logger?.info(`FileManager: SCORM extraction completed (${operationId}): ${path.basename(extractPath)} -- extracted=${extractStats.extractedCount} skipped=${extractStats.skippedCount} size=${this.formatBytes(extractStats.totalSize)}`);
      
      // Copy LMS support files to extracted directory
      try {
        await this.copyLmsFiles(extractPath);
        this.logger?.info(`FileManager: LMS support files copied to ${path.basename(extractPath)}`);
      } catch (lmsError) {
        this.logger?.warn(`FileManager: Failed to copy LMS support files: ${lmsError.message}`);
      }
      
      this.recordOperation('extractScorm', true);
      
      return {
        success: true,
        path: extractPath,
        extractedCount: extractStats.extractedCount,
        skippedCount: extractStats.skippedCount,
        totalSize: extractStats.totalSize
      };
      
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
   * Copy LMS support files to extracted SCORM directory
   * @private
   * @param {string} extractPath - Path to extracted SCORM directory
   */
  async copyLmsFiles(extractPath) {
    try {
      const appRoot = path.resolve(__dirname, '../../../');
      const lmsSourcePath = path.join(appRoot, 'references', 'real_course_examples', 'SL360_LMS_SCORM_2004', 'lms');
      const lmsDestPath = path.join(extractPath, 'lms');

      // Check if source LMS directory exists
      if (!fs.existsSync(lmsSourcePath)) {
        this.logger?.debug(`FileManager: LMS source directory not found at ${lmsSourcePath}, skipping LMS files copy`);
        return;
      }

      // Create destination lms directory if it doesn't exist
      await this.ensureDirectory(lmsDestPath);

      // Get list of LMS files to copy
      const lmsFiles = fs.readdirSync(lmsSourcePath);
      let copiedCount = 0;

      for (const filename of lmsFiles) {
        const sourcePath = path.join(lmsSourcePath, filename);
        const destPath = path.join(lmsDestPath, filename);
        
        // Only copy files, skip directories
        if (fs.statSync(sourcePath).isFile()) {
          fs.copyFileSync(sourcePath, destPath);
          copiedCount++;
        }
      }

      this.logger?.debug(`FileManager: Copied ${copiedCount} LMS support files to ${path.basename(extractPath)}/lms`);
      
    } catch (error) {
      throw new Error(`Failed to copy LMS support files: ${error.message}`);
    }
  }

  /**
   * Resolve and return the canonical manifest path for a given folder.
   * Returns { success: true, manifestPath } when found, or { success: false, error }.
   */
  getManifestPath(folderPath) {
    try {
      if (!folderPath || typeof folderPath !== 'string') {
        return { success: false, error: 'Invalid folder path' };
      }
      const manifestPath = path.join(folderPath, 'imsmanifest.xml');
      if (fs.existsSync(manifestPath)) {
        return { success: true, manifestPath };
      }
      // No manifest in expected location — return not found
      return { success: false, error: 'No imsmanifest.xml found' };
    } catch (error) {
      return { success: false, error: error.message || String(error) };
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
      
      const manifestResult = this.getManifestPath(folderPath);
      if (!manifestResult.success) {
        this.recordOperation('findScormEntry', false);
        return { success: false, error: manifestResult.error || 'No imsmanifest.xml found' };
      }
      
      this.logger?.info(`FileManager: Found imsmanifest.xml at ${manifestResult.manifestPath}`);
      this.recordOperation('findScormEntry', true);
      return { success: true, manifestPath: manifestResult.manifestPath };
      
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
      
      const manifestResult = this.getManifestPath(folderPath);
      if (!manifestResult.success) {
        this.recordOperation('getCourseInfo', false);
        return { success: false, error: manifestResult.error || 'No imsmanifest.xml found' };
      }
      
      this.logger?.info(`FileManager: Found imsmanifest.xml for course info at ${manifestResult.manifestPath}`);
      this.recordOperation('getCourseInfo', true);
      return { success: true, manifestPath: manifestResult.manifestPath };
      
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
      
      const manifestResult = this.getManifestPath(folderPath);
      if (!manifestResult.success) {
        this.recordOperation('getCourseManifest', false);
        return { success: false, error: manifestResult.error || 'Manifest not found' };
      }
      
      const manifestContent = await fs.promises.readFile(manifestResult.manifestPath, 'utf8');
      
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
      
      // Use canonical temp root
      const tempRoot = path.join(app.getPath('temp'), 'scorm-tester');
      await this.ensureDirectory(tempRoot);
      
      // Generate unique filename
      const timestamp = Date.now();
      const tempFileName = `${timestamp}_${sanitizedName}`;
      const tempFilePath = path.join(tempRoot, tempFileName);
      
      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Check file size
      if (buffer.length > this.config.maxPackageSize) {
        throw new Error(`File size ${this.formatBytes(buffer.length)} exceeds limit ${this.formatBytes(this.config.maxPackageSize)}`);
      }
      
      // Asynchronous write to avoid blocking main thread
      await fs.promises.writeFile(tempFilePath, buffer);
      
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
   * Prepare a canonical working directory for a course source (zip or folder).
   * Ensures the rest of the app always works against a canonical path under the
   * app temp root (os.tmpdir()/scorm-tester/scorm_<ts>).
   *
   * Source descriptor:
   *   { type: 'zip'|'folder'|'temp', path: string }
   *
   * Behavior:
   *   - zip: validate zip exists and extract into canonical temp root (reuse extractScorm)
   *   - folder: validate it contains imsmanifest.xml (findScormEntry) then copy folder into canonical temp root
   *   - temp: treated like zip or file depending on extension (zip -> extract, folder not expected)
   *
   * Returns:
   *   { success: true, type, unifiedPath, originalPath } or { success: false, error }
   */
  async prepareCourseSource(source) {
    try {
      if (!source || !source.path || !source.type) {
        throw new Error('Invalid source descriptor. Expect { type, path }');
      }

      const srcPath = source.path;
      const srcType = source.type;

      // Sanity checks
      if (!this.validateFilePath(srcPath) && !this.validateFolderPath(srcPath)) {
        throw new Error('Source path does not exist or is inaccessible');
      }

      // Canonical temp root
      const tempRoot = path.join(app.getPath('temp'), 'scorm-tester');
      await this.ensureDirectory(tempRoot);

      // For zip files (or temp files that are zip), extract and return the extracted path
      if (srcType === 'zip' || (srcType === 'temp' && path.extname(srcPath).toLowerCase() === '.zip')) {
        // Reuse existing extract flow which already writes into canonical temp/scorm_<ts>
        const extractResult = await this.extractScorm(srcPath);
        if (!extractResult.success) {
          return { success: false, error: extractResult.error || 'Extraction failed' };
        }
        return { success: true, type: 'zip', unifiedPath: extractResult.path, originalPath: srcPath };
      }

      // For folder sources, validate presence of imsmanifest.xml before copying
      if (srcType === 'folder') {
        // Check for manifest in selected folder only (top-level acceptance)
        const manifestCheck = await this.findScormEntry(srcPath);
        if (!manifestCheck.success) {
          return { success: false, error: 'Selected folder does not contain imsmanifest.xml' };
        }

        // Create canonical destination directory
        const destPath = path.join(tempRoot, `scorm_${Date.now()}`);
        await this.ensureDirectory(destPath);

        // Perform a recursive copy from srcPath -> destPath
        const copyRecursive = async (src, dest) => {
          const entries = await fs.promises.readdir(src, { withFileTypes: true });
          for (const entry of entries) {
            const srcEntryPath = path.join(src, entry.name);
            const destEntryPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              await fs.promises.mkdir(destEntryPath, { recursive: true });
              await copyRecursive(srcEntryPath, destEntryPath);
            } else if (entry.isFile()) {
              try {
                await fs.promises.copyFile(srcEntryPath, destEntryPath);
              } catch (e) {
                // If copy fails for a file, log and continue (don't fail whole copy for transient IO issues)
                this.logger?.warn(`FileManager: Failed to copy file ${srcEntryPath} -> ${destEntryPath}: ${e?.message || e}`);
              }
            }
          }
        };

        await copyRecursive(srcPath, destPath);
        this.tempFiles.add(destPath);

        // Double-check manifest exists in copied destination
        const manifestCheckCopy = this.getManifestPath(destPath);
        if (!manifestCheckCopy.success) {
          // Clean up and fail
          try { fs.rmSync(destPath, { recursive: true, force: true }); } catch(_) {}
          this.tempFiles.delete(destPath);
          return { success: false, error: 'Manifest not found in copied folder' };
        }

        return { success: true, type: 'folder', unifiedPath: destPath, originalPath: srcPath };
      }

      // Fallback - unknown type
      return { success: false, error: `Unsupported source type: ${srcType}` };

    } catch (error) {
      this.logger?.error('FileManager.prepareCourseSource failed:', error);
      return { success: false, error: error.message || String(error) };
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
      const entryNames = Object.keys(entries);
      const entryCount = entryNames.length;
      this.logger?.debug(`FileManager: extractZipWithValidation - Entry count: ${entryCount}`);

      if (entryCount === 0) {
        throw new Error('ZIP file is empty');
      }
      
      if (entryCount > 10000) {
        throw new Error('ZIP file contains too many files');
      }
      
      // Validate entries and calculate size, then extract safe entries only.
      let totalSize = 0;
      let extractedCount = 0;
      let skippedCount = 0;
      const resolvedExtractRoot = path.resolve(extractPath);
      this.logger?.debug(`FileManager: extractZipWithValidation - Resolved extract root: ${resolvedExtractRoot}`);
      
      for (const entryName of entryNames) {
        const entry = entries[entryName];
        this.logger?.debug(`FileManager: Processing entry: ${entryName}, isDirectory: ${entry.isDirectory}, size: ${entry.size}`);
        try {
          // Normalize entry name to use forward slashes for consistent checks
          const normalizedEntry = entryName.replace(/\\/g, '/');
  
          // Skip directory entries
          if (entry.isDirectory || normalizedEntry.endsWith('/')) {
            this.logger?.debug(`FileManager: Skipping directory entry: ${entryName}`);
            skippedCount++;
            continue;
          }
  
          // Basic suspicious name checks
          if (normalizedEntry.includes('..') || normalizedEntry.includes('\0') || normalizedEntry.includes('~')) {
            this.logger?.warn(`FileManager: Skipping suspicious entry name: ${entryName}`);
            skippedCount++;
            continue;
          }

          // Check for absolute paths within the zip entry name itself
          if (path.isAbsolute(normalizedEntry)) {
            this.logger?.warn(`FileManager: Skipping ZIP entry with absolute path: ${entryName}`);
            skippedCount++;
            continue;
          }
  
          // Compute the target path for this entry and ensure it does not escape extractPath
          const targetPath = path.join(extractPath, normalizedEntry);
          const resolvedTarget = path.resolve(targetPath);
          this.logger?.debug(`FileManager: Path validation - entryName: ${entryName}, targetPath: ${targetPath}, resolvedTarget: ${resolvedTarget}, resolvedExtractRoot: ${resolvedExtractRoot}, path.sep: ${path.sep}`);
          const isWithinExtractRoot = resolvedTarget === resolvedExtractRoot || resolvedTarget.startsWith(resolvedExtractRoot + path.sep);
          this.logger?.debug(`FileManager: Path validation - isWithinExtractRoot: ${isWithinExtractRoot}`);
          // Ensure resolved target is within extract root
          if (!isWithinExtractRoot) {
            this.logger?.warn(`FileManager: Skipping ZIP entry that would extract outside target: ${entryName} -> ${resolvedTarget}`);
            skippedCount++;
            continue;
          }
  
          // Size accounting and global extracted size guard
          // Check size before extraction to prevent exceeding limit
          if ((totalSize + (entry.size || 0)) > this.config.maxExtractedSize) {
            this.logger?.error(`FileManager: Extracted content would exceed size limit: ${totalSize + (entry.size || 0)} > ${this.config.maxExtractedSize}`);
            throw new Error('Extracted content would exceed size limit');
          }

          // Ensure destination directory exists for this entry
          const destDir = path.dirname(resolvedTarget);
          this.logger?.debug(`FileManager: Ensuring directory exists: ${destDir}`);
          await fs.promises.mkdir(destDir, { recursive: true });

          // Extract this single entry preserving the directory structure
          try {
            this.logger?.debug(`FileManager: Extracting entry: ${entryName} to ${resolvedTarget}`);
            
            // CRITICAL FIX: Use resolvedTarget which already includes the full directory path
            // This preserves the ZIP's internal directory structure
            await zip.extract(entryName, resolvedTarget);
            
            // Light verification - just log the extraction target for debugging
            this.logger?.debug(`FileManager: Extracted ${entryName} -> ${resolvedTarget}`)
            
            totalSize += entry.size || 0; // Only add size if extraction is successful
            extractedCount++;
            this.logger?.debug(`FileManager: Successfully extracted entry: ${entryName}, extractedCount: ${extractedCount}, totalSize: ${totalSize}`);
          } catch (e) {
            this.logger?.warn(`FileManager: Failed to extract entry ${entryName}: ${e?.message || e}`);
            skippedCount++;
          }
        } catch (e) {
          // Re-throw if it's a size limit error, otherwise skip and continue
          if (e.message === 'Extracted content would exceed size limit') {
            throw e; // Re-throw the size limit error
          }
          this.logger?.warn(`FileManager: Skipping entry due to validation/extract error ${entryName}: ${e?.message || e}`);
          skippedCount++;
        }
      }
  
      this.logger?.info(`FileManager: Extracted ${extractedCount} files, skipped ${skippedCount} suspicious/failed entries (${this.formatBytes(totalSize)})`);
      
      // Post-extraction filesystem verification to confirm files were actually written
      await this.verifyExtractedFiles(extractPath, extractedCount);
      
      // Return extraction statistics for callers and tests
      return { extractedCount, skippedCount, totalSize };
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
    const tempDir = path.join(app.getPath('temp'), 'scorm-tester');
    await this.ensureDirectory(tempDir);
    
    // Validate temp directory permissions for Windows filesystem operations
    try {
      // Check read permission
      fs.accessSync(tempDir, fs.constants.R_OK);
      this.logger?.debug(`FileManager: Temp directory read permission confirmed: ${tempDir}`);
      
      // Check write permission
      fs.accessSync(tempDir, fs.constants.W_OK);
      this.logger?.debug(`FileManager: Temp directory write permission confirmed: ${tempDir}`);
      
      // Test actual file creation to ensure permissions work
      const testFile = path.join(tempDir, `perm_test_${Date.now()}.tmp`);
      fs.writeFileSync(testFile, 'permission test', 'utf8');
      
      // Verify the test file was created and is readable
      if (fs.existsSync(testFile)) {
        const testContent = fs.readFileSync(testFile, 'utf8');
        this.logger?.debug(`FileManager: Temp directory write/read test successful: ${testFile}`);
        
        // Clean up test file
        fs.unlinkSync(testFile);
      } else {
        this.logger?.error(`FileManager: Temp directory write test FAILED - file not created: ${testFile}`);
      }
      
    } catch (permError) {
      this.logger?.error(`FileManager: Temp directory permission check FAILED for ${tempDir}: ${permError.code} - ${permError.message}`);
      throw new Error(`Insufficient permissions for temp directory: ${tempDir}`);
    }
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
   * Cleanup leftover temporary files from previous sessions at startup
   * @private
   */
  async cleanupLeftoverTempFiles() {
    const tempDir = path.join(app.getPath('temp'), 'scorm-tester');
    
    try {
      if (!fs.existsSync(tempDir)) {
        this.logger?.debug('FileManager: No temp directory to clean up');
        return;
      }

      const entries = fs.readdirSync(tempDir);
      let cleanupCount = 0;

      for (const entry of entries) {
        const entryPath = path.join(tempDir, entry);
        
        try {
          // Only clean up scorm_ prefixed directories and files
          if (entry.startsWith('scorm_')) {
            fs.rmSync(entryPath, { recursive: true, force: true });
            cleanupCount++;
            this.logger?.debug(`FileManager: Cleaned up leftover temp entry: ${entry}`);
          }
        } catch (error) {
          this.logger?.error(`FileManager: Failed to cleanup leftover temp entry ${entry}:`, error);
        }
      }

      if (cleanupCount > 0) {
        this.logger?.info(`FileManager: Cleaned up ${cleanupCount} leftover temp entries from previous sessions`);
      } else {
        this.logger?.debug('FileManager: No leftover temp files to clean up');
      }
      
    } catch (error) {
      this.logger?.error('FileManager: Failed to cleanup leftover temp files:', error);
    }
  }

  /**
   * Verify extracted files exist on filesystem after extraction
   * @private
   * @param {string} extractPath - Path where files were extracted
   * @param {number} expectedCount - Expected number of extracted files
   */
  async verifyExtractedFiles(extractPath, expectedCount) {
    try {
      this.logger?.debug(`FileManager: Verifying extraction - checking ${extractPath} for ${expectedCount} files`);
      
      if (!fs.existsSync(extractPath)) {
        this.logger?.error(`FileManager: VERIFICATION FAILED - Extract path does not exist: ${extractPath}`);
        return;
      }

      // Count actual files recursively
      let actualCount = 0;
      const countFiles = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              countFiles(fullPath);
            } else if (entry.isFile()) {
              actualCount++;
              // Also verify each file is readable
              try {
                fs.accessSync(fullPath, fs.constants.R_OK);
                this.logger?.debug(`FileManager: Verified file exists and is readable: ${path.relative(extractPath, fullPath)}`);
              } catch (accessError) {
                this.logger?.error(`FileManager: VERIFICATION FAILED - File not readable: ${fullPath} - ${accessError.message}`);
              }
            }
          }
        } catch (error) {
          this.logger?.error(`FileManager: Error counting files in ${dir}: ${error.message}`);
        }
      };

      countFiles(extractPath);
      
      this.logger?.info(`FileManager: Post-extraction verification - Expected: ${expectedCount}, Found: ${actualCount} files`);
      
      if (actualCount !== expectedCount) {
        this.logger?.warn(`FileManager: File count mismatch after extraction - expected ${expectedCount}, found ${actualCount}`);
      } else {
        this.logger?.debug(`FileManager: Post-extraction verification PASSED - all ${actualCount} files confirmed on filesystem`);
      }

    } catch (error) {
      this.logger?.error(`FileManager: Post-extraction verification failed: ${error.message}`);
    }
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