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
  constructor(errorHandler, logger) {
    this.errorHandler = errorHandler;
    this.logger = logger;

    // Initialize CAM sub-components
    this.manifestParser = new ManifestParser(errorHandler);
    this.contentValidator = new ContentValidator(errorHandler);
    this.metadataHandler = new MetadataHandler(errorHandler);
    this.packageAnalyzer = new PackageAnalyzer(errorHandler);
    
    this.logger?.debug('ScormCAMService initialized');
  }

  /**
   * Process a complete SCORM package
   * @param {string} packagePath - Path to the extracted SCORM package directory
   * @param {string} manifestContent - Content of the imsmanifest.xml file
   * @returns {Promise<Object>} Comprehensive package processing result
   */
  async processPackage(packagePath, manifestContent) {
    try {
      this.logger?.info(`ScormCAMService: Starting package processing for ${packagePath}`);
      
      // Add comprehensive logging for debugging
      this.logger?.info(`ScormCAMService: manifestContent type: ${typeof manifestContent}, length: ${manifestContent?.length || 'undefined'}`);
      this.logger?.info(`ScormCAMService: packagePath: ${packagePath}`);

      // Check for null/undefined manifestContent
      if (!manifestContent) {
        this.logger?.error('ScormCAMService: manifestContent is null or undefined');
        throw new Error('Manifest content is null or undefined');
      }

      if (typeof manifestContent !== 'string') {
        this.logger?.error(`ScormCAMService: manifestContent is not a string, got: ${typeof manifestContent}`);
        throw new Error(`Manifest content must be a string, got: ${typeof manifestContent}`);
      }

      if (manifestContent.trim() === '') {
        this.logger?.error('ScormCAMService: manifestContent is empty string');
        throw new Error('Manifest content is empty');
      }

      // 1. Parse Manifest with detailed logging
      this.logger?.info('ScormCAMService: About to parse manifest XML');
      let manifest;
      try {
        manifest = this.manifestParser.parseManifestXML(manifestContent, packagePath);
        this.logger?.info('ScormCAMService: Manifest parsing completed successfully');
        this.logger?.debug('ScormCAMService: Parsed manifest structure:', {
          hasIdentifier: !!manifest?.identifier,
          hasOrganizations: !!manifest?.organizations,
          hasResources: !!manifest?.resources,
          manifestType: typeof manifest
        });
      } catch (parseError) {
        this.logger?.error('ScormCAMService: Manifest parsing failed:', parseError);
        throw new Error(`Manifest parsing failed: ${parseError.message}`);
      }

      // Validate manifest object before proceeding
      if (!manifest) {
        this.logger?.error('ScormCAMService: Manifest parser returned null/undefined');
        throw new Error('Manifest parser returned null or undefined');
      }

      if (typeof manifest !== 'object') {
        this.logger?.error(`ScormCAMService: Manifest parser returned non-object: ${typeof manifest}`);
        throw new Error(`Manifest parser returned invalid type: ${typeof manifest}`);
      }

      // 2. Validate Package
      this.logger?.info('ScormCAMService: Starting package validation');
      let validation;
      try {
        validation = await this.contentValidator.validatePackage(packagePath, manifest);
        this.logger?.info('ScormCAMService: Package validation completed', { isValid: validation.isValid });
      } catch (validationError) {
        this.logger?.error('ScormCAMService: Package validation failed:', validationError);
        throw new Error(`Package validation failed: ${validationError.message}`);
      }

      // 3. Analyze Package
      this.logger?.info('ScormCAMService: Starting package analysis');
      let analysis;
      try {
        analysis = this.packageAnalyzer.analyzePackage(packagePath, manifest);
        this.logger?.info('ScormCAMService: Package analysis completed');
      } catch (analysisError) {
        this.logger?.error('ScormCAMService: Package analysis failed:', analysisError);
        throw new Error(`Package analysis failed: ${analysisError.message}`);
      }

      // 4. Extract Metadata (if any)
      this.logger?.info('ScormCAMService: Starting metadata extraction');
      let metadata;
      try {
        metadata = this.metadataHandler.extractMetadata(manifest.metadata);
        this.logger?.info('ScormCAMService: Metadata extraction completed');
      } catch (metadataError) {
        this.logger?.error('ScormCAMService: Metadata extraction failed:', metadataError);
        // Don't throw here, metadata extraction is not critical
        metadata = null;
      }

      // Create clean response object (avoid circular references and non-serializable data)
      const response = {
        success: true,
        manifest: this.cleanManifestForSerialization(manifest),
        validation,
        analysis,
        metadata
      };

      this.logger?.info('ScormCAMService: Package processing completed successfully');
      return response;

    } catch (error) {
      this.errorHandler?.setError('301', `SCORM package processing failed: ${error.message}`, 'ScormCAMService.processPackage');
      this.logger?.error('ScormCAMService: Package processing error:', error);
      this.logger?.error('ScormCAMService: Error stack:', error.stack);
      return { success: false, error: error.message, reason: error.message };
    }
  }

  /**
   * Clean manifest object for IPC serialization by removing non-serializable properties
   * @param {Object} manifest - Original manifest object
   * @returns {Object} Cleaned manifest object
   */
  cleanManifestForSerialization(manifest) {
    try {
      // Create a deep copy and remove any potential DOM elements or functions
      const cleaned = JSON.parse(JSON.stringify(manifest));
      this.logger?.debug('ScormCAMService: Manifest cleaned for serialization');
      return cleaned;
    } catch (error) {
      this.logger?.error('ScormCAMService: Failed to clean manifest for serialization:', error);
      // Return a minimal safe object
      return {
        identifier: manifest?.identifier || null,
        version: manifest?.version || null,
        organizations: manifest?.organizations || null,
        resources: manifest?.resources || null,
        metadata: manifest?.metadata || null
      };
    }
  }

  /**
   * Validate a SCORM package (delegates to ContentValidator)
   * @param {string} packagePath - Path to the extracted SCORM package directory
   * @param {string} manifestContent - Content of the imsmanifest.xml file
   * @returns {Promise<Object>} Validation result
   */
  async validatePackage(packagePath, manifestContent) {
    try {
      const manifest = this.manifestParser.parseManifestXML(manifestContent, packagePath);
      const validationResult = await this.contentValidator.validatePackage(packagePath, manifest);
      return validationResult;
    } catch (error) {
      this.errorHandler?.setError('301', `SCORM package validation failed: ${error.message}`, 'ScormCAMService.validatePackage');
      this.logger?.error('ScormCAMService: Package validation error:', error);
      throw error;
    }
  }

  /**
   * Analyze a SCORM package (delegates to PackageAnalyzer)
   * @param {string} packagePath - Path to the extracted SCORM package directory
   * @param {string} manifestContent - Content of the imsmanifest.xml file
   * @returns {Promise<Object>} Analysis result
   */
  async analyzePackage(packagePath, manifestContent) {
    try {
      const manifest = this.manifestParser.parseManifestXML(manifestContent, packagePath);
      const analysisResult = this.packageAnalyzer.analyzePackage(packagePath, manifest);
      return analysisResult;
    } catch (error) {
      this.errorHandler?.setError('301', `SCORM package analysis failed: ${error.message}`, 'ScormCAMService.analyzePackage');
      this.logger?.error('ScormCAMService: Package analysis error:', error);
      throw error;
    }
  }

  /**
   * Parse a SCORM manifest (delegates to ManifestParser)
   * @param {string} manifestContent - Content of the imsmanifest.xml file
   * @param {string} basePath - Base path for resolving relative URLs
   * @returns {Object} Parsed manifest object
   */
  parseManifest(manifestContent, basePath) {
    return this.manifestParser.parseManifestXML(manifestContent, basePath);
  }

  /**
   * Extract metadata from a manifest (delegates to MetadataHandler)
   * @param {Object} metadataElement - Metadata DOM element or parsed metadata object
   * @returns {Object} Extracted metadata object
   */
  extractMetadata(metadataElement) {
    return this.metadataHandler.extractMetadata(metadataElement);
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