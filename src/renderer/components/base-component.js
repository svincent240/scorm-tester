/**
 * Base Component Class
 * 
 * Provides common functionality for all UI components including
 * event handling, lifecycle management, and DOM utilities.
 * 
 * @fileoverview Base class for all renderer components
 */


/**
 * Base Component Class
 * 
 * Abstract base class that provides common functionality for all UI components.
 */
class BaseComponent {
  constructor(elementId, options = {}) {
    if (new.target === BaseComponent) {
      throw new Error('BaseComponent is abstract and cannot be instantiated directly');
    }

    this.elementId = elementId;
    this.element = null;
    this.options = { ...this.getDefaultOptions(), ...options };
    this.isInitialized = false;
    this.isDestroyed = false;
    this.eventListeners = new Map();
    this.childComponents = new Map();
    this.unsubscribeFunctions = [];
    
    this.bindMethods();
  }

  /**
   * Get default options for the component
   * @returns {Object} Default options
   */
  getDefaultOptions() {
    return {
      autoRender: true,
      className: '',
      attributes: {},
      events: {},
      template: null
    };
  }

  /**
   * Initialize the component with better error handling
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      this.log('warn', 'Component already initialized', { elementId: this.elementId });
      return;
    }

    if (this.isDestroyed) {
      throw new Error(`Component ${this.constructor.name} has been destroyed and cannot be reinitialized`);
    }

    try {
      this.log('debug', 'Starting component initialization');
      
      // Find or create element
      this.element = this.findOrCreateElement();
      
      // Load dependencies dynamically
      await this.loadDependencies();

      // Setup component with error boundary
      await this.safeSetup();
      
      // Render if auto-render is enabled
      if (this.options.autoRender) {
        this.safeRender();
      }
      
      // Bind events with error boundary
      this.safeBindEvents();
      
      // Setup event bus subscriptions with error boundary
      this.safeSetupEventSubscriptions();
      
      this.isInitialized = true;
      this.log('debug', 'Component initialization completed');
      this.emit('initialized');
      
    } catch (error) {
      this.log('error', 'Component initialization failed:', error);
      
      // Cleanup partial initialization
      try {
        this.destroy();
      } catch (cleanupError) {
        console.error('Error during cleanup after failed initialization:', cleanupError);
      }
      
      throw error;
    }
  }

  /**
   * Dynamically load dependencies for the component.
   * @returns {Promise<void>}
   */
  async loadDependencies() {
    try {
      this.eventBus = (await import('../services/event-bus.js')).eventBus;
      this.uiState = await (await import('../services/ui-state.js')).uiState;
    } catch (error) {
      console.error(`Error loading dependencies for ${this.constructor.name}:`, error);
      throw error;
    }
  }

  /**
   * Setup component (override in subclasses)
   * @returns {Promise<void>}
   */
  async setup() {
    // Override in subclasses
  }

  /**
   * Safe wrapper for setup with error boundary
   * @returns {Promise<void>}
   */
  async safeSetup() {
    try {
      await this.setup();
    } catch (error) {
      this.log('error', 'Component setup failed:', error);
      this.showErrorState('Setup Error', `Failed to setup ${this.constructor.name}: ${error.message}`);
      // Don't rethrow - allow component to continue in degraded mode
    }
  }

  /**
   * Render the component
   */
  render() {
    if (!this.element) {
      throw new Error('Element not found for component');
    }

    // Apply CSS classes
    if (this.options.className) {
      this.element.className = this.options.className;
    }

    // Apply attributes
    Object.entries(this.options.attributes).forEach(([key, value]) => {
      this.element.setAttribute(key, value);
    });

    // Render content
    this.renderContent();
    
    this.emit('rendered');
  }

  /**
   * Safe wrapper for render with error boundary
   */
  safeRender() {
    try {
      this.render();
    } catch (error) {
      this.log('error', 'Component render failed:', error);
      this.showErrorState('Render Error', `Failed to render ${this.constructor.name}: ${error.message}`);
    }
  }

  /**
   * Render component content (override in subclasses)
   */
  renderContent() {
    if (this.options.template) {
      this.element.innerHTML = this.options.template;
    }
  }

  /**
   * Update component with new data
   * @param {Object} data - Update data
   */
  update(data) {
    this.emit('beforeUpdate', data);
    this.handleUpdate(data);
    this.emit('updated', data);
  }

  /**
   * Handle component update (override in subclasses)
   * @param {Object} data - Update data
   */
  handleUpdate(data) {
    // Override in subclasses
  }

