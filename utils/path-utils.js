// utils/path-utils.js - Cross-platform path handling utilities
const path = require('path');
const fs = require('fs');

class PathUtils {
  /**
   * Normalize file path for current platform
   * @param {string} filePath - Path to normalize
   * @returns {string} - Normalized path
   */
  static normalize(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path provided');
    }
    
    // Convert forward slashes to platform-specific separators
    let normalized = filePath.replace(/[/\\]/g, path.sep);
    
    // Remove duplicate separators
    normalized = normalized.replace(new RegExp(`\\${path.sep}{2,}`, 'g'), path.sep);
    
    // Handle special Windows cases
    if (process.platform === 'win32') {
      // Handle UNC paths (\\server\share)
      if (normalized.startsWith('\\\\')) {
        normalized = '\\\\' + normalized.substring(2).replace(/^\\+/, '');
      }
      
      // Handle drive letters
      if (/^[a-zA-Z]:/.test(normalized)) {
        normalized = normalized[0].toUpperCase() + normalized.substring(1);
      }
      
      // Remove trailing separator except for root directories
      if (normalized.length > 3 && normalized.endsWith(path.sep)) {
        normalized = normalized.slice(0, -1);
      }
    }
    
    return path.normalize(normalized);
  }

  /**
   * Convert file path to file:// URL with proper encoding
   * @param {string} filePath - Local file path
   * @returns {string} - file:// URL
   */
  static toFileUrl(filePath) {
    try {
      const normalizedPath = this.normalize(filePath);
      
      // Ensure absolute path
      const absolutePath = path.isAbsolute(normalizedPath) 
        ? normalizedPath 
        : path.resolve(normalizedPath);
      
      if (process.platform === 'win32') {
        // Windows: Convert C:\path\file.html to file:///C:/path/file.html
        const windowsPath = absolutePath.replace(/\\/g, '/');
        return 'file:///' + windowsPath;
      } else {
        // Unix-like: Convert /path/file.html to file:///path/file.html
        return 'file://' + absolutePath;
      }
    } catch (error) {
      throw new Error(`Failed to convert path to file URL: ${error.message}`);
    }
  }

  /**
   * Safely join path segments
   * @param {...string} segments - Path segments to join
   * @returns {string} - Joined path
   */
  static join(...segments) {
    // Filter out empty segments
    const validSegments = segments.filter(segment => 
      segment && typeof segment === 'string' && segment.trim() !== ''
    );
    
    if (validSegments.length === 0) {
      throw new Error('No valid path segments provided');
    }
    
    return path.join(...validSegments);
  }

  /**
   * Check if path is safe (no directory traversal)
   * @param {string} filePath - Path to check
   * @param {string} basePath - Base directory path
   * @returns {boolean} - True if path is safe
   */
  static isSafePath(filePath, basePath) {
    try {
      const normalizedPath = this.normalize(filePath);
      const normalizedBase = this.normalize(basePath);
      const resolved = path.resolve(normalizedBase, normalizedPath);
      
      return resolved.startsWith(path.resolve(normalizedBase));
    } catch (error) {
      return false;
    }
  }

  /**
   * Get relative path from base to target
   * @param {string} basePath - Base path
   * @param {string} targetPath - Target path
   * @returns {string} - Relative path
   */
  static getRelativePath(basePath, targetPath) {
    try {
      const normalizedBase = this.normalize(basePath);
      const normalizedTarget = this.normalize(targetPath);
      
      return path.relative(normalizedBase, normalizedTarget);
    } catch (error) {
      throw new Error(`Failed to get relative path: ${error.message}`);
    }
  }

  /**
   * Check if file exists and is accessible
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} - True if file exists and is accessible
   */
  static async fileExists(filePath) {
    try {
      const normalizedPath = this.normalize(filePath);
      await fs.promises.access(normalizedPath, fs.constants.F_OK | fs.constants.R_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create directory recursively if it doesn't exist
   * @param {string} dirPath - Directory path to create
   * @returns {Promise<void>}
   */
  static async ensureDirectory(dirPath) {
    try {
      const normalizedPath = this.normalize(dirPath);
      await fs.promises.mkdir(normalizedPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  }

  /**
   * Get file extension with validation
   * @param {string} filePath - File path
   * @returns {string} - File extension (lowercase)
   */
  static getExtension(filePath) {
    try {
      const normalizedPath = this.normalize(filePath);
      return path.extname(normalizedPath).toLowerCase();
    } catch (error) {
      return '';
    }
  }

  /**
   * Generate unique temporary file path
   * @param {string} baseName - Base name for temp file
   * @param {string} extension - File extension
   * @returns {string} - Unique temp file path
   */
  static generateTempPath(baseName = 'temp', extension = '.tmp') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const fileName = `${baseName}_${timestamp}_${random}${extension}`;
    
    const tempDir = require('os').tmpdir();
    return this.join(tempDir, 'scorm-testing-tool', fileName);
  }

  /**
   * Clean up path for display (truncate if too long)
   * @param {string} filePath - Path to clean
   * @param {number} maxLength - Maximum display length
   * @returns {string} - Cleaned path for display
   */
  static displayPath(filePath, maxLength = 50) {
    try {
      const normalizedPath = this.normalize(filePath);
      
      if (normalizedPath.length <= maxLength) {
        return normalizedPath;
      }
      
      const fileName = path.basename(normalizedPath);
      const dirName = path.dirname(normalizedPath);
      
      if (fileName.length >= maxLength - 3) {
        return '...' + fileName.substring(fileName.length - (maxLength - 3));
      }
      
      const availableSpace = maxLength - fileName.length - 4; // ".../" + fileName
      if (availableSpace > 0) {
        return '...' + path.sep + dirName.substring(dirName.length - availableSpace) + path.sep + fileName;
      }
      
      return '...' + path.sep + fileName;
    } catch (error) {
      return filePath.substring(0, maxLength);
    }
  }
}

module.exports = PathUtils;