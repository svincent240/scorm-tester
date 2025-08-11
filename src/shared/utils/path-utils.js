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

/**
 * Path Utilities Class
 * 
 * Provides consistent, secure path operations across all processes.
 */
class PathUtils {
  /**
   * Normalize path for cross-platform compatibility
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized path
   */
  static normalize(filePath) {
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
    
    return `scorm-app://${relativePath}`;
  }

  /**
   * Resolve SCORM content URL for iframe loading
   * @param {string} contentPath - Content path from manifest (relative or absolute)
   * @param {string} extractionPath - SCORM package extraction directory OR user-selected folder for unzipped flow
   * @param {string} appRoot - Application root directory
   * @param {string|null} allowedBase - Optional additional allowed base outside appRoot (e.g., selected folder path)
   * @returns {Object} Resolution result with URL and metadata
   */
  static resolveScormContentUrl(contentPath, extractionPath, appRoot, allowedBase = null) {
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

      // Validate the resolved path exists and is within an allowed base
      const normalizedAppRoot = this.normalize(appRoot);
      const normalizedAllowedBase = allowedBase ? this.normalize(allowedBase) : null;
      // Treat the application's canonical temp extraction directory as an additional allowed base.
      const normalizedTempRoot = this.normalize(path.join(os.tmpdir(), 'scorm-tester'));
 
      const withinAppRoot = resolvedPath.startsWith(normalizedAppRoot);
      const withinAllowedBase = normalizedAllowedBase ? resolvedPath.startsWith(normalizedAllowedBase) : false;
      const withinTempRoot = resolvedPath.startsWith(normalizedTempRoot);
 
      if (!withinAppRoot && !withinAllowedBase && !withinTempRoot) {
        const bases = normalizedAllowedBase ? `${normalizedAppRoot} OR ${normalizedAllowedBase} OR ${normalizedTempRoot}` : `${normalizedAppRoot} OR ${normalizedTempRoot}`;
        throw new Error(`Resolved path outside allowed roots (${bases}): ${resolvedPath}`);
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File does not exist: ${resolvedPath}`);
      }

      // Determine which base to use for protocol URL construction
      const protocolBase = withinAppRoot ? appRoot : (normalizedAllowedBase || appRoot);

      // Convert to protocol URL
      let protocolUrl;
      if (withinAppRoot) {
        protocolUrl = this.toScormProtocolUrl(resolvedPath, appRoot);
      } else {
        // For external allowedBase, we cannot rely on appRoot-based protocol resolution.
        // Encode absolute path using an 'abs/' scheme that the protocol handler will decode.
        // Example: scorm-app://abs/C|/Users/name/Folder/index.html
        const encodedAbs = this.normalize(resolvedPath).replace(/^([A-Za-z]):\//, (_m, d) => `${d}|/`);
        protocolUrl = `scorm-app://abs/${encodedAbs}`;
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
        usedBase: withinAppRoot ? 'appRoot' : 'allowedBase'
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        originalPath: contentPath,
        extractionPath: extractionPath,
        allowedBase: allowedBase || null
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
      // Extract the path from the custom protocol URL
      let requestedPath = protocolUrl.substr(12); // Remove 'scorm-app://'

      // CRITICAL FIX: Handle undefined paths from SCORM content JavaScript
      if (requestedPath.includes('/undefined')) {
        console.warn(`PathUtils: UNDEFINED PATH DETECTED - Blocking request: ${requestedPath}`);
        console.warn(`PathUtils: This indicates SCORM content is using undefined JavaScript variables`);
        return {
          success: false,
          error: 'Undefined path detected - SCORM content JavaScript variable is undefined',
          requestedPath,
          resolvedPath: null,
          isUndefinedPath: true
        };
      }

      // CRITICAL FIX: Handle double temp/ paths that SCORM content sometimes generates
      if (requestedPath.includes('temp/temp/')) {
        requestedPath = requestedPath.replace(/temp\/temp\//g, 'temp/');
      }

      // Remove query parameters for file resolution
      let [filePath, queryString] = requestedPath.split('?');
      const rawFilePath = filePath; // preserve original for 'abs/' detection
 
      // Normalize double abs prefixes that can occur when subresources are resolved relative to an abs URL
      // Do the 'abs' detection before path.normalize to avoid platform path-separator issues on Windows
      const normalizedRawForAbs = rawFilePath.replace(/\\/g, '/');
      if (normalizedRawForAbs.startsWith('abs/abs/')) {
        filePath = normalizedRawForAbs.replace(/^abs\/abs\//, 'abs/');
      } else {
        filePath = normalizedRawForAbs;
      }
 
      // Branch 1: Absolute-path encoded scheme for external folders
      if (filePath.startsWith('abs/')) {
        // Extract the encoded absolute path portion after 'abs/'
        let encoded = filePath.substring(4);
 
        // First, decode URI components to handle %7C, %20, etc.
        try {
          // decodeURIComponent may throw on malformed sequences; guard it
          encoded = decodeURIComponent(encoded);
        } catch (_) {
          // If decoding fails, proceed with raw string
        }
 
        // Restore Windows drive colon if encoded with pipe or percent form
        // Accept both 'C|/...' and 'C:/...' variants
        encoded = encoded.replace(/^([A-Za-z])\|\//, (_m, d) => `${d}:/`);
 
        // Normalize to fs path (convert forward slashes to platform separators)
        const absPath = path.normalize(encoded);
 
        // Basic traversal guard: no '..' segments after normalization
        if (absPath.includes('..')) {
          return {
            success: false,
            error: 'Invalid or inaccessible path',
            requestedPath,
            resolvedPath: absPath
          };
        }
 
        // Ensure file exists
        if (!fs.existsSync(absPath)) {
          return {
            success: false,
            error: 'Invalid or inaccessible path',
            requestedPath,
            resolvedPath: absPath
          };
        }
 
        return {
          success: true,
          resolvedPath: absPath,
          requestedPath,
          queryString: queryString || null,
          usedBase: 'allowedBase'
        };
      }
 
      // Branch 2: Legacy appRoot-relative behavior
      // Normalize the file path to handle '..' segments correctly for appRoot joins
      const normalizedFilePath = path.normalize(filePath);
      const normalizedAppRoot = this.normalize(appRoot);
      const fullPath = path.join(normalizedAppRoot, normalizedFilePath);
      const normalizedPath = this.normalize(fullPath);
 
      // Validate path security and existence
      if (!this.validatePath(normalizedPath, normalizedAppRoot)) {
        return {
          success: false,
          error: 'Invalid or inaccessible path',
          requestedPath,
          resolvedPath: normalizedPath
        };
      }

      return {
        success: true,
        resolvedPath: normalizedPath,
        requestedPath,
        queryString: queryString || null,
        usedBase: 'appRoot'
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        requestedPath: protocolUrl
      };
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