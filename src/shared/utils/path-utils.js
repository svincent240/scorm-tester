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
    // Use the centralized shared logger - lazy initialization to avoid circular deps
    if (!this._logger) {
      try {
        this._logger = getLogger();
      } catch (e) {
        // Fallback to null if logger not available
        this._logger = null;
      }
    }
    return this._logger;
  }
  /**
   * Normalize path for cross-platform compatibility
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized path
   */
  static normalize(filePath) {
    PathUtils.logger?.debug(`PathUtils: normalize - Input: '${filePath}'`);
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path provided');
    }
    
    // Convert backslashes to forward slashes for consistency
    let normalized = filePath.replace(/\\/g, '/');
    
    // Remove duplicate slashes
    normalized = normalized.replace(/\/+/g, '/');
    
    // Remove trailing slash unless it's root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    PathUtils.logger?.debug(`PathUtils: normalize - Output: '${normalized}'`);
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
    
    PathUtils.logger?.debug(`PathUtils: toScormProtocolUrl - Input: filePath='${filePath}', appRoot='${appRoot}'`);

    const normalizedPath = PathUtils.normalize(filePath);
    const normalizedRoot = PathUtils.normalize(appRoot);
    PathUtils.logger?.debug(`PathUtils: toScormProtocolUrl - Normalized: normalizedPath='${normalizedPath}', normalizedRoot='${normalizedRoot}'`);
    
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
    PathUtils.logger?.debug(`PathUtils: toScormProtocolUrl - Relative Path: '${relativePath}'`);
    
    // Only use same-origin prefix for SCORM content (files under temp directory)
    // Main app files (index.html, scorm-inspector.html, etc.) should load directly
    const normalizedTempRoot = this.normalize(require('path').join(require('os').tmpdir(), 'scorm-tester'));
    const isScormContent = this.normalize(appRoot).startsWith(normalizedTempRoot);
    
    const protocolUrl = isScormContent 
      ? `scorm-app://index.html/${relativePath}`
      : `scorm-app://${relativePath}`;
    PathUtils.logger?.debug(`PathUtils: toScormProtocolUrl - Output: '${protocolUrl}' (isScormContent: ${isScormContent})`);
    return protocolUrl;
  }

  /**
   * Resolve SCORM content URL for iframe loading
   * @param {string} contentPath - Content path from manifest (relative or absolute)
   * @param {string} extractionPath - SCORM package extraction directory (must be under canonical temp root)
   * @param {string} appRoot - Application root directory
   * @returns {Object} Resolution result with URL and metadata
   */
  static resolveScormContentUrl(contentPath, extractionPath, appRoot) {
    try {
      if (!contentPath || !extractionPath || !appRoot) {
        throw new Error('Content path, extraction path, and app root are required');
      }

      // Parse content path to separate file and query parameters
      const [filePath, queryString] = contentPath.split('?');
      
      // Resolve the file path against extraction directory
      let resolvedPath;
      if (path.isAbsolute(filePath)) {
        // Already absolute - validate it's within extraction path
        resolvedPath = this.normalize(filePath);
        const normalizedExtraction = this.normalize(extractionPath);
        
        if (!resolvedPath.startsWith(normalizedExtraction)) {
          throw new Error(`Absolute path outside extraction directory: ${resolvedPath}`);
        }
      } else {
        // Relative path - resolve against extraction directory
        resolvedPath = path.resolve(extractionPath, filePath);
        resolvedPath = this.normalize(resolvedPath);
      }

      // Validate the resolved path exists and is within allowed roots
      const normalizedAppRoot = this.normalize(appRoot);
      // Treat the application's canonical temp extraction directory as the only allowed external base.
      const normalizedTempRoot = this.normalize(path.join(os.tmpdir(), 'scorm-tester'));
 
      const withinAppRoot = resolvedPath.startsWith(normalizedAppRoot);
      const withinTempRoot = resolvedPath.startsWith(normalizedTempRoot);
 
      if (!withinAppRoot && !withinTempRoot) {
        throw new Error(`Resolved path outside allowed roots (${normalizedAppRoot} OR ${normalizedTempRoot}): ${resolvedPath}`);
      }

      if (!fs.existsSync(resolvedPath)) {
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
      
      // Add query string back if present
      if (queryString) {
        protocolUrl += `?${queryString}`;
      }

      return {
        success: true,
        url: protocolUrl,
        resolvedPath: resolvedPath,
        originalPath: contentPath,
        hasQuery: !!queryString,
        queryString: queryString || null,
        usedBase: withinAppRoot ? 'appRoot' : 'tempRoot'
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        originalPath: contentPath,
        extractionPath: extractionPath
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
        PathUtils.logger?.debug(`PathUtils: Converted index.html/ to index.html`);
      }
      // Handle same-origin paths that start with 'index.html/' - strip this prefix
      else if (requestedPath.startsWith('index.html/')) {
        requestedPath = requestedPath.slice('index.html/'.length);
        PathUtils.logger?.debug(`PathUtils: Stripped index.html/ prefix, new path: ${requestedPath}`);
      }

      // Quick checks for broken content variables
      if (requestedPath.includes('/undefined')) {
        PathUtils.logger?.warn(`PathUtils: Undefined path blocked: ${requestedPath}`);
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
      const normalizedTempRoot = this.normalize(path.join(os.tmpdir(), 'scorm-tester'));

      // Legacy abs/ encoding is no longer supported - all paths should be relative to app root or temp root

      // Treat incoming path as relative first to appRoot, then to canonical temp root
      const safeRel = path.normalize(filePathRaw);
      const appResolved = path.resolve(normalizedAppRoot, safeRel);
      const tempResolved = path.resolve(normalizedTempRoot, safeRel);

      // Normalize resolved variants for reliable cross-platform comparisons (forward-slash normalized)
      const appResolvedNorm = this.normalize(appResolved);
      const tempResolvedNorm = this.normalize(tempResolved);
      
      // Debug path resolution process
      PathUtils.logger?.debug('PathUtils: Path resolution process', {
        originalUrl: protocolUrl,
        requestedPath,
        filePathRaw,
        safeRel,
        normalizedAppRoot,
        normalizedTempRoot,
        appResolved,
        tempResolved,
        appResolvedNorm,
        tempResolvedNorm
      });

      // Prefer file under app root (compare normalized forms, but use native paths for fs operations)
      const appExists = fs.existsSync(appResolved);
      if (appResolvedNorm.startsWith(normalizedAppRoot) && appExists) {
        return { success: true, resolvedPath: appResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'appRoot' };
      }

      // Fallback to canonical temp root
      const tempExists = fs.existsSync(tempResolved);
      
      // Additional filesystem debugging using native path
      let fileStats = null;
      try {
        fileStats = fs.statSync(tempResolved);
      } catch (statError) {
        PathUtils.logger?.debug(`PathUtils: fs.statSync failed for ${tempResolved}:`, statError.message);
      }
      
      // Enhanced logging for debugging file existence issues with timestamp for race condition detection
      const checkTimestamp = new Date().toISOString();
      PathUtils.logger?.info(`PathUtils: File existence check for ${requestedPath}`, { 
        requestedPath, 
        checkTimestamp,
        appResolvedNorm,
        appExists,
        tempResolved,
        tempResolvedNorm, 
        tempExists, 
        normalizedTempRoot, 
        startsWithTempRoot: tempResolvedNorm.startsWith(normalizedTempRoot),
        fileStats: fileStats ? { 
          size: fileStats.size, 
          isFile: fileStats.isFile(), 
          mtime: fileStats.mtime.toISOString(),
          birthtime: fileStats.birthtime.toISOString() 
        } : null
      });
      
      if (tempResolvedNorm.startsWith(normalizedTempRoot) && tempExists) {
        return { success: true, resolvedPath: tempResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'tempRoot' };
      } else {
        // Enhanced debugging for failed validation
        PathUtils.logger?.error('PathUtils: Temp root validation failed', {
          tempResolvedNorm,
          normalizedTempRoot,
          startsWithTempRoot: tempResolvedNorm.startsWith(normalizedTempRoot),
          tempExists,
          tempResolvedNormLength: tempResolvedNorm.length,
          normalizedTempRootLength: normalizedTempRoot.length,
          tempResolvedNormChars: tempResolvedNorm.split('').slice(0, normalizedTempRoot.length + 5).join(''),
          normalizedTempRootChars: normalizedTempRoot.split('').join('')
        });
      }

      // If file doesn't exist, try direct read attempt to distinguish permission vs existence issues
      if (tempResolvedNorm.startsWith(normalizedTempRoot)) {
        try {
          fs.readFileSync(tempResolved, { encoding: null });
          PathUtils.logger?.error(`PathUtils: Paradox detected - fs.readFileSync succeeded but fs.existsSync failed for ${tempResolved}`);
        } catch (readError) {
          PathUtils.logger?.debug(`PathUtils: Direct read attempt failed for ${tempResolved}: ${readError.code} - ${readError.message}`);
          if (readError.code === 'ENOENT') {
            PathUtils.logger?.debug(`PathUtils: Confirmed file does not exist (ENOENT): ${tempResolved}`);
          } else if (readError.code === 'EACCES') {
            PathUtils.logger?.warn(`PathUtils: File exists but permission denied (EACCES): ${tempResolved}`);
          }
        }
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
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  }
}

module.exports = PathUtils;