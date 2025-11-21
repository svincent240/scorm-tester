// @ts-check

import { ipcClient } from './ipc-client.js';
import { eventBus } from './event-bus.js';
import { rendererLogger } from '../utils/renderer-logger.js';

/**
 * Initialize IPC -> EventBus forwarding
 */
export async function initialize() {
  try {
    ipcClient.onActivityProgressUpdated(async (data) => {
      try { 
        eventBus.emit('activity:progress:updated', data); 
        
        // Update UIState with complete progress data from main process
        // Main process assembles complete snapshot per architectural spec
        const { uiState: uiStatePromise } = await import('./ui-state.js');
        const uiState = await uiStatePromise;
        
        // Parse numeric values that come as strings from SCORM data model
        const progressUpdate = {
          completionStatus: data.completionStatus,
          successStatus: data.successStatus,
          scoreRaw: data.scoreRaw ? (parseFloat(data.scoreRaw) || null) : null,
          progressMeasure: data.progressMeasure ? (parseFloat(data.progressMeasure) || 0) : 0,
          sessionTime: data.sessionTime || '',
          totalTime: data.totalTime || '',
          location: data.location || '',
          suspendData: data.suspendData || ''
        };
        
        uiState.updateProgress(progressUpdate);
      } catch (_) { /* intentionally empty */ }
    });

    ipcClient.onObjectivesUpdated((data) => {
      try { eventBus.emit('objectives:updated', data); } catch (_) { /* intentionally empty */ }
    });

    ipcClient.onNavigationCompleted((data) => {
      try { eventBus.emit('navigation:completed', data); } catch (_) { /* intentionally empty */ }
    });

    // NOTE: Do NOT forward course-loaded IPC event to course:loaded EventBus event
    // UIState.updateCourse() already emits course:loaded when CourseLoader updates the state
    // Forwarding this would cause duplicate course:loaded events and duplicate success notifications
    ipcClient.onCourseLoaded((data) => {
      // IPC event received but not forwarded to EventBus to prevent duplicates
      try { rendererLogger.debug('ipc-events-forwarder: course-loaded IPC event received (not forwarded to EventBus)'); } catch (_) { /* intentionally empty */ }
    });

    ipcClient.onCourseExited((data) => {
      try { eventBus.emit('course:exited', data); } catch (_) { /* intentionally empty */ }
    });

    // Forward diagnostic notifications to UI
    ipcClient.onScormDiagnosticNotification(async (data) => {
      try {
        const { uiState: uiStatePromise } = await import('./ui-state.js');
        const uiState = await uiStatePromise;
        uiState.showNotification({
          type: data.type || 'info',
          message: data.message,
          duration: data.duration || 5000
        });
      } catch (_) { /* intentionally empty */ }
    });

    ipcClient.onScormApiCallLogged((data) => {
      try {
        if (data && data.event === 'sn:initialized') {
          eventBus.emit('sn:initialized', data);
        }
      } catch (_) { /* intentionally empty */ }
    });

    ipcClient.onScormInspectorDataUpdated((data) => {
      try {
        if (data && data.type === 'course-outline:refresh-required') {
          eventBus.emit('course-outline:refresh-required', data);
        }
      } catch (_) { /* intentionally empty */ }
    });

    // Forward console errors from main process to EventBus for UI display
    ipcClient.onRendererConsoleError((data) => {
      try {
        eventBus.emit('renderer:console-error', data);
      } catch (_) { /* intentionally empty */ }
    });

    // Forward viewport size changes from main process to EventBus
    ipcClient.onViewportSizeChanged((data) => {
      try {
        eventBus.emit('viewport:size-changed', data);
      } catch (_) { /* intentionally empty */ }
    });

    rendererLogger.info('ipc-events-forwarder: initialized');
    return { success: true };
  } catch (e) {
    rendererLogger.error('ipc-events-forwarder: failed to initialize', e?.message || e);
    return { success: false, error: e?.message || String(e) };
  }
}

