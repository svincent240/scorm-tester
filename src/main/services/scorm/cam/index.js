/**
 * SCORM 2004 4th Edition Content Aggregation Model (CAM) Module
 * 
 * Main entry point for CAM functionality including:
 * - Manifest parsing and validation
 * - Content package validation
 * - Metadata extraction and processing
 * - Package structure analysis
 * 
 * This module provides a unified interface for all CAM operations
 * following the SCORM 2004 4th Edition specification.
 * 
 * @fileoverview CAM module main entry point
 */

const ManifestParser = require('./manifest-parser');
const ContentValidator = require('./content-validator');
const MetadataHandler = require('./metadata-handler');
const PackageAnalyzer = require('./package-analyzer');

/**
 * SCORM CAM Service
 * 
 * Provides unified interface for Content Aggregation Model operations
 */
class ScormCAMService {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.manifestParser = new ManifestParser(errorHandler);
    this.contentValidator = new ContentValidator(errorHandler);
    this.metadataHandler = new MetadataHandler(errorHandler);
    this.packageAnalyzer = new PackageAnalyzer(errorHandler);
  }

  /**
   * Process complete SCORM package
   * @param {string} packagePath - Path to SCORM package directory
   * @returns {Promise<Object>} Complete package processing result
   */
  async processPackage(packagePath) {
    try {
      // Step 1: Parse manifest
      const manifestPath = require('path').join(packagePath, 'imsmanifest.xml');
      const manifest = await this.manifestParser.parseManifestFile(manifestPath);

      // Step 2: Validate package
      const validation = await this.contentValidator.validatePackage(packagePath, manifest);

      // Step 3: Analyze package structure
      const analysis = this.packageAnalyzer.analyzePackage(packagePath, manifest);

      // Step 4: Extract metadata (skip for now since manifest.metadata is already parsed)
      const metadata = manifest.metadata;

      return {
        manifest,
        validation,
        analysis,
        metadata,
        packagePath,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      this.errorHandler?.setError('301', `Package processing failed: ${error.message}`, 'processPackage');
      throw error;
    }
  }

  /**
   * Parse manifest file only
   * @param {string} manifestPath - Path to imsmanifest.xml
   * @returns {Promise<Object>} Parsed manifest
   */
  async parseManifest(manifestPath) {
    return this.manifestParser.parseManifestFile(manifestPath);
  }

  /**
   * Validate package only
   * @param {string} packagePath - Package directory path
   * @param {Object} manifest - Parsed manifest object
   * @returns {Promise<Object>} Validation result
   */
  async validatePackage(packagePath, manifest) {
    return this.contentValidator.validatePackage(packagePath, manifest);
  }

  /**
   * Analyze package only
   * @param {string} packagePath - Package directory path
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Analysis result
   */
  analyzePackage(packagePath, manifest) {
    return this.packageAnalyzer.analyzePackage(packagePath, manifest);
  }

  /**
   * Extract metadata only
   * @param {Element} metadataElement - Metadata DOM element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Object} Extracted metadata
   */
  extractMetadata(metadataElement, basePath) {
    return this.metadataHandler.extractMetadata(metadataElement, basePath);
  }

  /**
   * Get service status and capabilities
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      version: '1.0.0',
      capabilities: {
        manifestParsing: true,
        contentValidation: true,
        metadataExtraction: true,
        packageAnalysis: true
      },
      supportedVersions: ['SCORM 2004 4th Edition'],
      lastError: this.errorHandler?.getLastError() || '0'
    };
  }
}

module.exports = {
  ScormCAMService,
  ManifestParser,
  ContentValidator,
  MetadataHandler,
  PackageAnalyzer
};