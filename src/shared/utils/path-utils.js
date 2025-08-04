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
   * @param {string} extractionPath - SCORM package extraction directory
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

      // Validate the resolved path exists and is within app root
      const normalizedAppRoot = this.normalize(appRoot);
      if (!resolvedPath.startsWith(normalizedAppRoot)) {
        throw new Error(`Resolved path outside app root: ${resolvedPath}`);
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File does not exist: ${resolvedPath}`);
      }

      // Convert to protocol URL
      let protocolUrl = this.toScormProtocolUrl(resolvedPath, appRoot);
      
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
        queryString: queryString || null
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
      // Extract the path from the custom protocol URL
      let requestedPath = protocolUrl.substr(12); // Remove 'scorm-app://'
      
      // CRITICAL FIX: Handle undefined paths from SCORM content JavaScript
      if (requestedPath.includes('/undefined')) {
        console.warn(`PathUtils: UNDEFINED PATH DETECTED - Blocking request: ${requestedPath}`);
        console.warn(`PathUtils: This indicates SCORM content is using undefined JavaScript variables`);
        return {
          success: false,
          error: 'Undefined path detected - SCORM content JavaScript variable is undefined',
          requestedPath: requestedPath,
          resolvedPath: null,
          isUndefinedPath: true
        };
      }
      
      // CRITICAL FIX: Handle double temp/ paths that SCORM content sometimes generates
      if (requestedPath.includes('temp/temp/')) {
        const originalPath = requestedPath;
        requestedPath = requestedPath.replace(/temp\/temp\//g, 'temp/');
      }
      
      // Remove query parameters for file resolution
      const [filePath, queryString] = requestedPath.split('?');
      
      // Normalize app root
      const normalizedAppRoot = this.normalize(appRoot);
      
      // Resolve the full file path
      const fullPath = path.join(normalizedAppRoot, filePath);
      const normalizedPath = this.normalize(fullPath);
      
      // Validate path security and existence
      if (!this.validatePath(normalizedPath, normalizedAppRoot)) {
        return {
          success: false,
          error: 'Invalid or inaccessible path',
          requestedPath: requestedPath,
          resolvedPath: normalizedPath
        };
      }
      
      return {
        success: true,
        resolvedPath: normalizedPath,
        requestedPath: requestedPath,
        queryString: queryString || null
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