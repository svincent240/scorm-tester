/**
 * Path Utilities Module
 * 
 * Centralized path operations for consistent file handling across
 * main process, renderer, and custom protocol handler.
 * 
 * @fileoverview Cross-platform path utilities for SCORM Tester
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const getLogger = require('./logger');

/**
 * Path Utilities Class
 * 
 * Provides consistent, secure path operations across all processes.
 */
class PathUtils {
  static get logger() {
    if (!this._logger) {
      try {
        this._logger = getLogger();
      } catch (e) {
        this._logger = null;
      }
    }
    return this._logger;
  }

  /**
   * Get normalized temp root directory
   * @returns {string} Normalized temp root path
   */
  static getTempRoot() {
    return this.normalize(path.join(os.tmpdir(), 'scorm-tester'));
  }

  /**
   * Check if path is within allowed root and exists
   * @param {string} resolvedPath - The resolved file path
   * @param {string} allowedRoot - The allowed root directory
   * @param {string} nativePath - The native file path for existence check
   * @returns {boolean} True if path is valid and exists
   */
  static isValidPath(resolvedPath, allowedRoot, nativePath) {
    return resolvedPath.startsWith(allowedRoot) && fs.existsSync(nativePath);
  }

  /**
   * Normalize path for cross-platform compatibility
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized path
   */
  static normalize(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path provided');
    }

    // Log original path for debugging
    if (this.logger) {
      this.logger.debug('PathUtils: Normalizing path:', {
        original: filePath,
        platform: process?.platform || 'unknown'
      });
    }

    // Convert backslashes to forward slashes and remove duplicate slashes
    let normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');

    // Remove trailing slash unless it's root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    // Log result for debugging
    if (this.logger) {
      this.logger.debug('PathUtils: Path normalized:', {
        original: filePath,
        normalized: normalized,
        changed: normalized !== filePath
      });
    }

