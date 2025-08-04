/**
 * Application Manager
 * 
 * Main application orchestrator that manages services, components, and lifecycle.
 * Provides clean separation of concerns and centralized application management.
 * 
 * @fileoverview Main application management service
 */

import { eventBus } from './event-bus.js';
import { uiState } from './ui-state.js';
import { scormClient } from './scorm-client.js';
import { scormAPIBridge } from './scorm-api-bridge.js';
import { courseLoader } from './course-loader.js';

import { BaseComponent } from '../components/base-component.js';
import { ContentViewer } from '../components/scorm/content-viewer.js';
import { NavigationControls } from '../components/scorm/navigation-controls.js';
import { ProgressTracking } from '../components/scorm/progress-tracking.js';
import { DebugPanel } from '../components/scorm/debug-panel.js';
import { CourseOutline } from '../components/scorm/course-outline.js';

/**
 * Application Manager Class
 * 
 * Orchestrates the entire application lifecycle and component interactions.
 */
class AppManager {
  constructor() {
    this.services = new Map();
    this.components = new Map();
    this.initialized = false;
    this.setupErrorHandlers();
  }

  /**
   * Initialize the application
   */
  async initialize() {
    console.log('AppManager: Starting application initialization...');
    
    try {
      // Step 1: Initialize services
      await this.initializeServices();
      
      // Step 2: Initialize components
      await this.initializeComponents();
      
      // Step 3: Setup event listeners
      this.setupEventHandlers();
      
      // Step 4: Setup UI event listeners
      this.setupUIEventListeners();
      
      this.initialized = true;
      console.log('AppManager: Application initialized successfully');
      
      // Emit initialization complete event
      eventBus.emit('app:initialized');
      
    } catch (error) {
      console.error('AppManager: Failed to initialize application:', error);
      this.handleInitializationError(error);
      throw error;
    }
  }

  /**
   * Initialize all services
   */
  async initializeServices() {
    console.log('AppManager: Initializing services...');
    
    // Register services
    this.services.set('eventBus', eventBus);
    this.services.set('uiState', uiState);
    this.services.set('scormClient', scormClient);
    this.services.set('scormAPIBridge', scormAPIBridge);
    this.services.set('courseLoader', courseLoader);
    
    // Initialize SCORM client if needed
    if (!scormClient.getInitialized()) {
      // Note: ScormClient doesn't have an initialize() method - it initializes via Initialize()
      // We'll skip this for now as SCORM initialization happens when content is loaded
      console.log('AppManager: SCORM client not initialized, will initialize when content loads');
    }
    
    console.log('AppManager: Services initialized');
  }

  /**
   * Initialize all components
   */
  async initializeComponents() {
    console.log('AppManager: Initializing components...');
    
    try {
      // Initialize components with proper error handling
      const componentConfig = {
        contentViewer: { elementId: 'content-frame', service: 'contentViewer' },
        navigationControls: { elementId: 'navigation-controls', service: 'navigationControls' },
        progressTracking: { elementId: 'progress-tracking', service: 'progressTracking' },
        debugPanel: { elementId: 'debug-panel', service: 'debugPanel' },
        courseOutline: { elementId: 'course-outline', service: 'courseOutline' }
      };

      // Content Viewer
      if (document.getElementById(componentConfig.contentViewer.elementId)) {
        const contentViewer = new ContentViewer();
        await contentViewer.initialize();
        this.components.set('contentViewer', contentViewer);
        console.log('AppManager: ContentViewer initialized');
      }

      // Navigation Controls
      if (document.getElementById(componentConfig.navigationControls.elementId)) {
        const navigationControls = new NavigationControls();
        await navigationControls.initialize();
        this.components.set('navigationControls', navigationControls);
        console.log('AppManager: NavigationControls initialized');
      }

      // Progress Tracking
      if (document.getElementById(componentConfig.progressTracking.elementId)) {
        const progressTracking = new ProgressTracking();
        await progressTracking.initialize();
        this.components.set('progressTracking', progressTracking);
        console.log('AppManager: ProgressTracking initialized');
      }

      // Debug Panel
      if (document.getElementById(componentConfig.debugPanel.elementId)) {
        const debugPanel = new DebugPanel();
        await debugPanel.initialize();
        this.components.set('debugPanel', debugPanel);
        console.log('AppManager: DebugPanel initialized');
      }

      // Course Outline
      if (document.getElementById(componentConfig.courseOutline.elementId)) {
        const courseOutline = new CourseOutline();
        await courseOutline.initialize();
        this.components.set('courseOutline', courseOutline);
        console.log('AppManager: CourseOutline initialized');
      }

      console.log('AppManager: All components initialized');
      
    } catch (error) {
      console.error('AppManager: Error initializing components:', error);
      throw error;
    }
  }

