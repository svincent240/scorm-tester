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

      // 3b. Build UI Outline (simple) and compute launch directly from manifest structures (spec-aligned)
      try {
        const toArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
        const safeStr = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
        const joinPath = (a, b) => {
          const A = safeStr(a, '').replace(/\\/g, '/').replace(/\/+$/, '');
          const B = safeStr(b, '').replace(/\\/g, '/').replace(/^\/+/, '');
          if (!A) return B;
          if (!B) return A;
          return `${A}/${B}`;
        };

        analysis = analysis || {};
        let usedFallback = false;

        // Manifest shapes from ManifestParser
        const orgContainer = manifest?.organizations || null;
        const orgs = toArray(orgContainer?.organizations);
        const defId = safeStr(orgContainer?.default);
        const pickOrg = defId ? (orgs.find(o => o && safeStr(o.identifier) === defId) || null) : (orgs[0] || null);

        // Resources array from ManifestParser
        const resources = toArray(manifest?.resources);
        // Build resource lookup and compute effective href using resource.xmlBase (resolvedBase) + href
        const resById = new Map();
        for (const r of resources) {
          const id = safeStr(r?.identifier);
          if (!id) continue;
          const base = safeStr(r?.xmlBase) || safeStr(r?.resolvedBase);
          const href = safeStr(r?.href);
          const eff = href ? (r?.resolvedBase ? joinPath(r.resolvedBase, href) : joinPath(base, href)) : '';
          const st = safeStr(r?.scormType).toLowerCase();
          resById.set(id, { href: eff, scormType: st, rawHref: href, base: base || r?.resolvedBase || '' });
          this.logger?.info('CAM: resource href resolved', {
            resourceId: id,
            xmlBaseContainer: null,
            xmlBaseResource: base || null,
            hrefOriginal: href || null,
            hrefEffective: eff || null,
            scormType: st || null
          });
        }

        // Build a minimal uiOutline: chosen org's direct children mapped to items, keeping wrapper if present
        const outlineFromOrgItems = (org) => {
          if (!org) return [];
          const mapItem = (it) => {
            const identifier = safeStr(it?.identifier) || safeStr(it?.title, 'Untitled');
            const title = safeStr(it?.title, identifier);
            const idref = safeStr(it?.identifierref);
            let href = '';
            let type = 'cluster';
            if (idref && resById.has(idref)) {
              const r = resById.get(idref);
              href = safeStr(r.href);
              type = r.scormType === 'sco' ? 'sco' : (r.scormType ? 'asset' : (href ? 'asset' : 'cluster'));
              this.logger?.info('CAM: launch candidate (org item)', {
                itemId: identifier,
                identifierref: idref,
                scormType: r.scormType || null,
                xmlBaseResource: r.base || null,
                xmlBaseContainer: null,
                hrefOriginal: r.rawHref || null,
                hrefEffective: href || null
              });
            }
            const children = toArray(it?.children);
            return { identifier, title, type, href, items: children.map(mapItem) };
          };
          const topChildren = toArray(org?.items);
          return topChildren.map(mapItem);
        };

        let uiOutline = outlineFromOrgItems(pickOrg);

        // Simplify one-level wrapper: surface children if single non-launchable cluster
        if (Array.isArray(uiOutline) && uiOutline.length === 1) {
          const only = uiOutline[0];
          const isWrapper = (!only.href || only.href === '') && String(only.type || 'cluster').toLowerCase() === 'cluster';
          if (isWrapper && Array.isArray(only.items) && only.items.length > 0) {
            this.logger?.info('CAM: simplifying outline by lifting wrapper children', {
              wrapperIdentifier: only.identifier, childCount: only.items.length
            });
            uiOutline = only.items;
          }
        }

        if (!Array.isArray(uiOutline) || uiOutline.length === 0) {
          // Last resort: resources flat
          const fallback = this.buildUiOutlineFromResources(manifest);
          uiOutline = Array.isArray(fallback) ? fallback : [];
          usedFallback = uiOutline.length > 0;
        }

        analysis.uiOutline = uiOutline;

        // Compute launchSequence directly from org items/resById: DFS prefer SCO, then first href
        const pickFirstSco = (nodes) => {
          if (!Array.isArray(nodes)) return null;
          for (const n of nodes) {
            const hasHref = !!(n && typeof n.href === 'string' && n.href.trim());
            if (hasHref && String(n.type || '').toLowerCase() === 'sco') {
              return { href: n.href.trim(), identifier: n.identifier || n.title || 'node', title: n.title || n.identifier || 'Untitled' };
            }
            const child = pickFirstSco(n?.items);
            if (child) return child;
          }
          return null;
        };
        let first = pickFirstSco(uiOutline);
        if (!first) {
          const pickFirstHref = (nodes) => {
            if (!Array.isArray(nodes)) return null;
            for (const n of nodes) {
              const hasHref = !!(n && typeof n.href === 'string' && n.href.trim());
              if (hasHref) {
                return { href: n.href.trim(), identifier: n.identifier || n.title || 'node', title: n.title || n.identifier || 'Untitled' };
              }
              const child = pickFirstHref(n?.items);
              if (child) return child;
            }
            return null;
          };
          first = pickFirstHref(uiOutline);
        }
        analysis.launchSequence = first ? [first] : [];
        this.logger?.info('CAM: launchSequence computed', { count: analysis.launchSequence.length, first: analysis.launchSequence[0] || null });

        const itemCount = Array.isArray(analysis.uiOutline) ? analysis.uiOutline.length : 0;
        const sample = itemCount > 0 ? analysis.uiOutline[0] : null;
        this.logger?.info('ScormCAMService: UI outline built (default org children - direct)', {
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
 
    // Build resource map by identifier with SCORM xml:base resolution per IMS CP/SCORM
    // Reference: SCORM 2004 4th Ed CAM uses IMS CP xml:base semantics. Effective href = join(xml:base, href).
    const resources = manifest?.resources;
    const resourceList = toArray(resources?.resource);
    const resourceById = new Map();

    // Resolve nested xml:base at resources container and resource node levels
    const containerBase = safeStr(resources?.['xml:base'] || resources?.xmlBase || resources?.xmlbase || '', '');
    const normJoin = (base, href) => {
      const b = safeStr(base, '').replace(/\\/g, '/');
      const h = safeStr(href, '').replace(/\\/g, '/');
      if (!h) return '';
      if (!b) return h.replace(/^\/+/, '');
      const lhs = b.replace(/\/+$/,'');
      const rhs = h.replace(/^\/+/,'');
      return `${lhs}/${rhs}`;
    };

    for (const res of resourceList) {
      const id = safeStr(res?.identifier);
      if (!id) continue;
      const localBase = safeStr(res?.['xml:base'] || res?.xmlBase || res?.xmlbase || '', '');
      const resHref = safeStr(res?.href, '');
      // Respect precedence: resource.xml:base overrides container base when both present
      const baseForRes = localBase || containerBase;
      const effectiveHref = normJoin(baseForRes, resHref);
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
    const joinXmlBase = (resObj) => {
      const href = safeStr(resObj?.href || '', '');
      return href;
    };

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
      const a = toArray(rootOrg?.item);
      if (a.length > 0) return a.map(traverse);
      const b = toArray(rootOrg?.items);
      if (b.length > 0) return b.map(traverse);
      const c = toArray(rootOrg?.children);
      return c.map(traverse);
    })();

    // Flatten top-level hidden/non-launchable wrapper if present to surface first-level SCOs
    if (Array.isArray(topLevelItems) && topLevelItems.length === 1) {
      const only = topLevelItems[0];
      const isWrapper = (!only.href || only.href === '') && String(only.type || 'cluster').toLowerCase() === 'cluster';
      const hasChildren = Array.isArray(only.items) && only.items.length > 0;
      if (isWrapper && hasChildren) {
        this.logger?.info('CAM: flattening top-level wrapper item to expose child items', {
          wrapperIdentifier: only.identifier,
          wrapperTitle: only.title,
          childCount: only.items.length
        });
        return only.items;
      }
    }
    // Do not write to manifest here; higher-level processPackage will compute analysis.launchSequence from uiOutline.
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