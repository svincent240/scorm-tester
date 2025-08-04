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
    console.log('CourseLoader: handleCourseLoad called');
    
    try {
      // Check if electronAPI is available
      if (typeof window.electronAPI === 'undefined') {
        throw new Error('Electron API not available');
      }

      // DIAGNOSTIC: Log available API functions
      console.log('CourseLoader: Available electronAPI functions:', Object.keys(window.electronAPI));
      console.log('CourseLoader: Looking for selectScormFile function:', typeof window.electronAPI.selectScormFile);
      console.log('CourseLoader: Available selectScormPackage function:', typeof window.electronAPI.selectScormPackage);

      // Show file selection dialog - FIX: Use correct function name
      const result = await window.electronAPI.selectScormPackage();
      console.log('CourseLoader: File selection result:', result);
      
      if (!result.success) {
        console.log('CourseLoader: File selection was cancelled or failed:', result);
        return;
      }
      
      console.log('CourseLoader: File selected successfully:', result.filePath);
      
      // Process the selected course file
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
    console.log('CourseLoader: loadCourseFromPath called with:', filePath);
    
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
    console.log('CourseLoader: processCourseFile called with:', filePath);
    
    try {
      // Step 1: Extract the SCORM package
      console.log('CourseLoader: Step 1 - Extracting SCORM package...');
      const extractResult = await window.electronAPI.extractScorm(filePath);
      console.log('CourseLoader: Extract result:', extractResult);
      
      // DIAGNOSTIC: Log extract result properties
      console.log('CourseLoader: Extract result keys:', Object.keys(extractResult));
      console.log('CourseLoader: Extract result.success:', extractResult.success);
      console.log('CourseLoader: Extract result.extractedPath:', extractResult.extractedPath);
      console.log('CourseLoader: Extract result.extractionPath:', extractResult.extractionPath);
      console.log('CourseLoader: Extract result.path:', extractResult.path);
      
      if (!extractResult.success) {
        throw new Error(`Failed to extract SCORM package: ${extractResult.error}`);
      }
      
      // FIX: Use the correct property name from the extract result
      const extractedPath = extractResult.extractedPath || extractResult.extractionPath || extractResult.path;
      console.log('CourseLoader: Using extractedPath:', extractedPath);
      
      if (!extractedPath) {
        throw new Error('Extract result did not contain a valid path property');
      }
      
      // Step 2: Get entry point
      console.log('CourseLoader: Step 2 - Getting entry point...');
      
      // DIAGNOSTIC: Log available entry point functions
      console.log('CourseLoader: Looking for getCourseEntryPoint function:', typeof window.electronAPI.getCourseEntryPoint);
      console.log('CourseLoader: Available findScormEntry function:', typeof window.electronAPI.findScormEntry);
      
      // FIX: Use correct function name
      const entryResult = await window.electronAPI.findScormEntry(extractedPath);
      console.log('CourseLoader: Entry result:', entryResult);
      
      if (!entryResult.success) {
        throw new Error(`Failed to get course entry point: ${entryResult.error}`);
      }
      
      // Step 3: Get course info
      console.log('CourseLoader: Step 3 - Getting course info...');
      const courseInfo = await window.electronAPI.getCourseInfo(extractedPath);
      console.log('CourseLoader: Course info:', courseInfo);
      
      // Step 4: Get course manifest
      console.log('CourseLoader: Step 4 - Getting course manifest...');
      const manifestResult = await window.electronAPI.getCourseManifest(extractedPath);
      console.log('CourseLoader: Manifest result:', manifestResult);
      
      // Step 5: Create course data object
      const courseData = {
        info: courseInfo,
        structure: manifestResult.success ? manifestResult.structure : null,
        path: extractedPath,
        entryPoint: entryResult.entryPath,
        launchUrl: entryResult.launchUrl,
        originalFilePath: filePath
      };
      
      // Step 6: Update application state
      this.currentCourse = courseData;
      uiState.updateCourse(courseData);
      
      // Step 7: Emit course loaded event
      eventBus.emit('course:loaded', courseData);
      
      console.log('CourseLoader: Course processing completed successfully!');
      
    } catch (error) {
      console.error('CourseLoader: Error in processCourseFile:', error);
      throw error;
    }
  }

  /**
   * Load course from File object (drag and drop support)
   */
  async loadCourse(file) {
    console.log('CourseLoader: loadCourse called with file:', file.name);
    
    try {
      this.setLoadingState(true);
      eventBus.emit('course:loadStart', { fileName: file.name });
      
      // Check if electronAPI is available
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
   * Validate course structure
   */
  validateCourse(courseData) {
    const errors = [];
    
    if (!courseData) {
      errors.push('Course data is missing');
      return errors;
    }
    
    if (!courseData.entryPoint) {
      errors.push('Course entry point not found');
    }
    
    if (!courseData.launchUrl) {
      errors.push('Course launch URL not found');
    }
    
    if (!courseData.info) {
      errors.push('Course info not found');
    }
    
    return errors;
  }
}

// Create and export singleton instance
const courseLoader = new CourseLoader();

export { CourseLoader, courseLoader };