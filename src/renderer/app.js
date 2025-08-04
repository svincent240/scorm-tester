/**
 * SCORM Tester Application Entry Point
 *
 * Simplified renderer entry point that orchestrates all modular components.
 * Initializes services, components, and manages application lifecycle.
 *
 * @fileoverview Main application entry point
 */

// CRITICAL DEBUG: Log immediately when script loads
console.log('CRITICAL DEBUG: app.js script is loading...');
console.log('CRITICAL DEBUG: window object exists:', typeof window !== 'undefined');
console.log('CRITICAL DEBUG: document object exists:', typeof document !== 'undefined');

import { EventBus } from './services/event-bus.js';
import { UIStateManager } from './services/ui-state.js';
import { ScormClient } from './services/scorm-client.js';
import { BaseComponent } from './components/base-component.js';
import { ContentViewer } from './components/scorm/content-viewer.js';
import { NavigationControls } from './components/scorm/navigation-controls.js';
import { ProgressTracking } from './components/scorm/progress-tracking.js';
import { DebugPanel } from './components/scorm/debug-panel.js';
import { CourseOutline } from './components/scorm/course-outline.js';

/**
 * Main SCORM Tester Application Class
 * 
 * Manages the entire application lifecycle, component initialization,
 * and service coordination. Provides a clean API for application control.
 */
class ScormTesterApp {
  constructor() {
    this.isInitialized = false;
    this.isStarted = false;
    this.components = new Map();
    this.services = new Map();
    
    // Bind methods to preserve context
    this.handleThemeToggle = this.handleThemeToggle.bind(this);
    this.handleSidebarToggle = this.handleSidebarToggle.bind(this);
    this.handleDebugToggle = this.handleDebugToggle.bind(this);
    this.handleCourseLoad = this.handleCourseLoad.bind(this);
    this.handleFileSelect = this.handleFileSelect.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }
  
  /**
   * Initialize the application
   * Sets up services, components, and event listeners
   */
  async initialize() {
    if (this.isInitialized) {
      console.warn('Application already initialized');
      return;
    }
    
    try {
      console.log('Initializing SCORM Tester Application...');
      
      // Initialize core services
      await this.initializeServices();
      
      // Initialize UI components
      await this.initializeComponents();
      
      // Set up global event listeners
      this.setupEventListeners();
      
      // Apply saved UI state
      this.restoreUIState();
      
      this.isInitialized = true;
      console.log('Application initialized successfully');
      
      // Emit initialization complete event
      this.services.get('eventBus').emit('app:initialized');
      
    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.showError('Failed to initialize application', error.message);
      throw error;
    }
  }
  
