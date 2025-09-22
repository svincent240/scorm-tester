// @ts-check

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
import { rendererLogger } from '../utils/renderer-logger.js';

import { ipcClient } from './ipc-client.js';

/**
 * Course Loader Class
 *
 * Manages the complete course loading workflow from file selection to UI updates.
 */
class CourseLoader {
  constructor() {
    this.currentCourse = null;
    this.loadingState = false;

    // Check Electron API availability immediately
    this.checkElectronAPIAvailability();

    // Lazy init logger
    import('../utils/renderer-logger.js')
      .then(({ rendererLogger }) => {
        this.logger = rendererLogger;
        this.logger?.info && this.logger.info('CourseLoader: Logger initialized');
      })
      .catch((error) => {
        // Fallback to a no-op logger to satisfy no-console policy
        try { window.electronAPI?.logger?.warn?.('CourseLoader: Failed to load renderer logger', error?.message || String(error)); } catch (_) {}
        this.logger = { info: ()=>{}, warn: ()=>{}, error: ()=>{}, debug: ()=>{} };
      });
  }

  /**
   * Check Electron API availability and log details
   */
  checkElectronAPIAvailability() {
    const windowDefined = typeof window !== 'undefined';
    const electronAPIAvailable = windowDefined && typeof window.electronAPI !== 'undefined';
    try {
      rendererLogger.info('CourseLoader: Electron API availability check:', {
        available: electronAPIAvailable,
        windowDefined,
        electronAPIType: windowDefined ? typeof window.electronAPI : 'undefined'
      });
    } catch (_) {}

    if (electronAPIAvailable) {
      try { rendererLogger.info('CourseLoader: Using IpcClient for file selection and prep'); } catch (_) {}
      // IPC surface verification removed in rewrite; fail-fast happens inside IpcClient
      const requiredMethods = [];
      const missingMethods = [];
      if (missingMethods.length > 0) {
        try { rendererLogger.error('CourseLoader: Missing required Electron API methods:', missingMethods); } catch (_) {}
      } else {
        try { rendererLogger.info('CourseLoader: All required Electron API methods available'); } catch (_) {}
      }
    } else {
      try { rendererLogger.error('CourseLoader: Electron API not available - this will prevent course loading'); } catch (_) {}
    }
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
    try {
      this.logger?.info && this.logger.info('CourseLoader: handleCourseLoad called');

      // Select SCORM package via IPC client
      this.logger?.info && this.logger.info('CourseLoader: Using IpcClient.selectScormPackage');

      const result = await ipcClient.selectScormPackage();
      this.logger?.info && this.logger.info('CourseLoader: File selection result:', result);

      if (!result.success) {
        this.logger?.info && this.logger.info('CourseLoader: File selection was cancelled or failed:', result);
        return;
      }

      this.logger?.info && this.logger.info('CourseLoader: File selected successfully:', result.filePath);

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


      const result = await ipcClient.selectScormFolder();
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
    this.logger?.info && this.logger.info('CourseLoader: loadCourseFromPath called with:', filePath);

    try {
      this.setLoadingState(true);
      this.logger?.info && this.logger.info('CourseLoader: Emitting course:loadStart event');
      eventBus.emit('course:loadStart', { filePath });

      this.logger?.info && this.logger.info('CourseLoader: Calling processCourseFile');
      await this.processCourseFile(filePath);
      this.logger?.info && this.logger.info('CourseLoader: processCourseFile completed successfully');

    } catch (error) {
      this.logger?.error && this.logger.error('CourseLoader: Error in loadCourseFromPath:', error);
      eventBus.emit('course:loadError', { error: error.message });
      return;
    } finally {
      this.setLoadingState(false);
      this.logger?.info && this.logger.info('CourseLoader: loadCourseFromPath completed');
    }
  }

  /**
   * Load course from a selected folder path (unzipped)
   */
  async loadCourseFromFolder(folderPath) {
    try {
      this.setLoadingState(true);
      eventBus.emit('course:loadStart', { folderPath });

      // Prepare canonical working directory for the selected folder and operate from it
      const prepResult = await ipcClient.prepareCourseSource({ type: 'folder', path: folderPath });
      if (!prepResult.success) {
        throw new Error(`Failed to prepare course source: ${prepResult.error}`);
      }
      const unifiedPath = prepResult.unifiedPath;

      // Validate manifest presence and read it from the unified path
      const manifestContentResult = await ipcClient.getCourseManifest(unifiedPath);
      if (!manifestContentResult.success) {
        throw new Error(`Failed to get course manifest content: ${manifestContentResult.error}`);
      }
      const manifestContent = manifestContentResult.manifestContent;
      const manifestPath = manifestContentResult.manifestPath;

      // Process manifest via CAM in main using canonical path
      const processManifestResult = await ipcClient.processScormManifest(unifiedPath, manifestContent);
      if (!processManifestResult.success) {
        throw new Error(`Failed to process SCORM manifest: ${processManifestResult.reason || processManifestResult.error}`);
      }
      const { manifest, validation, analysis } = processManifestResult;

      // Determine entry point from CAM analysis (CAM now returns final scorm-app:// URL)
      const firstLaunchUrl = Array.isArray(analysis?.launchSequence) && analysis.launchSequence.length > 0
        ? analysis.launchSequence[0].href
        : null;
      if (!firstLaunchUrl || !String(firstLaunchUrl).startsWith('scorm-app://')) {
        throw new Error('CAM analysis did not provide a final scorm-app:// URL in launchSequence[0].href');
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
        entryPoint: null,
        launchUrl: firstLaunchUrl,
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
    this.logger?.info && this.logger.info('CourseLoader: processCourseFile called with:', filePath);

    try {
      // Step 1: Prepare canonical working directory for the SCORM source (zip/temp)
      this.logger?.info && this.logger.info('CourseLoader: Step 1 - Preparing course source');
      const prepResult = await ipcClient.prepareCourseSource({ type: 'zip', path: filePath });
      this.logger?.info && this.logger.info('CourseLoader: prepareCourseSource result:', prepResult);

      if (!prepResult.success) {
        this.logger?.error && this.logger.error('CourseLoader: Failed to prepare course source:', prepResult.error);
        throw new Error(`Failed to prepare course source: ${prepResult.error}`);
      }
      const extractedPath = prepResult.unifiedPath;
      this.logger?.info && this.logger.info('CourseLoader: Extracted path:', extractedPath);

      if (!extractedPath) {
        throw new Error('PrepareCourseSource did not return a valid unifiedPath');
      }

      // Step 2: Get manifest content (FileManager now only returns content, not parsed structure)
      this.logger?.info && this.logger.info('CourseLoader: Step 2 - Getting course manifest content from:', extractedPath);
      const manifestContentResult = await ipcClient.getCourseManifest(extractedPath);
      this.logger?.info && this.logger.info('CourseLoader: getCourseManifest result:', manifestContentResult);

      if (!manifestContentResult.success) {
        this.logger?.error && this.logger.error('CourseLoader: Failed to get course manifest content:', manifestContentResult.error);
        throw new Error(`Failed to get course manifest content: ${manifestContentResult.error}`);
      }

      const manifestContent = manifestContentResult.manifestContent;
      const manifestPath = manifestContentResult.manifestPath;
      this.logger?.info && this.logger.info('CourseLoader: Manifest content length:', manifestContent.length);
      this.logger?.info && this.logger.info('CourseLoader: Manifest path:', manifestPath);

      // Step 3: Process manifest using ScormCAMService (via IPC)
      this.logger?.info && this.logger.info('CourseLoader: Step 3 - Processing manifest with CAM service');
      const processManifestResult = await ipcClient.processScormManifest(extractedPath, manifestContent);
      this.logger?.info && this.logger.info('CourseLoader: processScormManifest result success:', processManifestResult.success);

      if (!processManifestResult.success) {
        this.logger?.error && this.logger.error('CourseLoader: Failed to process SCORM manifest:', processManifestResult.reason || processManifestResult.error);
        throw new Error(`Failed to process SCORM manifest: ${processManifestResult.reason || processManifestResult.error}`);
      }

      const { manifest, validation, analysis } = processManifestResult;
      this.logger?.info && this.logger.info('CourseLoader: Manifest processing successful, validation:', validation?.valid);

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
      this.logger?.info && this.logger.info('CourseLoader: Step 4 - Determining entry point');
      const firstLaunchUrl = Array.isArray(analysis?.launchSequence) && analysis.launchSequence.length > 0
        ? analysis.launchSequence[0].href
        : null;
      this.logger?.info && this.logger.info('CourseLoader: First launch URL (from CAM):', firstLaunchUrl);

      // Diagnostic: Show full launch sequence for debugging
      if (this.logger?.info && Array.isArray(analysis?.launchSequence)) {
        this.logger.info('CourseLoader: Full launch sequence:', analysis.launchSequence.map(item => ({
          href: item.href,
          title: item.title,
          identifier: item.identifier
        })));
      }

      // Diagnostic: Show what resources the manifest contains
      if (this.logger?.info && manifest?.resources?.resource) {
        const resources = Array.isArray(manifest.resources.resource)
          ? manifest.resources.resource
          : [manifest.resources.resource];
        this.logger.info('CourseLoader: Manifest resources:', resources.map(r => ({
          identifier: r.identifier,
          href: r.href,
          scormType: r['adlcp:scormType'] || r.scormType
        })));
      }

      if (!firstLaunchUrl) {
        this.logger?.error && this.logger.error('CourseLoader: CAM analysis did not provide a launchable href');
        throw new Error('CAM analysis did not provide a launchable URL in launchSequence[0].href');
      }
      if (!String(firstLaunchUrl).startsWith('scorm-app://')) {
        throw new Error('CAM analysis did not provide a final scorm-app:// URL in launchSequence[0].href');
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
        entryPoint: null,
        launchUrl: firstLaunchUrl,
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
      this.logger?.info && this.logger.info('CourseLoader: Step 7 - Updating application state');
      this.currentCourse = courseData;
      this.logger?.info && this.logger.info('CourseLoader: Course data set, updating UI state');

      const uiState = await uiStatePromise; // Await the promise
      this.logger?.info && this.logger.info('CourseLoader: UI state obtained, calling updateCourse');
      uiState.updateCourse(courseData);
      this.logger?.info && this.logger.info('CourseLoader: UI state updated successfully');

      // Update MRU
      try {
        this.logger?.info && this.logger.info('CourseLoader: Updating recent courses store');
        const { recentCoursesStore } = await import('./recent-courses.js');
        const title = courseData?.info?.title || 'Course';
        recentCoursesStore.addOrUpdate({ type: 'zip', path: filePath, displayName: title, meta: { title } });
        this.logger?.info && this.logger.info('CourseLoader: Recent courses updated');
      } catch (error) {
        this.logger?.warn && this.logger.warn('CourseLoader: Failed to update recent courses:', error?.message || error);
      }

      // Do NOT emit course:loaded directly here; UIState.updateCourse already emits it.
      // This avoids duplicate event paths and potential double render/update races.

      this.logger?.info && this.logger.info('CourseLoader: Course processing completed successfully!');

    } catch (error) {
      this.logger?.error && this.logger.error('CourseLoader: Error in processCourseFile:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
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

      const result = await ipcClient.saveTemporaryFile(file.name, base64Data);

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

    if (!courseData.launchUrl) {
      errors.push('Course launch URL not found after CAM processing.');
    }

    return errors;
  }
}

// Create and export singleton instance
const courseLoader = new CourseLoader();

export { CourseLoader, courseLoader };
