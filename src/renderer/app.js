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
 
/**
 * Set up service worker message handling for console mirroring
 */
function setupServiceWorkerLogging() {
  try {
    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'log') {
        const { level, message, data } = event.data;

        // Import renderer logger dynamically to avoid circular dependencies
        import('./utils/renderer-logger.js').then(({ rendererLogger }) => {
          if (rendererLogger && typeof rendererLogger[level] === 'function') {
            const logMessage = `[ServiceWorker] ${message}`;
            if (data) {
              rendererLogger[level](logMessage, data);
            } else {
              rendererLogger[level](logMessage);
            }
          }
        }).catch((_error) => {
          // Fallback: try to use electronAPI logger directly
          if (window.electronAPI && window.electronAPI.logger) {
            const logMessage = `[ServiceWorker] ${message}`;
            if (window.electronAPI.logger[level]) {
              window.electronAPI.logger[level](logMessage, data || '').catch(() => {});
            }
          }
        });
      }
    });
  } catch (error) {
    // Silently fail if service workers are not supported or other issues
  }
}

/**
 * Initialize the application when DOM is ready
 */
async function initializeApplication() {
  try {
    // Set up service worker logging before initializing the app
    setupServiceWorkerLogging();

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