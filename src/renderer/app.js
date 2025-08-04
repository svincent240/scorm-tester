/**
 * SCORM Tester Application Entry Point
 *
 * Clean, modular application entry point that delegates to the AppManager service.
 * Preserves critical debugging from troubleshooting while maintaining clean architecture.
 *
 * @fileoverview Main application entry point
 */

// CRITICAL DEBUG: Log immediately when script loads (preserved from troubleshooting)
console.log('CRITICAL DEBUG: app.js script is loading...');
console.log('CRITICAL DEBUG: window object exists:', typeof window !== 'undefined');
console.log('CRITICAL DEBUG: document object exists:', typeof document !== 'undefined');
console.log('CRITICAL DEBUG: document.readyState:', document.readyState);
console.log('CRITICAL DEBUG: electronAPI available:', typeof window.electronAPI !== 'undefined');

// Add error handler for module loading (preserved from troubleshooting)
window.addEventListener('error', (event) => {
  console.error('CRITICAL DEBUG: Script error detected:', event.error);
  console.error('CRITICAL DEBUG: Error source:', event.filename, 'line:', event.lineno);
});

// Add unhandled rejection handler (preserved from troubleshooting)
window.addEventListener('unhandledrejection', (event) => {
  console.error('CRITICAL DEBUG: Unhandled promise rejection:', event.reason);
});

/**
 * Application Initialization
 *
 * Uses dynamic imports to work around Electron custom protocol ES6 module limitations.
 * Preserves critical debugging while maintaining modular architecture.
 */

/**
 * Initialize the application when DOM is ready
 */
async function initializeApplication() {
  console.log('CRITICAL DEBUG: Initializing application...');
  
  try {
    // Use dynamic import to load the AppManager
    console.log('CRITICAL DEBUG: Loading AppManager via dynamic import...');
    const { appManager } = await import('./services/app-manager.js');
    console.log('CRITICAL DEBUG: AppManager imported successfully via dynamic import');
    
    // Wait for AppManager to be available
    if (!appManager) {
      throw new Error('AppManager not available - check dynamic import');
    }
    
    // Initialize the application through AppManager
    await appManager.initialize();
    
    console.log('CRITICAL DEBUG: Application initialization completed successfully');
    
  } catch (error) {
    console.error('CRITICAL DEBUG: Application initialization failed:', error);
    console.error('CRITICAL DEBUG: Error details:', error.stack);
    
    // Show error to user
    const errorElement = document.getElementById('app-error') || document.body;
    errorElement.innerHTML = `
      <div style="padding: 20px; background: #f44336; color: white; margin: 10px;">
        <h3>Application Initialization Error</h3>
        <p>Failed to initialize the SCORM Tester application:</p>
        <p><strong>${error.message}</strong></p>
        <button onclick="location.reload()" style="margin-top: 10px; padding: 10px; background: white; color: #f44336; border: none; cursor: pointer;">
          Reload Application
        </button>
      </div>
    `;
  }
}

/**
 * DOM Ready Handler
 * 
 * Starts the application when the DOM is fully loaded.
 * Preserves critical debugging from troubleshooting.
 */
function startWhenReady() {
  console.log('CRITICAL DEBUG: startWhenReady called, DOM state:', document.readyState);
  
  if (document.readyState === 'loading') {
    console.log('CRITICAL DEBUG: DOM still loading, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', () => {
      console.log('CRITICAL DEBUG: DOMContentLoaded fired');
      initializeApplication();
    });
  } else {
    console.log('CRITICAL DEBUG: DOM already ready, starting immediately');
    initializeApplication();
  }
}

// Start the application when ready
startWhenReady();

console.log('CRITICAL DEBUG: app.js script loaded - clean modular version');