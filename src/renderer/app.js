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
console.log('CRITICAL DEBUG: document.readyState:', document.readyState);
console.log('CRITICAL DEBUG: electronAPI available:', typeof window.electronAPI !== 'undefined');

// Add error handler for module loading
window.addEventListener('error', (event) => {
  console.error('CRITICAL DEBUG: Script error detected:', event.error);
  console.error('CRITICAL DEBUG: Error source:', event.filename, 'line:', event.lineno);
});

// Add unhandled rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('CRITICAL DEBUG: Unhandled promise rejection:', event.reason);
});

// Convert ES6 imports to dynamic imports to work around Electron custom protocol issues
console.log('CRITICAL DEBUG: Starting dynamic imports...');

// Dynamic import function
async function loadModules() {
  try {
    console.log('CRITICAL DEBUG: Loading modules dynamically...');
    
    // For now, create a minimal app without imports to test basic functionality
    console.log('CRITICAL DEBUG: Creating minimal app without imports...');
    
    // Create a simple test app
    const testApp = {
      initialize: async function() {
        console.log('CRITICAL DEBUG: Test app initializing...');
        
        // Test basic DOM manipulation
        const welcomeContent = document.querySelector('.content-viewer__welcome');
        if (welcomeContent) {
          console.log('CRITICAL DEBUG: Welcome content found, app should be visible');
          welcomeContent.style.display = 'block';
        } else {
          console.log('CRITICAL DEBUG: Welcome content not found');
        }
        
        // Test theme application
        document.documentElement.setAttribute('data-theme', 'default');
        document.documentElement.className = 'theme-default';
        
        // CRITICAL: Add event listener for load course button
        this.setupEventListeners();
        
        console.log('CRITICAL DEBUG: Test app initialized successfully');
        return true;
      },
      
      setupEventListeners: function() {
        console.log('CRITICAL DEBUG: Setting up event listeners...');
        
        // Course load button
        const courseLoadBtn = document.getElementById('course-load-btn');
        console.log('CRITICAL DEBUG: Course load button found:', !!courseLoadBtn);
        
        if (courseLoadBtn) {
          courseLoadBtn.addEventListener('click', this.handleCourseLoad.bind(this));
          console.log('CRITICAL DEBUG: Course load button event listener attached');
        } else {
          console.error('CRITICAL DEBUG: Course load button not found in DOM');
        }
        
        // Also handle the welcome page button
        const welcomeButtons = document.querySelectorAll('button[onclick*="course-load-btn"]');
        console.log('CRITICAL DEBUG: Welcome buttons found:', welcomeButtons.length);
        
        welcomeButtons.forEach((btn, index) => {
          btn.removeAttribute('onclick'); // Remove inline onclick
          btn.addEventListener('click', this.handleCourseLoad.bind(this));
          console.log(`CRITICAL DEBUG: Welcome button ${index + 1} event listener attached`);
        });
      },
      
      handleCourseLoad: async function() {
        console.log('CRITICAL DEBUG: handleCourseLoad called - button was clicked!');
        
        // Check if electronAPI is available
        if (typeof window.electronAPI === 'undefined') {
          console.error('CRITICAL DEBUG: electronAPI not available');
          alert('Electron API Error: The application is not properly initialized. Please restart the application.');
          return;
        }
        
        console.log('CRITICAL DEBUG: electronAPI available, methods:', Object.keys(window.electronAPI));
        
        try {
          console.log('CRITICAL DEBUG: Calling selectScormPackage...');
          const result = await window.electronAPI.selectScormPackage();
          console.log('CRITICAL DEBUG: selectScormPackage result:', result);
          
          if (!result) {
            console.log('CRITICAL DEBUG: No result returned from selectScormPackage');
            return;
          }
          
          if (!result.success) {
            console.log('CRITICAL DEBUG: File selection was cancelled or failed:', result);
            return;
          }
          
          console.log('CRITICAL DEBUG: File selected successfully:', result.filePath);
          
          // Now actually process the course instead of just showing an alert
          await this.processCourseFile(result.filePath);
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error in handleCourseLoad:', error);
          alert(`Error: ${error.message}`);
        }
      },
      
      processCourseFile: async function(filePath) {
        console.log('CRITICAL DEBUG: processCourseFile called with:', filePath);
        
        try {
          // Step 1: Extract the SCORM package
          console.log('CRITICAL DEBUG: Step 1 - Extracting SCORM package...');
          const extractResult = await window.electronAPI.extractScorm(filePath);
          console.log('CRITICAL DEBUG: Extract result:', extractResult);
          
          if (!extractResult.success) {
            throw new Error(`Failed to extract SCORM package: ${extractResult.error}`);
          }
          
          const extractedPath = extractResult.path;
          console.log('CRITICAL DEBUG: Package extracted to:', extractedPath);
          
          // Step 2: Find SCORM entry point
          console.log('CRITICAL DEBUG: Step 2 - Finding SCORM entry point...');
          const entryResult = await window.electronAPI.findScormEntry(extractedPath);
          console.log('CRITICAL DEBUG: Entry result:', entryResult);
          
          if (!entryResult.success) {
            throw new Error(`Failed to find SCORM entry point: ${entryResult.error}`);
          }
          
          console.log('CRITICAL DEBUG: Entry point found:', entryResult.entryPath);
          
          // Step 3: Get course information
          console.log('CRITICAL DEBUG: Step 3 - Getting course info...');
          const courseInfo = await window.electronAPI.getCourseInfo(extractedPath);
          console.log('CRITICAL DEBUG: Course info:', courseInfo);
          
          // Step 4: Get course manifest
          console.log('CRITICAL DEBUG: Step 4 - Getting course manifest...');
          const manifestResult = await window.electronAPI.getCourseManifest(extractedPath);
          console.log('CRITICAL DEBUG: Manifest result:', manifestResult);
          
          // Step 5: Update UI to show course is loaded
          console.log('CRITICAL DEBUG: Step 5 - Updating UI...');
          this.updateUIWithCourse({
            info: courseInfo,
            structure: manifestResult.success ? manifestResult.structure : null,
            path: extractedPath,
            entryPoint: entryResult.entryPath,
            launchUrl: entryResult.launchUrl
          });
          
          console.log('CRITICAL DEBUG: Course processing completed successfully!');
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error in processCourseFile:', error);
          alert(`Course Loading Error: ${error.message}`);
        }
      },
      
      updateUIWithCourse: function(courseData) {
        console.log('CRITICAL DEBUG: updateUIWithCourse called with:', courseData);
        
        try {
          // Update course outline
          const courseOutline = document.getElementById('course-outline');
          if (courseOutline) {
            const emptyState = courseOutline.querySelector('.course-outline__empty');
            if (emptyState) {
              emptyState.style.display = 'none';
            }
            
            // Add course title and basic structure
            const courseTitle = courseData.info?.title || 'Loaded Course';
            courseOutline.innerHTML = `
              <div class="course-outline__loaded">
                <h3>${courseTitle}</h3>
                <p>Course loaded successfully!</p>
                <p>Entry point: ${courseData.entryPoint || 'Unknown'}</p>
                ${courseData.structure ? `<p>Items: ${courseData.structure.items?.length || 0}</p>` : ''}
              </div>
            `;
            console.log('CRITICAL DEBUG: Course outline updated');
          }
          
          // Update navigation controls
          const navCurrent = document.getElementById('nav-current');
          if (navCurrent) {
            navCurrent.textContent = courseData.info?.title || 'Course Loaded';
            console.log('CRITICAL DEBUG: Navigation updated');
          }
          
          // Update progress summary
          const progressSummary = document.getElementById('progress-summary');
          if (progressSummary) {
            const statusValue = progressSummary.querySelector('.progress-summary__value');
            if (statusValue) {
              statusValue.textContent = 'Course Loaded';
            }
            console.log('CRITICAL DEBUG: Progress summary updated');
          }
          
          // Hide welcome content and show course content
          const welcomeContent = document.querySelector('.content-viewer__welcome');
          if (welcomeContent) {
            welcomeContent.style.display = 'none';
            console.log('CRITICAL DEBUG: Welcome content hidden');
          }
          
          // CRITICAL FIX: Load content into iframe
          this.loadContentIntoIframe(courseData);
          
          // Show a success message
          alert(`Course "${courseData.info?.title || 'Unknown'}" loaded successfully!\n\nEntry point: ${courseData.entryPoint}`);
          
          console.log('CRITICAL DEBUG: UI update completed successfully');
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error updating UI:', error);
        }
      },
      
      loadContentIntoIframe: function(courseData) {
        console.log('CRITICAL DEBUG: loadContentIntoIframe called with:', courseData);
        
        try {
          // Get the content iframe and welcome content
          const contentFrame = document.getElementById('content-frame');
          const welcomeContent = document.querySelector('.content-viewer__welcome');
          
          console.log('CRITICAL DEBUG: Content frame found:', !!contentFrame);
          console.log('CRITICAL DEBUG: Welcome content found:', !!welcomeContent);
          console.log('CRITICAL DEBUG: Launch URL:', courseData.launchUrl);
          
          if (!contentFrame) {
            console.error('CRITICAL DEBUG: Content frame not found in DOM');
            return;
          }
          
          if (!courseData.launchUrl && !courseData.entryPoint) {
            console.error('CRITICAL DEBUG: No launch URL or entry point available');
            return;
          }
          
          // Hide welcome content
          if (welcomeContent) {
            welcomeContent.style.display = 'none';
            console.log('CRITICAL DEBUG: Welcome content hidden');
          }
          
          // Show content frame
          contentFrame.classList.remove('hidden');
          contentFrame.style.display = 'block';
          console.log('CRITICAL DEBUG: Content frame shown');
          
          // Determine the content URL to load
          const contentUrl = courseData.launchUrl || courseData.entryPoint;
          console.log('CRITICAL DEBUG: Loading content URL:', contentUrl);
          
          // Setup iframe load handler for SCORM API injection
          contentFrame.onload = () => {
            console.log('CRITICAL DEBUG: Content frame loaded successfully');
            this.injectScormAPI(contentFrame);
          };
          
          contentFrame.onerror = (error) => {
            console.error('CRITICAL DEBUG: Content frame load error:', error);
          };
          
          // Load the content
          contentFrame.src = contentUrl;
          
          console.log('CRITICAL DEBUG: Content loading initiated');
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error in loadContentIntoIframe:', error);
        }
      },
      
      injectScormAPI: function(contentFrame) {
        console.log('CRITICAL DEBUG: injectScormAPI called');
        
        try {
          const contentWindow = contentFrame.contentWindow;
          if (!contentWindow) {
            console.error('CRITICAL DEBUG: Content window not accessible');
            return;
          }
          
          console.log('CRITICAL DEBUG: Injecting SCORM API into content window');
          
          // Inject SCORM 2004 API
          contentWindow.API_1484_11 = {
            Initialize: (param) => {
              console.log('SCORM API: Initialize called with:', param);
              return 'true';
            },
            Terminate: (param) => {
              console.log('SCORM API: Terminate called with:', param);
              return 'true';
            },
            GetValue: (element) => {
              console.log('SCORM API: GetValue called with:', element);
              // Return appropriate default values
              switch (element) {
                case 'cmi.completion_status':
                  return 'incomplete';
                case 'cmi.success_status':
                  return 'unknown';
                case 'cmi.learner_id':
                  return 'test_learner';
                case 'cmi.learner_name':
                  return 'Test Learner';
                case 'cmi.credit':
                  return 'credit';
                case 'cmi.mode':
                  return 'normal';
                default:
                  return '';
              }
            },
            SetValue: (element, value) => {
              console.log('SCORM API: SetValue called with:', element, '=', value);
              return 'true';
            },
            Commit: (param) => {
              console.log('SCORM API: Commit called with:', param);
              return 'true';
            },
            GetLastError: () => {
              return '0';
            },
            GetErrorString: (errorCode) => {
              return errorCode === '0' ? 'No error' : 'Unknown error';
            },
            GetDiagnostic: (errorCode) => {
              return `Diagnostic for error ${errorCode}`;
            }
          };
          
          // Also inject SCORM 1.2 API for compatibility
          contentWindow.API = {
            LMSInitialize: (param) => contentWindow.API_1484_11.Initialize(param),
            LMSFinish: (param) => contentWindow.API_1484_11.Terminate(param),
            LMSGetValue: (element) => contentWindow.API_1484_11.GetValue(element),
            LMSSetValue: (element, value) => contentWindow.API_1484_11.SetValue(element, value),
            LMSCommit: (param) => contentWindow.API_1484_11.Commit(param),
            LMSGetLastError: () => contentWindow.API_1484_11.GetLastError(),
            LMSGetErrorString: (errorCode) => contentWindow.API_1484_11.GetErrorString(errorCode),
            LMSGetDiagnostic: (errorCode) => contentWindow.API_1484_11.GetDiagnostic(errorCode)
          };
          
          console.log('CRITICAL DEBUG: SCORM API injection completed successfully');
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error injecting SCORM API:', error);
        }
      }
    };
    
    // Initialize the test app
    await testApp.initialize();
    
    // Make it globally available
    window.scormTesterApp = testApp;
    
    return testApp;
    
  } catch (error) {
    console.error('CRITICAL DEBUG: Module loading failed:', error);
    throw error;
  }
}

