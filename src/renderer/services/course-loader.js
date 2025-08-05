/**
 * Course Loading Service
 * 
 * Handles SCORM course file selection, extraction, processing, and validation.
 * Provides clean separation of course loading logic from UI components.
 * 
 * @fileoverview Course loading and processing service
 */

import { eventBus } from './event-bus.js';
import { uiState as uiStatePromise } from './ui-state.js';

/**
 * Course Loader Class
 * 
 * Manages the complete course loading workflow from file selection to UI updates.
 */
class CourseLoader {
  constructor() {
    this.currentCourse = null;
    this.loadingState = false;
  }

  /**
   * Handle course load request - opens file dialog and processes selection
   */
  async handleCourseLoad() {
    // console.log('CourseLoader: handleCourseLoad called'); // Removed debug log
    
    try {
      if (typeof window.electronAPI === 'undefined') {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.selectScormPackage();
      // console.log('CourseLoader: File selection result:', result); // Removed debug log
      
      if (!result.success) {
        // console.log('CourseLoader: File selection was cancelled or failed:', result); // Removed debug log
        return;
      }
      
      // console.log('CourseLoader: File selected successfully:', result.filePath); // Removed debug log
      
      await this.loadCourseFromPath(result.filePath);
      
    } catch (error) {
      console.error('CourseLoader: Error in handleCourseLoad:', error);
      eventBus.emit('course:loadError', { error: error.message });
      throw error;
    }
  }

  /**
   * Load course from file path
   */
  async loadCourseFromPath(filePath) {
    // console.log('CourseLoader: loadCourseFromPath called with:', filePath); // Removed debug log
    
    try {
      this.setLoadingState(true);
      eventBus.emit('course:loadStart', { filePath });
      
      await this.processCourseFile(filePath);
      
    } catch (error) {
      console.error('CourseLoader: Error in loadCourseFromPath:', error);
      eventBus.emit('course:loadError', { error: error.message });
      throw error;
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Process SCORM course file through complete workflow
   */
  async processCourseFile(filePath) {
    // console.log('CourseLoader: processCourseFile called with:', filePath); // Removed debug log
    
    try {
      // Step 1: Extract the SCORM package
      // console.log('CourseLoader: Step 1 - Extracting SCORM package...'); // Removed debug log
      const extractResult = await window.electronAPI.extractScorm(filePath);
      // console.log('CourseLoader: Extract result:', extractResult); // Removed debug log
      
      if (!extractResult.success) {
        throw new Error(`Failed to extract SCORM package: ${extractResult.error}`);
      }
      
      const extractedPath = extractResult.path;
      // console.log('CourseLoader: Confirmed extractedPath:', extractedPath); // Removed debug log
      
      if (!extractedPath) {
        throw new Error('Extract result did not contain a valid path property');
      }
      
      // Step 2: Get manifest content (FileManager now only returns content, not parsed structure)
      // console.log('CourseLoader: Step 2 - Getting course manifest content...'); // Removed debug log
      const manifestContentResult = await window.electronAPI.getCourseManifest(extractedPath);
      
      if (!manifestContentResult.success) {
        throw new Error(`Failed to get course manifest content: ${manifestContentResult.error}`);
      }
      
      const manifestContent = manifestContentResult.manifestContent;
      
      // Step 3: Process manifest using ScormCAMService (via IPC)
      // console.log('CourseLoader: Step 3 - Processing manifest with CAM service...'); // Removed debug log
      const processManifestResult = await window.electronAPI.processScormManifest(extractedPath, manifestContent);
      
      if (!processManifestResult.success) {
        throw new Error(`Failed to process SCORM manifest: ${processManifestResult.reason || processManifestResult.error}`);
      }
      
      const { manifest, validation, analysis } = processManifestResult;

      // INFO-LEVEL DIAGNOSTICS (compact to avoid IPC rate limit): capture raw structure and manifest shapes
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        const raw = analysis?.structure;
        const diag = {
          analysisHasStructure: !!raw,
          analysisRootKeys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 12) : [],
          analysisItemsLen: Array.isArray(raw?.items) ? raw.items.length : 0,
          analysisChildrenLen: Array.isArray(raw?.children) ? raw.children.length : 0,
          analysisItemLen: raw?.item ? (Array.isArray(raw.item) ? raw.item.length : 1) : 0,
          analysisOrgsShape: raw?.organizations
            ? (Array.isArray(raw.organizations?.organizations) ? 'organizations[]'
              : Array.isArray(raw.organizations?.organization) ? 'organization[]'
              : (raw.organizations?.organization ? 'organization{}' : 'none'))
            : 'none',
          manifestHasOrganizations: !!manifest?.organizations,
          manifestOrgCount: Array.isArray(manifest?.organizations?.organization) ? manifest.organizations.organization.length : (manifest?.organizations?.organization ? 1 : 0),
          manifestDefaultOrg: manifest?.organizations?.default || null,
          manifestIdentifier: manifest?.identifier || null
        };
        rendererLogger.info('CourseLoader: structure pre-normalize snapshot', diag);
      } catch (_) {}

      // Prefer CAM-provided uiOutline if available
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        const uiOutline = Array.isArray(analysis?.uiOutline) ? analysis.uiOutline : null;
        if (uiOutline && uiOutline.length > 0) {
          rendererLogger.info('CourseLoader: using CAM-provided uiOutline', {
            count: uiOutline.length,
            sample: { identifier: uiOutline[0]?.identifier, title: uiOutline[0]?.title, href: uiOutline[0]?.href, type: uiOutline[0]?.type }
          });
        } else {
          rendererLogger.info('CourseLoader: CAM-provided uiOutline not present; falling back to renderer normalization');
        }
      } catch (_) {}

      // Step 4: Determine entry point from processed manifest
      const firstLaunchHref = Array.isArray(analysis?.launchSequence) && analysis.launchSequence.length > 0
        ? analysis.launchSequence[0].href
        : null;
      if (!firstLaunchHref) {
        throw new Error('CAM analysis did not provide a launchable href in launchSequence[0].href');
      }
      const entryResult = await window.electronAPI.pathUtils.resolveScormUrl(firstLaunchHref, extractedPath);
      if (!entryResult.success) {
        throw new Error(`Failed to resolve SCORM entry URL: ${entryResult.error}`);
      }

      // Step 5: Build a robust, normalized structure for the UI
      // Normalizer ensures a consistent shape: { identifier, title, type?, href?, items: [] }
      const normalizeNode = (node) => {
        if (!node || typeof node !== 'object') return null;

        // Title resolution across possible shapes
        const rawTitle = node.title || node.name || node._text || node['#text'] || node.identifier;
        const title = (typeof rawTitle === 'string' && rawTitle.trim().length > 0) ? rawTitle.trim() : 'Untitled';

        // Identifier resolution
        const identifier = node.identifier || node.id || node.identifierref || `node_${Math.random().toString(36).slice(2, 10)}`;

        // Children resolution across keys: support items/children/item and also organization root with .item
        const rawChildren = Array.isArray(node.items) ? node.items
                          : Array.isArray(node.children) ? node.children
                          : (node.item ? (Array.isArray(node.item) ? node.item : [node.item]) : []);

        // Normalize each child node
        let children = rawChildren.map(normalizeNode).filter(Boolean);

        // If this node looks like an organization wrapper that directly contains launchable leaf (identifierref)
        // expose it as a leaf (type 'sco') even if no explicit href provided
        // Also compute href from common SCORM shapes if present
        const href = node.href || node.launch || node.url || node.resource?.href || undefined;

        // Determine type:
        // - explicit node.type
        // - 'sco' if identifierref present (SCORM item referencing a resource)
        // - 'cluster' if it has children
        // - 'asset' otherwise
        const type = node.type || (node.identifierref ? 'sco' : (children.length > 0 ? 'cluster' : 'asset'));

        // Some CAM structures use { children: [...] } at leaves but expect those to be in 'items'
        // Ensure items array is present; UI expects 'items'
        return {
          identifier,
          title,
          type,
          href,
          items: children
        };
      };

      const coerceArray = (val) => Array.isArray(val) ? val : (val ? [val] : []);

      const normalizeStructure = (structureLike) => {
        if (!structureLike) return null;

        // 1) Direct items
        if (Array.isArray(structureLike.items) && structureLike.items.length > 0) {
          const items = structureLike.items.map(normalizeNode).filter(Boolean);
          return {
            title: structureLike.title || 'Course',
            identifier: structureLike.identifier || 'course',
            items
          };
        }

        // 2) Direct children
        if (Array.isArray(structureLike.children) && structureLike.children.length > 0) {
          const items = structureLike.children.map(normalizeNode).filter(Boolean);
          return {
            title: structureLike.title || 'Course',
            identifier: structureLike.identifier || 'course',
            items
          };
        }

        // 3) Root has "item" singular or array
        if (structureLike.item) {
          const items = coerceArray(structureLike.item).map(normalizeNode).filter(Boolean);
          return {
            title: structureLike.title || 'Course',
            identifier: structureLike.identifier || 'course',
            items
          };
        }

        // 4) organizations/organization path variants
        const orgsA = structureLike.organizations?.organizations;
        const orgsB = structureLike.organizations?.organization;
        const organizations = Array.isArray(orgsA) ? orgsA : (Array.isArray(orgsB) ? orgsB : (orgsB ? [orgsB] : null));
        if (organizations && organizations.length > 0) {
          const defaultOrgId = structureLike.organizations.default;
          const org = (defaultOrgId && organizations.find(o => o.identifier === defaultOrgId)) || organizations[0];
          const orgItems = org?.items || org?.children || coerceArray(org?.item);
          const items = (Array.isArray(orgItems) ? orgItems : []).map(normalizeNode).filter(Boolean);
          return {
            title: org?.title || structureLike.identifier || 'Course',
            identifier: org?.identifier || 'course',
            items
          };
        }

        // 5) Fallback: normalize node and lift its children into items if present
        const n = normalizeNode(structureLike);
        if (!n) return null;
        n.items = Array.isArray(n.items) ? n.items : [];
        return n;
      };

      // Manifest conversion helpers
      const convertManifestItems = (items) => {
        const arr = Array.isArray(items) ? items : (items ? [items] : []);
        return arr.map(item => ({
          identifier: item.identifier || item.identifierref || 'unknown',
          title: (typeof item.title === 'string' ? item.title : (item.title?._text || item.title?.['#text'])) || item.identifier || 'Untitled',
          type: item.identifierref ? 'sco' : (item.item ? 'cluster' : 'asset'),
          href: item.href || item.launch || item.resource?.href || undefined,
          item: item.item || []
        }));
      };

      const buildStructureFromManifest = (mf) => {
        const orgs = mf?.organizations;
        if (!orgs) return null;
        const org = Array.isArray(orgs.organization) ? orgs.organization[0] : orgs.organization;
        if (!org) return null;
        return {
          title: org.title || mf.identifier || 'Course',
          identifier: org.identifier || 'course',
          items: convertManifestItems(org.item || [])
        };
      };

      // Prefer CAM-provided structure when available, else build from manifest
      // If CAM provided a uiOutline (array of nodes), wrap it into a structure shape directly
      let rawStructure;
      if (Array.isArray(analysis?.uiOutline) && analysis.uiOutline.length > 0) {
        rawStructure = {
          title: manifest?.organizations?.organization?.title
            || manifest?.identifier
            || 'Course',
          identifier: manifest?.organizations?.organization?.identifier
            || manifest?.identifier
            || 'course',
          items: analysis.uiOutline
        };
      } else {
        rawStructure = (analysis && analysis.structure) ? analysis.structure : buildStructureFromManifest(manifest);
      }
      let normalized = normalizeStructure(rawStructure);

      // Fallbacks if items are still empty: try deeper common keys
      if (!normalized || !Array.isArray(normalized.items) || normalized.items.length === 0) {
        const candidates = [
          Array.isArray(rawStructure?.children) ? rawStructure.children : null,
          Array.isArray(rawStructure?.items) ? rawStructure.items : null,
          rawStructure?.item ? (Array.isArray(rawStructure.item) ? rawStructure.item : [rawStructure.item]) : null
        ].filter(Boolean);

        const firstNonEmpty = candidates.find(c => Array.isArray(c) && c.length > 0) || [];
        if (firstNonEmpty.length > 0) {
          const rootTitle = rawStructure?.title
            || manifest?.organizations?.organization?.title
            || manifest?.identifier
            || 'Course';
          normalized = {
            title: rootTitle,
            identifier: rawStructure?.identifier || 'course',
            items: firstNonEmpty.map(child => normalizeNode(child)).filter(Boolean)
          };
        }
      }

      // Ensure final structure shape
      let uiStructure = normalized && Array.isArray(normalized.items)
        ? normalized
        : { title: 'Course', identifier: 'course', items: [] };

      // Helper: build map of manifest resources for resolving hrefs
      const buildResourceMap = (mf) => {
        const map = new Map();
        const resources = mf?.resources?.resource;
        const resArr = Array.isArray(resources) ? resources : (resources ? [resources] : []);
        for (const r of resArr) {
          const id = r?.identifier || r?.id;
          if (!id) continue;
          const href = r?.href || r?.launch || r?.url;
          const title = (typeof r?.title === 'string' ? r.title : (r?.title?._text || r?.title?.['#text'])) || null;
          map.set(id, { href, title });
        }
        return map;
      };

      // FINAL SAFETY A: if uiStructure has zero items but manifest has organizations.organization.item,
      // convert manifest directly as a last-resort path.
      if (Array.isArray(uiStructure.items) && uiStructure.items.length === 0 && manifest?.organizations?.organization) {
        try {
          // Prefer default organization if specified
          const organizations = Array.isArray(manifest.organizations.organization)
            ? manifest.organizations.organization
            : [manifest.organizations.organization];
          const defaultOrgId = manifest.organizations.default;
          const org = (defaultOrgId && organizations.find(o => o.identifier === defaultOrgId)) || organizations[0];

          const resourceMap = buildResourceMap(manifest);

          const mapItems = (items) => {
            const arr = Array.isArray(items) ? items : (items ? [items] : []);
            return arr.map(it => {
              const identifier = it.identifier || it.identifierref || 'unknown';
              const titleCandidate =
                (typeof it.title === 'string' ? it.title :
                  (it.title?._text || it.title?.['#text'])) || it.identifier || 'Untitled';
              const ref = it.identifierref || null;
              const res = ref ? resourceMap.get(ref) : null;
              const href = it.href || it.launch || res?.href || undefined;
              const children = it.item ? mapItems(it.item) : [];
              const type = ref ? 'sco' : (children.length > 0 ? 'cluster' : 'asset');
              return {
                identifier,
                title: titleCandidate,
                type,
                href,
                items: children
              };
            });
          };

          const fallbackItems = mapItems(org?.item);
          const fallbackStructure = {
            title: org?.title || manifest?.identifier || 'Course',
            identifier: org?.identifier || 'course',
            items: fallbackItems
          };
          if (Array.isArray(fallbackStructure.items) && fallbackStructure.items.length > 0) {
            uiStructure = fallbackStructure;
          }
        } catch (_) {}
      }

      // FINAL SAFETY B: if still zero items and manifest has organizations but 0 organization nodes,
      // derive items from manifest.resources as launchable SCOs, using default org id for root naming if available.
      if (Array.isArray(uiStructure.items) && uiStructure.items.length === 0 && manifest?.organizations && !manifest?.organizations?.organization) {
        try {
          const resourceMap = buildResourceMap(manifest);
          const resourcesArr = Array.from(resourceMap.entries())
            .map(([id, v]) => ({ id, href: v.href, title: v.title }))
            .filter(r => !!r.href);

          if (resourcesArr.length > 0) {
            const makeTitleFromHref = (href) => {
              try {
                const parts = href.split(/[\\/]/);
                const file = parts[parts.length - 1] || href;
                return file;
              } catch {
                return href;
              }
            };
            const items = resourcesArr.map(res => ({
              identifier: res.id,
              title: res.title || makeTitleFromHref(res.href),
              type: 'sco',
              href: res.href,
              items: []
            }));
            uiStructure = {
              title: manifest?.organizations?.default || manifest?.identifier || 'Course',
              identifier: manifest?.organizations?.default || 'course',
              items
            };
          }
        } catch (_) {}
      }

      // Step 6: Create course data object
      const courseData = {
        info: {
          title: (manifest?.organizations?.organizations?.[0]?.title)
                 || manifest?.organizations?.organization?.title
                 || manifest?.identifier
                 || 'Course',
          version: manifest?.version,
          scormVersion: manifest?.metadata?.schemaversion || 'Unknown',
          hasManifest: true,
          manifestSize: manifestContent.length
        },
        structure: uiStructure,
        path: extractedPath,
        entryPoint: entryResult.resolvedPath,
        launchUrl: entryResult.url,
        originalFilePath: filePath,
        validation,
        analysis
      };

      // Diagnostic: log normalized structure stats prior to emitting
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        const itemCount = Array.isArray(courseData.structure?.items) ? courseData.structure.items.length : 0;

        // Shallow diagnostics about raw structure to guide normalization (INFO-level, compact)
        const rootKeys = rawStructure && typeof rawStructure === 'object' ? Object.keys(rawStructure).slice(0, 12) : [];
        const orgsType = rawStructure?.organizations
          ? (Array.isArray(rawStructure.organizations?.organizations) ? 'organizations[]'
             : Array.isArray(rawStructure.organizations?.organization) ? 'organization[]'
             : (rawStructure.organizations?.organization ? 'organization{}' : 'none'))
          : 'none';
        const childrenLen = Array.isArray(rawStructure?.children) ? rawStructure.children.length : 0;
        const itemsLen = Array.isArray(rawStructure?.items) ? rawStructure.items.length : 0;
        const itemLen = rawStructure?.item ? (Array.isArray(rawStructure.item) ? rawStructure.item.length : 1) : 0;

        // Include a tiny sample of first item for confirmation without overwhelming logs
        const firstItem = (Array.isArray(courseData.structure?.items) && courseData.structure.items.length > 0)
          ? courseData.structure.items[0]
          : null;
        const firstItemSample = firstItem ? {
          identifier: firstItem.identifier,
          title: firstItem.title,
          href: firstItem.href,
          type: firstItem.type,
          childCount: Array.isArray(firstItem.items) ? firstItem.items.length : 0
        } : null;

        // Manifest-centric metrics
        const manifestOrgCount = Array.isArray(courseData?.analysis?.manifest?.organizations?.organization)
          ? courseData.analysis.manifest.organizations.organization.length
          : (courseData?.analysis?.manifest?.organizations?.organization ? 1 : 0);
        const resourcesCount = Array.isArray(courseData?.analysis?.manifest?.resources?.resource)
          ? courseData.analysis.manifest.resources.resource.length
          : (courseData?.analysis?.manifest?.resources?.resource ? 1 : 0);

        rendererLogger.info('CourseLoader: normalized structure ready', {
          hasStructure: !!courseData.structure,
          hasItemsArray: Array.isArray(courseData.structure?.items),
          itemCount,
          sample: firstItemSample
        });
        rendererLogger.info('CourseLoader: rawStructure shallow shape', {
          rootKeys,
          orgsType,
          childrenLen,
          itemsLen,
          itemLen
        });
        rendererLogger.info('CourseLoader: manifest-derived metrics', {
          manifestOrgCount,
          resourcesCount,
          defaultOrg: courseData?.analysis?.manifest?.organizations?.default || null
        });
      } catch (_) {
        // ignore logging errors
      }

      // Step 7: Update application state
      this.currentCourse = courseData;
      const uiState = await uiStatePromise; // Await the promise
      uiState.updateCourse(courseData);

      // Emit course loaded event for UI components
      eventBus.emit('course:loaded', courseData);
      
      // console.log('CourseLoader: Course processing completed successfully!'); // Removed debug log
      
    } catch (error) {
      console.error('CourseLoader: Error in processCourseFile:', error);
      throw error;
    }
  }

  /**
   * Load course from File object (drag and drop support)
   */
  async loadCourse(file) {
    // console.log('CourseLoader: loadCourse called with file:', file.name); // Removed debug log
    
    try {
      this.setLoadingState(true);
      eventBus.emit('course:loadStart', { fileName: file.name });
      
      if (typeof window.electronAPI === 'undefined') {
        throw new Error('Electron API not available');
      }
      
      // Create temporary path for the file
      const tempPath = await this.createTempFileFromBlob(file);
      
      // Process the course file
      await this.processCourseFile(tempPath);
      
    } catch (error) {
      console.error('CourseLoader: Error in loadCourse:', error);
      eventBus.emit('course:loadError', { error: error.message });
      throw error;
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Create temporary file from File object
   * @param {File} file - File object from drag and drop
   * @returns {Promise<string>} Path to the temporary file
   */
  async createTempFileFromBlob(file) {
    try {
      if (!window.electronAPI || !window.electronAPI.saveTemporaryFile) {
        throw new Error('Electron API for saving temporary files not available');
      }

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      // Convert ArrayBuffer to Base64 string
      const base64Data = Buffer.from(arrayBuffer).toString('base64');

      const result = await window.electronAPI.saveTemporaryFile(file.name, base64Data);

      if (!result.success) {
        throw new Error(`Failed to save temporary file: ${result.error}`);
      }

      return result.path;
    } catch (error) {
      console.error('CourseLoader: Error creating temporary file from blob:', error);
      throw error;
    }
  }

  /**
   * Get current course data
   */
  getCurrentCourse() {
    return this.currentCourse;
  }

  /**
   * Check if course is currently loading
   */
  isLoading() {
    return this.loadingState;
  }

  /**
   * Set loading state and emit events
   */
  setLoadingState(loading) {
    this.loadingState = loading;
    eventBus.emit('course:loadingStateChanged', { loading });
  }

  /**
   * Clear current course
   */
  async clearCourse() {
    this.currentCourse = null;
    const uiState = await uiStatePromise;
    uiState.updateCourse({ info: null, structure: null, path: null, entryPoint: null });
    eventBus.emit('course:cleared');
  }

  /**
   * Validate course structure (now handled by CAM service in main process)
   */
  validateCourse(courseData) {
    // Basic client-side check, full validation is done by CAM service
    const errors = [];
    
    if (!courseData || !courseData.validation || !courseData.analysis) {
      errors.push('Course data, validation, or analysis is missing from CAM service result.');
      return errors;
    }
    
    if (!courseData.validation.valid) {
      errors.push('Course failed SCORM compliance validation.');
      errors.push(...courseData.validation.errors);
    }
    
    if (!courseData.entryPoint) {
      errors.push('Course entry point not found after CAM processing.');
    }
    
    if (!courseData.launchUrl) {
      errors.push('Course launch URL not found after CAM processing.');
    }
    
    return errors;
  }
}

// Create and export singleton instance
const courseLoader = new CourseLoader();

export { CourseLoader, courseLoader };