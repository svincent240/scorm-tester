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
      console.debug(`EventBus: Subscribed to '${event}' (${this.listeners.get(event).length} total)`);
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
        console.debug(`EventBus: Unsubscribed from '${event}' (${eventListeners.length} remaining)`);
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

    const eventData = {
      event,
      data,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    };

    // Add to history
    this.history.push(eventData);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    if (this.debugMode) {
      console.debug(`EventBus: Emitting '${event}'`, data);
    }

    // Emit to subscribers
    if (this.listeners.has(event)) {
      const eventListeners = [...this.listeners.get(event)]; // Copy to avoid modification during iteration
      
      eventListeners.forEach(subscription => {
        try {
          if (subscription.context) {
            subscription.handler.call(subscription.context, data, eventData);
          } else {
            subscription.handler(data, eventData);
          }
        } catch (error) {
          console.error(`EventBus: Error in event handler for '${event}':`, error);
          // CRITICAL FIX: Prevent infinite recursion by not emitting 'error' event
          // Only emit error event if it's not already an error event to prevent loops
          if (event !== 'error') {
            this.emit('error', { event, error, subscription: subscription.id });
          }
        }
      });
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
        console.debug(`EventBus: Cleared all listeners for '${event}'`);
      }
    } else {
      this.listeners.clear();
      if (this.debugMode) {
        console.debug('EventBus: Cleared all listeners');
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
    console.log(`EventBus: Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Destroy the event bus and clean up all listeners
   */
  destroy() {
    this.clear();
    this.history = [];
    if (this.debugMode) {
      console.debug('EventBus: Destroyed');
    }
  }
}

// Create and export singleton instance
const eventBus = new EventBus();

// Enable debug mode in development
// Note: process.env is not available in renderer, so we'll enable debug mode by default
eventBus.setDebugMode(true);

export { EventBus, eventBus };