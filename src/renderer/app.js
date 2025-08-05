/**
 * SCORM Tester Application Entry Point
 *
 * Clean, modular application entry point that delegates to the AppManager service.
 * Preserves critical debugging from troubleshooting while maintaining clean architecture.
 *
 * @fileoverview Main application entry point
 */

/**
 * Application Initialization
 *
 * Uses dynamic imports to work around Electron custom protocol ES6 module limitations.
 */
 
/**
 * Initialize the application when DOM is ready
 */
async function initializeApplication() {
  try {
    // Use dynamic import to load the AppManager
    const { appManager } = await import('./services/app-manager.js');
    
    if (!appManager) {
      throw new Error('AppManager not available - check dynamic import');
    }
    
    // Initialize the application through AppManager
    await appManager.initialize();
    
  } catch (error) {
    console.error('Application initialization failed:', error);
    console.error('Error details:', error.stack);
    
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
 */
function startWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeApplication();
    });
  } else {
    initializeApplication();
  }
}
 
// Start the application when ready
startWhenReady();