  /**
   * Start the application
   * Begins the main application loop and user interaction
   */
  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isStarted) {
      console.warn('Application already started');
      return;
    }
    
    try {
      console.log('Starting SCORM Tester Application...');
      
      // Start all components
      for (const [name, component] of this.components) {
        if (typeof component.start === 'function') {
          await component.start();
        }
      }
      
      // Hide loading overlay
      this.hideLoading();
      
      this.isStarted = true;
      console.log('Application started successfully');
      
      // Emit start complete event
      this.services.get('eventBus').emit('app:started');
      
    } catch (error) {
      console.error('Failed to start application:', error);
      this.showError('Failed to start application', error.message);
      throw error;
    }
  }
  
  /**
   * Initialize core services
   */
  async initializeServices() {
    // Event Bus - Central communication hub
    const eventBus = new EventBus({
      maxListeners: 100,
      enableLogging: true,
      logLevel: 'info'
    });
    this.services.set('eventBus', eventBus);
    
    // UI State Manager - Application state persistence
    const uiState = new UIStateManager({
      persistKey: 'scorm-tester-state',
      autoSave: true,
      saveInterval: 5000,
      enableHistory: true,
      maxHistorySize: 50
    });
    this.services.set('uiState', uiState);
    
    // SCORM Client - SCORM API communication
    const scormClient = new ScormClient({
      apiVersion: '2004',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      enableLogging: true,
      strictMode: false
    });
    this.services.set('scormClient', scormClient);
    
    console.log('Core services initialized');
  }
  
  /**
   * Initialize UI components
   */
  async initializeComponents() {
    console.log('DEBUG: initializeComponents called, DOM ready state:', document.readyState);
    
    const eventBus = this.services.get('eventBus');
    const uiState = this.services.get('uiState');
    const scormClient = this.services.get('scormClient');
    
    // Check if required elements exist
    const requiredElements = ['content-viewer', 'navigation-controls', 'progress-tracking', 'debug-panel', 'course-outline'];
    for (const elementId of requiredElements) {
      const element = document.getElementById(elementId);
      console.log(`DEBUG: Element '${elementId}' exists:`, !!element);
      if (!element) {
        throw new Error(`Required element '${elementId}' not found in DOM`);
      }
    }
    
    // Content Viewer - SCORM content display
    console.log('DEBUG: Creating ContentViewer with elementId: content-viewer');
    const contentViewer = new ContentViewer('content-viewer', {
      allowFullscreen: true,
      enableSandbox: true,
      loadTimeout: 30000,
      showLoadingIndicator: true
    });
    this.components.set('contentViewer', contentViewer);
    
    // Navigation Controls - Course navigation
    console.log('DEBUG: Creating NavigationControls with elementId: navigation-controls');
    const navigationControls = new NavigationControls('navigation-controls', {
      showPrevious: true,
      showNext: true,
      showMenu: true,
      showExit: true,
      enableKeyboardShortcuts: true
    });
    this.components.set('navigationControls', navigationControls);
    
    // Progress Tracking - Learning progress display
    console.log('DEBUG: Creating ProgressTracking with elementId: progress-tracking');
    const progressTracking = new ProgressTracking('progress-tracking', {
      showPercentage: true,
      showTimeSpent: true,
      showScore: true,
      showCompletion: true,
      animateChanges: true,
      updateInterval: 1000
    });
    this.components.set('progressTracking', progressTracking);
    
    // Debug Panel - Development and testing tools
    console.log('DEBUG: Creating DebugPanel with elementId: debug-panel');
    const debugPanel = new DebugPanel('debug-panel', {
      maxApiCalls: 1000,
      showTimestamps: true,
      showDuration: true,
      enableFiltering: true,
      enableExport: true,
      refreshInterval: 500
    });
    this.components.set('debugPanel', debugPanel);
    
    // Course Outline - Course structure navigation
    console.log('DEBUG: Creating CourseOutline with elementId: course-outline');
    const courseOutline = new CourseOutline('course-outline', {
      showProgress: true,
      showIcons: true,
      enableNavigation: true,
      expandByDefault: false,
      maxDepth: 10
    });
    this.components.set('courseOutline', courseOutline);
    
    // Initialize all components
    for (const [name, component] of this.components) {
      await component.initialize();
      console.log(`Component '${name}' initialized`);
    }
    
    console.log('UI components initialized');
  }
  
  /**
   * Set up global event listeners
   */
  setupEventListeners() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', this.handleThemeToggle);
    }
    
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', this.handleSidebarToggle);
    }
    
    // Debug panel toggle
    const debugToggle = document.getElementById('debug-toggle');
    if (debugToggle) {
      debugToggle.addEventListener('click', this.handleDebugToggle);
    }
    
    // Course load button
    const courseLoadBtn = document.getElementById('course-load-btn');
    if (courseLoadBtn) {
      courseLoadBtn.addEventListener('click', this.handleCourseLoad);
    }
    
    // File input
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.addEventListener('change', this.handleFileSelect);
    }
    
    // Window events
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown.bind(this));
    
    console.log('Event listeners set up');
  }
  
  /**
   * Handle theme toggle
   */
  handleThemeToggle() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'default';
    const newTheme = currentTheme === 'default' ? 'dark' : 'default';
    
    this.setTheme(newTheme);
  }
  
  /**
   * Set application theme
   */
  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.className = `theme-${theme}`;
    localStorage.setItem('scorm-tester-theme', theme);
    
    this.services.get('eventBus').emit('theme:changed', { theme });
  }
  
  /**
   * Handle sidebar toggle
   */
  handleSidebarToggle() {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('app-sidebar--collapsed');
    }
  }
  
  /**
   * Handle debug panel toggle
   */
  handleDebugToggle() {
    const debugPanel = document.getElementById('debug-panel');
    if (debugPanel) {
      debugPanel.classList.toggle('hidden');
    }
  }
  
  /**
   * Handle course load request
   */
  handleCourseLoad() {
    console.log('DEBUG: handleCourseLoad called');
    
    // Check if electronAPI is available
    if (typeof window.electronAPI === 'undefined') {
      console.error('DEBUG: electronAPI not available in handleCourseLoad');
      this.showError('Electron API Error', 'The application is not properly initialized. Please restart the application.');
      return;
    }
    
    console.log('DEBUG: electronAPI available, methods:', Object.keys(window.electronAPI));
    
    // Try to use the Electron file dialog instead of HTML file input
    this.openScormFileDialog();
  }
  
  /**
   * Open SCORM file dialog using Electron API
   */
  async openScormFileDialog() {
    console.log('DEBUG: openScormFileDialog called');
    
    try {
      this.showLoading('Opening file dialog...');
      
      // Use Electron's native file dialog
      const result = await window.electronAPI.selectScormPackage();
      console.log('DEBUG: selectScormPackage result:', result);
      
      if (!result || !result.success) {
        console.log('DEBUG: No file selected or operation failed:', result);
        this.hideLoading();
        return;
      }
      
      if (result.filePath) {
        console.log('DEBUG: File selected:', result.filePath);
        // Process the selected file path
        await this.loadCourseFromPath(result.filePath);
      }
      
    } catch (error) {
      console.error('DEBUG: Error in openScormFileDialog:', error);
      this.showError('File Selection Error', `Failed to open file dialog: ${error.message}`);
    } finally {
      this.hideLoading();
    }
  }
  
  /**
   * Load course from file path
   */
  async loadCourseFromPath(filePath) {
    console.log('DEBUG: loadCourseFromPath called with:', filePath);
    
    try {
      this.showLoading('Loading course...');
      
      // Extract the SCORM package if it's a ZIP file
      if (filePath.toLowerCase().endsWith('.zip')) {
        console.log('DEBUG: ZIP file detected, extracting...');
        
        const extractResult = await window.electronAPI.extractScorm(filePath);
        console.log('DEBUG: Extract result:', extractResult);
        
        if (!extractResult.success) {
          throw new Error(`Failed to extract SCORM package: ${extractResult.error}`);
        }
        
        // Load the extracted course
        await this.loadExtractedCourse(extractResult.path);
        
      } else {
        throw new Error('Unsupported file type. Please select a ZIP file containing a SCORM package.');
      }
      
    } catch (error) {
      console.error('DEBUG: Error in loadCourseFromPath:', error);
      this.showError('Course Loading Error', error.message);
    } finally {
      this.hideLoading();
    }
  }
  
  /**
   * Handle file selection
   */
  async handleFileSelect(event) {
    console.log('DEBUG: handleFileSelect called');
    const file = event.target.files[0];
    if (!file) {
      console.log('DEBUG: No file selected');
      return;
    }
    
    console.log('DEBUG: File selected:', file.name, file.type, file.size);
    
    try {
      this.showLoading('Loading course...');
      
      // Process the selected file
      await this.loadCourse(file);
      
    } catch (error) {
      console.error('DEBUG: Failed to load course:', error);
      this.showError('Failed to load course', error.message);
    } finally {
      this.hideLoading();
      // Clear file input
      event.target.value = '';
    }
  }
  
  /**
   * Load a SCORM course
   */
  async loadCourse(file) {
    console.log('DEBUG: loadCourse called with file:', file.name);
    
    // Check if electronAPI is available
    if (typeof window.electronAPI === 'undefined') {
      console.error('DEBUG: electronAPI not available - this indicates a preload script issue');
      throw new Error('Electron API not available. Please check preload script configuration.');
    }
    
    console.log('DEBUG: electronAPI available, methods:', Object.keys(window.electronAPI));
    
    try {
      // For ZIP files, extract them first
      if (file.name.toLowerCase().endsWith('.zip')) {
        console.log('DEBUG: ZIP file detected, extracting...');
        
        // Create a temporary file path for the ZIP
        const tempPath = await this.saveFileTemporarily(file);
        console.log('DEBUG: File saved temporarily at:', tempPath);
        
        // Extract the SCORM package
        const extractResult = await window.electronAPI.extractScorm(tempPath);
        if (!extractResult.success) {
          throw new Error(`Failed to extract SCORM package: ${extractResult.error}`);
        }
        
        console.log('DEBUG: SCORM package extracted to:', extractResult.path);
        
        // Load the extracted course
        await this.loadExtractedCourse(extractResult.path);
        
      } else {
        throw new Error('Unsupported file type. Please select a ZIP file containing a SCORM package.');
      }
      
    } catch (error) {
      console.error('DEBUG: Error in loadCourse:', error);
      throw error;
    }
  }
  
  /**
   * Save file temporarily for processing
   */
  async saveFileTemporarily(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const arrayBuffer = event.target.result;
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // Convert to base64 for transmission
          const base64 = btoa(String.fromCharCode.apply(null, uint8Array));
          
          // Send to main process to save temporarily
          const result = await window.electronAPI.saveTemporaryFile(file.name, base64);
          if (result.success) {
            resolve(result.path);
          } else {
            reject(new Error(result.error));
          }
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }
  
  /**
   * Load extracted SCORM course
   */
  async loadExtractedCourse(coursePath) {
    console.log('DEBUG: Loading extracted course from:', coursePath);
    
    try {
      // Get course information
      const courseInfo = await window.electronAPI.getCourseInfo(coursePath);
      if (!courseInfo.success) {
        throw new Error(`Failed to get course info: ${courseInfo.error}`);
      }
      
      console.log('DEBUG: Course info retrieved:', courseInfo.data);
      
      // Find SCORM entry point
      const entryResult = await window.electronAPI.findScormEntry(coursePath);
      if (!entryResult.success) {
        throw new Error(`Failed to find SCORM entry point: ${entryResult.error}`);
      }
      
      console.log('DEBUG: SCORM entry point found:', entryResult.entryPoint);
      
      // Get course manifest for detailed structure
      const manifestResult = await window.electronAPI.getCourseManifest(coursePath);
      if (!manifestResult.success) {
        console.warn('DEBUG: Could not load course manifest:', manifestResult.error);
      }
      
      // Update UI state with course data
      const courseData = {
        info: courseInfo.data,
        structure: manifestResult.success ? manifestResult.data : null,
        path: coursePath,
        entryPoint: entryResult.entryPoint
      };
      
      // Update UI state
      this.services.get('uiState').updateCourse(courseData);
      
      // Emit course loaded event
      this.services.get('eventBus').emit('course:loaded', courseData);
      
      console.log('DEBUG: Course loaded successfully');
      
    } catch (error) {
      console.error('DEBUG: Error loading extracted course:', error);
      throw error;
    }
  }
  
  /**
   * Handle window resize
   */
  handleResize() {
    // Notify components of resize
    this.services.get('eventBus').emit('window:resize', {
      width: window.innerWidth,
      height: window.innerHeight
    });
  }
  
  /**
   * Handle keyboard shortcuts
   */
  handleKeydown(event) {
    // F12 - Toggle debug panel
    if (event.key === 'F12') {
      event.preventDefault();
      this.handleDebugToggle();
    }
    
    // Ctrl/Cmd + O - Open course
    if ((event.ctrlKey || event.metaKey) && event.key === 'o') {
      event.preventDefault();
      this.handleCourseLoad();
    }
    
    // Ctrl/Cmd + Shift + D - Toggle theme
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'D') {
      event.preventDefault();
      this.handleThemeToggle();
    }
  }
  
  /**
   * Handle before unload
   */
  handleBeforeUnload(event) {
    // Save current state
    this.services.get('uiState').save();
    
    // If SCORM session is active, warn user
    const scormClient = this.services.get('scormClient');
    if (scormClient.isInitialized() && !scormClient.isTerminated()) {
      event.preventDefault();
      event.returnValue = 'You have an active SCORM session. Are you sure you want to leave?';
      return event.returnValue;
    }
  }
  
  /**
   * Restore UI state from storage
   */
  restoreUIState() {
    const uiState = this.services.get('uiState');
    
    // Restore sidebar state
    const sidebarCollapsed = uiState.get('ui.sidebarCollapsed', false);
    if (sidebarCollapsed) {
      const sidebar = document.getElementById('app-sidebar');
      if (sidebar) {
        sidebar.classList.add('app-sidebar--collapsed');
      }
    }
    
    // Restore debug panel state
    const debugPanelVisible = uiState.get('ui.debugPanelVisible', false);
    if (debugPanelVisible) {
      const debugPanel = document.getElementById('debug-panel');
      if (debugPanel) {
        debugPanel.classList.remove('hidden');
      }
    }
  }
  
  /**
   * Show loading overlay
   */
  showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const messageEl = document.getElementById('loading-message');
    
    if (overlay) {
      overlay.classList.remove('hidden');
    }
    
    if (messageEl) {
      messageEl.textContent = message;
    }
  }
  
  /**
   * Hide loading overlay
   */
  hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }
  
  /**
   * Show error notification
   */
  showError(title, message) {
    // This would integrate with a notification system
    console.error(`${title}: ${message}`);
    alert(`${title}\n\n${message}`);
  }
  
  /**
   * Get component by name
   */
  getComponent(name) {
    return this.components.get(name);
  }
  
  /**
   * Get service by name
   */
  getService(name) {
    return this.services.get(name);
  }
  
  /**
   * Destroy the application
   */
  async destroy() {
    console.log('Destroying SCORM Tester Application...');
    
    // Remove event listeners
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('keydown', this.handleKeydown);
    
    // Destroy all components
    for (const [name, component] of this.components) {
      if (typeof component.destroy === 'function') {
        await component.destroy();
      }
    }
    
    // Clear collections
    this.components.clear();
    this.services.clear();
    
    this.isInitialized = false;
    this.isStarted = false;
    
    console.log('Application destroyed');
  }
}

// Initialize and start the application
const app = new ScormTesterApp();

// Make app globally available for debugging
window.scormTesterApp = app;

// Start the application when DOM is ready
function startWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.start());
  } else {
    // DOM is already ready, start immediately
    app.start();
  }
}

// Always wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startWhenReady);
} else {
  // DOM is already ready
  startWhenReady();
}

// Export for module usage
export default app;