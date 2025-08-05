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
    console.log('ContentValidator: Starting manifest structure validation');
    console.log('ContentValidator: manifest type:', typeof manifest);
    console.log('ContentValidator: manifest is null/undefined:', manifest == null);
    
    // Critical check: ensure manifest is not null/undefined
    if (!manifest) {
      console.error('ContentValidator: Manifest is null or undefined!');
      this.addError('Manifest object is null or undefined');
      this.hasRequiredElements = false;
      this.metadataCompliance = false;
      return;
    }

    if (typeof manifest !== 'object') {
      console.error('ContentValidator: Manifest is not an object, got:', typeof manifest);
      this.addError(`Manifest must be an object, got: ${typeof manifest}`);
      this.hasRequiredElements = false;
      this.metadataCompliance = false;
      return;
    }

    console.log('ContentValidator: Manifest structure:', {
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
        console.log('ContentValidator: Missing identifier attribute');
        this.addError('Manifest missing required identifier attribute');
        missingRequired = true;
      } else {
        console.log('ContentValidator: Identifier found:', manifest.identifier);
      }
    } catch (error) {
      console.error('ContentValidator: Error checking identifier:', error);
      this.addError('Error accessing manifest identifier');
      missingRequired = true;
    }

    try {
      if (!manifest.organizations) {
        console.log('ContentValidator: Missing organizations element');
        this.addError('Manifest missing required organizations element');
        missingRequired = true;
      } else {
        console.log('ContentValidator: Organizations found');
      }
    } catch (error) {
      console.error('ContentValidator: Error checking organizations:', error);
      this.addError('Error accessing manifest organizations');
      missingRequired = true;
    }

    try {
      if (!manifest.resources) {
        console.log('ContentValidator: Missing resources element');
        this.addError('Manifest missing required resources element');
        missingRequired = true;
      } else {
        console.log('ContentValidator: Resources found, count:', manifest.resources?.length || 0);
      }
    } catch (error) {
      console.error('ContentValidator: Error checking resources:', error);
      this.addError('Error accessing manifest resources');
      missingRequired = true;
    }

    this.hasRequiredElements = !missingRequired;
    console.log('ContentValidator: Required elements check completed, hasRequiredElements:', this.hasRequiredElements);

    // Metadata validation
    try {
      if (manifest.metadata) {
        console.log('ContentValidator: Validating metadata structure');
        this.validateMetadataStructure(manifest.metadata);
        this.metadataCompliance = true; // Assuming valid if present and structure is validated
        console.log('ContentValidator: Metadata validation completed');
      } else {
        console.log('ContentValidator: No metadata found');
        this.addWarning('Package missing recommended metadata section');
        this.metadataCompliance = false;
      }
    } catch (error) {
      console.error('ContentValidator: Error validating metadata:', error);
      this.addError('Error validating manifest metadata');
      this.metadataCompliance = false;
    }

    // Version validation
    try {
      if (manifest.version && !this.isValidVersion(manifest.version)) {
        console.log('ContentValidator: Invalid version format:', manifest.version);
        this.addWarning(`Invalid manifest version: ${manifest.version}`);
      } else if (manifest.version) {
        console.log('ContentValidator: Valid version found:', manifest.version);
      }
    } catch (error) {
      console.error('ContentValidator: Error checking version:', error);
      this.addWarning('Error validating manifest version');
    }

    console.log('ContentValidator: Manifest structure validation completed');
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
        this.addError(`File not found: ${resource.href} (Resource: ${resource.identifier})`);
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