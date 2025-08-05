/**
 * Course Loading Service
 * 
 * Handles SCORM course file selection, extraction, processing, and validation.
 * Provides clean separation of course loading logic from UI components.
 * 
 * @fileoverview Course loading and processing service
 */

import { eventBus } from './event-bus.js';
import { uiState } from './ui-state.js';

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
      
      // Step 4: Determine entry point from processed manifest
      // console.log('CourseLoader: Step 4 - Determining entry point...'); // Removed debug log
      const entryResult = await window.electronAPI.pathUtils.resolveScormUrl(analysis.launchSequence[0].href, extractedPath); // Assuming first SCO in launch sequence is entry
      
      if (!entryResult.success) {
        throw new Error(`Failed to resolve SCORM entry URL: ${entryResult.error}`);
      }
      
      // Step 5: Create course data object
      const courseData = {
        info: {
          title: manifest.organizations.organizations[0].title || manifest.identifier, // Use parsed title
          version: manifest.version,
          scormVersion: manifest.metadata?.schemaversion || 'Unknown',
          hasManifest: true,
          manifestSize: manifestContent.length // Use actual size
        },
        structure: analysis.structure, // Use detailed structure from CAM
        path: extractedPath,
        entryPoint: entryResult.resolvedPath,
        launchUrl: entryResult.url,
        originalFilePath: filePath,
        validation: validation, // Include full validation report
        analysis: analysis // Include full analysis report
      };
      
      // Step 6: Update application state
      this.currentCourse = courseData;
      uiState.updateCourse(courseData);
      
      // Step 7: Emit course loaded event
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
   */
  async createTempFileFromBlob(file) {
    // This would typically use electron's file system APIs
    // For now, we'll assume the file path is handled by the caller
    throw new Error('Drag and drop file loading not yet implemented');
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
  clearCourse() {
    this.currentCourse = null;
    uiState.clearCourse();
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