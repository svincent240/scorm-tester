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
const path = require('path');
const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');

/**
 * SCORM Content Validator
 * 
 * Validates SCORM packages for compliance with SCORM 2004 4th Edition
 * Content Aggregation Model specification.
 */
class ContentValidator {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.validationErrors = [];
    this.validationWarnings = [];
  }

  /**
   * Validate complete SCORM package
   * @param {string} packagePath - Path to SCORM package directory
   * @param {Object} manifest - Parsed manifest object
   * @returns {Promise<Object>} Validation result
   */
  async validatePackage(packagePath, manifest) {
    this.clearValidationResults();

    try {
      // Core validation steps
      await this.validateManifestStructure(manifest);
      await this.validateFileIntegrity(packagePath, manifest);
      await this.validateResourceDependencies(packagePath, manifest);
      await this.validateScormTypes(manifest);
      await this.validateOrganizationStructure(manifest);

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
    // Required elements validation
    if (!manifest.identifier) {
      this.addError('Manifest missing required identifier attribute');
    }

    if (!manifest.organizations) {
      this.addError('Manifest missing required organizations element');
    }

    if (!manifest.resources) {
      this.addError('Manifest missing required resources element');
    }

    // Metadata validation
    if (manifest.metadata) {
      this.validateMetadataStructure(manifest.metadata);
    }

    // Version validation
    if (manifest.version && !this.isValidVersion(manifest.version)) {
      this.addWarning(`Invalid manifest version: ${manifest.version}`);
    }
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
      const filePath = path.resolve(resourceBase, resource.href);
      if (!(await this.fileExists(filePath))) {
        this.addError(`Resource file not found: ${resource.href} (Resource: ${resource.identifier})`);
      }
    }

    // Validate all listed files
    if (resource.files) {
      for (const file of resource.files) {
        const filePath = path.resolve(resourceBase, file.href || file);
        if (!(await this.fileExists(filePath))) {
          this.addError(`File not found: ${file.href || file} (Resource: ${resource.identifier})`);
        }
      }
    }
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
    if (!manifest.resources) return;

    for (const resource of manifest.resources) {
      if (resource.scormType) {
        if (!SCORM_CONSTANTS.CAM.SCORM_TYPES[resource.scormType.toUpperCase()]) {
          this.addError(`Invalid SCORM type: ${resource.scormType} (Resource: ${resource.identifier})`);
        }

        // SCO validation
        if (resource.scormType === 'sco' && !resource.href) {
          this.addError(`SCO resource must have href attribute (Resource: ${resource.identifier})`);
        }
      }
    }
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
    if (!organization.identifier) {
      this.addError('Organization missing required identifier');
    }

    if (!organization.title) {
      this.addWarning(`Organization missing title: ${organization.identifier}`);
    }

    // Validate item references
    if (organization.items) {
      this.validateItems(organization.items, resources, organization.identifier);
    }
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
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if version string is valid
   * @param {string} version - Version string
   * @returns {boolean} True if valid
   */
  isValidVersion(version) {
    return /^\d+\.\d+$/.test(version);
  }

  /**
   * Add validation error
   * @param {string} message - Error message
   */
  addError(message) {
    this.validationErrors.push(message);
  }

  /**
   * Add validation warning
   * @param {string} message - Warning message
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
   * Generate validation summary
   * @returns {Object} Validation summary
   */
  generateValidationSummary() {
    return {
      totalErrors: this.validationErrors.length,
      totalWarnings: this.validationWarnings.length,
      isCompliant: this.validationErrors.length === 0,
      validationDate: new Date().toISOString()
    };
  }
}

module.exports = ContentValidator;