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
   * Initialize the component
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      throw new Error(`Component ${this.constructor.name} is already initialized`);
    }

    if (this.isDestroyed) {
      throw new Error(`Component ${this.constructor.name} has been destroyed`);
    }

    try {
      // Find or create element
      this.element = this.findOrCreateElement();
      
      // Load dependencies dynamically
      await this.loadDependencies();

      // Setup component
      await this.setup();
      
      // Render if auto-render is enabled
      if (this.options.autoRender) {
        this.render();
      }
      
      // Bind events
      this.bindEvents();
      
      // Setup event bus subscriptions
      this.setupEventSubscriptions();
      
      this.isInitialized = true;
      this.emit('initialized');
      
    } catch (error) {
      console.error(`Error initializing component ${this.constructor.name}:`, error);
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

    // Destroy child components
    for (const [name, component] of this.childComponents) {
      component.destroy();
    }
    this.childComponents.clear();

    // Remove event listeners
    this.removeAllEventListeners();

    // Unsubscribe from event bus
    this.unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    this.unsubscribeFunctions = [];

    // Clean up element
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.isDestroyed = true;
    this.isInitialized = false;
    this.element = null;

    this.emit('destroyed');
  }

  /**
   * Find or create the component element
   * @private
   */
  findOrCreateElement() {
    console.log(`DEBUG: BaseComponent.findOrCreateElement() called for elementId: '${this.elementId}'`);
    let element = document.getElementById(this.elementId);
    console.log(`DEBUG: Element found:`, !!element);
    
    if (!element) {
      console.log(`DEBUG: Creating new element with id: '${this.elementId}'`);
      element = document.createElement('div');
      element.id = this.elementId;
      
      // Add to document if no parent specified
      if (!this.options.parent) {
        document.body.appendChild(element);
      } else {
        const parent = typeof this.options.parent === 'string'
          ? document.getElementById(this.options.parent)
          : this.options.parent;
        
        if (parent) {
          parent.appendChild(element);
        } else {
          document.body.appendChild(element);
        }
      }
    }
    
    console.log(`DEBUG: Returning element:`, !!element, element?.id);
    return element;
  }

  /**
   * Bind component methods to this context
   * @private
   */
  bindMethods() {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this))
      .filter(name => name !== 'constructor' && typeof this[name] === 'function');
    
    methods.forEach(method => {
      this[method] = this[method].bind(this);
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
   * Setup event bus subscriptions (override in subclasses)
   * @private
   */
  setupEventSubscriptions() {
    // Override in subclasses
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
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed,
      isVisible: this.isVisible(),
      childCount: this.childComponents.size,
      eventListenerCount: Array.from(this.eventListeners.values()).reduce((sum, listeners) => sum + listeners.length, 0)
    };
  }
}

export { BaseComponent };