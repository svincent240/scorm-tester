// @ts-check

/**
 * Event Bus Service
 *
 * Provides centralized event communication between renderer components.
 * Enables loose coupling and clean separation of concerns.
 *
 * @fileoverview Event bus for inter-component communication
 */

/**
 * Event Bus Class
 *
 * Manages event subscriptions, emissions, and cleanup for renderer components.
 */
class EventBus {
  constructor() {
    this.listeners = new Map();
    this.history = [];
    this.maxHistorySize = 100;
    this.debugMode = false;

    // Lightweight debug buffers for diagnostics without console usage
    this.debug = {
      lastEvents: [],
      maxEvents: 200,
      lastLogs: [],
      maxLogs: 500
    };

    // Reentrancy and cycle guards
    this._inFlightCounts = new Map();   // event -> depth
    this._maxSyncDepth = 12;            // cap synchronous nesting per event
    this._recentRing = [];              // recent event names for cycle detection
    this._recentRingMax = 20;
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @param {Object} context - Optional context for handler
   * @returns {Function} Unsubscribe function
   */
  on(event, handler, context = null) {
    if (typeof event !== 'string' || typeof handler !== 'function') {
      throw new Error('Invalid event subscription parameters');
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const subscription = { handler, context, id: Date.now() + Math.random() };
    this.listeners.get(event).push(subscription);

    if (this.debugMode) {
      import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug(`EventBus: Subscribed to '${event}' (${this.listeners.get(event).length} total)`);
      });
    }

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function to remove
   */
  off(event, handler) {
    if (!this.listeners.has(event)) return;

    const eventListeners = this.listeners.get(event);
    const index = eventListeners.findIndex(sub => sub.handler === handler);

    if (index !== -1) {
      eventListeners.splice(index, 1);

      if (eventListeners.length === 0) {
        this.listeners.delete(event);
      }

      if (this.debugMode) {
        import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.debug(`EventBus: Unsubscribed from '${event}' (${eventListeners.length} remaining)`);
        });
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data = null) {
    if (typeof event !== 'string') {
      throw new Error('Event name must be a string');
    }

    // Prevent misuse: EventBus is for UI events only. Disallow SCORM/debug/telemetry/api events here.
    try {
      const forbiddenPatterns = [/^scorm:/, /^debug:/, /^telemetry:/, /^api:/];
      for (const p of forbiddenPatterns) {
        if (p.test(event)) {
          // Log synchronously to console/renderer logger and throw to prevent accidental usage.
      try {
        import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger?.error(`EventBus: Forbidden event '${event}'. SCORM/debug/telemetry data must use direct IPC channels, not EventBus.`);
        }).catch(() => {
          // Fallback only - should not reach here in normal operation
        });
      } catch (_) {
        // Silent fallback - renderer logger should handle all cases
      }
          throw new Error(`EventBus: Forbidden event '${event}'. SCORM/debug/telemetry data must use direct IPC channels, not EventBus.`);
        }
      }
    } catch (validationErr) {
      // Fail fast for forbidden events
      throw validationErr;
    }

