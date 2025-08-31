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
    return this.join(os.tmpdir(), 'scorm-tester');
  }

  /**
   * Check if path is within allowed root and exists (legacy method - use validatePath)
   * @param {string} resolvedPath - The resolved file path
   * @param {string} allowedRoot - The allowed root directory
   * @param {string} nativePath - The native file path for existence check
   * @returns {boolean} True if path is valid and exists
   */
  static isValidPath(resolvedPath, allowedRoot, nativePath) {
    // Delegate to validatePath for consistency
    return this.validatePath(nativePath, allowedRoot);
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

    // Convert backslashes to forward slashes and remove duplicate forward slashes
    let normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');

    // Remove trailing slash unless it's root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
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
    const startTime = Date.now();
    try {
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

      const protocolUrl = `scorm-app://${relativePath}`;

      this.logger?.info('PathUtils: toScormProtocolUrl success', {
        operation: 'toScormProtocolUrl',
        duration: Date.now() - startTime,
        filePath: normalizedPath,
        appRoot: normalizedRoot,
        url: protocolUrl
      });

      return protocolUrl;
    } catch (error) {
      this.logger?.error('PathUtils: toScormProtocolUrl failed', {
        operation: 'toScormProtocolUrl',
        error: error?.message || String(error),
        duration: Date.now() - startTime
      });
      throw error;
    }
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
    const startTime = Date.now();
    // Declare variables at method scope for use in catch block
    let encodedFilePath, queryString, filePath;

    try {
      this.logger?.info('PathUtils: Starting content resolution', {
        operation: 'contentResolution',
        contentPath,
        extractionPath,
        manifestPath,
        phase: 'CAM_INTEGRATION'
      });

      if (!contentPath || !extractionPath || !manifestPath || !appRoot) {
        throw new Error('Content path, extraction path, manifest path, and app root are required');
      }

      // Parse content path to separate file and query parameters
      [encodedFilePath, queryString] = contentPath.split('?');

      // URL decode the file path to handle cases where manifest contains encoded paths
      filePath = encodedFilePath; // Default to encoded path
      try {
        filePath = decodeURIComponent(encodedFilePath);
      } catch (decodeError) {
        this.logger?.warn('PathUtils: Failed to decode URI component, using original path:', { encodedFilePath, error: decodeError.message });
        // filePath remains as encodedFilePath
      }


      // Get the manifest's directory as the base for relative path resolution
      const manifestDir = this.dirname(manifestPath);


      // Resolve the file path against manifest directory (not extraction root)
      let resolvedPath;
      if (path.isAbsolute(filePath)) {
        // Already absolute - validate it's within extraction path
        resolvedPath = this.normalize(filePath);
        const normalizedExtraction = this.normalize(extractionPath);


        if (!resolvedPath.startsWith(normalizedExtraction)) {
          throw new Error(`Absolute path outside extraction directory: ${resolvedPath}`);
        }
      } else {
        // Relative path - resolve against manifest directory
        resolvedPath = this.join(manifestDir, filePath);

      }

      // Validate the resolved path exists and is within allowed roots
      const normalizedAppRoot = this.normalize(appRoot);
      // Treat the application's canonical temp extraction directory as the only allowed external base.
      const normalizedTempRoot = this.getTempRoot();

      const withinAppRoot = resolvedPath.startsWith(normalizedAppRoot);
      const withinTempRoot = resolvedPath.startsWith(normalizedTempRoot);


      if (!withinAppRoot && !withinTempRoot) {
        throw new Error(`Resolved path outside allowed roots (${normalizedAppRoot} OR ${normalizedTempRoot}): ${resolvedPath}`);
      }

      // Check file existence
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

      const result = {
        success: true,
        url: protocolUrl,
        resolvedPath: resolvedPath,
        originalPath: contentPath,
        decodedPath: filePath,
        hasQuery: !!queryString,
        queryString: queryString || null,
        usedBase: withinAppRoot ? 'appRoot' : 'tempRoot',
        wasDecoded: filePath !== encodedFilePath
      };


      this.logger?.debug && this.logger.debug('PathUtils: content resolution result', {
        operation: 'contentResolution',
        success: true,
        originalPath: contentPath,
        resolvedPath: resolvedPath,
        url: protocolUrl,
        usedBase: withinAppRoot ? 'appRoot' : 'tempRoot',
        duration: Date.now() - startTime
      });

      return result;

    } catch (error) {
      this.logger?.error('PathUtils: content resolution failed', {
        operation: 'contentResolution',
        error: error?.message || String(error),
        context: { contentPath, extractionPath, manifestPath },
        duration: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message,
        originalPath: contentPath,
        decodedPath: filePath,
        extractionPath: extractionPath,
        manifestPath: manifestPath,
        wasDecoded: filePath !== encodedFilePath
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
    const startTime = Date.now();
    try {
      this.logger?.info('PathUtils: handleProtocolRequest start', {
        operation: 'protocolRequest',
        url: protocolUrl
      });
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
      // This maintains backward compatibility with any URLs that still have the prefix
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

      // URL decode the file path to handle encoded characters like %20 (spaces)
      try {
        filePathRaw = decodeURIComponent(filePathRaw);
      } catch (decodeError) {
        if (this.logger) {
          this.logger.warn('PathUtils: Failed to decode URI component, using original path:', {
            filePortion,
            error: decodeError.message
          });
        }
        // filePathRaw remains as the original
      }

      // If the path looks like a file but has a trailing slash (e.g., "index.html/"), trim it.
      if (filePathRaw.match(/^[^/]+\.[^/]+\/$/)) {
        filePathRaw = filePathRaw.replace(/\/+$/, '');
      }


      const normalizedAppRoot = this.normalize(appRoot);
      const normalizedTempRoot = this.getTempRoot();

      // Legacy abs/ encoding is no longer supported - all paths should be relative to app root or temp root

      // Treat incoming path as relative first to appRoot, then to canonical temp root
      const safeRel = this.normalize(filePathRaw);
      const appResolved = this.join(normalizedAppRoot, safeRel);
      const tempResolved = this.join(normalizedTempRoot, safeRel);

      // Normalize resolved variants for reliable cross-platform comparisons (forward-slash normalized)
      const appResolvedNorm = this.normalize(appResolved);
      const tempResolvedNorm = this.normalize(tempResolved);

      // Check file existence and validate against allowed roots
      if (this.isValidPath(appResolvedNorm, normalizedAppRoot, appResolved)) {
        return { success: true, resolvedPath: appResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'appRoot' };
      }

      // Check temp root directory
      if (this.isValidPath(tempResolvedNorm, normalizedTempRoot, tempResolved)) {
        return { success: true, resolvedPath: tempResolvedNorm, requestedPath, queryString: queryString || null, usedBase: 'tempRoot' };
      }

      // Nothing found
      PathUtils.logger?.warn('PathUtils: handleProtocolRequest - file not found under allowed roots', { requestedPath, appResolvedNorm, tempResolvedNorm, duration: Date.now() - startTime });
      return { success: false, error: `File not found under allowed roots (${normalizedAppRoot} or ${normalizedTempRoot})`, requestedPath, resolvedPath: null };

    } catch (error) {
      PathUtils.logger?.error('PathUtils: handleProtocolRequest unexpected error', { error: error?.message || String(error), duration: Date.now() - startTime });
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
    return this.join(currentDir, '../../../');
  }

  /**
   * Resolve preload script path
   * @param {string} currentDir - Current directory (usually __dirname)
   * @returns {string} Resolved preload script path
   */
  static getPreloadPath(currentDir) {
    return this.join(currentDir, '../../preload.js');
  }

  /**
   * Check if file exists at path
   * @param {string} filePath - Path to check
   * @returns {boolean} True if file exists
   */
  static fileExists(filePath) {
    return fs.existsSync(filePath);
  }

  /**
   * Join path segments using platform-specific separator
   * @param {...string} paths - Path segments to join
   * @returns {string} Joined and normalized path
   */
  static join(...paths) {
    return this.normalize(path.join(...paths));
  }

  /**
   * Get the directory name of a path
   * @param {string} filePath - Path to get directory from
   * @returns {string} Directory path
   */
  static dirname(filePath) {
    return path.dirname(filePath);
  }

  /**
   * Get the file extension from a path (without the dot)
   * @param {string} filePath - Path to get extension from
   * @returns {string} File extension in lowercase (without dot)
   */
  static getExtension(filePath) {
    const normalized = this.normalize(filePath);
    const ext = path.extname(normalized);
    return ext ? ext.substring(1).toLowerCase() : '';
  }

  /**
   * Combine xmlBase and href for SCORM content paths
   * @param {string} xmlBase - The xml:base value from manifest
   * @param {string} href - The href value from resource
   * @returns {string} Combined path with proper normalization
   */
  static combineXmlBaseHref(xmlBase, href) {
    if (!href) {
      throw new Error('href is required for path combination');
    }
    
    if (!xmlBase) {
      return href;
    }
    
    // Remove trailing slashes from xmlBase
    const cleanBase = xmlBase.replace(/\/+$/, '');
    
    // Join paths using our normalized join method
    return this.join(cleanBase, href);
  }
}

module.exports = PathUtils;
