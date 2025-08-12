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
    this.logger?.debug(`PathUtils: normalize - Input: '${filePath}'`);
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
    this.logger?.debug(`PathUtils: normalize - Output: '${normalized}'`);
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
    
    this.logger?.debug(`PathUtils: toScormProtocolUrl - Input: filePath='${filePath}', appRoot='${appRoot}'`);

    const normalizedPath = this.normalize(filePath);
    const normalizedRoot = this.normalize(appRoot);
    this.logger?.debug(`PathUtils: toScormProtocolUrl - Normalized: normalizedPath='${normalizedPath}', normalizedRoot='${normalizedRoot}'`);
    
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
    this.logger?.debug(`PathUtils: toScormProtocolUrl - Relative Path: '${relativePath}'`);
    
    const protocolUrl = `scorm-app://${relativePath}`;
    this.logger?.debug(`PathUtils: toScormProtocolUrl - Output: '${protocolUrl}'`);
    return protocolUrl;
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
        const encodedAbs = this.normalize(resolvedPath).replace(/^([A-Za-z]):/, (_m, d) => `${d}|`);
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
      this.logger?.debug(`PathUtils: handleProtocolRequest - Input: protocolUrl='${protocolUrl}'`);
      // Extract the path from the custom protocol URL
      let requestedPath = protocolUrl.substr(12); // Remove 'scorm-app://'
      this.logger?.debug(`PathUtils: handleProtocolRequest - After scorm-app:// removal: requestedPath='${requestedPath}'`);

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
        this.logger?.debug(`PathUtils: handleProtocolRequest - After temp/temp/ fix: requestedPath='${requestedPath}'`);
      }

      // Remove query parameters for file resolution
      let [filePath, queryString] = requestedPath.split('?');
      const rawFilePath = filePath; // preserve original for 'abs/' detection
 
      // Normalize double abs prefixes that can occur when subresources are resolved relative to an abs URL
      // Do the 'abs' detection before path.normalize to avoid platform path-separator issues on Windows
      const normalizedRawForAbs = rawFilePath.replace(/\\/g, '/');
      if (normalizedRawForAbs.startsWith('abs/abs/')) {
        filePath = normalizedRawForAbs.replace(/^abs\/abs\//, 'abs/');
        this.logger?.debug(`PathUtils: handleProtocolRequest - After abs/abs/ fix: filePath='${filePath}'`);
      } else {
        filePath = normalizedRawForAbs;
      }
 
      // Branch 1: Absolute-path encoded scheme for external folders
      if (filePath.startsWith('abs/')) {
        // Extract the encoded absolute path portion after 'abs/'
        let encoded = filePath.substring(4);
        this.logger?.debug(`PathUtils: handleProtocolRequest - Abs path detected, encoded='${encoded}'`);
 
        // Normalize separators for safer decoding attempts
        encoded = encoded.replace(/\\/g, '/');
 
        // Build a robust set of candidate variants to try.
        // We intentionally produce both forward-slash and backslash variants,
        // percent-decoded variants, pipe-based drive encodings and direct drive encodings.
        const variants = new Set();
 
        // Helper to push both slash variants and normalized forms
        const pushVariants = (raw) => {
          if (!raw || typeof raw !== 'string') return;
          // Trim accidental leading slashes
          let r = raw.replace(/^\/+/, '');
          // Add as-is
          variants.add(r);
          // Add normalized forward-slash form
          variants.add(r.replace(/\\/g, '/'));
          // Add Windows-style backslash form
          variants.add(r.replace(/\//g, '\\'));
        };
 
        // Strategy 1: try decodeURIComponent (guarded)
        try {
          const dec = decodeURIComponent(encoded);
          // convert possible 'C|/...' -> 'C:/...' form
          pushVariants(dec.replace(/^([A-Za-z])\|\//, (_m, d) => `${d}:/`));
        } catch (e) {
          // ignore decoding errors
        }
 
        // Strategy 2: replace %7C with '|' then convert pipe -> colon
        pushVariants(encoded.replace(/%7C/gi, '|').replace(/^([A-Za-z])\|\//, (_m, d) => `${d}:/`));
 
        // Strategy 3: handle literal pipe used by renderer (C|/Users/...)
        pushVariants(encoded.replace(/^([A-Za-z])\|\//, (_m, d) => `${d}:/`));
 
        // Strategy 4: if renderer sent already-colon form (C:/...), include it
        pushVariants(encoded.replace(/^\/+/, '').replace(/^([A-Za-z]):\//, (_m, d) => `${d}:/`));
 
        // Strategy 5: fallback - percent-encoded left as-is (some renderers send mixed encoding)
        pushVariants(encoded);
 
        // Evaluate candidates and pick the first that exists
        let foundPath = null;
        const triedCandidates = [];
 
        for (const candidateRaw of variants) {
          try {
            // Normalize candidate into a platform-correct absolute path
            // If candidate looks like 'C:/Users/...' or 'C:\Users\...', use as-is.
            let candidate = candidateRaw;
 
            // If candidate uses '|' as drive separator (legacy encoding), convert to ':' form
            candidate = candidate.replace(/^([A-Za-z])\|\//, (_m, d) => `${d}:/`);
            candidate = candidate.replace(/^([A-Za-z])\|\\/, (_m, d) => `${d}:/`);
 
            // If candidate begins with a leading slash then a drive letter (e.g. '/C:/' or '/C|/'), strip leading slash
            candidate = candidate.replace(/^\/+([A-Za-z]:|[A-Za-z]\|)/, (_m, g1) => g1);
 
            // Ensure we have a consistent OS-style path (path.resolve will handle absolute forms)
            candidate = path.resolve(candidate);
            triedCandidates.push(candidate);
 
            // Basic traversal guard on normalized candidate
            if (candidate.includes('..')) {
              this.logger?.warn(`PathUtils: handleProtocolRequest - Path traversal detected in abs candidate: ${candidate}`);
              continue;
            }
 
            // Log candidate existence attempt (use try/catch to capture permission errors)
            let exists = false;
            try {
              exists = fs.existsSync(candidate);
            } catch (statErr) {
              this.logger?.debug(`PathUtils: handleProtocolRequest - fs.existsSync threw for candidate='${candidate}'`, statErr?.message || statErr);
              exists = false;
            }
 
            if (exists) {
              foundPath = candidate;
              this.logger?.debug(`PathUtils: handleProtocolRequest - Found existing abs candidate: ${candidate}`);
              break;
            } else {
              this.logger?.debug(`PathUtils: handleProtocolRequest - Candidate does not exist: ${candidate}`);
            }
          } catch (err) {
            // Guard against malformed candidate causing normalize/resolve to throw
            this.logger?.debug(`PathUtils: handleProtocolRequest - Candidate processing failed: ${candidateRaw}`, err?.message || err);
          }
        }
 
        // If not found, attempt a temp-root fallback before failing.
        // Some renderer encodings can mangle or omit the absolute drive prefix while
        // the extraction process always writes into the known temp root
        // (os.tmpdir()/scorm-tester). Reconstructing the tail and joining it with
        // the canonical temp root often recovers the real path.
        if (!foundPath) {
          try {
            // Attempt safe decode to make tail extraction more reliable
            const decoded = (() => {
              try { return decodeURIComponent(encoded); } catch (_) { return encoded; }
            })();
 
            const searchNormalized = decoded.replace(/\\/g, '/');
            const marker = 'scorm-tester/';
            const idx = searchNormalized.toLowerCase().indexOf(marker);
 
            if (idx !== -1) {
              const tail = searchNormalized.substring(idx + marker.length);
              const tempRoot = path.join(os.tmpdir(), 'scorm-tester');
              const tempCandidate = path.resolve(path.join(tempRoot, tail));
              triedCandidates.push(tempCandidate);
              this.logger?.debug(`PathUtils: handleProtocolRequest - Trying temp-root fallback candidate: ${tempCandidate}`);
              try {
                if (fs.existsSync(tempCandidate)) {
                  foundPath = tempCandidate;
                  this.logger?.debug(`PathUtils: handleProtocolRequest - Found existing temp-root fallback candidate: ${tempCandidate}`);
                } else {
                  this.logger?.debug(`PathUtils: handleProtocolRequest - Temp-root fallback candidate does not exist: ${tempCandidate}`);
                }
              } catch (statErr) {
                this.logger?.debug(`PathUtils: handleProtocolRequest - fs.existsSync threw for tempCandidate='${tempCandidate}'`, statErr?.message || statErr);
              }
            }
          } catch (fallbackErr) {
            this.logger?.debug('PathUtils: handleProtocolRequest - temp-root fallback failed', fallbackErr?.message || fallbackErr);
          }
        }
 
        // If still not found, include a helpful diagnostic listing of tried variants
        if (!foundPath) {
          this.logger?.warn('PathUtils: handleProtocolRequest - No existing file found for abs path. Tried candidates:', triedCandidates);
          return {
            success: false,
            error: 'Invalid or inaccessible path',
            requestedPath,
            resolvedPath: triedCandidates.length > 0 ? triedCandidates[0] : path.normalize(encoded),
            triedCandidates,
            usedBase: 'allowedBase'
          };
        }
 
        return {
          success: true,
          resolvedPath: foundPath,
          requestedPath,
          queryString: queryString || null,
          usedBase: 'allowedBase'
        };
      }
 
      // Branch 2: Legacy appRoot-relative behavior
      // Normalize the file path to handle '..' segments correctly for appRoot joins
      const normalizedFilePath = path.normalize(filePath);
      const normalizedAppRoot = this.normalize(appRoot);
      this.logger?.debug(`PathUtils: handleProtocolRequest - AppRoot-relative: normalizedFilePath='${normalizedFilePath}', normalizedAppRoot='${normalizedAppRoot}'`);
      const fullPath = path.join(normalizedAppRoot, normalizedFilePath);
      const normalizedPath = this.normalize(fullPath);
      this.logger?.debug(`PathUtils: handleProtocolRequest - AppRoot-relative: fullPath='${fullPath}', normalizedPath='${normalizedPath}'`);
 
      // Validate path security and existence
      if (!this.validatePath(normalizedPath, normalizedAppRoot)) {
        this.logger?.warn(`PathUtils: handleProtocolRequest - Path validation failed for appRoot-relative path: ${normalizedPath}`);
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