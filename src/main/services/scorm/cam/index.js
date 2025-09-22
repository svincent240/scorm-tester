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
const { ParserError } = require('../../../../shared/errors/parser-error');
const PathUtils = require('../../../../shared/utils/path-utils');
// Logger is obtained via constructor parameter

/**
 * SCORM CAM Service
 * 
 * Provides unified interface for Content Aggregation Model operations
 */
class ScormCAMService {
  constructor(errorHandler, loggerInstance) {
    this.errorHandler = errorHandler;
    // Ensure we always have a usable logger with info/warn/error/debug methods
    const getSharedLogger = require('../../../../shared/utils/logger');
    this.logger = (loggerInstance && typeof loggerInstance.info === 'function')
      ? loggerInstance
      : getSharedLogger();

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
    // Keep validation available across failures for diagnostics
    let validation = null;
    let analysis;
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

        // EARLY SNAPSHOT for diagnostics (duplicates now prevented at parser level)
        try {
          const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
          const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
          const orgContainer = manifest?.organizations || null;
          const orgs = toArray(orgContainer?.organization);  // ManifestParser outputs organizations.organization
          const defId = safeStr(orgContainer?.default);
          const defaultOrg = defId
            ? (orgs.find(o => o && safeStr(o.identifier) === defId) || null)
            : (orgs[0] || null);
          const top = defaultOrg ? (() => {
            const itemArray = toArray(defaultOrg.item);
            if (itemArray.length > 0) return itemArray;
            return toArray(defaultOrg.items);
          })() : [];
          const ids = top.map(n => (safeStr(n?.identifier) || safeStr(n?.title) || 'node'));
          // const dupCount = ids.length - new Set(ids).size; // Removed unused variable
          const payload = {
            phase: 'CAM_PARSE',
            code: 'PARSE_VALIDATION_ERROR',
            message: 'Parser defaultOrg top-level snapshot',
            detail: { topIds: ids },
            manifestId: manifest?.identifier || null,
            defaultOrgId: defId || (defaultOrg?.identifier || null),
            stats: { orgCount: orgs.length, topCount: top.length },
            packagePath,
            severity: 'info'
          };
          this.logger?.info('ScormCAMService: Parser snapshot', payload);
        } catch (e) {
          this.logger?.warn('ScormCAMService: Failed early org/items diagnostic', { message: e?.message || String(e) });
        }
      } catch (parseError) {
        // Ensure structured failure is logged once with approved contract
        const payload = {
          phase: 'CAM_PARSE',
          code: 'PARSE_VALIDATION_ERROR',
          message: parseError?.message || 'Manifest parsing failed',
          detail: parseError?.detail || { note: 'no-detail' },
          manifestId: undefined,
          defaultOrgId: undefined,
          stats: undefined,
          packagePath,
          severity: 'error'
        };
        this.logger?.error('ScormCAMService: parse failure', payload);
        // Re-throw ParserError or wrap generically
        if (parseError instanceof ParserError) {
          throw parseError;
        }
        throw new ParserError({
          code: 'PARSE_VALIDATION_ERROR',
          message: `Manifest parsing failed: ${parseError?.message || String(parseError)}`,
          detail: { stack: parseError?.stack }
        });
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
      try {
        validation = await this.contentValidator.validatePackage(packagePath, manifest);
        this.logger?.info('ScormCAMService: Package validation completed', { isValid: validation.isValid });
      } catch (validationError) {
        this.logger?.error('ScormCAMService: Package validation failed:', validationError);
        validation = {
          isValid: false,
          errors: [validationError?.message || String(validationError)],
          warnings: [],
          summary: {
            totalErrors: 1,
            totalWarnings: 0,
            isCompliant: false,
            validationDate: new Date().toISOString()
          }
        };
        // Continue to analysis; do not return early. Validation details will be included in the final result.
      }

      // If invalid, log and continue to analysis to provide outline/metadata for diagnostics
      if (!validation?.isValid) {
        this.logger?.info('ScormCAMService: Package invalid; continuing to analysis for diagnostics', { errorCount: validation?.errors?.length || 0 });
      }

      // 3. Analyze Package
      this.logger?.info('ScormCAMService: Starting package analysis');
      try {
        analysis = this.packageAnalyzer.analyzePackage(packagePath, manifest);
        this.logger?.info('ScormCAMService: Package analysis completed');
      } catch (analysisError) {
        this.logger?.error('ScormCAMService: Package analysis failed:', analysisError);
        throw new Error(`Package analysis failed: ${analysisError.message}`);
      }

      // 3b. Minimal, spec-aligned pipeline: single traversal and first launch resolution
      try {
        const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
        const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);

        analysis = analysis || {};

        // 1) Select default organization from parser output (use correct property name)
        const orgContainer = manifest?.organizations || null;
        const orgs = toArray(orgContainer?.organization);  // ManifestParser outputs organizations.organization
        const defId = safeStr(orgContainer?.default);
        const defaultOrg = defId
          ? (orgs.find(o => o && safeStr(o.identifier) === defId) || null)
          : (orgs[0] || null);

        // 2) Build a resource map with xml:base resolution
        const resourceList = toArray(manifest?.resources?.resource);
        const resById = new Map();

        // Resolve nested xml:base at resources container and resource node levels
        const containerBase = safeStr(manifest?.resources?.['xml:base'] || manifest?.resources?.xmlBase || manifest?.resources?.xmlbase || '', '');

        for (const r of resourceList) {
          const id = safeStr(r?.identifier);
          if (!id) continue;
          const localBase = safeStr(r?.['xml:base'] || r?.xmlBase || r?.xmlbase || '', '');
          const resHref = safeStr(r?.href, '');
          // Respect precedence: resource.xml:base overrides container base when both present
          const baseForRes = localBase || containerBase;
          const effectiveHref = resHref ? PathUtils.combineXmlBaseHref(baseForRes, resHref) : baseForRes;
          const st = safeStr(r?.scormType).toLowerCase();

          resById.set(id, { href: effectiveHref || '', scormType: st || '' });

          // Debug logging for xml:base resolution
          this.logger?.info('CAM: inline resource href resolved', {
            resourceId: id,
            xmlBaseContainer: containerBase || null,
            xmlBaseResource: localBase || null,
            hrefOriginal: resHref || null,
            hrefEffective: effectiveHref || null,
            scormType: st || null
          });
        }

        // 3) Traverse defaultOrg.item[] with item.children[] only; never mix alternative axes
        const mapItem = (it) => {
          const identifier = safeStr(it?.identifier) || safeStr(it?.identifierref) || safeStr(it?.title, 'Untitled');
          const title = safeStr(it?.title, identifier);
          const idref = safeStr(it?.identifierref);
          let href = '';
          let type = 'cluster';

          if (idref && resById.has(idref)) {
            const r = resById.get(idref);
            href = safeStr(r.href);
            const st = safeStr(r.scormType).toLowerCase();
            type = st === 'sco' ? 'sco' : (href ? 'asset' : 'cluster');
          }

          const children = (() => {
            const itemArray = toArray(it?.item);
            if (itemArray.length > 0) return itemArray.map(mapItem);
            const itemsArray = toArray(it?.items);
            if (itemsArray.length > 0) return itemsArray.map(mapItem);
            return toArray(it?.children).map(mapItem);
          })();
          return { identifier, title, type, href, items: children };
        };

        
        const uiOutline = defaultOrg ? (() => {
          const itemArray = toArray(defaultOrg?.item);
          if (itemArray.length > 0) return itemArray.map(mapItem);
          const itemsArray = toArray(defaultOrg?.items);
          if (itemsArray.length > 0) return itemsArray.map(mapItem);
          return toArray(defaultOrg?.children).map(mapItem);
        })() : [];

        // 4) Compute launch by DFS preferring first SCO with href, else first href
        const pickFirstSco = (nodes) => {
          for (const n of nodes || []) {
            if (n?.href && String(n.type || '').toLowerCase() === 'sco') {
              return { href: n.href.trim(), identifier: n.identifier || n.title || 'node', title: n.title || n.identifier || 'Untitled' };
            }
            const child = pickFirstSco(n.items);
            if (child) return child;
          }
          return null;
        };
        let first = pickFirstSco(uiOutline);
        if (!first) {
          const pickFirstHref = (nodes) => {
            for (const n of nodes || []) {
              if (n?.href) {
                return { href: n.href.trim(), identifier: n.identifier || n.title || 'node', title: n.title || n.identifier || 'Untitled' };
              }
              const child = pickFirstHref(n.items);
              if (child) return child;
            }
            return null;
          };
          first = pickFirstHref(uiOutline);
        }

        // Centralize resolution: convert selected href into final scorm-app:// URL
        // Resolve launch URL only when validation has passed; otherwise leave xml:base-joined href for diagnostics
        if (validation?.isValid && first && first.href) {
          try {
            const manifestPath = PathUtils.join(packagePath, 'imsmanifest.xml');
            const appRoot = PathUtils.getAppRoot(__dirname);
            const resolution = PathUtils.resolveScormContentUrl(first.href, packagePath, manifestPath, appRoot);
            if (resolution?.success && resolution.url) {
              first.href = resolution.url; // overwrite with final URL
            } else {
              // If resolution fails, throw to surface error and avoid partial output
              throw new Error(resolution?.error || 'Unknown resolution failure');
            }
          } catch (e) {
            this.logger?.error('ScormCAMService: Failed to resolve launch URL via PathUtils', { href: first.href, error: e?.message || String(e) });
            // Re-throw to fail processing per strict contract
            throw e;
          }
        }

        // Strict policy: if default organization exists but has zero top-level items, throw ParserError
        try {
          const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
          const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
          const orgContainer = manifest?.organizations || null;
          const orgs = toArray(orgContainer?.organization);  // ManifestParser outputs organizations.organization
          const defId = safeStr(orgContainer?.default);
          const defaultOrg = defId
            ? (orgs.find(o => o && safeStr(o.identifier) === defId) || null)
            : (orgs[0] || null);
          const topItems = (() => {
            const itemArray = toArray(defaultOrg?.item);
            if (itemArray.length > 0) return itemArray;
            const itemsArray = toArray(defaultOrg?.items);
            if (itemsArray.length > 0) return itemsArray;
            return toArray(defaultOrg?.children);
          })();
          if (defaultOrg && topItems.length === 0) {
            const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');
            throw new ParserError({
              code: ParserErrorCode ? ParserErrorCode.PARSE_VALIDATION_ERROR : 'PARSE_VALIDATION_ERROR',
              message: 'No items in default organization',
              detail: {
                reason: 'EMPTY_ORGANIZATION',
                defaultOrgId: safeStr(defaultOrg?.identifier) || defId || null,
                orgCount: orgs.length,
                topCount: 0
              },
              phase: 'CAM_PROCESS'
            });
          }
        } catch (guardErr) {
          // If we threw a ParserError above, rethrow to fail the pipeline as per strict contract
          if (guardErr && (guardErr.name === 'ParserError' || guardErr.code === 'PARSE_VALIDATION_ERROR')) {
            throw guardErr;
          }
          // Otherwise, continue; non-critical guard errors shouldn't mask analysis
        }

        analysis.uiOutline = uiOutline;
        analysis.launchSequence = first ? [first] : [];
      } catch (outlineError) {
        this.logger?.warn('ScormCAMService: Minimal pipeline failed:', outlineError?.message || outlineError);
        // Re-throw ParserError from strict guard so tests can assert rejection
        if (outlineError && (outlineError.name === 'ParserError' || outlineError.code === 'PARSE_VALIDATION_ERROR')) {
          throw outlineError;
        }
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
      const payload = {
        type: error?.name || 'Error',
        message: error?.message || String(error),
        code: error?.code || undefined,
        stackHead: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 5) : null
      };
      this.logger?.error('ScormCAMService: Package processing error', payload);
      this.logger?.error('ScormCAMService: Error stack', { stack: error?.stack });

