// @ts-check

import { ipcClient } from './ipc-client.js';
import { eventBus } from './event-bus.js';
import { rendererLogger } from '../utils/renderer-logger.js';

/**
 * Initialize IPC -> EventBus forwarding
 */
export async function initialize() {
  try {
    ipcClient.onActivityProgressUpdated((data) => {
      try { eventBus.emit('activity:progress:updated', data); } catch (_) {}
    });

    ipcClient.onObjectivesUpdated((data) => {
      try { eventBus.emit('objectives:updated', data); } catch (_) {}
    });

    ipcClient.onNavigationCompleted((data) => {
      try { eventBus.emit('navigation:completed', data); } catch (_) {}
    });

    ipcClient.onScormApiCallLogged((data) => {
      try {
        if (data && data.event === 'sn:initialized') {
          eventBus.emit('sn:initialized', data);
        }
      } catch (_) {}
    });

    ipcClient.onScormInspectorDataUpdated((data) => {
      try {
        if (data && data.type === 'course-outline:refresh-required') {
          eventBus.emit('course-outline:refresh-required', data);
        }
      } catch (_) {}
    });

    rendererLogger.info('ipc-events-forwarder: initialized');
    return { success: true };
  } catch (e) {
    rendererLogger.error('ipc-events-forwarder: failed to initialize', e?.message || e);
    return { success: false, error: e?.message || String(e) };
  }
}