  /**
   * Show the component
   */
  show() {
    if (this.element) {
      this.element.style.display = '';
      this.element.classList.remove('hidden');
      this.emit('shown');
    }
  }

  /**
   * Hide the component
   */
  hide() {
    if (this.element) {
      this.element.style.display = 'none';
      this.element.classList.add('hidden');
      this.emit('hidden');
    }
  }

  /**
   * Toggle component visibility
   */
  toggle() {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if component is visible
   * @returns {boolean} Visibility state
   */
  isVisible() {
    if (!this.element) return false;
    return this.element.style.display !== 'none' && !this.element.classList.contains('hidden');
  }

  /**
   * Enable the component
   */
  enable() {
    if (this.element) {
      this.element.classList.remove('disabled');
      if (this.element.disabled !== undefined) {
        this.element.disabled = false;
      }
      this.emit('enabled');
    }
  }

  /**
   * Disable the component
   */
  disable() {
    if (this.element) {
      this.element.classList.add('disabled');
      if (this.element.disabled !== undefined) {
        this.element.disabled = true;
      }
      this.emit('disabled');
    }
  }

  /**
   * Add event listener to component element
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - Event options
   */
  addEventListener(event, handler, options = {}) {
    if (!this.element) return;

    const boundHandler = handler.bind(this);
    this.element.addEventListener(event, boundHandler, options);
    
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push({ handler, boundHandler, options });
  }

  /**
   * Remove event listener from component element
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  removeEventListener(event, handler) {
    if (!this.element || !this.eventListeners.has(event)) return;

    const listeners = this.eventListeners.get(event);
    const index = listeners.findIndex(l => l.handler === handler);
    
    if (index !== -1) {
      const listener = listeners[index];
      this.element.removeEventListener(event, listener.boundHandler, listener.options);
      listeners.splice(index, 1);
      
      if (listeners.length === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Emit component event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data = null) {
    if (!this.eventBus) {
      console.warn(`EventBus not loaded for ${this.constructor.name}. Cannot emit event: ${event}`);
      return;
    }
    const eventData = {
      component: this.constructor.name,
      elementId: this.elementId,
      data
    };
    
    this.eventBus.emit(`component:${event}`, eventData);
    this.eventBus.emit(`${this.constructor.name.toLowerCase()}:${event}`, eventData);
  }

  /**
   * Subscribe to event bus events
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(event, handler) {
    if (!this.eventBus) {
      throw new Error('EventBus not loaded. Ensure loadDependencies() is called before subscribing.');
    }
    const unsubscribe = this.eventBus.on(event, handler.bind(this));
    this.unsubscribeFunctions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Add child component
   * @param {string} name - Child component name
   * @param {BaseComponent} component - Child component instance
   */
  addChild(name, component) {
    if (!(component instanceof BaseComponent)) {
      throw new Error('Child must be an instance of BaseComponent');
    }
    
    this.childComponents.set(name, component);
    this.emit('childAdded', { name, component });
  }

  /**
   * Remove child component
   * @param {string} name - Child component name
   */
  removeChild(name) {
    const component = this.childComponents.get(name);
    if (component) {
      component.destroy();
      this.childComponents.delete(name);
      this.emit('childRemoved', { name, component });
    }
  }

  /**
   * Get child component
   * @param {string} name - Child component name
   * @returns {BaseComponent|null} Child component
   */
  getChild(name) {
    return this.childComponents.get(name) || null;
  }

  /**
   * Find element by selector within component
   * @param {string} selector - CSS selector
   * @returns {Element|null} Found element
   */
  find(selector) {
    return this.element ? this.element.querySelector(selector) : null;
  }

  /**
   * Find all elements by selector within component
   * @param {string} selector - CSS selector
   * @returns {NodeList} Found elements
   */
  findAll(selector) {
    return this.element ? this.element.querySelectorAll(selector) : [];
  }

  /**
   * Destroy the component and clean up resources
   */
  destroy() {
    if (this.isDestroyed) return;

    this.emit('beforeDestroy');

    try {
      // Destroy child components first
      for (const [name, component] of this.childComponents) {
        try {
          component.destroy();
        } catch (error) {
          console.error(`Error destroying child component ${name}:`, error);
        }
      }
      this.childComponents.clear();

      // Remove event listeners
      this.removeAllEventListeners();

      // Unsubscribe from event bus
      this.unsubscribeFunctions.forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing from event bus:', error);
        }
      });
      this.unsubscribeFunctions = [];

      // Only remove element if it was created by this component
      if (this.element && this.options.removeOnDestroy !== false) {
        if (this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
      }

      // Clear references
      this.element = null;
      this.eventBus = null;
      this.options = null;
      
    } finally {
      // Always mark as destroyed, even if cleanup failed
      this.isDestroyed = true;
      this.isInitialized = false;
    }

