/**
 * SCORM 2004 4th Edition Content Validator
 * 
 * Validates SCORM packages according to:
 * - SCORM 2004 4th Edition Content Aggregation Model specification
 * - IMS Content Packaging specification
 * - File integrity and structure validation
 * - Resource dependency validation
 * 
 * Features:
 * - Package structure validation
 * - File existence verification
 * - Resource dependency checking
 * - SCORM type validation (SCO vs Asset)
 * - Manifest schema compliance
 * 
 * @fileoverview SCORM content validator implementation
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');
const PathUtils = require('../../../../shared/utils/path-utils');
const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');
const getLogger = require('../../../../shared/utils/logger');
const { scorm_lint_parent_dom_access } = require('../../../../mcp/tools/validate');

/**
 * SCORM Content Validator
 * 
 * Validates SCORM packages for compliance with SCORM 2004 4th Edition
 * Content Aggregation Model specification.
 */
class ContentValidator {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.logger = getLogger();
    this.validationErrors = [];
    this.validationWarnings = [];
    this.hasRequiredElements = false;
    this.validScormTypes = false;
    this.validIdentifiers = false;
    this.sequencingCompliance = false;
    this.metadataCompliance = false;
    this.overallCompliance = false;
  }

  /**
   * Validate complete SCORM package
   * @param {string} packagePath - Path to SCORM package directory
   * @param {Object} manifest - Parsed manifest object
   * @returns {Promise<Object>} Validation result
   */
  async validatePackage(packagePath, manifest) {
    this.clearValidationResults();
    this.resetComplianceFlags(); // New method to reset flags

    try {
      // Core validation steps
      await this.validateManifestStructure(manifest);
      await this.validateFileIntegrity(packagePath, manifest);
      await this.validateResourceDependencies(packagePath, manifest);
      await this.validateScormTypes(manifest);
      await this.validateOrganizationStructure(manifest);
      await this.validateSequencingCompliance(manifest); // New validation step
      await this.validateParentDOMAccess(packagePath); // Parent DOM access validation
      await this.validateOverallCompliance(); // New validation step

      return {
        isValid: this.validationErrors.length === 0,
        errors: [...this.validationErrors],
        warnings: [...this.validationWarnings],
        summary: this.generateValidationSummary()
      };
    } catch (error) {
      this.errorHandler?.setError('301', `Package validation failed: ${error.message}`, 'validatePackage');
      throw error;
    }
  }

  /**
   * Validate manifest structure
   * @param {Object} manifest - Parsed manifest object
   */
  async validateManifestStructure(manifest) {
    this.logger?.debug && this.logger.debug('ContentValidator: Starting manifest structure validation');
    this.logger?.debug && this.logger.debug('ContentValidator: manifest type:', typeof manifest);
    this.logger?.debug && this.logger.debug('ContentValidator: manifest is null/undefined:', manifest == null);
    
    // Critical check: ensure manifest is not null/undefined
    if (!manifest) {
      this.logger?.error && this.logger.error('ContentValidator: Manifest is null or undefined!');
      this.addError('Manifest object is null or undefined');
      this.hasRequiredElements = false;
      this.metadataCompliance = false;
      return;
    }

    if (typeof manifest !== 'object') {
      this.logger?.error && this.logger.error('ContentValidator: Manifest is not an object, got:', typeof manifest);
      this.addError(`Manifest must be an object, got: ${typeof manifest}`);
      this.hasRequiredElements = false;
      this.metadataCompliance = false;
      return;
    }

    this.logger?.debug && this.logger.debug('ContentValidator: Manifest structure:', {
      hasIdentifier: 'identifier' in manifest,
      identifierValue: manifest.identifier,
      hasOrganizations: 'organizations' in manifest,
      hasResources: 'resources' in manifest,
      hasMetadata: 'metadata' in manifest
    });

    // Required elements validation
    let missingRequired = false;
    
    try {
      if (!manifest.identifier) {
        this.logger?.debug && this.logger.debug('ContentValidator: Missing identifier attribute');
        this.addError('Manifest missing required identifier attribute');
        missingRequired = true;
      } else {
        this.logger?.debug && this.logger.debug('ContentValidator: Identifier found:', manifest.identifier);
      }
    } catch (error) {
      this.logger?.error && this.logger.error('ContentValidator: Error checking identifier:', error);
      this.addError('Error accessing manifest identifier');
      missingRequired = true;
    }

    try {
      if (!manifest.organizations) {
        this.logger?.debug && this.logger.debug('ContentValidator: Missing organizations element');
        this.addError('Manifest missing required organizations element');
        missingRequired = true;
      } else {
        this.logger?.debug && this.logger.debug('ContentValidator: Organizations found');
      }
    } catch (error) {
      this.logger?.error && this.logger.error('ContentValidator: Error checking organizations:', error);
      this.addError('Error accessing manifest organizations');
      missingRequired = true;
    }

    try {
      if (!manifest.resources) {
        this.logger?.debug && this.logger.debug('ContentValidator: Missing resources element');
        this.addError('Manifest missing required resources element');
        missingRequired = true;
      } else {
        this.logger?.debug && this.logger.debug('ContentValidator: Resources found, count:', manifest.resources?.length || 0);
      }
    } catch (error) {
      this.logger?.error && this.logger.error('ContentValidator: Error checking resources:', error);
      this.addError('Error accessing manifest resources');
      missingRequired = true;
    }

    this.hasRequiredElements = !missingRequired;
    this.logger?.debug && this.logger.debug('ContentValidator: Required elements check completed, hasRequiredElements:', this.hasRequiredElements);

    // Metadata validation
    try {
      if (manifest.metadata) {
        this.logger?.debug && this.logger.debug('ContentValidator: Validating metadata structure');
        this.validateMetadataStructure(manifest.metadata);
        this.metadataCompliance = true; // Assuming valid if present and structure is validated
        this.logger?.debug && this.logger.debug('ContentValidator: Metadata validation completed');
      } else {
        this.logger?.debug && this.logger.debug('ContentValidator: No metadata found');
        this.addWarning('Package missing recommended metadata section');
        this.metadataCompliance = false;
      }
    } catch (error) {
      this.logger?.error && this.logger.error('ContentValidator: Error validating metadata:', error);
      this.addError('Error validating manifest metadata');
      this.metadataCompliance = false;
    }

    // Version validation
    try {
      if (manifest.version && !this.isValidVersion(manifest.version)) {
        this.logger?.debug && this.logger.debug('ContentValidator: Invalid version format:', manifest.version);
        this.addWarning(`Invalid manifest version: ${manifest.version}`);
      } else if (manifest.version) {
        this.logger?.debug && this.logger.debug('ContentValidator: Valid version found:', manifest.version);
      }
    } catch (error) {
      this.logger?.error && this.logger.error('ContentValidator: Error checking version:', error);
      this.addWarning('Error validating manifest version');
    }

    this.logger?.debug && this.logger.debug('ContentValidator: Manifest structure validation completed');
  }

  /**
   * Validate file integrity
   * @param {string} packagePath - Package directory path
   * @param {Object} manifest - Parsed manifest object
   */
  async validateFileIntegrity(packagePath, manifest) {
    if (!manifest.resources) return;

    for (const resource of manifest.resources) {
      await this.validateResourceFiles(packagePath, resource);
    }
  }

  /**
   * Validate resource files exist
   * @param {string} packagePath - Package directory path
   * @param {Object} resource - Resource object
   */
  async validateResourceFiles(packagePath, resource) {
    const resourceBase = resource.resolvedBase || packagePath;

    // Validate main resource file (href)
    if (resource.href) {
      const filePath = PathUtils.join(resourceBase, resource.href);
      const fileExists = PathUtils.fileExists(filePath);

      if (!fileExists) {
        this.addError(this.buildFileNotFoundError(resource.href, filePath, resourceBase, resource.identifier, true));
      }
    }

    // Validate all listed files
    if (resource.files) {
      for (const file of resource.files) {
        const fileName = file.href || file;
        const filePath = PathUtils.join(resourceBase, fileName);
        const fileExists = PathUtils.fileExists(filePath);

        if (!fileExists) {
          this.addError(this.buildFileNotFoundError(fileName, filePath, resourceBase, resource.identifier, false));
        }
      }
    }
  }

  /**
   * Build detailed file not found error message
   * @param {string} fileName - Original file name from manifest
   * @param {string} fullPath - Full resolved path that was searched
   * @param {string} searchDir - Directory that was searched
   * @param {string} resourceId - Resource identifier
   * @param {boolean} isMainResource - Whether this is the main resource file (href) or a dependency
   * @returns {string} Detailed error message
   */
  buildFileNotFoundError(fileName, fullPath, searchDir, resourceId, isMainResource) {
    const fileType = isMainResource ? 'Main resource file' : 'Dependency file';

    // Get list of files in the search directory
    let availableFiles = [];
    try {
      if (fsSync.existsSync(searchDir)) {
        availableFiles = fsSync.readdirSync(searchDir);
      }
    } catch (err) {
      // If we can't read the directory, just note that
      this.logger?.warn('ContentValidator: Could not read directory for file listing', {
        directory: searchDir,
        error: err.message
      });
    }

    // Build the error message with all diagnostic information
    let errorMsg = `File not found: ${fileName}\n`;
    errorMsg += `  Resource: ${resourceId}\n`;
    errorMsg += `  Type: ${fileType}\n`;
    errorMsg += `  Full path searched: ${fullPath}\n`;
    errorMsg += `  Search directory: ${searchDir}\n`;

    if (availableFiles.length > 0) {
      errorMsg += `  Files in directory (${availableFiles.length} total):\n`;
      // Show first 10 files to avoid overwhelming the error message
      const filesToShow = availableFiles.slice(0, 10);
      filesToShow.forEach(file => {
        errorMsg += `    - ${file}\n`;
      });
      if (availableFiles.length > 10) {
        errorMsg += `    ... and ${availableFiles.length - 10} more files\n`;
      }
    } else {
      errorMsg += `  Directory is empty or does not exist\n`;
    }

    return errorMsg;
  }

  /**
   * Validate resource dependencies
   * @param {string} packagePath - Package directory path
   * @param {Object} manifest - Parsed manifest object
   */
  async validateResourceDependencies(packagePath, manifest) {
    if (!manifest.resources) return;

    const resourceIds = new Set(manifest.resources.map(r => r.identifier));

    for (const resource of manifest.resources) {
      if (resource.dependencies) {
        for (const dependency of resource.dependencies) {
          if (!resourceIds.has(dependency.identifierref || dependency)) {
            this.addError(`Dependency not found: ${dependency.identifierref || dependency} (Resource: ${resource.identifier})`);
          }
        }
      }
    }
  }

  /**
   * Validate SCORM types
   * @param {Object} manifest - Parsed manifest object
   */
  async validateScormTypes(manifest) {
    if (!manifest.resources) {
      this.validScormTypes = false;
      return;
    }

    let allScormTypesValid = true;
    for (const resource of manifest.resources) {
      if (resource.scormType) {
        if (!SCORM_CONSTANTS.CAM.SCORM_TYPES[resource.scormType.toUpperCase()]) {
          this.addError(`Invalid SCORM type: ${resource.scormType} (Resource: ${resource.identifier})`);
          allScormTypesValid = false;
        }

        // SCO validation
        if (resource.scormType === 'sco' && !resource.href) {
          this.addError(`SCO resource must have href attribute (Resource: ${resource.identifier})`);
          allScormTypesValid = false;
        }
      } else {
        // If scormType is missing, it's often treated as an asset, but for strict compliance, it might be a warning/error
        this.addWarning(`Resource missing scormType attribute: ${resource.identifier}`);
      }
    }
    this.validScormTypes = allScormTypesValid;
  }

  /**
   * Validate organization structure
   * @param {Object} manifest - Parsed manifest object
   */
  async validateOrganizationStructure(manifest) {
    if (!manifest.organizations) return;

    const { organizations } = manifest.organizations;
    if (!organizations || organizations.length === 0) {
      this.addError('No organizations found in manifest');
      return;
    }

    // Validate default organization exists
    if (manifest.organizations.default) {
      const defaultExists = organizations.some(org => org.identifier === manifest.organizations.default);
      if (!defaultExists) {
        this.addError(`Default organization not found: ${manifest.organizations.default}`);
      }
    }

    // Validate each organization
    for (const organization of organizations) {
      this.validateOrganization(organization, manifest.resources);
    }
  }

  /**
   * Validate single organization
   * @param {Object} organization - Organization object
   * @param {Array} resources - Resources array
   */
  validateOrganization(organization, resources) {
    let allIdentifiersValid = true;
    if (!organization.identifier) {
      this.addError('Organization missing required identifier');
      allIdentifiersValid = false;
    }

    if (!organization.title) {
      this.addWarning(`Organization missing title: ${organization.identifier}`);
    }

    // Validate item references
    if (organization.items) {
      this.validateItems(organization.items, resources, organization.identifier);
      // Assuming validateItems also contributes to validIdentifiers
      // For simplicity, we'll set it based on the organization's identifier for now
      if (!organization.identifier) allIdentifiersValid = false;
    }
    this.validIdentifiers = allIdentifiersValid; // This needs to be more robust, checking all identifiers
  }

  /**
   * Validate organization items
   * @param {Array} items - Items array
   * @param {Array} resources - Resources array
   * @param {string} orgId - Organization identifier
   */
  validateItems(items, resources, orgId) {
    const resourceIds = new Set(resources?.map(r => r.identifier) || []);

    for (const item of items) {
      if (!item.identifier) {
        this.addError(`Item missing identifier in organization: ${orgId}`);
      }

      // Validate resource reference
      if (item.identifierref && !resourceIds.has(item.identifierref)) {
        this.addError(`Item references non-existent resource: ${item.identifierref} (Organization: ${orgId})`);
      }

      // Recursively validate child items
      if (item.children && item.children.length > 0) {
        this.validateItems(item.children, resources, orgId);
      }
    }
  }

  /**
   * Validate metadata structure
   * @param {Object} metadata - Metadata object
   */
  validateMetadataStructure(metadata) {
    if (metadata.schema && metadata.schema !== 'ADL SCORM') {
      this.addWarning(`Non-standard schema: ${metadata.schema}`);
    }

    if (metadata.schemaversion && !metadata.schemaversion.includes('2004')) {
      this.addWarning(`Non-SCORM 2004 schema version: ${metadata.schemaversion}`);
    }
  }

  /**
   * Check if file exists
   * @param {string} filePath - File path to check
   * @returns {Promise<boolean>} True if file exists
   */
  

  /**
   * Check if version string is valid
   * Accepts both 2-part (X.Y) and 3-part semantic versioning (X.Y.Z)
   * @param {string} version - Version string
   * @returns {boolean} True if valid
   */
  isValidVersion(version) {
    return /^\d+\.\d+(\.\d+)?$/.test(version);
  }

  /**
   * Add validation error
   * @param {string|Object} message - Error message or detailed error object
   */
  addError(message) {
    this.validationErrors.push(message);
  }

  /**
   * Add validation warning
   * @param {string|Object} message - Warning message or detailed warning object
   */
  addWarning(message) {
    this.validationWarnings.push(message);
  }

  /**
   * Clear validation results
   */
  clearValidationResults() {
    this.validationErrors = [];
    this.validationWarnings = [];
  }

  /**
   * Reset compliance flags
   */
  resetComplianceFlags() {
    this.hasRequiredElements = false;
    this.validScormTypes = false;
    this.validIdentifiers = false;
    this.sequencingCompliance = false;
    this.metadataCompliance = false;
    this.overallCompliance = false;
  }

  /**
   * Validate sequencing compliance
   * This is a placeholder and would involve deeper parsing of sequencing rules.
   * For now, it checks if any sequencing elements exist.
   * @param {Object} manifest - Parsed manifest object
   */
  async validateSequencingCompliance(manifest) {
    let hasSequencing = false;
    if (manifest.organizations && manifest.organizations.organizations) {
      for (const org of manifest.organizations.organizations) {
        if (org.sequencing) {
          hasSequencing = true;
          break;
        }
        if (org.items && this.checkItemsForSequencing(org.items)) {
          hasSequencing = true;
          break;
        }
      }
    }
    this.sequencingCompliance = hasSequencing;
    if (!hasSequencing) {
      this.addWarning('No sequencing information found. Package may not be fully SCORM 2004 compliant regarding sequencing.');
    }
  }

  /**
   * Helper to recursively check items for sequencing
   * @param {Array} items - Array of item objects
   * @returns {boolean} True if sequencing found
   */
  checkItemsForSequencing(items) {
    for (const item of items) {
      if (item.sequencing) {
        return true;
      }
      if (item.children && this.checkItemsForSequencing(item.children)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate parent DOM access in course files
   * Scans HTML/JS files for patterns that indicate parent window DOM manipulation
   * @param {string} packagePath - Path to SCORM package directory
   */
  async validateParentDOMAccess(packagePath) {
    try {
      const result = await scorm_lint_parent_dom_access({ workspace_path: packagePath });

      if (result.violations && result.violations.length > 0) {
        this.logger?.warn && this.logger.warn('ContentValidator: Found parent DOM access violations', {
          count: result.violations.length
        });

        // Add each violation as an error with detailed information
        for (const violation of result.violations) {
          const errorMessage = `${violation.file}:${violation.line} - ${violation.issue}`;
          const detailedError = {
            message: errorMessage,
            file: violation.file,
            line: violation.line,
            severity: violation.severity,
            code_snippet: violation.code_snippet,
            fix_suggestion: violation.fix_suggestion,
            type: 'parent_dom_violation'
          };

          if (violation.severity === 'error') {
            this.addError(detailedError);
          } else {
            this.addWarning(detailedError);
          }
        }
      }
    } catch (error) {
      this.logger?.error && this.logger.error('ContentValidator: Parent DOM validation failed', error);
      this.addWarning(`Parent DOM validation failed: ${error.message}`);
    }
  }

  /**
   * Validate overall compliance based on all checks
   */
  async validateOverallCompliance() {
    this.overallCompliance = this.validationErrors.length === 0 &&
                             this.hasRequiredElements &&
                             this.validScormTypes &&
                             this.validIdentifiers &&
                             this.sequencingCompliance &&
                             this.metadataCompliance;
  }

  /**
   * Generate validation summary
   * @returns {Object} Validation summary
   */
  generateValidationSummary() {
    return {
      totalErrors: this.validationErrors.length,
      totalWarnings: this.validationWarnings.length,
      isCompliant: this.validationErrors.length === 0,
      validationDate: new Date().toISOString(),
      hasRequiredElements: this.hasRequiredElements,
      validScormTypes: this.validScormTypes,
      validIdentifiers: this.validIdentifiers,
      sequencingCompliance: this.sequencingCompliance,
      metadataCompliance: this.metadataCompliance,
      overallCompliance: this.overallCompliance
    };
  }
}

module.exports = ContentValidator;