    // Depth guard (per event)
    const currentDepth = (this._inFlightCounts.get(event) || 0) + 1;
    this._inFlightCounts.set(event, currentDepth);
    if (currentDepth > this._maxSyncDepth) {
      // Drop further synchronous recursion to avoid stack overflow
      import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn(`EventBus: Dropping emit for '${event}' due to depth>${this._maxSyncDepth}`, { dataType: typeof data });
      }).catch(() => { /* no-op */ });
      // Decrement depth before returning
      this._inFlightCounts.set(event, currentDepth - 1);
      return;
    }

    // Basic short-cycle detection on recent pattern e.g., api:call <-> error
    try {
      this._recentRing.push(event);
      if (this._recentRing.length > this._recentRingMax) this._recentRing.shift();
      const len = this._recentRing.length;
      if (len >= 4) {
        const a = this._recentRing[len - 4];
        const b = this._recentRing[len - 3];
        const c = this._recentRing[len - 2];
        const d = this._recentRing[len - 1];
        const isABAB = (a === c) && (b === d) && (a !== b);
        if (isABAB) {
          import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
            rendererLogger.error(`EventBus: Detected repeating cycle '${a}' <-> '${b}', dropping '${event}'`);
          }).catch(() => { /* no-op */ });
          this._inFlightCounts.set(event, currentDepth - 1);
          return;
        }
      }
    } catch (_) { /* no-op */ }

    // Attach a lightweight correlation token for key events to help trace feedback paths
    const correlation = (() => {
      try {
        const base = (data && typeof data === 'object') ? (data._corr || null) : null;
        const token = base || (`${event}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`);
        return token;
      } catch (_) {
        return `${event}:${Date.now()}`;
      }
    })();

    const eventData = {
      event,
      data,
      timestamp: Date.now(),
      id: Date.now() + Math.random(),
      _corr: correlation
    };

    // Add to history
    this.history.push(eventData);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    // Mirror into debug ring when debugMode enabled (no console)
    if (this.debugMode) {
      try {
        this.debug.lastEvents.push(eventData);
        while (this.debug.lastEvents.length > (this.debug.maxEvents || 200)) this.debug.lastEvents.shift();
      } catch (_) { /* no-op */ }
      import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug(`EventBus: Emitting '${event}'`, data);
      }).catch(() => { /* no-op */ });
    }

    // Emit to subscribers
    try {
      if (this.listeners.has(event)) {
        const eventListeners = [...this.listeners.get(event)]; // Copy to avoid modification during iteration

        for (const subscription of eventListeners) {
          try {
            if (subscription.context) {
              subscription.handler.call(subscription.context, data, eventData);
            } else {
              subscription.handler(data, eventData);
            }
          } catch (error) {
            // Log error (file logger via IPC; no event emission here if in error path)
            import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
              rendererLogger.error(`EventBus: Error in event handler for '${event}'`, error?.message || error);
            }).catch(() => { /* no-op */ });

            // Only emit 'error' if:
            //  - The original event isn't 'error'
            //  - We are not already handling an 'error' at any depth
            //  - The current depth for 'error' is 0 (to avoid nested recursion)
            const errorDepth = this._inFlightCounts.get('error') || 0;
            const safeToEmitError = event !== 'error' && errorDepth === 0;

            if (safeToEmitError) {
              // Guard against emitting 'api:call' from error handlers and vice-versa tight loops
              const isApiCall = event === 'api:call';
              if (isApiCall) {
                // If api:call handler threw, we will emit a single 'error', but we must not allow it to cause more api:call in the same tick
                this.emit('error', { event, error, subscription: subscription.id });
              } else {
                // For other events, emit a single error as well
                this.emit('error', { event, error, subscription: subscription.id });
              }
            }
          }
        }
      }
    } finally {
      // Decrement depth counter
      this._inFlightCounts.set(event, currentDepth - 1);
    }
  }

  /**
   * Subscribe to an event only once
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @param {Object} context - Optional context for handler
   * @returns {Function} Unsubscribe function
   */
  once(event, handler, context = null) {
    const onceHandler = (data, eventData) => {
      handler.call(context, data, eventData);
      this.off(event, onceHandler);
    };

    return this.on(event, onceHandler, context);
  }

  /**
   * Remove all listeners for an event or all events
   * @param {string} [event] - Specific event to clear, or all if not provided
   */
  clear(event = null) {
    if (event) {
      this.listeners.delete(event);
      if (this.debugMode) {
        import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.debug(`EventBus: Cleared all listeners for '${event}'`);
        });
      }
    } else {
      this.listeners.clear();
      if (this.debugMode) {
        import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.debug('EventBus: Cleared all listeners');
        });
      }
    }
  }

  /**
   * Get event history
   * @param {string} [event] - Filter by specific event
   * @param {number} [limit] - Limit number of results
   * @returns {Array} Event history
   */
  getHistory(event = null, limit = null) {
    let history = [...this.history];

    if (event) {
      history = history.filter(item => item.event === event);
    }

    if (limit && limit > 0) {
      history = history.slice(-limit);
    }

    return history;
  }

  /**
   * Get current listener count
   * @param {string} [event] - Specific event to count
   * @returns {number} Number of listeners
   */
  getListenerCount(event = null) {
    if (event) {
      return this.listeners.has(event) ? this.listeners.get(event).length : 0;
    }

    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.length;
    }
    return total;
  }

  /**
   * Get all registered events
   * @returns {Array<string>} Array of event names
   */
  getEvents() {
    return Array.from(this.listeners.keys());
  }

  /**
   * Enable or disable debug mode
   * @param {boolean} enabled - Debug mode state
   */
  setDebugMode(enabled) {
    this.debugMode = Boolean(enabled);
    // Use a local cached logger with no-op fallback to avoid undefined during early startup
    if (!this._logger) {
      this._logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      };
      // Initialize asynchronously; do not block or throw if import fails
      import('../utils/renderer-logger.js')
        .then(({ rendererLogger }) => {
          if (rendererLogger) this._logger = rendererLogger;
        })
        .catch(() => { /* keep no-op */ });
    }
    try {
      this._logger.info(`EventBus: Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    } catch (_) { /* no-op */ }
  }

  /**
   * Destroy the event bus and clean up all listeners
   */
  destroy() {
    this.clear();
    this.history = [];
    if (this.debugMode) {
      import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug('EventBus: Destroyed');
      });
    }
  }
}

// Create and export singleton instance
const eventBus = new EventBus();

// Provide lightweight debug selectors for diagnostics panels
eventBus.getDebugSnapshot = (limit = 200) => {
  try {
    const arr = eventBus.debug?.lastEvents || [];
    return arr.slice(-Math.max(1, Math.min(limit, eventBus.debug.maxEvents || 200)));
  } catch (_) {
    return [];
  }
};

// Enable debug mode default off; UIState will control later (step 8).
try {
  eventBus.setDebugMode(false);
} catch (_) {
  // no-op
}

export { EventBus, eventBus };
