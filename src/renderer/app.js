/**
 * SCORM Tester Application Entry Point
 *
 * Clean, modular application entry point that delegates to the AppManager service.
 * Preserves critical debugging from troubleshooting while maintaining clean architecture.
 *
 * @fileoverview Main application entry point
 */

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
 
// Service worker removed - console logging handled directly by renderer logger

/**
 * Initialize the application when DOM is ready
 */
async function initializeApplication() {
  try {

    // Use dynamic import to load the AppManager with absolute path
    const { appManager } = await import(`${window.electronAPI.rendererBaseUrl}services/app-manager.js`);

    if (!appManager) {
      throw new Error('AppManager not available - check dynamic import');
    }

    // Initialize the application through AppManager
    await appManager.initialize();


  } catch (error) {
    // Centralized logging and UI notification (no inline HTML)
    const { rendererLogger } = await import('./utils/renderer-logger.js');
    const { eventBus } = await import('./services/event-bus.js');
    const { uiState } = await import('./services/ui-state.js');
    try {
      rendererLogger.error('Application initialization failed:', error?.message || error);
      rendererLogger.error('Error details stack:', error?.stack || 'no stack');
    } catch (_) {}

    try {
      const resolvedUiState = await uiState;
      resolvedUiState.setError(error);
      resolvedUiState.showNotification({
        message: `Initialization Error: ${error?.message || 'Unknown error'}`,
        type: 'error',
        duration: 0
      });
    } catch (_) {}

    try {
      eventBus.emit('app:error', { error });
    } catch (_) {}
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