      // Strict policy: propagate ParserError so callers can assert on it
      if (error && (error.name === 'ParserError' || error.code === 'PARSE_VALIDATION_ERROR')) {
        throw error;
      }

      // Fail-fast but include validation snapshot when available for diagnostics
      return { success: false, error: error.message, reason: error.message, validation: validation || undefined };
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
  buildUiOutlineFromManifest(manifest, _basePath) {
    // Helpers
    const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
    const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
 
    // Build resource map by identifier with SCORM xml:base resolution per IMS CP/SCORM
    // Reference: SCORM 2004 4th Ed CAM uses IMS CP xml:base semantics. Effective href = join(xml:base, href).
    const resources = manifest?.resources;
    const resourceList = toArray(resources?.resource);
    const resourceById = new Map();

    // Resolve nested xml:base at resources container and resource node levels
    const containerBase = safeStr(resources?.['xml:base'] || resources?.xmlBase || resources?.xmlbase || '', '');
    

    for (const res of resourceList) {
      const id = safeStr(res?.identifier);
      if (!id) continue;
      const localBase = safeStr(res?.['xml:base'] || res?.xmlBase || res?.xmlbase || '', '');
      const resHref = safeStr(res?.href, '');
      // Respect precedence: resource.xml:base overrides container base when both present
      const baseForRes = localBase || containerBase;
      const effectiveHref = PathUtils.combineXmlBaseHref(baseForRes, resHref);
      // Capture scormType across common shapes and normalize
      const scormType = safeStr(
        res?.['adlcp:scormType']
        || res?.adlcp_scormType
        || res?.scormType
        || res?.ScormType
        || res?.['scormType']
        || res?.['adlcp:SCORMType']
        || ''
      ).toLowerCase();

      resourceById.set(id, {
        identifier: id,
        href: effectiveHref, // already xml:base-joined
        scormType: scormType || '',
        title: safeStr(res?.title || res?.['adlcp:title'] || res?.['ims:title'] || '', ''),
        __debug: {
          xmlBaseContainer: containerBase,
          xmlBaseResource: localBase,
          hrefOriginal: resHref,
          hrefEffective: effectiveHref
        }
      });

      // Diagnostic log for each resource resolution
      this.logger?.info('CAM: resource href resolved', {
        resourceId: id,
        xmlBaseContainer: containerBase || null,
        xmlBaseResource: localBase || null,
        hrefOriginal: resHref || null,
        hrefEffective: effectiveHref || null,
        scormType: scormType || null
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
      // Prefer first org that actually has items before blindly taking index 0
      rootOrg = orgList.find(o => !!(o && (Array.isArray(o.item) ? o.item.length : (o.item || o.items || o.children)))) || orgList[0];
    }

    // joinXmlBase no longer needed here because resourceById contains effective hrefs.

    if (!rootOrg) {
      // No organizations — derive from resources as flat outline using effective hrefs
      const flat = [];
      for (const res of resourceList) {
        const id = safeStr(res?.identifier, '');
        const mapped = resourceById.get(id);
        const href = safeStr(mapped?.href || '', '');
        if (!href) continue;
        const rawTitle = (typeof res?.title === 'string') ? res.title
          : (res?.title?._text || res?.title?.['#text'] || '');
        const title = safeStr(rawTitle, (href.split('/').pop() || href));
        const scormType = safeStr(res?.['adlcp:scormType'] || res?.scormType || res?.['scormType'] || '', '');
        flat.push({
          identifier: id || href,
          title,
          type: scormType.toLowerCase() === 'sco' ? 'sco' : 'asset',
          href,
          items: []
        });
        // INFO log for diagnostics
        this.logger?.info('CAM: launch candidate (no-org resources)', {
          resourceId: id,
          xmlBase: mapped?.__debug?.xmlBaseResource || mapped?.__debug?.xmlBaseContainer || '',
          hrefOriginal: mapped?.__debug?.hrefOriginal || '',
          hrefJoined: href
        });
      }
      return flat;
    }

    // Traverse organization items (accept item/items/children)
    const traverse = (itemNode) => {
      const id = safeStr(itemNode?.identifier);
      const title = safeStr(itemNode?.title || itemNode?.['ims:title'] || itemNode?.['adlcp:title'] || '', id || 'Untitled');
      const identifierref = safeStr(itemNode?.identifierref);
      const childrenArr = (() => {
        const a = toArray(itemNode?.item);
        if (a.length > 0) return a;
        const b = toArray(itemNode?.items);
        if (b.length > 0) return b;
        const c = toArray(itemNode?.children);
        return c;
      })();
      // Resolve type/href
      let href = '';
      let type = 'cluster';
      if (identifierref) {
        const res = resourceById.get(identifierref);
        if (res) {
          // Use effective href already resolved with xml:base precedence
          href = safeStr(res.href, '');
          const st = safeStr(res.scormType).toLowerCase();
          type = st === 'sco' ? 'sco' : (st ? 'asset' : 'asset');

          // INFO log for diagnostics
          this.logger?.info('CAM: launch candidate (org item)', {
            itemId: id || title,
            identifierref,
            scormType: st || null,
            xmlBaseResource: res?.__debug?.xmlBaseResource || null,
            xmlBaseContainer: res?.__debug?.xmlBaseContainer || null,
            hrefOriginal: res?.__debug?.hrefOriginal || null,
            hrefEffective: href || null
          });
        } else {
          // Unknown reference, leave as cluster with no href
          type = childrenArr.length > 0 ? 'cluster' : 'asset';
        }
      } else if (childrenArr.length === 0) {
        // Leaf without identifierref — treat as cluster without launch
        type = 'cluster';
      }

      const items = childrenArr.map(traverse);
  
      // SCORM conformance: prevent generating a synthetic organization-level wrapper node
      // that duplicates the first child cluster when identifier is missing.
      // Prefer stable identifier: use itemNode.identifier when present; otherwise use title.
      const stableId = id || title;
  
      return { identifier: stableId, title, type, href, items };
    };

    const topLevelItems = (() => {
      // Prefer 'item' (canonical), else 'items'. Do NOT mix with 'children' at org level.
      const a = toArray(rootOrg?.item);
      if (a.length > 0) return a.map(traverse);
      const b = toArray(rootOrg?.items);
      if (b.length > 0) return b.map(traverse);
      return [];
    })();

    // Preserve structure; no wrapper flattening here.
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