  /**
   * Setup application event handlers
   */
  setupEventHandlers() {
    console.log('AppManager: Setting up event handlers...');
    
    // Course loading events
    eventBus.on('course:loaded', (courseData) => {
      console.log('AppManager: Course loaded event received');
      this.handleCourseLoaded(courseData);
    });

    eventBus.on('course:loadError', (errorData) => {
      console.error('AppManager: Course load error:', errorData.error);
      this.showError('Course Loading Error', errorData.error);
    });

    eventBus.on('course:loadingStateChanged', (stateData) => {
      if (stateData.loading) {
        this.showLoading('Loading course...');
      } else {
        this.hideLoading();
      }
    });

    // SCORM events
    eventBus.on('scorm:dataChanged', (data) => {
      console.log('AppManager: SCORM data changed:', data);
    });

    eventBus.on('scorm:error', (errorData) => {
      console.error('AppManager: SCORM error:', errorData);
    });

    console.log('AppManager: Event handlers setup complete');
  }

  /**
   * Setup UI event listeners
   */
  setupUIEventListeners() {
    console.log('AppManager: Setting up UI event listeners...');
    
    // Course load button
    const courseLoadBtn = document.getElementById('course-load-btn');
    if (courseLoadBtn) {
      courseLoadBtn.addEventListener('click', () => {
        courseLoader.handleCourseLoad().catch(error => {
          console.error('AppManager: Course load error:', error);
        });
      });
      console.log('AppManager: Course load button listener attached');
    }

    // Welcome page buttons
    const welcomeButtons = document.querySelectorAll('button[onclick*="course-load-btn"]');
    welcomeButtons.forEach((btn, index) => {
      btn.onclick = null; // Remove inline onclick
      btn.addEventListener('click', () => {
        courseLoader.handleCourseLoad().catch(error => {
          console.error('AppManager: Course load error from welcome button:', error);
        });
      });
      console.log(`AppManager: Welcome button ${index + 1} listener attached`);
    });

    console.log('AppManager: UI event listeners setup complete');
  }

  /**
   * Handle course loaded event
   */
  handleCourseLoaded(courseData) {
    console.log('AppManager: Handling course loaded:', courseData);
    
    try {
      // Update components with course data
      const contentViewer = this.components.get('contentViewer');
      if (contentViewer && courseData.launchUrl) {
        contentViewer.loadContent(courseData.launchUrl);
      }

      // Update course outline
      const courseOutline = this.components.get('courseOutline');
      if (courseOutline) {
        courseOutline.updateWithCourse(courseData);
      }

      // Show success message
      this.showSuccess('Course Loaded', `Successfully loaded: ${courseData.info?.title || 'Course'}`);
      
    } catch (error) {
      console.error('AppManager: Error handling course loaded:', error);
    }
  }

  /**
   * Setup error handlers
   */
  setupErrorHandlers() {
    // Global error handler
    window.addEventListener('error', (event) => {
      console.error('AppManager: Global error detected:', event.error);
      console.error('AppManager: Error source:', event.filename, 'line:', event.lineno);
    });

    // Unhandled promise rejection handler  
    window.addEventListener('unhandledrejection', (event) => {
      console.error('AppManager: Unhandled promise rejection:', event.reason);
    });
  }

  /**
   * Handle initialization errors
   */
  handleInitializationError(error) {
    console.error('AppManager: Initialization error:', error);
    
    // Show error to user
    const errorElement = document.getElementById('app-error');
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.innerHTML = `
        <h3>Application Initialization Error</h3>
        <p>Failed to initialize the application: ${error.message}</p>
        <button onclick="location.reload()">Reload Application</button>
      `;
    }
  }

  /**
   * Show loading state
   */
  showLoading(message = 'Loading...') {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
      loadingElement.querySelector('.loading-message').textContent = message;
      loadingElement.style.display = 'flex';
    }
  }

  /**
   * Hide loading state
   */
  hideLoading() {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }
  }

  /**
   * Show error message
   */
  showError(title, message) {
    console.error(`AppManager: ${title}:`, message);
    // In a real implementation, this would show a proper error dialog
    alert(`${title}: ${message}`);
  }

  /**
   * Show success message
   */
  showSuccess(title, message) {
    console.log(`AppManager: ${title}:`, message);
    // In a real implementation, this would show a proper success notification
  }

  /**
   * Get service instance
   */
  getService(name) {
    return this.services.get(name);
  }

  /**
   * Get component instance
   */
  getComponent(name) {
    return this.components.get(name);
  }

  /**
   * Check if application is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Shutdown the application
   */
  async shutdown() {
    console.log('AppManager: Shutting down application...');
    
    try {
      // Cleanup components
      for (const component of this.components.values()) {
        if (component.destroy) {
          await component.destroy();
        }
      }
      
      // Cleanup services
      eventBus.destroy();
      
      this.initialized = false;
      console.log('AppManager: Application shutdown complete');
      
    } catch (error) {
      console.error('AppManager: Error during shutdown:', error);
    }
  }
}

// Create and export singleton instance
const appManager = new AppManager();

export { AppManager, appManager };