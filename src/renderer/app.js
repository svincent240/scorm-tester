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
          
          // Determine the content URL to load - use custom protocol for security
          let contentUrl = courseData.launchUrl || courseData.entryPoint;
          
          console.log('CRITICAL DEBUG: Original contentUrl:', contentUrl);
          console.log('CRITICAL DEBUG: courseData.entryPoint:', courseData.entryPoint);
          console.log('CRITICAL DEBUG: courseData.path:', courseData.path);
          
          // Convert to scorm-app:// protocol for Electron security compliance
          if (contentUrl && !contentUrl.startsWith('scorm-app://') && !contentUrl.startsWith('http')) {
            // If it's just a filename, get the full path from entryPoint
            if (!contentUrl.includes('\\') && !contentUrl.includes('/')) {
              const entryPath = courseData.entryPoint || '';
              const directory = entryPath.substring(0, entryPath.lastIndexOf('\\'));
              contentUrl = `${directory}\\${contentUrl}`;
              console.log('CRITICAL DEBUG: Constructed full path:', contentUrl);
            }
            
            // Convert absolute Windows path to relative path for custom protocol
            // The protocol handler expects paths relative to the app root
            const appRoot = 'C:\\Users\\svincent\\GitHub\\scorm-tester\\';
            console.log('CRITICAL DEBUG: App root:', appRoot);
            console.log('CRITICAL DEBUG: Content URL before conversion:', contentUrl);
            
            if (contentUrl.startsWith(appRoot)) {
              const relativePath = contentUrl.substring(appRoot.length).replace(/\\/g, '/');
              console.log('CRITICAL DEBUG: Relative path extracted:', relativePath);
              contentUrl = `scorm-app://${relativePath}`;
              console.log('CRITICAL DEBUG: Final scorm-app URL:', contentUrl);
            } else {
              console.error('CRITICAL DEBUG: Content path not within app root:', contentUrl);
              console.error('CRITICAL DEBUG: Expected to start with:', appRoot);
            }
          }
          
          console.log('CRITICAL DEBUG: Loading content URL:', contentUrl);
          
          // CRITICAL FIX: Inject SCORM API BEFORE content loads
          // This ensures the API is available when the content starts executing
          this.preInjectScormAPI(contentFrame);
          
          // Setup iframe load handler for additional configuration
          contentFrame.onload = () => {
            console.log('CRITICAL DEBUG: Content frame loaded successfully');
            // Verify API is still there and enhance it if needed
            this.verifyAndEnhanceScormAPI(contentFrame);
            this.fixScormBasePath(contentFrame);
            
            // Add a message listener to handle path correction requests from SCORM content
            this.setupPathCorrectionHandler(contentFrame);
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
      
      preInjectScormAPI: function(contentFrame) {
        console.log('CRITICAL DEBUG: preInjectScormAPI called - injecting BEFORE content loads');
        
        // Create a script that will inject the API into the iframe's window
        // This runs before any content scripts execute
        const apiScript = `
          console.log('SCORM Tester: Pre-injecting SCORM API');
          
          // Inject SCORM 2004 API
          window.API_1484_11 = {
            Initialize: function(param) {
              console.log('SCORM API: Initialize called with:', param);
              parent.postMessage({type: 'SCORM_API_CALL', method: 'Initialize', params: [param]}, '*');
              return 'true';
            },
            Terminate: function(param) {
              console.log('SCORM API: Terminate called with:', param);
              parent.postMessage({type: 'SCORM_API_CALL', method: 'Terminate', params: [param]}, '*');
              return 'true';
            },
            GetValue: function(element) {
              console.log('SCORM API: GetValue called with:', element);
              parent.postMessage({type: 'SCORM_API_CALL', method: 'GetValue', params: [element]}, '*');
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
                case 'cmi.entry':
                  return 'ab-initio';
                case 'cmi.exit':
                  return '';
                case 'cmi.session_time':
                  return 'PT0H0M0S';
                case 'cmi.total_time':
                  return 'PT0H0M0S';
                case 'cmi.location':
                  return '';
                case 'cmi.suspend_data':
                  return '';
                case 'cmi.score.scaled':
                  return '';
                case 'cmi.score.raw':
                  return '';
                case 'cmi.score.min':
                  return '';
                case 'cmi.score.max':
                  return '';
                default:
                  return '';
              }
            },
            SetValue: function(element, value) {
              console.log('SCORM API: SetValue called with:', element, '=', value);
              parent.postMessage({type: 'SCORM_API_CALL', method: 'SetValue', params: [element, value]}, '*');
              return 'true';
            },
            Commit: function(param) {
              console.log('SCORM API: Commit called with:', param);
              parent.postMessage({type: 'SCORM_API_CALL', method: 'Commit', params: [param]}, '*');
              return 'true';
            },
            GetLastError: function() {
              return '0';
            },
            GetErrorString: function(errorCode) {
              return errorCode === '0' ? 'No error' : 'Unknown error';
            },
            GetDiagnostic: function(errorCode) {
              return 'Diagnostic for error ' + errorCode;
            }
          };
          
          // Also inject SCORM 1.2 API for compatibility
          window.API = {
            LMSInitialize: function(param) { return window.API_1484_11.Initialize(param); },
            LMSFinish: function(param) { return window.API_1484_11.Terminate(param); },
            LMSGetValue: function(element) { return window.API_1484_11.GetValue(element); },
            LMSSetValue: function(element, value) { return window.API_1484_11.SetValue(element, value); },
            LMSCommit: function(param) { return window.API_1484_11.Commit(param); },
            LMSGetLastError: function() { return window.API_1484_11.GetLastError(); },
            LMSGetErrorString: function(errorCode) { return window.API_1484_11.GetErrorString(errorCode); },
            LMSGetDiagnostic: function(errorCode) { return window.API_1484_11.GetDiagnostic(errorCode); }
          };
          
          console.log('SCORM Tester: SCORM API pre-injection completed');
        `;
        
        // Set up the iframe with the API script injected via srcdoc
        const originalSrc = contentFrame.src;
        
        // Create a minimal HTML document that will load the original content
        // but with our API already injected
        const wrapperHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <script>${apiScript}</script>
          </head>
          <body>
            <script>
              // Redirect to the actual content after API is injected
              window.location.href = '${originalSrc}';
            </script>
          </body>
          </html>
        `;
        
        // Use srcdoc to inject our wrapper, then redirect to actual content
        contentFrame.srcdoc = wrapperHtml;
        
        console.log('CRITICAL DEBUG: SCORM API pre-injection setup completed');
      },
      
      verifyAndEnhanceScormAPI: function(contentFrame) {
        console.log('CRITICAL DEBUG: verifyAndEnhanceScormAPI called');
        
        try {
          const contentWindow = contentFrame.contentWindow;
          if (!contentWindow) {
            console.error('CRITICAL DEBUG: Content window not accessible for verification');
            return;
          }
          
          // Check if API exists
          if (contentWindow.API_1484_11) {
            console.log('CRITICAL DEBUG: SCORM 2004 API found in content window');
          } else {
            console.warn('CRITICAL DEBUG: SCORM 2004 API not found, attempting direct injection');
            this.injectScormAPI(contentFrame);
          }
          
          if (contentWindow.API) {
            console.log('CRITICAL DEBUG: SCORM 1.2 API found in content window');
          } else {
            console.warn('CRITICAL DEBUG: SCORM 1.2 API not found');
          }
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error verifying SCORM API:', error);
        }
      },

      injectScormAPI: function(contentFrame) {
        console.log('CRITICAL DEBUG: injectScormAPI called (fallback method)');
        
        try {
          const contentWindow = contentFrame.contentWindow;
          if (!contentWindow) {
            console.error('CRITICAL DEBUG: Content window not accessible');
            return;
          }
          
          // Check if we can access the content window (same-origin policy)
          try {
            // Test access to content window
            const testAccess = contentWindow.location.href;
            console.log('CRITICAL DEBUG: Content window accessible, URL:', testAccess);
          } catch (accessError) {
            console.warn('CRITICAL DEBUG: Cannot access content window due to cross-origin restrictions:', accessError.message);
            // Try alternative approach - inject via postMessage
            this.injectScormAPIViaPostMessage(contentFrame);
            return;
          }
          
          console.log('CRITICAL DEBUG: Injecting SCORM API into content window (fallback)');
          
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
          
          console.log('CRITICAL DEBUG: SCORM API fallback injection completed successfully');
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error injecting SCORM API:', error);
          console.error('CRITICAL DEBUG: Error details:', error.name, error.message);
        }
      },
      
      injectScormAPIViaPostMessage: function(contentFrame) {
        console.log('CRITICAL DEBUG: Using postMessage approach for SCORM API');
        
        // Listen for SCORM API requests from the iframe
        window.addEventListener('message', (event) => {
          if (event.source !== contentFrame.contentWindow) return;
          
          if (event.data && event.data.type === 'SCORM_API_CALL') {
            console.log('SCORM API Call via postMessage:', event.data.method, event.data.params);
            
            let result = 'true';
            switch (event.data.method) {
              case 'Initialize':
                console.log('SCORM API: Initialize called');
                break;
              case 'Terminate':
                console.log('SCORM API: Terminate called');
                break;
              case 'GetValue':
                console.log('SCORM API: GetValue called with:', event.data.params[0]);
                result = this.getScormValue(event.data.params[0]);
                break;
              case 'SetValue':
                console.log('SCORM API: SetValue called with:', event.data.params[0], event.data.params[1]);
                break;
              case 'Commit':
                console.log('SCORM API: Commit called');
                break;
              case 'GetLastError':
                result = '0';
                break;
              case 'GetErrorString':
                result = 'No error';
                break;
              case 'GetDiagnostic':
                result = 'No diagnostic';
                break;
            }
            
            // Send response back
            contentFrame.contentWindow.postMessage({
              type: 'SCORM_API_RESPONSE',
              callId: event.data.callId,
              result: result
            }, '*');
          }
        });
        
        // Notify the iframe that SCORM API is available via postMessage
        setTimeout(() => {
          contentFrame.contentWindow.postMessage({
            type: 'SCORM_API_READY',
            message: 'SCORM API available via postMessage'
          }, '*');
        }, 100);
      },
      
      getScormValue: function(element) {
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
      
      fixScormBasePath: function(contentFrame) {
        console.log('CRITICAL DEBUG: fixScormBasePath called');
        
        try {
          const contentWindow = contentFrame.contentWindow;
          if (!contentWindow) {
            console.error('CRITICAL DEBUG: Content window not accessible for base path fix');
            return;
          }
          
          // Check if we can access the content window
          try {
            // Test access to content window
            const testAccess = contentWindow.location.href;
            console.log('CRITICAL DEBUG: Content window accessible for base path fix, URL:', testAccess);
            
            // Fix the DATA_PATH_BASE if window.globals exists
            if (contentWindow.globals && typeof contentWindow.globals.DATA_PATH_BASE !== 'undefined') {
              console.log('CRITICAL DEBUG: Original DATA_PATH_BASE:', contentWindow.globals.DATA_PATH_BASE);
              contentWindow.globals.DATA_PATH_BASE = 'html5/data/';
              console.log('CRITICAL DEBUG: Updated DATA_PATH_BASE to:', contentWindow.globals.DATA_PATH_BASE);
            }
            
            // Also try to fix RequireJS base path if it exists
            if (contentWindow.require && contentWindow.require.config) {
              console.log('CRITICAL DEBUG: Configuring RequireJS base path');
              contentWindow.require.config({
                baseUrl: 'html5/data/js/'
              });
            }
            
          } catch (accessError) {
            console.warn('CRITICAL DEBUG: Cannot access content window for base path fix due to cross-origin restrictions:', accessError.message);
            // For cross-origin content, we can't directly modify the base path
            // The SCORM content will need to handle this internally
          }
          
        } catch (error) {
          console.error('CRITICAL DEBUG: Error in fixScormBasePath:', error);
        }
      },
      
      setupPathCorrectionHandler: function(contentFrame) {
        console.log('CRITICAL DEBUG: setupPathCorrectionHandler called');
        
        // Listen for messages from the SCORM content
        window.addEventListener('message', (event) => {
          if (event.source !== contentFrame.contentWindow) return;
          
          // Handle SCORM API calls
          if (event.data && event.data.type === 'SCORM_API_CALL') {
            console.log('CRITICAL DEBUG: SCORM API call received:', event.data.method, event.data.params);
            
            // Log the API call for debugging
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] SCORM API: ${event.data.method}(${event.data.params ? event.data.params.join(', ') : ''})`);
            
            // Here you could forward to the main process for proper SCORM handling
            // For now, just log that we received it
          }
          
          // Handle path correction requests
          if (event.data && event.data.type === 'PATH_CORRECTION_REQUEST') {
            console.log('CRITICAL DEBUG: Path correction request received:', event.data.path);
            
            // Fix double temp/ paths
            let correctedPath = event.data.path;
            if (correctedPath.includes('temp/temp/')) {
              correctedPath = correctedPath.replace('temp/temp/', 'temp/');
              console.log('CRITICAL DEBUG: Corrected path:', correctedPath);
            }
            
            // Send back the corrected path
            contentFrame.contentWindow.postMessage({
              type: 'PATH_CORRECTION_RESPONSE',
              requestId: event.data.requestId,
              correctedPath: correctedPath
            }, '*');
          }
        });
        
        // Inject a script into the content frame to intercept RequireJS path resolution
        try {
          const script = `
            console.log('SCORM Tester: Path correction script injected');
            
            // Override RequireJS path resolution if it exists
            if (typeof require !== 'undefined' && require.config) {
              console.log('SCORM Tester: Configuring RequireJS to fix paths');
              
              // Store original require function
              const originalRequire = window.require;
              
              // Override require to fix paths
              window.require = function(deps, callback, errback) {
                if (Array.isArray(deps)) {
                  deps = deps.map(dep => {
                    if (typeof dep === 'string' && dep.includes('temp/temp/')) {
                      const fixed = dep.replace('temp/temp/', 'temp/');
                      console.log('SCORM Tester: Fixed require path:', dep, '->', fixed);
                      return fixed;
                    }
                    return dep;
                  });
                }
                return originalRequire.call(this, deps, callback, errback);
              };
              
              // Copy over require properties
              Object.keys(originalRequire).forEach(key => {
                window.require[key] = originalRequire[key];
              });
            }
          `;
          
          // Try to inject the script
          if (contentFrame.contentDocument) {
            const scriptElement = contentFrame.contentDocument.createElement('script');
            scriptElement.textContent = script;
            contentFrame.contentDocument.head.appendChild(scriptElement);
            console.log('CRITICAL DEBUG: Path correction script injected successfully');
          }
        } catch (error) {
          console.warn('CRITICAL DEBUG: Could not inject path correction script:', error.message);
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