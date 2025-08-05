/**
 * Application Manager
 * 
 * Main application orchestrator that manages services, components, and lifecycle.
 * Provides clean separation of concerns and centralized application management.
 * 
 * @fileoverview Main application management service
 */

import { eventBus } from './event-bus.js';
import { uiState as uiStatePromise } from './ui-state.js';
import { scormClient } from './scorm-client.js';
import { scormAPIBridge } from './scorm-api-bridge.js';
import { courseLoader } from './course-loader.js';

import { BaseComponent } from '../components/base-component.js';
import { ContentViewer } from '../components/scorm/content-viewer.js';
import { NavigationControls } from '../components/scorm/navigation-controls.js';
import { ProgressTracking } from '../components/scorm/progress-tracking.js';
import { CourseOutline } from '../components/scorm/course-outline.js';
import { FooterProgressBar } from '../components/scorm/footer-progress-bar.js';
import { FooterStatusDisplay } from '../components/scorm/footer-status-display.js';

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
    // console.log('AppManager: Starting application initialization...'); // Removed debug log
    
    try {
      this.uiState = await uiStatePromise; // Resolve the promise
      console.log('DEBUG: AppManager - uiState resolved:', this.uiState);
      scormClient.setUiState(this.uiState); // Pass resolved uiState to scormClient
      // Step 1: Initialize services
      await this.initializeServices();
      
      // Step 2: Initialize components
      await this.initializeComponents();
      
      // Step 3: Setup event listeners
      this.setupEventHandlers();
      
      // Step 4: Setup UI event listeners
      this.setupUIEventListeners();
      
      this.initialized = true;
      // console.log('AppManager: Application initialized successfully'); // Removed debug log
      
      // Clear any persistent loading states from previous sessions
      this.hideLoading();
      console.log('DEBUG: AppManager - uiState before setLoading(false):', this.uiState);
      this.uiState.setLoading(false); // Use the resolved instance
      
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
    // console.log('AppManager: Initializing services...'); // Removed debug log
    
    // Register services
    this.services.set('eventBus', eventBus);
    this.services.set('uiState', this.uiState); // Use the resolved instance
    this.services.set('scormClient', scormClient);
    this.services.set('scormAPIBridge', scormAPIBridge);
    this.services.set('courseLoader', courseLoader);
    
    // Initialize SCORM client if needed
    if (!scormClient.getInitialized()) {
      // Note: ScormClient doesn't have an initialize() method - it initializes via Initialize()
      // We'll skip this for now as SCORM initialization happens when content is loaded
      // console.log('AppManager: SCORM client not initialized, will initialize when content loads'); // Removed debug log
    }
    
    // console.log('AppManager: Services initialized'); // Removed debug log
  }

  /**
   * Initialize all components
   */
  async initializeComponents() {
    console.log('AppManager: Initializing components...');
    
    const componentConfigs = [
      { name: 'contentViewer', class: ContentViewer, elementId: 'content-viewer', required: true },
      { name: 'navigationControls', class: NavigationControls, elementId: 'navigation-controls', required: true },
      { name: 'progressTracking', class: ProgressTracking, elementId: 'progress-tracking', required: true },
      { name: 'footerProgressBar', class: FooterProgressBar, elementId: 'app-footer', required: true },
      { name: 'footerStatusDisplay', class: FooterStatusDisplay, elementId: 'app-footer', required: true },
      { name: 'courseOutline', class: CourseOutline, elementId: 'course-outline', required: true }
    ];

    try {
      for (const config of componentConfigs) {
        const element = document.getElementById(config.elementId);
        if (element) {
          const componentInstance = new config.class(config.elementId);
          await componentInstance.initialize();
          this.components.set(config.name, componentInstance);
          console.log(`AppManager: ${config.name} initialized`);
        } else {
          if (config.required) {
            throw new Error(`Required UI element '${config.elementId}' for component '${config.name}' not found in DOM.`);
          } else {
            console.debug(`AppManager: Optional UI element '${config.elementId}' for component '${config.name}' not found in DOM. Skipping initialization.`);
          }
        }
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
    // console.log('AppManager: Setting up event handlers...'); // Removed debug log
    
    // Course loading events
    eventBus.on('course:loaded', (courseData) => {
      // console.log('AppManager: Course loaded event received'); // Removed debug log
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
      // console.log('AppManager: SCORM data changed:', data); // Removed debug log
    });
 
    eventBus.on('scorm:error', (errorData) => {
      console.error('AppManager: SCORM error:', JSON.stringify(errorData, null, 2));
      console.error('AppManager: SCORM error details:', {
        type: typeof errorData,
        message: errorData?.message || 'No message',
        code: errorData?.code || 'No code',
        source: errorData?.source || 'No source',
        timestamp: new Date().toISOString(),
        raw: errorData
      });
    });
 
    // console.log('AppManager: Event handlers setup complete'); // Removed debug log
  }

  /**
   * Setup UI event listeners
   */
  setupUIEventListeners() {
    // console.log('AppManager: Setting up UI event listeners...'); // Removed debug log
    
    // Course load button
    const courseLoadBtn = document.getElementById('course-load-btn');
    if (courseLoadBtn) {
      courseLoadBtn.addEventListener('click', () => {
        courseLoader.handleCourseLoad().catch(error => {
          console.error('AppManager: Course load error:', error);
        });
      });
      // console.log('AppManager: Course load button listener attached'); // Removed debug log
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
      // console.log(`AppManager: Welcome button ${index + 1} listener attached`); // Removed debug log
    });
 
    // Debug panel toggle
    const debugToggleBtn = document.getElementById('debug-toggle');
    if (debugToggleBtn) {
      debugToggleBtn.addEventListener('click', () => {
        this.toggleDebugPanel();
      });
    }

    // Theme toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // Sidebar toggle for mobile
    const sidebarToggleBtn = document.getElementById('sidebar-toggle');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', () => {
        this.toggleSidebar();
      });
    }

    // console.log('AppManager: UI event listeners setup complete'); // Removed debug log
  }

  /**
   * Handle course loaded event
   */
  handleCourseLoaded(courseData) {
    console.log('DEBUG: AppManager - handleCourseLoaded - uiState:', this.uiState);
    console.log('DEBUG: AppManager - handleCourseLoaded - courseData:', courseData);
    // console.log('AppManager: Handling course loaded:', courseData); // Removed debug log
    
    try {
      // Clear API call history when new course is loaded
      if (window.electronAPI && window.electronAPI.emitDebugEvent) {
        // console.log('AppManager: Clearing API call history for new course'); // Removed debug log
        window.electronAPI.emitDebugEvent('course:loaded', {
          courseTitle: courseData.info?.title || 'Course',
          timestamp: Date.now()
        });
      }
 
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
      // FIX: Use ID selector instead of class selector
      const messageElement = document.getElementById('loading-message');
      if (messageElement) {
        messageElement.textContent = message;
      }
      loadingElement.style.display = 'flex';
      loadingElement.classList.remove('hidden');
    }
  }

  /**
   * Hide loading state
   */
  hideLoading() {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
      loadingElement.style.display = 'none';
      loadingElement.classList.add('hidden');
    }
  }

  /**
   * Show error message
   */
  showError(title, message) {
    console.error(`AppManager: ${title}:`, message);
    this.uiState.showNotification({
      message: `${title}: ${message}`,
      type: 'error',
      duration: 0 // Persistent until dismissed
    });
  }

  /**
   * Show success message
   */
  showSuccess(title, message) {
    // console.log(`AppManager: ${title}:`, message); // Removed debug log
    this.uiState.showNotification({
      message: `${title}: ${message}`,
      type: 'success',
      duration: 5000 // Auto-dismiss after 5 seconds
    });
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
   * Toggle debug panel visibility
   */
  toggleDebugPanel() {
    if (window.electronAPI && window.electronAPI.openDebugWindow) {
      window.electronAPI.openDebugWindow();
    } else {
      console.warn('AppManager: electronAPI or openDebugWindow not available. Cannot open debug window.');
    }
  }

  /**
   * Toggle application theme
   */
  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'default';
    const newTheme = currentTheme === 'dark' ? 'default' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    document.documentElement.className = document.documentElement.className.replace(/theme-\w+/, `theme-${newTheme}`);
    
    // Save theme preference
    try {
      localStorage.setItem('scorm-tester-theme', newTheme);
    } catch (error) {
      console.warn('Failed to save theme preference:', error);
    }
  }

  /**
   * Toggle sidebar visibility (mobile)
   */
  toggleSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('sidebar--mobile-open');
    }
    
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
      overlay.classList.toggle('active');
    } else {
      // Create overlay if it doesn't exist
      const newOverlay = document.createElement('div');
      newOverlay.className = 'sidebar-overlay active';
      newOverlay.addEventListener('click', () => this.toggleSidebar());
      document.body.appendChild(newOverlay);
    }
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
    // console.log('AppManager: Shutting down application...'); // Removed debug log
    
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
      // console.log('AppManager: Application shutdown complete'); // Removed debug log
      
    } catch (error) {
      console.error('AppManager: Error during shutdown:', error);
    }
  }
}

// Create and export singleton instance
const appManager = new AppManager();

export { AppManager, appManager };