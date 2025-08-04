/**
 * SCORM Tester Application Entry Point
 * 
 * Simplified renderer entry point that orchestrates all modular components.
 * Initializes services, components, and manages application lifecycle.
 * 
 * @fileoverview Main application entry point
 */

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
    const eventBus = this.services.get('eventBus');
    const uiState = this.services.get('uiState');
    const scormClient = this.services.get('scormClient');
    
    // Content Viewer - SCORM content display
    const contentViewer = new ContentViewer({
      elementId: 'content-viewer',
      allowFullscreen: true,
      enableSandbox: true,
      loadTimeout: 30000,
      showLoadingIndicator: true
    });
    this.components.set('contentViewer', contentViewer);
    
    // Navigation Controls - Course navigation
    const navigationControls = new NavigationControls({
      elementId: 'navigation-controls',
      showPrevious: true,
      showNext: true,
      showMenu: true,
      showExit: true,
      enableKeyboardShortcuts: true
    });
    this.components.set('navigationControls', navigationControls);
    
    // Progress Tracking - Learning progress display
    const progressTracking = new ProgressTracking({
      elementId: 'progress-tracking',
      showPercentage: true,
      showTimeSpent: true,
      showScore: true,
      showCompletion: true,
      animateChanges: true,
      updateInterval: 1000
    });
    this.components.set('progressTracking', progressTracking);
    
    // Debug Panel - Development and testing tools
    const debugPanel = new DebugPanel({
      elementId: 'debug-panel',
      maxApiCalls: 1000,
      showTimestamps: true,
      showDuration: true,
      enableFiltering: true,
      enableExport: true,
      refreshInterval: 500
    });
    this.components.set('debugPanel', debugPanel);
    
    // Course Outline - Course structure navigation
    const courseOutline = new CourseOutline({
      elementId: 'course-outline',
      showProgress: true,
      showIcons: true,
      enableNavigation: true,
      expandByDefault: false,
      maxDepth: 10
    });
    this.components.set('courseOutline', courseOutline);
    
    // Initialize all components
    for (const [name, component] of this.components) {
      await component.render();
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
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.click();
    }
  }
  
  /**
   * Handle file selection
   */
  async handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      this.showLoading('Loading course...');
      
      // Process the selected file
      await this.loadCourse(file);
      
    } catch (error) {
      console.error('Failed to load course:', error);
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
    // This would integrate with the main process to extract and validate the course
    // For now, emit an event that components can listen to
    this.services.get('eventBus').emit('course:load-requested', { file });
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.start());
} else {
  app.start();
}

// Export for module usage
export default app;