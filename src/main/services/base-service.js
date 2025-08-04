/**
 * Base Service Class for SCORM Tester Main Process Services
 * 
 * Provides common functionality and interface for all Phase 4 main process services.
 * Implements service lifecycle management, error handling, and event emission patterns.
 * 
 * @fileoverview Base service class with common service patterns
 */

const EventEmitter = require('events');
const { 
  SERVICE_STATES, 
  SERVICE_EVENTS, 
  PERFORMANCE_THRESHOLDS 
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');

/**
 * Base Service Class
 * 
 * All Phase 4 main process services extend this base class to ensure
 * consistent lifecycle management, error handling, and event patterns.
 */
class BaseService extends EventEmitter {
  /**
   * Initialize base service
   * @param {string} serviceName - Name of the service
   * @param {Object} errorHandler - Shared error handler instance
   * @param {Object} logger - Logger instance
   * @param {Object} options - Service-specific options
   */
  constructor(serviceName, errorHandler, logger, options = {}) {
    super();
    
    this.serviceName = serviceName;
    this.errorHandler = errorHandler;
    this.logger = logger;
    this.options = options;
    
    // Service state management
    this.state = SERVICE_STATES.NOT_INITIALIZED;
    this.initializationTime = null;
    this.lastError = null;
    this.dependencies = new Map();
    this.metrics = {
      startTime: null,
      operationCount: 0,
      errorCount: 0,
      lastOperation: null
    };
    
    if (this.logger && typeof this.logger.debug === 'function') {
      this.logger.debug(`${this.serviceName} base service created`);
    }
  }

  /**
   * Initialize the service
   * @param {Map} dependencies - Service dependencies
   * @returns {Promise<boolean>} True if initialization successful
   */
  async initialize(dependencies = new Map()) {
    const startTime = Date.now();
    
    try {
      this.logger?.info(`Initializing ${this.serviceName} service`);
      this.setState(SERVICE_STATES.INITIALIZING);
      this.emit(SERVICE_EVENTS.INITIALIZING, { serviceName: this.serviceName });
      
      // Store dependencies
      this.dependencies = dependencies;
      
      // Validate dependencies
      if (!this.validateDependencies()) {
        throw new Error('Service dependency validation failed');
      }
      
      // Perform service-specific initialization
      await this.doInitialize();
      
      // Record initialization metrics
      this.initializationTime = Date.now() - startTime;
      this.metrics.startTime = Date.now();
      
      // Check performance threshold
      if (this.initializationTime > PERFORMANCE_THRESHOLDS.SERVICE_INITIALIZATION) {
        this.logger?.warn(`${this.serviceName} initialization took ${this.initializationTime}ms (threshold: ${PERFORMANCE_THRESHOLDS.SERVICE_INITIALIZATION}ms)`);
      }
      
      this.setState(SERVICE_STATES.READY);
      this.emit(SERVICE_EVENTS.READY, { 
        serviceName: this.serviceName, 
        initializationTime: this.initializationTime 
      });
      
      this.logger?.info(`${this.serviceName} service initialized successfully in ${this.initializationTime}ms`);
      return true;
      
    } catch (error) {
      this.lastError = error;
      this.setState(SERVICE_STATES.ERROR);
      
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SERVICE_INITIALIZATION_FAILED,
        `${this.serviceName} initialization failed: ${error.message}`,
        'BaseService.initialize'
      );
      
      this.emit(SERVICE_EVENTS.ERROR, { 
        serviceName: this.serviceName, 
        error: error.message 
      });
      
      this.logger?.error(`${this.serviceName} service initialization failed:`, error);
      return false;
    }
  }

  /**
   * Shutdown the service gracefully
   * @returns {Promise<boolean>} True if shutdown successful
   */
  async shutdown() {
    try {
      this.logger?.info(`Shutting down ${this.serviceName} service`);
      this.setState(SERVICE_STATES.SHUTTING_DOWN);
      this.emit(SERVICE_EVENTS.SHUTTING_DOWN, { serviceName: this.serviceName });
      
      // Perform service-specific shutdown
      await this.doShutdown();
      
      this.setState(SERVICE_STATES.SHUTDOWN);
      this.emit(SERVICE_EVENTS.SHUTDOWN, { serviceName: this.serviceName });
      
      this.logger?.info(`${this.serviceName} service shutdown completed`);
      return true;
      
    } catch (error) {
      this.lastError = error;
      this.setState(SERVICE_STATES.ERROR);
      
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.SERVICE_SHUTDOWN_FAILED,
        `${this.serviceName} shutdown failed: ${error.message}`,
        'BaseService.shutdown'
      );
      
      this.logger?.error(`${this.serviceName} service shutdown failed:`, error);
      return false;
    }
  }

  /**
   * Get service status information
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      serviceName: this.serviceName,
      state: this.state,
      isReady: this.isReady(),
      initializationTime: this.initializationTime,
      lastError: this.lastError?.message || null,
      metrics: {
        ...this.metrics,
        uptime: this.metrics.startTime ? Date.now() - this.metrics.startTime : 0
      },
      dependencies: Array.from(this.dependencies.keys())
    };
  }

  /**
   * Check if service is ready for operations
   * @returns {boolean} True if service is ready
   */
  isReady() {
    return this.state === SERVICE_STATES.READY || this.state === SERVICE_STATES.RUNNING;
  }

  /**
   * Get service dependency
   * @param {string} dependencyName - Name of dependency
   * @returns {Object|null} Dependency instance or null
   */
  getDependency(dependencyName) {
    return this.dependencies.get(dependencyName) || null;
  }

  /**
   * Record operation metrics
   * @protected
   * @param {string} operationName - Name of operation
   * @param {boolean} success - Whether operation was successful
   */
  recordOperation(operationName, success = true) {
    this.metrics.operationCount++;
    this.metrics.lastOperation = {
      name: operationName,
      timestamp: Date.now(),
      success
    };
    
    if (!success) {
      this.metrics.errorCount++;
    }
  }

  /**
   * Set service state and emit state change event
   * @protected
   * @param {string} newState - New service state
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    this.logger?.debug(`${this.serviceName} state changed: ${oldState} -> ${newState}`);
    this.emit('stateChanged', { serviceName: this.serviceName, oldState, newState });
  }

  /**
   * Validate service dependencies (override in subclasses)
   * @protected
   * @returns {boolean} True if dependencies are valid
   */
  validateDependencies() {
    // Base implementation - override in subclasses
    return true;
  }

  /**
   * Perform service-specific initialization (override in subclasses)
   * @protected
   * @returns {Promise<void>}
   */
  async doInitialize() {
    // Base implementation - override in subclasses
  }

  /**
   * Perform service-specific shutdown (override in subclasses)
   * @protected
   * @returns {Promise<void>}
   */
  async doShutdown() {
    // Base implementation - override in subclasses
  }
}

module.exports = BaseService;