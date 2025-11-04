/**
 * SCORM 2004 4th Edition Package Analyzer
 * 
 * Analyzes SCORM package structure and content according to:
 * - SCORM 2004 4th Edition Content Aggregation Model specification
 * - Package dependency analysis
 * - Content structure mapping
 * - Launch sequence determination
 * 
 * Features:
 * - Package structure analysis
 * - Dependency graph construction
 * - Launch path resolution
 * - Content type classification
 * - Package statistics generation
 * 
 * @fileoverview SCORM package analyzer implementation
 */

const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');
const ContentValidator = require('./content-validator'); // Import ContentValidator
const PathUtils = require('../../../../shared/utils/path-utils');
const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');

/**
 * SCORM Package Analyzer
 *
 * Analyzes SCORM packages to extract structural information,
 * dependencies, and launch sequences for content delivery.
 */
class PackageAnalyzer {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.contentValidator = new ContentValidator(errorHandler); // Initialize ContentValidator
    this.logger = console; // Default logger, can be overridden
  }

  /**
   * Analyze complete SCORM package
   * @param {string} packagePath - Path to SCORM package directory
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Package analysis result
   */
  analyzePackage(packagePath, manifest) {
    try {
      const analysis = {
        packageInfo: this.analyzePackageInfo(manifest),
        structure: this.analyzeStructure(manifest),
        resources: this.analyzeResources(manifest, packagePath),
        dependencies: this.analyzeDependencies(manifest),
        launchSequence: this.determineLaunchSequence(manifest, packagePath),
        statistics: this.generateStatistics(manifest),
        compliance: this.checkComplianceSync(packagePath, manifest)
      };

      return analysis;
    } catch (error) {
      this.errorHandler?.setError('301', `Package analysis failed: ${error.message}`, 'analyzePackage');
      throw error;
    }
  }

  /**
   * Analyze basic package information
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Package information
   */
  analyzePackageInfo(manifest) {
    return {
      identifier: manifest.identifier,
      version: manifest.version || '1.0',
      title: this.extractPackageTitle(manifest),
      schema: manifest.metadata?.schema || 'Unknown',
      schemaVersion: manifest.metadata?.schemaversion || 'Unknown',
      applicationProfile: this.determineApplicationProfile(manifest),
      defaultOrganization: manifest.organizations?.default,
      hasSequencing: this.hasSequencingRules(manifest),
      hasNavigation: this.hasNavigationControls(manifest)
    };
  }

  /**
   * Analyze package structure
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Structure analysis
   */
  analyzeStructure(manifest) {
    const organizations = manifest.organizations?.organizations || [];
    
    return {
      organizationCount: organizations.length,
      organizations: organizations.map(org => this.analyzeOrganization(org)),
      maxDepth: this.calculateMaxDepth(organizations),
      totalItems: this.countTotalItems(organizations),
      itemTypes: this.classifyItemTypes(organizations, manifest.resources || [])
    };
  }

  /**
   * Analyze single organization
   * @param {Object} organization - Organization object
   * @returns {Object} Organization analysis
   */
  analyzeOrganization(organization) {
    return {
      identifier: organization.identifier,
      title: organization.title,
      structure: organization.structure || 'hierarchical',
      itemCount: this.countItems(organization.items || []),
      depth: this.calculateDepth(organization.items || []),
      hasSequencing: !!organization.sequencing,
      sequencingRules: this.analyzeSequencingRules(organization.sequencing),
      navigationFlow: this.analyzeNavigationFlow(organization.items || [])
    };
  }

  /**
   * Analyze resources
   * @param {Object} manifest - Parsed manifest object
   * @param {string} packagePath - Package directory path
   * @returns {Object} Resource analysis
   */
  analyzeResources(manifest, packagePath) {
    const resources = manifest.resources || [];
    
    return {
      totalResources: resources.length,
      resourceTypes: this.classifyResourceTypes(resources),
      scormTypes: this.classifyScormTypes(resources),
      fileTypes: this.classifyFileTypes(resources),
      launchableResources: this.identifyLaunchableResources(resources),
      assetResources: this.identifyAssetResources(resources),
      totalFiles: this.countTotalFiles(resources),
      estimatedSize: this.estimatePackageSize(resources, packagePath)
    };
  }

  /**
   * Analyze dependencies
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Dependency analysis
   */
  analyzeDependencies(manifest) {
    const resources = manifest.resources || [];
    const dependencyGraph = this.buildDependencyGraph(resources);
    
    return {
      dependencyGraph,
      circularDependencies: this.detectCircularDependencies(dependencyGraph),
      orphanedResources: this.findOrphanedResources(resources, manifest.organizations),
      sharedDependencies: this.findSharedDependencies(dependencyGraph),
      dependencyDepth: this.calculateDependencyDepth(dependencyGraph)
    };
  }

  /**
   * Determine launch sequence
   * @param {Object} manifest - Parsed manifest object
   * @returns {Array} Launch sequence
   */
  determineLaunchSequence(manifest, packagePath) {
    const defaultOrg = this.getDefaultOrganization(manifest);
    if (!defaultOrg) return [];

    return this.buildLaunchSequence(defaultOrg.items || [], manifest.resources || [], packagePath);
  }

  /**
   * Generate package statistics
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Package statistics
   */
  generateStatistics(manifest) {
    const organizations = manifest.organizations?.organizations || [];
    const resources = manifest.resources || [];

    return {
      organizations: organizations.length,
      totalItems: this.countTotalItems(organizations),
      scoCount: this.countResourcesByType(resources, 'sco'),
      assetCount: this.countResourcesByType(resources, 'asset'),
      totalResources: resources.length,
      averageDepth: this.calculateAverageDepth(organizations),
      complexityScore: this.calculateComplexityScore(manifest)
    };
  }

  /**
   * Check SCORM compliance (delegated to ContentValidator) - Async version
   * @param {string} packagePath - Path to SCORM package directory
   * @param {Object} manifest - Parsed manifest object
   * @returns {Promise<Object>} Compliance check result
   */
  async checkCompliance(packagePath, manifest) {
    try {
      const validationResult = await this.contentValidator.validatePackage(packagePath, manifest);
      return {
        hasRequiredElements: validationResult.summary.hasRequiredElements,
        validScormTypes: validationResult.summary.validScormTypes,
        validIdentifiers: validationResult.summary.validIdentifiers,
        sequencingCompliance: validationResult.summary.sequencingCompliance,
        metadataCompliance: validationResult.summary.metadataCompliance,
        overallCompliance: validationResult.summary.overallCompliance,
        isValid: validationResult.isValid,
        errors: validationResult.errors,
        warnings: validationResult.warnings
      };
    } catch (error) {
      this.errorHandler?.setError('301', `Compliance check failed: ${error.message}`, 'checkCompliance');
      throw error;
    }
  }

  /**
   * Check SCORM compliance (synchronous version for analysis)
   * @param {string} packagePath - Path to SCORM package directory
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Basic compliance check result
   */
  checkComplianceSync(packagePath, manifest) {
    try {
      this.contentValidator.logger?.debug && this.contentValidator.logger.debug('PackageAnalyzer: Starting synchronous compliance check');
      this.contentValidator.logger?.debug && this.contentValidator.logger.debug('PackageAnalyzer: packagePath:', packagePath);
      this.contentValidator.logger?.debug && this.contentValidator.logger.debug('PackageAnalyzer: manifest type:', typeof manifest);
      this.contentValidator.logger?.debug && this.contentValidator.logger.debug('PackageAnalyzer: manifest is null/undefined:', manifest == null);

      if (!manifest) {
        this.contentValidator.logger?.error('PackageAnalyzer: Manifest is null or undefined in checkComplianceSync');
        return {
          hasRequiredElements: false,
          validScormTypes: false,
          validIdentifiers: false,
          sequencingCompliance: false,
          metadataCompliance: false,
          overallCompliance: false,
          isValid: false,
          errors: ['Manifest is null or undefined'],
          warnings: []
        };
      }

      // Basic synchronous compliance checks
      const hasRequiredElements = !!(manifest.identifier && manifest.organizations && manifest.resources);
      const validScormTypes = this.validateScormTypesSync(manifest.resources || []);
      const validIdentifiers = this.validateIdentifiersSync(manifest);
      const sequencingCompliance = this.hasSequencingRules(manifest);
      const metadataCompliance = !!manifest.metadata;

      const result = {
        hasRequiredElements,
        validScormTypes,
        validIdentifiers,
        sequencingCompliance,
        metadataCompliance,
        overallCompliance: hasRequiredElements && validScormTypes && validIdentifiers,
        isValid: hasRequiredElements && validScormTypes && validIdentifiers,
        errors: [],
        warnings: []
      };

      this.contentValidator.logger?.debug && this.contentValidator.logger.debug('PackageAnalyzer: Synchronous compliance check completed:', result);
      return result;
    } catch (error) {
      this.contentValidator.logger?.error('PackageAnalyzer: Synchronous compliance check failed:', error);
      this.errorHandler?.setError('301', `Synchronous compliance check failed: ${error.message}`, 'checkComplianceSync');
      return {
        hasRequiredElements: false,
        validScormTypes: false,
        validIdentifiers: false,
        sequencingCompliance: false,
        metadataCompliance: false,
        overallCompliance: false,
        isValid: false,
        errors: [error.message],
        warnings: []
      };
    }
  }

  /**
   * Validate SCORM types synchronously
   * @param {Array} resources - Resources array
   * @returns {boolean} True if all SCORM types are valid
   */
  validateScormTypesSync(resources) {
    if (!Array.isArray(resources)) return false;
    
    return resources.every(resource => {
      if (!resource.scormType) return true; // Missing scormType is allowed (defaults to asset)
      return ['sco', 'asset'].includes(resource.scormType.toLowerCase());
    });
  }

  /**
   * Validate identifiers synchronously
   * @param {Object} manifest - Parsed manifest object
   * @returns {boolean} True if all identifiers are valid and unique
   */
  validateIdentifiersSync(manifest) {
    const identifiers = new Set();
    let duplicates = false;
    
    // Check manifest identifier
    if (manifest.identifier) {
      identifiers.add(manifest.identifier);
    }
    
    // Check organization identifiers
    manifest.organizations?.organizations?.forEach(org => {
      if (org.identifier) {
        if (identifiers.has(org.identifier)) {
          duplicates = true;
        }
        identifiers.add(org.identifier);
      }
    });
    
    // Check resource identifiers
    manifest.resources?.forEach(resource => {
      if (resource.identifier) {
        if (identifiers.has(resource.identifier)) {
          duplicates = true;
        }
        identifiers.add(resource.identifier);
      }
    });
    
    return !duplicates;
  }

  // Helper methods for analysis (retained for analysis, not validation)

  extractPackageTitle(manifest) {
    const defaultOrg = this.getDefaultOrganization(manifest);
    return defaultOrg?.title || manifest.identifier || 'Untitled Package';
  }

  determineApplicationProfile(manifest) {
    const hasSequencing = this.hasSequencingRules(manifest);
    return hasSequencing ? 
      SCORM_CONSTANTS.CAM.PROFILES.CONTENT_AGGREGATION : 
      SCORM_CONSTANTS.CAM.PROFILES.RESOURCE_PACKAGE;
  }

  hasSequencingRules(manifest) {
    const organizations = manifest.organizations?.organizations || [];
    return organizations.some(org => 
      org.sequencing || this.hasItemSequencing(org.items || [])
    );
  }

  hasItemSequencing(items) {
    return items.some(item => 
      item.sequencing || this.hasItemSequencing(item.children || [])
    );
  }

  /**
   * Checks if the manifest indicates the presence of navigation controls.
   * This is determined by examining sequencing control mode attributes.
   * @param {Object} manifest - Parsed manifest object
   * @returns {boolean} True if navigation controls are indicated
   */
  hasNavigationControls(manifest) {
    const organizations = manifest.organizations?.organizations || [];
    for (const org of organizations) {
      if (this.checkSequencingForNavigationControls(org.sequencing)) {
        return true;
      }
      if (org.items && this.checkItemsForNavigationControls(org.items)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Helper to recursively check sequencing for navigation control attributes.
   * @param {Object} sequencing - Sequencing object
   * @returns {boolean} True if navigation controls are indicated
   */
  checkSequencingForNavigationControls(sequencing) {
    if (!sequencing || !sequencing.controlMode) {
      return false;
    }
    const controlMode = sequencing.controlMode;
    return controlMode.choice || controlMode.flow || controlMode.choiceExit || controlMode.flowExit;
  }

  /**
   * Helper to recursively check items for navigation control attributes.
   * @param {Array} items - Array of item objects
   * @returns {boolean} True if navigation controls are indicated
   */
  checkItemsForNavigationControls(items) {
    for (const item of items) {
      if (this.checkSequencingForNavigationControls(item.sequencing)) {
        return true;
      }
      if (item.children && this.checkItemsForNavigationControls(item.children)) {
        return true;
      }
    }
    return false;
  }

  calculateMaxDepth(organizations) {
    return Math.max(...organizations.map(org => 
      this.calculateDepth(org.items || [])
    ), 0);
  }

  calculateDepth(items, currentDepth = 0) {
    if (!items || items.length === 0) return currentDepth;
    
    return Math.max(...items.map(item => 
      this.calculateDepth(item.children || [], currentDepth + 1)
    ));
  }

  countTotalItems(organizations) {
    return organizations.reduce((total, org) => 
      total + this.countItems(org.items || []), 0
    );
  }

  countItems(items) {
    return items.reduce((count, item) => 
      count + 1 + this.countItems(item.children || []), 0
    );
  }

  classifyItemTypes(organizations, resources) {
    const types = { sco: 0, asset: 0, aggregation: 0 };
    
    organizations.forEach(org => {
      this.classifyItemsRecursive(org.items || [], types, resources);
    });
    
    return types;
  }

  classifyItemsRecursive(items, types, resources) {
    items.forEach(item => {
      if (item.identifierref) {
        const referencedResource = resources.find(res => res.identifier === item.identifierref);
        if (referencedResource) {
          if (referencedResource.scormType === 'sco') {
            types.sco++;
          } else if (referencedResource.scormType === 'asset') {
            types.asset++;
          } else {
            // Default to asset if scormType is missing or unknown
            types.asset++;
          }
        } else {
          // If resource not found, it's an error, but for classification, treat as asset
          types.asset++;
        }
      } else if (item.children && item.children.length > 0) {
        types.aggregation++;
      }
      
      this.classifyItemsRecursive(item.children || [], types, resources);
    });
  }

  classifyResourceTypes(resources) {
    const types = {};
    resources.forEach(resource => {
      const type = resource.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });
    return types;
  }

  classifyScormTypes(resources) {
    const types = { sco: 0, asset: 0, unknown: 0 };
    resources.forEach(resource => {
      const scormType = resource.scormType || 'unknown';
      types[scormType] = (types[scormType] || 0) + 1;
    });
    return types;
  }

  classifyFileTypes(resources) {
  const types = {};
  resources.forEach(resource => {
    if (resource.files) {
      resource.files.forEach(file => {
        const filePath = file.href || file;
        const ext = PathUtils.getExtension(filePath);
        types[`.${ext}`] = (types[`.${ext}`] || 0) + 1;
      });
    }
  });
  return types;
}

  identifyLaunchableResources(resources) {
    return resources.filter(resource => 
      resource.scormType === 'sco' && resource.href
    );
  }

  identifyAssetResources(resources) {
    return resources.filter(resource => 
      resource.scormType === 'asset' || !resource.scormType
    );
  }

  countTotalFiles(resources) {
    return resources.reduce((total, resource) => 
      total + (resource.files ? resource.files.length : 0), 0
    );
  }

  estimatePackageSize(resources, _packagePath) {
    // Simplified size estimation - would need actual file system access
    return this.countTotalFiles(resources) * 50000; // Rough estimate
  }

  buildDependencyGraph(resources) {
    const graph = {};
    
    resources.forEach(resource => {
      graph[resource.identifier] = {
        dependencies: resource.dependencies?.map(dep => 
          dep.identifierref || dep
        ) || [],
        dependents: []
      };
    });
    
    // Build reverse dependencies
    Object.keys(graph).forEach(resourceId => {
      graph[resourceId].dependencies.forEach(depId => {
        if (graph[depId]) {
          graph[depId].dependents.push(resourceId);
        }
      });
    });
    
    return graph;
  }

  detectCircularDependencies(graph) {
    const visited = new Set();
    const recursionStack = new Set();
    const cycles = [];
    
    const dfs = (node, path) => {
      if (recursionStack.has(node)) {
        cycles.push([...path, node]);
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      recursionStack.add(node);
      
      graph[node]?.dependencies.forEach(dep => {
        dfs(dep, [...path, node]);
      });
      
      recursionStack.delete(node);
    };
    
    Object.keys(graph).forEach(node => {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    });
    
    return cycles;
  }

  findOrphanedResources(resources, organizations) {
    const referencedResources = new Set();
    
    organizations?.organizations?.forEach(org => {
      this.collectReferencedResources(org.items || [], referencedResources);
    });
    
    return resources.filter(resource => 
      !referencedResources.has(resource.identifier)
    );
  }

  collectReferencedResources(items, referenced) {
    items.forEach(item => {
      if (item.identifierref) {
        referenced.add(item.identifierref);
      }
      this.collectReferencedResources(item.children || [], referenced);
    });
  }

  findSharedDependencies(graph) {
    const dependencyCounts = {};
    
    Object.values(graph).forEach(node => {
      node.dependencies.forEach(dep => {
        dependencyCounts[dep] = (dependencyCounts[dep] || 0) + 1;
      });
    });
    
    return Object.entries(dependencyCounts)
      .filter(([, count]) => count > 1)
      .map(([dep, count]) => ({ dependency: dep, usageCount: count }));
  }

  calculateDependencyDepth(graph) {
    const depths = {};
    
    const calculateDepth = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return 0; // Circular dependency
      if (depths[nodeId] !== undefined) return depths[nodeId];
      
      visited.add(nodeId);
      const node = graph[nodeId];
      
      if (!node || node.dependencies.length === 0) {
        depths[nodeId] = 0;
      } else {
        depths[nodeId] = 1 + Math.max(...node.dependencies.map(dep => 
          calculateDepth(dep, new Set(visited))
        ));
      }
      
      return depths[nodeId];
    };
    
    Object.keys(graph).forEach(nodeId => calculateDepth(nodeId));
    return Math.max(...Object.values(depths), 0);
  }

  getDefaultOrganization(manifest) {
    const organizations = manifest.organizations?.organizations || [];
    const defaultId = manifest.organizations?.default;
    
    return defaultId ? 
      organizations.find(org => org.identifier === defaultId) :
      organizations[0];
  }

  buildLaunchSequence(items, resources, packagePath) {
    const sequence = [];
    
    const processItems = (itemList) => {
      itemList.forEach(item => {
        if (item.identifierref) {
          const resource = resources.find(r => r.identifier === item.identifierref);
          if (resource && resource.scormType === 'sco') {
            try {
              // Use PathUtils to combine xmlBase/href properly
              const contentPath = PathUtils.combineXmlBaseHref(resource.xmlBase, resource.href);
              
              // Get full manifest file path (not just directory)
              const manifestPath = PathUtils.join(packagePath, 'imsmanifest.xml');
              const appRoot = PathUtils.getAppRoot(__dirname);

              const resolutionResult = PathUtils.resolveScormContentUrl(
                contentPath,
                packagePath,
                manifestPath, // Full manifest file path
                appRoot
              );

              let fullHref;
              if (resolutionResult.success) {
                // Use final scorm-app:// URL from centralized resolution
                fullHref = resolutionResult.url;
              } else {
                // Use ParserError for consistent error handling
                const parserError = new ParserError({
                  code: ParserErrorCode.PATH_RESOLUTION_ERROR,
                  message: `Path resolution failed for resource ${resource.identifier}: ${resolutionResult.error}`,
                  detail: { 
                    originalPath: contentPath, 
                    resourceId: resource.identifier,
                    xmlBase: resource.xmlBase,
                    href: resource.href
                  },
                  phase: 'CAM_INTEGRATION'
                });

                this.errorHandler?.setError('301', parserError.message, 'PathUtilsIntegration');
                throw parserError;
              }
              
              sequence.push({
                itemId: item.identifier,
                resourceId: item.identifierref,
                title: item.title,
                href: fullHref,
                parameters: item.parameters
              });
            } catch (error) {
              // Log error and re-throw
              this.logger?.error('PackageAnalyzer: SCO path resolution failed', {
                operation: 'xmlBaseResolution',
                error: error.message,
                resourceId: resource.identifier,
                stack: error.stack?.substring(0, 500)
              });
              throw error;
            }
          }
        }
        
        if (item.children) {
          processItems(item.children);
        }
      });
    };
    
    processItems(items);
    return sequence;
  }

  countResourcesByType(resources, type) {
    return resources.filter(resource => resource.scormType === type).length;
  }

  calculateAverageDepth(organizations) {
    if (organizations.length === 0) return 0;
    
    const totalDepth = organizations.reduce((sum, org) => 
      sum + this.calculateDepth(org.items || []), 0
    );
    
    return totalDepth / organizations.length;
  }

  calculateComplexityScore(manifest) {
    // Simplified complexity scoring
    const organizations = manifest.organizations?.organizations || [];
    const resources = manifest.resources || [];
    
    let score = 0;
    score += organizations.length * 10;
    score += this.countTotalItems(organizations) * 5;
    score += resources.length * 3;
    score += this.hasSequencingRules(manifest) ? 50 : 0;
    
    return score;
  }


  analyzeSequencingRules(sequencing) {
    if (!sequencing) return null;
    
    return {
      hasControlModes: !!sequencing.controlMode,
      hasSequencingRules: !!sequencing.sequencingRules,
      hasLimitConditions: !!sequencing.limitConditions,
      hasRollupRules: !!sequencing.rollupRules
    };
  }

  analyzeNavigationFlow(items) {
    return {
      linearFlow: this.isLinearFlow(items),
      branchingPoints: this.countBranchingPoints(items),
      maxBreadth: this.calculateMaxBreadth(items)
    };
  }

  isLinearFlow(items) {
    return items.every(item => 
      !item.children || item.children.length <= 1
    );
  }

  countBranchingPoints(items) {
    return items.reduce((count, item) => {
      const branches = item.children ? item.children.length : 0;
      return count + (branches > 1 ? 1 : 0) + 
             this.countBranchingPoints(item.children || []);
    }, 0);
  }

  calculateMaxBreadth(items) {
    if (!items || items.length === 0) return 0;
    
    const currentBreadth = items.length;
    const childBreadths = items.map(item => 
      this.calculateMaxBreadth(item.children || [])
    );
    
    return Math.max(currentBreadth, ...childBreadths);
  }
}

module.exports = PackageAnalyzer;