// Load modules and initialize
loadModules().catch(error => {
  console.error('CRITICAL DEBUG: Failed to load application:', error);
});

// Skip the rest of the original imports for now
const EventBus = null;
const UIStateManager = null;
const ScormClient = null;
const BaseComponent = null;
const ContentViewer = null;
const NavigationControls = null;
const ProgressTracking = null;
const DebugPanel = null;
const CourseOutline = null;

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
    
    // Save theme preference with error handling
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('scorm-tester-theme', theme);
      }
    } catch (error) {
      console.warn('Failed to save theme preference:', error);
    }
    
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

// Disable the original ScormTesterApp for now since imports are failing
console.log('CRITICAL DEBUG: Skipping original ScormTesterApp initialization');

// Simple DOM ready handler
function startWhenReady() {
  console.log('CRITICAL DEBUG: startWhenReady called, DOM state:', document.readyState);
  
  if (document.readyState === 'loading') {
    console.log('CRITICAL DEBUG: DOM still loading, waiting...');
    document.addEventListener('DOMContentLoaded', () => {
      console.log('CRITICAL DEBUG: DOMContentLoaded fired');
      loadModules();
    });
  } else {
    console.log('CRITICAL DEBUG: DOM already ready, starting immediately');
    loadModules();
  }
}

// Start when ready
startWhenReady();

// Script loaded as regular JavaScript, no exports needed
console.log('CRITICAL DEBUG: app.js script loaded as regular JavaScript');