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
 * Wait for electronAPI to be ready
 */
async function waitForElectronAPI() {
  // Import renderer logger for proper logging
  const { rendererLogger } = await import('./utils/renderer-logger.js');

  let retryCount = 0;
  const MAX_RETRIES = 50; // 50 * 50ms = 2.5 seconds max wait
  const POLL_INTERVAL = 50; // Less aggressive polling

  return new Promise((resolve, reject) => {
    const checkAPI = () => {
      // First check if the API readiness flag is set
      if (typeof window !== 'undefined' && window.electronAPIIsReady) {
        // Then verify the API itself is available
        if (window.electronAPI) {
          // API is ready
          if (retryCount > 1) {
            rendererLogger.info(`electronAPI ready after ${retryCount} retries`);
          }
          resolve();
          return;
        } else {
          rendererLogger.warn('electronAPIIsReady flag set but electronAPI not found');
        }
      }

      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        reject(new Error(`electronAPI failed to initialize after ${MAX_RETRIES} retries`));
        return;
      }

      if (retryCount === 1 || retryCount % 10 === 0) {
        // Log every 10th retry to reduce verbosity
        rendererLogger.debug(`Waiting for electronAPI (${retryCount}/${MAX_RETRIES})...`);
      }

      setTimeout(checkAPI, POLL_INTERVAL);
    };

    checkAPI();
  });
}

/**
 * Set up SCORM event forwarding from IPC to Event Bus
 */
async function setupScormEventForwarding() {
  // Import renderer logger for proper logging
  const { rendererLogger } = await import('./utils/renderer-logger.js');

  try {
    // Import event bus dynamically
    const { eventBus } = await import(`${window.electronAPI.rendererBaseUrl}services/event-bus.js`);

    // Forward activity progress updates
    window.electronAPI.onActivityProgressUpdated((data) => {
      eventBus.emit('activity:progress:updated', data);
    });

    // Forward objectives updates
    window.electronAPI.onObjectivesUpdated((data) => {
      eventBus.emit('objectives:updated', data);
    });

    // Forward navigation completion events
    window.electronAPI.onNavigationCompleted((data) => {
      eventBus.emit('navigation:completed', data);
    });

    // Forward SCORM API call logs (for sn:initialized detection)
    window.electronAPI.onScormApiCallLogged((data) => {
      // Check if this is an sn:initialized event
      if (data && data.event === 'sn:initialized') {
        eventBus.emit('sn:initialized', data);
      }
    });

    // Forward course outline refresh events
    window.electronAPI.onScormInspectorDataUpdated((data) => {
      if (data && data.type === 'course-outline:refresh-required') {
        eventBus.emit('course-outline:refresh-required', data);
      }
    });

    rendererLogger.info('SCORM event forwarding initialized successfully');
  } catch (error) {
    rendererLogger.error('Failed to initialize SCORM event forwarding:', error);
  }
}

/**
 * Initialize the application when DOM is ready
 */
async function initializeApplication() {
  try {
    // Wait for electronAPI to be ready
    await waitForElectronAPI();

    // Set up SCORM event forwarding
    await setupScormEventForwarding();

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