    return normalized;
  }

  /**
   * Convert file system path to scorm-app:// protocol URL
   * @param {string} filePath - Absolute file system path
   * @param {string} appRoot - Application root directory
   * @returns {string} Protocol URL
   */
  static toScormProtocolUrl(filePath, appRoot) {
    if (!filePath || !appRoot) {
      throw new Error('File path and app root are required');
    }
    
    const normalizedPath = this.normalize(filePath);
    const normalizedRoot = this.normalize(appRoot);
    
    // Ensure path is within app root for security
    if (!normalizedPath.startsWith(normalizedRoot)) {
      throw new Error(`Path outside app root: ${normalizedPath}`);
    }
    
    // Extract relative path from app root
    let relativePath = normalizedPath.substring(normalizedRoot.length);
    
    // Remove leading slash
    if (relativePath.startsWith('/')) {
      relativePath = relativePath.substring(1);
    }
    
    // Only use same-origin prefix for SCORM content (files under temp directory)
    // Main app files (index.html, scorm-inspector.html, etc.) should load directly
    const normalizedTempRoot = this.getTempRoot();
    const isScormContent = this.normalize(appRoot).startsWith(normalizedTempRoot);
    
    const protocolUrl = isScormContent 
      ? `scorm-app://index.html/${relativePath}`
      : `scorm-app://${relativePath}`;
    return protocolUrl;
  }

  /**
   * Resolve SCORM content URL for iframe loading
   * @param {string} contentPath - Content path from manifest (relative or absolute)
   * @param {string} extractionPath - SCORM package extraction directory (must be under canonical temp root)
   * @param {string} manifestPath - Full path to the manifest file (used to determine base directory)
   * @param {string} appRoot - Application root directory
   * @returns {Object} Resolution result with URL and metadata
   */
  static resolveScormContentUrl(contentPath, extractionPath, manifestPath, appRoot) {
    try {
      if (this.logger) {
        this.logger.info('PathUtils: Resolving SCORM content URL:', {
          contentPath,
          extractionPath,
          manifestPath,
          appRoot
        });
      }

      if (!contentPath || !extractionPath || !manifestPath || !appRoot) {
        throw new Error('Content path, extraction path, manifest path, and app root are required');
      }

      // Parse content path to separate file and query parameters
      const [filePath, queryString] = contentPath.split('?');

      if (this.logger) {
        this.logger.debug('PathUtils: Parsed content path:', {
          filePath,
          queryString,
          isAbsolute: path.isAbsolute(filePath)
        });
      }

      // Get the manifest's directory as the base for relative path resolution
      const manifestDir = path.dirname(manifestPath);

      if (this.logger) {
        this.logger.debug('PathUtils: Manifest directory for base resolution:', {
          manifestPath,
          manifestDir
        });
      }

      // Resolve the file path against manifest directory (not extraction root)
      let resolvedPath;
      if (path.isAbsolute(filePath)) {
        // Already absolute - validate it's within extraction path
        resolvedPath = this.normalize(filePath);
        const normalizedExtraction = this.normalize(extractionPath);

        if (this.logger) {
          this.logger.debug('PathUtils: Absolute path resolution:', {
            resolvedPath,
            normalizedExtraction,
            startsWith: resolvedPath.startsWith(normalizedExtraction)
          });
        }

        if (!resolvedPath.startsWith(normalizedExtraction)) {
          throw new Error(`Absolute path outside extraction directory: ${resolvedPath}`);
        }
      } else {
        // Relative path - resolve against manifest directory
        resolvedPath = path.resolve(manifestDir, filePath);
        resolvedPath = this.normalize(resolvedPath);

        if (this.logger) {
          this.logger.debug('PathUtils: Relative path resolution:', {
            originalFilePath: filePath,
            manifestDir,
            resolvedPath
          });
        }
      }

      // Validate the resolved path exists and is within allowed roots
      const normalizedAppRoot = this.normalize(appRoot);
      // Treat the application's canonical temp extraction directory as the only allowed external base.
      const normalizedTempRoot = this.getTempRoot();

      const withinAppRoot = resolvedPath.startsWith(normalizedAppRoot);
      const withinTempRoot = resolvedPath.startsWith(normalizedTempRoot);

      if (this.logger) {
        this.logger.debug('PathUtils: Path validation:', {
          resolvedPath,
          normalizedAppRoot,
          normalizedTempRoot,
          withinAppRoot,
          withinTempRoot
        });
      }

      if (!withinAppRoot && !withinTempRoot) {
        throw new Error(`Resolved path outside allowed roots (${normalizedAppRoot} OR ${normalizedTempRoot}): ${resolvedPath}`);
      }

      // Log file check details
      if (this.logger) {
        this.logger.debug('PathUtils: Checking file existence:', {
          resolvedPath,
          fileExists: fs.existsSync(resolvedPath)
        });

        // If file exists, log its stats
        if (fs.existsSync(resolvedPath)) {
          try {
            const stats = fs.statSync(resolvedPath);
            this.logger.debug('PathUtils: File stats:', {
              resolvedPath,
              size: stats.size,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory(),
              mode: stats.mode.toString(8),
              uid: stats.uid,
              gid: stats.gid
            });
          } catch (statsError) {
            this.logger.error('PathUtils: Failed to get file stats:', { resolvedPath, error: statsError.message });
          }
        }
      }

      // Detailed file existence check with directory listing
      if (!fs.existsSync(resolvedPath)) {
        if (this.logger) {
          this.logger.error('PathUtils: File does not exist:', resolvedPath);

          // Check if parent directory exists
          const parentDir = path.dirname(resolvedPath);
          const parentExists = fs.existsSync(parentDir);
          this.logger.error('PathUtils: Parent directory exists:', { parentDir, parentExists });

          if (parentExists) {
            try {
              const dirContents = fs.readdirSync(parentDir);
              this.logger.error('PathUtils: Parent directory contents:', { parentDir, contents: dirContents });
            } catch (dirError) {
              this.logger.error('PathUtils: Failed to read parent directory:', { parentDir, error: dirError.message });
            }
          }

          // Check extraction root contents
          try {
            const extractionContents = fs.readdirSync(extractionPath);
            this.logger.error('PathUtils: Extraction root contents:', { extractionPath, contents: extractionContents });
          } catch (extractionError) {
            this.logger.error('PathUtils: Failed to read extraction root:', { extractionPath, error: extractionError.message });
          }
        }
        throw new Error(`File does not exist: ${resolvedPath}`);
      }

      // Convert to protocol URL using appropriate base
      let protocolUrl;
      if (withinAppRoot) {
        protocolUrl = this.toScormProtocolUrl(resolvedPath, appRoot);
      } else {
        // For temp root paths, use temp root as base
        protocolUrl = this.toScormProtocolUrl(resolvedPath, normalizedTempRoot);
      }

      if (this.logger) {
        this.logger.debug('PathUtils: Generated protocol URL:', {
          protocolUrl,
          usedBase: withinAppRoot ? 'appRoot' : 'tempRoot'
        });
      }

      // Add query string back if present
      if (queryString) {
        protocolUrl += `?${queryString}`;
      }

      const result = {
        success: true,
        url: protocolUrl,
        resolvedPath: resolvedPath,
        originalPath: contentPath,
        hasQuery: !!queryString,
        queryString: queryString || null,
        usedBase: withinAppRoot ? 'appRoot' : 'tempRoot'
      };

      if (this.logger) {
        this.logger.info('PathUtils: SCORM content URL resolved successfully:', result);
      }

      return result;

    } catch (error) {
      if (this.logger) {
        this.logger.error('PathUtils: Failed to resolve SCORM content URL:', {
          error: error.message,
          contentPath,
          extractionPath,
          manifestPath,
          appRoot
        });
      }

      return {
        success: false,
        error: error.message,
        originalPath: contentPath,
        extractionPath: extractionPath,
        manifestPath: manifestPath
      };
    }
  }

  /**
   * Validate path for security and existence
   * @param {string} filePath - Path to validate
   * @param {string} allowedRoot - Root directory that path must be within
   * @returns {boolean} True if path is valid and safe
   */
  static validatePath(filePath, allowedRoot) {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return false;
      }
      
      const normalizedPath = this.normalize(filePath);
      const normalizedRoot = this.normalize(allowedRoot);
      
      // Check for path traversal attempts
      if (normalizedPath.includes('..')) {
        return false;
      }
      
      // Ensure path is within allowed root
      if (!normalizedPath.startsWith(normalizedRoot)) {
        return false;
      }
      
      // Check if path exists
      return fs.existsSync(filePath);
      
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle custom protocol requests with comprehensive path processing
   * @param {string} protocolUrl - Full protocol URL (e.g., 'scorm-app://temp/file.html')
   * @param {string} appRoot - Application root directory
   * @returns {Object} Processing result with resolved path or error
   */
  static handleProtocolRequest(protocolUrl, appRoot) {
    try {
      // Defensive guard
      if (!protocolUrl || typeof protocolUrl !== 'string') {
        return { success: false, error: 'Invalid protocol URL', requestedPath: protocolUrl };
      }

      // Strip scheme prefix 'scorm-app://'
      const prefix = 'scorm-app://';
      let requestedPath = protocolUrl.startsWith(prefix) ? protocolUrl.slice(prefix.length) : protocolUrl;

      // Handle case where main app requests 'index.html/' (with trailing slash)
      if (requestedPath === 'index.html/') {
        requestedPath = 'index.html';
      }
      // Handle same-origin paths that start with 'index.html/' - strip this prefix
      else if (requestedPath.startsWith('index.html/')) {
        requestedPath = requestedPath.slice('index.html/'.length);
      }

      // Quick checks for broken content variables
      if (requestedPath.includes('/undefined')) {
        return { success: false, error: 'Undefined path detected', requestedPath, resolvedPath: null, isUndefinedPath: true };
      }

      // Normalize accidental duplicated temp segments
      if (requestedPath.includes('temp/temp/')) {
        requestedPath = requestedPath.replace(/temp\/temp\//g, 'temp/');
      }

      // Remove query part for resolution and normalize trailing slashes for file names
      const [filePortion, queryString] = requestedPath.split('?');
      let filePathRaw = (filePortion || '').replace(/\\/g, '/');
      // If the path looks like a file but has a trailing slash (e.g., "index.html/"), trim it.
      if (filePathRaw.match(/^[^\/]+\.[^\/]+\/$/)) {
        filePathRaw = filePathRaw.replace(/\/+$/, '');
      }

      const normalizedAppRoot = this.normalize(appRoot);
      const normalizedTempRoot = this.getTempRoot();

      // Legacy abs/ encoding is no longer supported - all paths should be relative to app root or temp root

      // Treat incoming path as relative first to appRoot, then to canonical temp root
      const safeRel = path.normalize(filePathRaw);
      const appResolved = path.resolve(normalizedAppRoot, safeRel);
      const tempResolved = path.resolve(normalizedTempRoot, safeRel);

      // Normalize resolved variants for reliable cross-platform comparisons (forward-slash normalized)
      const appResolvedNorm = this.normalize(appResolved);
      const tempResolvedNorm = this.normalize(tempResolved);

      // Check file existence and validate against allowed roots
      if (this.isValidPath(appResolvedNorm, normalizedAppRoot, appResolved)) {
        return { success: true, resolvedPath: appResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'appRoot' };
      }

      // Check temp root directory first
      if (this.isValidPath(tempResolvedNorm, normalizedTempRoot, tempResolved)) {
        return { success: true, resolvedPath: tempResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'tempRoot' };
      }

      // If not found in temp root, check inside SCORM extraction subdirectories
      try {
        const tempDirContents = fs.readdirSync(normalizedTempRoot, { withFileTypes: true });
        for (const item of tempDirContents) {
          if (item.isDirectory() && item.name.startsWith('scorm_')) {
            const scormDirPath = path.join(normalizedTempRoot, item.name);
            const scormResolved = path.resolve(scormDirPath, safeRel);
            const scormResolvedNorm = this.normalize(scormResolved);

            if (this.isValidPath(scormResolvedNorm, normalizedTempRoot, scormResolved)) {
              return { success: true, resolvedPath: scormResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'scormExtraction' };
            }
          }
        }
      } catch (error) {
        // Ignore directory reading errors - fall through to not found
      }

      // Nothing found
      PathUtils.logger?.warn('PathUtils: handleProtocolRequest - file not found under allowed roots', { requestedPath, appResolvedNorm, tempResolvedNorm });
      return { success: false, error: `File not found under allowed roots (${normalizedAppRoot} or ${normalizedTempRoot})`, requestedPath, resolvedPath: null };

    } catch (error) {
      PathUtils.logger?.error('PathUtils: handleProtocolRequest unexpected error', error?.message || error);
      return { success: false, error: error?.message || String(error), requestedPath: protocolUrl };
    }
  }

  /**
   * Get application root directory
   * @param {string} currentDir - Current directory (usually __dirname)
   * @returns {string} Normalized application root path
   */
  static getAppRoot(currentDir) {
    // Navigate up from main/services to app root
    const appRoot = path.resolve(currentDir, '../../../');
    return this.normalize(appRoot);
  }

  /**
   * Resolve preload script path
   * @param {string} currentDir - Current directory (usually __dirname)
   * @returns {string} Resolved preload script path
   */
  static getPreloadPath(currentDir) {
    const preloadPath = path.join(currentDir, '../../preload.js');
    return path.resolve(preloadPath);
  }

  /**
   * Check if file exists at path
   * @param {string} filePath - Path to check
   * @returns {boolean} True if file exists
   */
  static fileExists(filePath) {
    return fs.existsSync(filePath);
  }
}

module.exports = PathUtils;