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

      // 3b. Build UI Outline for renderer (static, manifest-derived)
      try {
        // Manifest stats logging prior to building outline (namespace-robust)
        const _toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
        // Accept both canonical { organizations: { organization: [] } } and alternative shapes
        const orgContainer = manifest?.organizations;
        const orgListForStats = _toArray(orgContainer?.organization || orgContainer?.organizations || orgContainer);
        const resContainer = manifest?.resources;
        const resListForStats = _toArray(resContainer?.resource || resContainer?.resources || resContainer);
        const statsSample = {
          firstOrg: orgListForStats.length > 0 ? {
            identifier: orgListForStats[0]?.identifier || null,
            title: orgListForStats[0]?.title || null,
            hasItems: !!(orgListForStats[0]?.item || orgListForStats[0]?.items || orgListForStats[0]?.children)
          } : null,
          firstResource: resListForStats.length > 0 ? {
            identifier: resListForStats[0]?.identifier || null,
            href: resListForStats[0]?.href || null,
            scormType: (resListForStats[0]?.['adlcp:scormType'] || resListForStats[0]?.scormType || null)
          } : null
        };
        this.logger?.info('ScormCAMService: manifest org/resources counts', {
          orgCount: orgListForStats.length,
          resCount: resListForStats.length,
          defaultOrg: orgContainer?.default || null,
          sample: statsSample
        });

        // Build outline from organizations FIRST and only fall back if organizations truly absent/empty
        // SCORM 2004: default organization applies when explicit selection exists; items under that org form the course tree.
        analysis = analysis || {};
        const hasAnyOrgs = orgListForStats.length > 0;
        let usedFallback = false;

        // Helper: count items recursively in org
        const countOrgItems = (org) => {
          const toArr = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
          const walk = (items) => {
            const arr = toArr(items);
            let n = 0;
            for (const it of arr) {
              n += 1;
              n += walk(it && (it.item || it.items || []));
            }
            return n;
          };
          return walk(org && (org.item || org.items || []));
        };

        let uiOutlineFromOrg = [];
        if (hasAnyOrgs) {
          // Prefer default org if present and has items; otherwise first org with items
          const defId = orgContainer?.default || null;
          const pickOrg = (() => {
            if (defId) {
              const def = orgListForStats.find(o => (o && (o.identifier === defId)));
              if (def && countOrgItems(def) > 0) return def;
            }
            // fallback to first org that has items
            const withItems = orgListForStats.find(o => !!(o && (o.item || o.items || o.children)));
            return withItems || orgListForStats[0] || null;
          })();

          // Build outline strictly from organizations branch
          uiOutlineFromOrg = this.buildUiOutlineFromManifest({
            ...manifest,
            organizations: { default: pickOrg?.identifier || orgContainer?.default, organization: [pickOrg || orgListForStats[0]].filter(Boolean) }
          }, packagePath) || [];
        }

        if ((hasAnyOrgs && uiOutlineFromOrg.length > 0)) {
          analysis.uiOutline = uiOutlineFromOrg;
        } else {
          // Only fall back to resources when no orgs or org had zero items
          const fallback = this.buildUiOutlineFromResources(manifest);
          analysis.uiOutline = Array.isArray(fallback) ? fallback : [];
          usedFallback = analysis.uiOutline.length > 0;
        }

        const itemCount = Array.isArray(analysis.uiOutline) ? analysis.uiOutline.length : 0;
        const sample = itemCount > 0 ? analysis.uiOutline[0] : null;
        this.logger?.info('ScormCAMService: UI outline built', {
          itemCount,
          usedFallback,
          sample: sample ? { identifier: sample.identifier, title: sample.title, href: sample.href, type: sample.type } : null
        });
      } catch (outlineError) {
        this.logger?.warn('ScormCAMService: Failed to build UI outline from manifest:', outlineError?.message || outlineError);
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
      const cleanedManifest = this.cleanManifestForSerialization(manifest);
      // Diagnostics: log cleaned manifest key shapes and counts (app log)
      try {
        const orgsArr = Array.isArray(cleanedManifest?.organizations?.organization)
          ? cleanedManifest.organizations.organization
          : [];
        const resArr = Array.isArray(cleanedManifest?.resources?.resource)
          ? cleanedManifest.resources.resource
          : [];
        this.logger?.info('ScormCAMService: Cleaned manifest shapes', {
          hasOrganizations: !!cleanedManifest?.organizations,
          hasResources: !!cleanedManifest?.resources,
          orgKeyType: cleanedManifest?.organizations
            ? 'organization[]'
            : 'none',
          resKeyType: cleanedManifest?.resources
            ? 'resource[]'
            : 'none',
          orgCount: orgsArr.length,
          resCount: resArr.length
        });
      } catch (_) { /* swallow diagnostics errors */ }

      const response = {
        success: true,
        manifest: cleanedManifest,
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
      // Deep clone to strip functions/DOM refs
      const cloned = JSON.parse(JSON.stringify(manifest));

      // Normalize to canonical SCORM-like keys expected by tests and analyzers:
      // organizations: { default, organization: Organization[] }
      // resources: { resource: Resource[] }
      const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
      const norm = {};

      // Basic attributes
      norm.identifier = cloned?.identifier || null;
      norm.version = cloned?.version || null;
      norm.metadata = cloned?.metadata || null;

      // Organizations normalization
      let orgDefault = null;
      let orgArray = [];
      if (cloned?.organizations) {
        // Accept either { organizations: [...] } or { organization: [...] } or array or single object
        const orgContainer = cloned.organizations;

        // default attribute
        orgDefault = orgContainer?.default || null;

        if (Array.isArray(orgContainer?.organizations)) {
          orgArray = orgContainer.organizations;
        } else if (Array.isArray(orgContainer?.organization)) {
          orgArray = orgContainer.organization;
        } else if (Array.isArray(orgContainer)) {
          orgArray = orgContainer;
        } else if (orgContainer?.organizations) {
          orgArray = toArray(orgContainer.organizations);
        } else if (orgContainer?.organization) {
          orgArray = toArray(orgContainer.organization);
        } else if (typeof orgContainer === 'object') {
          // Unknown object shape: try values that look like orgs
          const vals = Object.values(orgContainer).flat();
          orgArray = vals.filter(v => v && (v.items || v.item || v.title || v.identifier));
        }

        // Map item children keys from "children" to "item" to align with buildUiOutlineFromManifest expectations
        const remapItems = (node) => {
          if (!node || typeof node !== 'object') return node;
          const out = { ...node };
          if (Array.isArray(out.children) && !out.item) {
            out.item = out.children;
          }
          if (Array.isArray(out.items) && !out.item) {
            out.item = out.items;
          }
          // Recurse for child items
          if (Array.isArray(out.item)) {
            out.item = out.item.map(remapItems);
          }
          return out;
        };
        orgArray = orgArray.map(remapItems);
      }

      // Resources normalization
      let resArray = [];
      if (cloned?.resources) {
        const resContainer = cloned.resources;
        if (Array.isArray(resContainer?.resource)) {
          resArray = resContainer.resource;
        } else if (Array.isArray(resContainer)) {
          resArray = resContainer;
        } else if (resContainer?.resources) {
          resArray = toArray(resContainer.resources);
        } else if (resContainer?.resource) {
          resArray = toArray(resContainer.resource);
        } else if (typeof resContainer === 'object') {
          const vals = Object.values(resContainer).flat();
          resArray = vals.filter(v => v && (v.href || v.identifier || v.files));
        }
      }

      norm.organizations = (orgArray.length > 0 || orgDefault)
        ? { default: orgDefault || undefined, organization: orgArray }
        : null;

      norm.resources = (resArray.length > 0)
        ? { resource: resArray }
        : (cloned?.resources ? { resource: [] } : null);

      this.logger?.debug('ScormCAMService: Manifest cleaned and normalized for serialization', {
        orgCount: Array.isArray(norm.organizations?.organization) ? norm.organizations.organization.length : 0,
        resCount: Array.isArray(norm.resources?.resource) ? norm.resources.resource.length : 0
      });

      return norm;
    } catch (error) {
      this.logger?.error('ScormCAMService: Failed to clean manifest for serialization:', error);
      // Minimal safe object preserving canonical keys
      return {
        identifier: manifest?.identifier || null,
        version: manifest?.version || null,
        organizations: manifest?.organizations
          ? { default: manifest.organizations.default || undefined, organization: [] }
          : null,
        resources: manifest?.resources ? { resource: [] } : null,
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
  /**
   * Build a UI-friendly outline from manifest organizations/resources.
   * Returns an array of normalized nodes for the default organization.
   * Node shape: { identifier, title, type: 'cluster'|'sco'|'asset', href, items: [] }
   */
  buildUiOutlineFromManifest(manifest, basePath) {
    // Helpers
    const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
    const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
 
    // Build resource map by identifier
    const resources = manifest?.resources;
    const resourceList = toArray(resources?.resource);
    const resourceById = new Map();
    for (const res of resourceList) {
      const id = safeStr(res?.identifier);
      if (!id) continue;
      const scormType = safeStr(res?.['adlcp:scormType'] || res?.scormType || res?.['scormType']);
      // Prefer href on resource; fall back later if needed
      resourceById.set(id, {
        identifier: id,
        href: safeStr(res?.href, ''),
        scormType: scormType || '',
        title: safeStr(res?.title || res?.['adlcp:title'] || res?.['ims:title'] || '', '')
      });
    }
 
    // Determine default organization
    const orgs = manifest?.organizations;
    const defaultOrgId = safeStr(orgs?.default);
    const orgList = toArray(orgs?.organization);
    let rootOrg = null;
    if (defaultOrgId) {
      rootOrg = orgList.find(o => safeStr(o?.identifier) === defaultOrgId) || null;
    }
    if (!rootOrg && orgList.length > 0) {
      rootOrg = orgList[0];
    }
 
    if (!rootOrg) {
      // No organizations — attempt to derive from resources as flat outline
      const flat = [];
      for (const res of resourceList) {
        const href = safeStr(res?.href, '');
        if (!href) continue;
        const rawTitle = (typeof res?.title === 'string') ? res.title
          : (res?.title?._text || res?.title?.['#text'] || '');
        const title = safeStr(rawTitle, href.split('/').pop() || href);
        const scormType = safeStr(res?.['adlcp:scormType'] || res?.scormType || res?.['scormType'] || '', '');
        flat.push({
          identifier: safeStr(res?.identifier, href),
          title,
          type: scormType.toLowerCase() === 'sco' ? 'sco' : 'asset',
          href,
          items: []
        });
      }
      return flat;
    }
 
    // Traverse organization items
    const traverse = (itemNode) => {
      const id = safeStr(itemNode?.identifier);
      const title = safeStr(itemNode?.title || itemNode?.['ims:title'] || itemNode?.['adlcp:title'] || '', id || 'Untitled');
      const identifierref = safeStr(itemNode?.identifierref);
      const childrenArr = toArray(itemNode?.item);
      // Resolve type/href
      let href = '';
      let type = 'cluster';
      if (identifierref) {
        const res = resourceById.get(identifierref);
        if (res) {
          href = safeStr(res.href, '');
          const st = safeStr(res.scormType).toLowerCase();
          type = st === 'sco' ? 'sco' : (st ? 'asset' : 'asset');
        } else {
          // Unknown reference, leave as cluster with no href
          type = childrenArr.length > 0 ? 'cluster' : 'asset';
        }
      } else if (childrenArr.length === 0) {
        // Leaf without identifierref — treat as cluster without launch
        type = 'cluster';
      }
 
      const items = childrenArr.map(traverse);
      return { identifier: id || title, title, type, href, items };
    };
 
    const topLevelItems = toArray(rootOrg?.item).map(traverse);
    return topLevelItems;
  } // end buildUiOutlineFromManifest

  /**
   * Secondary outline builder: derive flat list from manifest.resources when organizations are absent/empty.
   * Returns array of { identifier, title, type, href, items: [] }
   */
  buildUiOutlineFromResources(manifest) {
    const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
    const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);

    // Coerce various shapes into a list of resource-like objects
    let resources = [];
    if (manifest?.resources?.resource) {
      resources = toArray(manifest.resources.resource);
    } else if (Array.isArray(manifest?.resources)) {
      // Some parsers might flatten to an array
      resources = manifest.resources;
    } else if (manifest?.resources && typeof manifest.resources === 'object') {
      // Unknown shape: try values
      const vals = Object.values(manifest.resources).flat();
      resources = vals.filter(v => typeof v === 'object' && (v.href || v.identifier));
    }

    const items = [];
    for (const res of resources) {
      const href = safeStr(res?.href, '');
      if (!href) continue;
      const id = safeStr(res?.identifier, href);
      const t = safeStr(res?.['adlcp:scormType'] || res?.scormType || res?.['scormType'] || '', '').toLowerCase();
      const rawTitle = (typeof res?.title === 'string') ? res.title
        : (res?.title?._text || res?.title?.['#text'] || '');
      const title = safeStr(rawTitle, href.split(/[\\/]/).pop() || href);
      items.push({
        identifier: id,
        title,
        type: t === 'sco' ? 'sco' : 'asset',
        href,
        items: []
      });
    }
    // Log counts for diagnostics
    this.logger?.info('ScormCAMService: resources fallback built outline', { resourceCount: resources.length, itemCount: items.length });
    return items;
  }
} // end class ScormCAMService
 
module.exports = {
  ScormCAMService,
  ManifestParser,
  ContentValidator,
  MetadataHandler,
  PackageAnalyzer
};