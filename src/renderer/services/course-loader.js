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

    // Lazy init logger
    import('../utils/renderer-logger.js')
      .then(({ rendererLogger }) => { this.logger = rendererLogger; })
      .catch(() => { this.logger = { info: ()=>{}, warn: ()=>{}, error: ()=>{}, debug: ()=>{} }; });
  }
/**
   * Convert an ArrayBuffer to a Base64 string in a browser-safe way.
   * Kept small and defensive to avoid referencing Node Buffer in the renderer.
   */
  arrayBufferToBase64(buf) {
    try {
      let binary = '';
      const bytes = new Uint8Array(buf);
      // Chunk to avoid call stack / argument length limits on large files
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        // Array.from ensures apply receives a proper array in environments where typed arrays can't be used directly
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      // btoa is available in browser renderer contexts
      return btoa(binary);
    } catch (_) {
      return '';
    }
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
      this.logger?.error && this.logger.error('CourseLoader: Error in handleCourseLoad:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
    }
  }

  /**
   * Select a SCORM folder and load it (unzipped flow)
   */
  async handleFolderLoad() {
    try {
      if (typeof window.electronAPI === 'undefined') {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.selectScormFolder();
      if (!result || !result.success) {
        return; // cancelled or failed; errors already logged in main
      }

      await this.loadCourseFromFolder(result.folderPath);
    } catch (error) {
      this.logger?.error && this.logger.error('CourseLoader: Error in handleFolderLoad:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
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
      this.logger?.error && this.logger.error('CourseLoader: Error in loadCourseFromPath:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Load course from a selected folder path (unzipped)
   */
  async loadCourseFromFolder(folderPath) {
    try {
      this.setLoadingState(true);
      eventBus.emit('course:loadStart', { folderPath });

      if (typeof window.electronAPI === 'undefined') {
        throw new Error('Electron API not available');
      }

      // Prepare canonical working directory for the selected folder and operate from it
      const prepResult = await window.electronAPI.pathUtils.prepareCourseSource({ type: 'folder', path: folderPath });
      if (!prepResult.success) {
        throw new Error(`Failed to prepare course source: ${prepResult.error}`);
      }
      const unifiedPath = prepResult.unifiedPath;
  
      // Validate manifest presence and read it from the unified path
      const manifestContentResult = await window.electronAPI.getCourseManifest(unifiedPath);
      if (!manifestContentResult.success) {
        throw new Error(`Failed to get course manifest content: ${manifestContentResult.error}`);
      }
      const manifestContent = manifestContentResult.manifestContent;
  
      // Process manifest via CAM in main using canonical path
      const processManifestResult = await window.electronAPI.processScormManifest(unifiedPath, manifestContent);
      if (!processManifestResult.success) {
        throw new Error(`Failed to process SCORM manifest: ${processManifestResult.reason || processManifestResult.error}`);
      }
      const { manifest, validation, analysis } = processManifestResult;
  
      // Determine entry point from CAM analysis
      const firstLaunchHref = Array.isArray(analysis?.launchSequence) && analysis.launchSequence.length > 0
        ? analysis.launchSequence[0].href
        : null;
      if (!firstLaunchHref) {
        throw new Error('CAM analysis did not provide a launchable href in launchSequence[0].href');
      }
  
      // Resolve the launch href against the canonical unified path
      const entryResult = await window.electronAPI.pathUtils.resolveScormUrl(firstLaunchHref, unifiedPath);
      if (!entryResult.success) {
        throw new Error(`Failed to resolve SCORM entry URL: ${entryResult.error}`);
      }

      // Build UI structure as passthrough of uiOutline
      const uiOutline = Array.isArray(analysis?.uiOutline) ? analysis.uiOutline : [];
      const orgsCanon = Array.isArray(manifest?.organizations?.organization)
        ? manifest.organizations.organization
        : (manifest?.organizations?.organization ? [manifest.organizations.organization] : []);
      const defaultOrgId = manifest?.organizations?.default || null;
      const pickedOrg = defaultOrgId
        ? (orgsCanon.find(o => o?.identifier === defaultOrgId) || orgsCanon[0] || null)
        : (orgsCanon[0] || null);

      const rootTitle = pickedOrg?.title || manifest?.identifier || 'Course';
      const rootId = pickedOrg?.identifier || manifest?.identifier || 'course';

      const passthroughNode = (n) => ({
        identifier: n?.identifier || n?.id || n?.identifierref || `node_${Math.random().toString(36).slice(2,10)}`,
        title: (typeof n?.title === 'string' && n.title.trim()) ? n.title.trim() : (n?.identifier || 'Untitled'),
        type: n?.type || (n?.identifierref ? 'sco' : (Array.isArray(n?.items) && n.items.length > 0 ? 'cluster' : 'asset')),
        href: n?.href,
        items: Array.isArray(n?.items) ? n.items.map(passthroughNode) : []
      });

      const uiStructure = {
        title: rootTitle,
        identifier: rootId,
        items: uiOutline.map(passthroughNode)
      };

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
        path: folderPath,
        entryPoint: entryResult.resolvedPath,
        launchUrl: entryResult.url,
        originalFilePath: null,
        validation,
        analysis
      };
  
      this.currentCourse = courseData;
      const uiState = await uiStatePromise;
      uiState.updateCourse(courseData);
      // Update MRU
      try {
        const { recentCoursesStore } = await import('./recent-courses.js');
        const title = courseData?.info?.title || 'Course';
        recentCoursesStore.addOrUpdate({ type: 'folder', path: folderPath, displayName: title, meta: { title } });
      } catch (_) { /* no-op */ }
    } catch (error) {
      this.logger?.error && this.logger.error('CourseLoader: Error in loadCourseFromFolder:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Load by source descriptor
   * @param {{type:'zip'|'folder', path:string}} source
   */
  async loadCourseBySource(source) {
    if (!source || !source.type || !source.path) {
      throw new Error('Invalid source descriptor');
    }
    if (source.type === 'zip') {
      await this.loadCourseFromPath(source.path);
    } else if (source.type === 'folder') {
      await this.loadCourseFromFolder(source.path);
    } else {
      throw new Error(`Unknown source type: ${source.type}`);
    }
  }

  /**
   * Process SCORM course file through complete workflow
   */
  async processCourseFile(filePath) {
    // console.log('CourseLoader: processCourseFile called with:', filePath); // Removed debug log
    
    try {
      // Step 1: Prepare canonical working directory for the SCORM source (zip/temp)
      const prepResult = await window.electronAPI.pathUtils.prepareCourseSource({ type: 'zip', path: filePath });
      if (!prepResult.success) {
        throw new Error(`Failed to prepare course source: ${prepResult.error}`);
      }
      const extractedPath = prepResult.unifiedPath;
  
      if (!extractedPath) {
        throw new Error('PrepareCourseSource did not return a valid unifiedPath');
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

      // Prefer CAM-provided uiOutline if available AND manifest has organizations
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        const uiOutline = Array.isArray(analysis?.uiOutline) ? analysis.uiOutline : null;
        const orgCountDiag = Array.isArray(analysis?.manifest?.organizations?.organization)
          ? analysis.manifest.organizations.organization.length
          : (analysis?.manifest?.organizations?.organization ? 1 : 0);
        if (uiOutline && uiOutline.length > 0 && orgCountDiag > 0) {
          rendererLogger.info('CourseLoader: using CAM-provided uiOutline (organizations present)', {
            count: uiOutline.length,
            orgCount: orgCountDiag,
            sample: { identifier: uiOutline[0]?.identifier, title: uiOutline[0]?.title, href: uiOutline[0]?.href, type: uiOutline[0]?.type }
          });
        } else if (uiOutline && uiOutline.length > 0) {
          rendererLogger.info('CourseLoader: CAM uiOutline present but organizations missing; will still normalize from uiOutline', { count: uiOutline.length, orgCount: orgCountDiag });
        } else {
          rendererLogger.info('CourseLoader: CAM-provided uiOutline not present; falling back to renderer normalization');
        }
      } catch (_) {}

      // Step 4: Determine entry point from processed manifest (single-source from CAM)
      const firstLaunchHref = Array.isArray(analysis?.launchSequence) && analysis.launchSequence.length > 0
        ? analysis.launchSequence[0].href
        : null;
      if (!firstLaunchHref) {
        throw new Error('CAM analysis did not provide a launchable href in launchSequence[0].href');
      }
      // Resolve the launch href against the canonical extraction path
      const entryResult = await window.electronAPI.pathUtils.resolveScormUrl(firstLaunchHref, extractedPath);
      if (!entryResult.success) {
        throw new Error(`Failed to resolve SCORM entry URL: ${entryResult.error}`);
      }

      // Step 5: Build UI structure as a pure passthrough of CAM uiOutline under default-org root.
      // No renderer normalization, no fallback builders, no manifest conversions.
      const uiOutline = Array.isArray(analysis?.uiOutline) ? analysis.uiOutline : [];
      const orgsCanon = Array.isArray(manifest?.organizations?.organization)
        ? manifest.organizations.organization
        : (manifest?.organizations?.organization ? [manifest.organizations.organization] : []);
      const defaultOrgId = manifest?.organizations?.default || null;
      const pickedOrg = defaultOrgId
        ? (orgsCanon.find(o => o?.identifier === defaultOrgId) || orgsCanon[0] || null)
        : (orgsCanon[0] || null);

      const rootTitle = pickedOrg?.title || manifest?.identifier || 'Course';
      const rootId = pickedOrg?.identifier || manifest?.identifier || 'course';

      const passthroughNode = (n) => ({
        identifier: n?.identifier || n?.id || n?.identifierref || `node_${Math.random().toString(36).slice(2,10)}`,
        title: (typeof n?.title === 'string' && n.title.trim()) ? n.title.trim() : (n?.identifier || 'Untitled'),
        type: n?.type || (n?.identifierref ? 'sco' : (Array.isArray(n?.items) && n.items.length > 0 ? 'cluster' : 'asset')),
        href: n?.href,
        items: Array.isArray(n?.items) ? n.items.map(passthroughNode) : []
      });

      const uiStructure = {
        title: rootTitle,
        identifier: rootId,
        items: uiOutline.map(passthroughNode)
      };

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

        // Shallow diagnostics about analysis structure (INFO-level, compact)
        const analysisStructure = analysis?.structure;
        const rootKeys = analysisStructure && typeof analysisStructure === 'object' ? Object.keys(analysisStructure).slice(0, 12) : [];
        const orgsType = analysisStructure?.organizations
          ? (Array.isArray(analysisStructure.organizations?.organizations) ? 'organizations[]'
             : Array.isArray(analysisStructure.organizations?.organization) ? 'organization[]'
             : (analysisStructure.organizations?.organization ? 'organization{}' : 'none'))
          : 'none';
        const childrenLen = Array.isArray(analysisStructure?.children) ? analysisStructure.children.length : 0;
        const itemsLen = Array.isArray(analysisStructure?.items) ? analysisStructure.items.length : 0;
        const itemLen = analysisStructure?.item ? (Array.isArray(analysisStructure.item) ? analysisStructure.item.length : 1) : 0;

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
        rendererLogger.info('CourseLoader: analysis structure shallow shape', {
          rootKeys,
          orgsType,
          childrenLen,
          itemsLen,
          itemLen
        });
        // Ensure metrics reflect normalized manifest from CAM, not any post-fallback mutation
        rendererLogger.info('CourseLoader: manifest-derived metrics', {
          manifestOrgCount,
          resourcesCount,
          defaultOrg: courseData?.analysis?.manifest?.organizations?.default || null
        });
      } catch (_) {
        // ignore logging errors
      }

      // Additional diagnostics: capture top-level identifiers to detect duplication before publishing
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        const topIds = Array.isArray(courseData?.structure?.items)
          ? courseData.structure.items.slice(0, 24).map(n => n?.identifier || 'unknown')
          : [];
        rendererLogger.info('CourseLoader: uiStructure top-level IDs', { count: topIds.length, ids: topIds });
      } catch (_) {}

      // Step 7: Update application state
      this.currentCourse = courseData;
      const uiState = await uiStatePromise; // Await the promise
      uiState.updateCourse(courseData);
      // Update MRU
      try {
        const { recentCoursesStore } = await import('./recent-courses.js');
        const title = courseData?.info?.title || 'Course';
        recentCoursesStore.addOrUpdate({ type: 'zip', path: filePath, displayName: title, meta: { title } });
      } catch (_) { /* no-op */ }
  
      // Do NOT emit course:loaded directly here; UIState.updateCourse already emits it.
      // This avoids duplicate event paths and potential double render/update races.
  
      // console.log('CourseLoader: Course processing completed successfully!'); // Removed debug log

    } catch (error) {
      this.logger?.error && this.logger.error('CourseLoader: Error in processCourseFile:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
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
      this.logger?.error && this.logger.error('CourseLoader: Error in loadCourse:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
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
      // Convert ArrayBuffer to Base64 string (browser-safe helper)
      const base64Data = this.arrayBufferToBase64(arrayBuffer);

      const result = await window.electronAPI.saveTemporaryFile(file.name, base64Data);

      if (!result.success) {
        throw new Error(`Failed to save temporary file: ${result.error}`);
      }

      return result.path;
    } catch (error) {
      this.logger?.error && this.logger.error('CourseLoader: Error creating temporary file from blob:', error);
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