    this.emit('destroyed');
  }

  /**
   * Find or create the component element
   * @private
   */
  findOrCreateElement() {
    let element = document.getElementById(this.elementId);
    
    if (!element) {
      // Only create element if explicitly requested
      if (this.options.createIfNotFound !== false) {
        element = document.createElement('div');
        element.id = this.elementId;
        
        // Add to document if no parent specified
        const parent = this.options.parent 
          ? (typeof this.options.parent === 'string'
              ? document.getElementById(this.options.parent)
              : this.options.parent)
          : document.body;
        
        if (parent) {
          parent.appendChild(element);
        } else {
          throw new Error(`Parent element not found for component ${this.elementId}`);
        }
      } else {
        throw new Error(`Required element with id '${this.elementId}' not found in DOM`);
      }
    }
    
    return element;
  }

  /**
   * Bind critical component methods to this context
   * @private
   */
  bindMethods() {
    // Only bind methods that are commonly used as event handlers
    const methodsToBind = [
      'handleUpdate', 'show', 'hide', 'toggle', 'enable', 'disable',
      'destroy', 'setupEventSubscriptions', 'renderContent'
    ];
    
    methodsToBind.forEach(method => {
      if (typeof this[method] === 'function') {
        this[method] = this[method].bind(this);
      }
    });
  }

  /**
   * Bind component events
   * @private
   */
  bindEvents() {
    Object.entries(this.options.events).forEach(([event, handler]) => {
      if (typeof handler === 'string' && typeof this[handler] === 'function') {
        this.addEventListener(event, this[handler]);
      } else if (typeof handler === 'function') {
        this.addEventListener(event, handler);
      }
    });
  }

  /**
   * Safe wrapper for bindEvents with error boundary
   */
  safeBindEvents() {
    try {
      this.bindEvents();
    } catch (error) {
      this.log('error', 'Component event binding failed:', error);
      this.showErrorState('Event Binding Error', `Failed to bind events for ${this.constructor.name}: ${error.message}`);
    }
  }

  /**
   * Setup event bus subscriptions (override in subclasses)
   * @private
   */
  setupEventSubscriptions() {
    // Override in subclasses
  }

  /**
   * Safe wrapper for setupEventSubscriptions with error boundary
   */
  safeSetupEventSubscriptions() {
    try {
      this.setupEventSubscriptions();
    } catch (error) {
      this.log('error', 'Component event subscription setup failed:', error);
      this.showErrorState('Event Subscription Error', `Failed to setup event subscriptions for ${this.constructor.name}: ${error.message}`);
    }
  }

  /**
   * Remove all event listeners
   * @private
   */
  removeAllEventListeners() {
    for (const [event, listeners] of this.eventListeners) {
      listeners.forEach(listener => {
        this.element.removeEventListener(event, listener.boundHandler, listener.options);
      });
    }
    this.eventListeners.clear();
  }

  /**
   * Get component status
   * @returns {Object} Component status
   */
  getStatus() {
    return {
      elementId: this.elementId,
      className: this.constructor.name,
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed,
      isVisible: this.element ? this.isVisible() : false,
      hasElement: !!this.element,
      childCount: this.childComponents.size,
      eventListenerCount: Array.from(this.eventListeners.values())
        .reduce((sum, listeners) => sum + listeners.length, 0),
      subscriptionCount: this.unsubscribeFunctions.length
    };
  }
  
  /**
   * Set logger for the component
   */
  setLogger(logger) {
    this.logger = logger;
  }
  
  /**
   * Log component events (if logger is available)
   */
  log(level, message, data = null) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](`[${this.constructor.name}] ${message}`, data);
    }
  }

  /**
   * Show error state in component
   */
  showErrorState(title, message) {
    if (!this.element) return;
    
    if (this.uiState) {
      this.uiState.showNotification({
        message: `${title}: ${message}`,
        type: 'error',
        duration: 0 // Persistent until dismissed
      });
    } else {
      // Fallback to console error if uiState is not available
      console.error(`BaseComponent Error: ${title} - ${message}`);
    }
    
    // Remove the old error display if it exists
    const oldErrorDisplay = this.element.querySelector('.component-error');
    if (oldErrorDisplay) {
      oldErrorDisplay.remove();
    }
    
    // Remove the dynamically injected style if it exists
    const oldStyle = document.querySelector('#component-error-styles');
    if (oldStyle) {
      oldStyle.remove();
    }
  }
}

export { BaseComponent };