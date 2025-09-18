# IPC Error Handling Patterns

## Overview

Inter-Process Communication (IPC) between the Electron main and renderer processes requires robust error handling to ensure application stability. This document outlines comprehensive IPC error handling patterns implemented in the SCORM Inspector application.

## Core IPC Error Scenarios

### 1. ElectronAPI Availability Issues

**Problem:** The `window.electronAPI` object may not be available during initialization or may be missing specific methods.

**Solution:** Comprehensive availability checking with graceful degradation

```javascript
class IpcAvailabilityManager {
    constructor() {
        this.apiCheckTimeout = 5000; // 5 seconds
        this.checkInterval = 50; // 50ms intervals
        this.availabilityCache = new Map();
        this.pendingChecks = new Map();
    }

    // Core API availability checker with timeout
    async waitForElectronAPI(timeout = this.apiCheckTimeout) {
        // Check cache first
        if (this.availabilityCache.has('electronAPI')) {
            return this.availabilityCache.get('electronAPI');
        }

        // Check if already waiting
        if (this.pendingChecks.has('electronAPI')) {
            return await this.pendingChecks.get('electronAPI');
        }

        const checkPromise = this.performApiCheck(timeout);
        this.pendingChecks.set('electronAPI', checkPromise);

        try {
            const result = await checkPromise;
            this.availabilityCache.set('electronAPI', result);
            return result;
        } finally {
            this.pendingChecks.delete('electronAPI');
        }
    }

    async performApiCheck(timeout) {
        const startTime = Date.now();

        while (!window.electronAPI) {
            if (Date.now() - startTime > timeout) {
                safeLogger.error('Timeout waiting for electronAPI to be available');
                return false;
            }

            await new Promise(resolve => setTimeout(resolve, this.checkInterval));
        }

        safeLogger.log('ElectronAPI is available');
        return true;
    }

    // Check specific method availability
    async checkMethodAvailability(methodPath, timeout = 2000) {
        const cacheKey = `method:${methodPath}`;

        if (this.availabilityCache.has(cacheKey)) {
            return this.availabilityCache.get(cacheKey);
        }

        try {
            const apiAvailable = await this.waitForElectronAPI(timeout);
            if (!apiAvailable) {
                this.availabilityCache.set(cacheKey, false);
                return false;
            }

            // Navigate to method using dot notation
            const pathParts = methodPath.split('.');
            let current = window.electronAPI;

            for (const part of pathParts) {
                if (!current || typeof current[part] === 'undefined') {
                    safeLogger.warn(`Method ${methodPath} not available`);
                    this.availabilityCache.set(cacheKey, false);
                    return false;
                }
                current = current[part];
            }

            const isFunction = typeof current === 'function';
            this.availabilityCache.set(cacheKey, isFunction);

            if (!isFunction) {
                safeLogger.warn(`${methodPath} exists but is not a function`);
            }

            return isFunction;

        } catch (error) {
            safeLogger.error(`Error checking method availability ${methodPath}:`, error);
            this.availabilityCache.set(cacheKey, false);
            return false;
        }
    }

    // Clear cache (useful for testing or after errors)
    clearCache() {
        this.availabilityCache.clear();
        safeLogger.log('API availability cache cleared');
    }

    // Get current status
    getStatus() {
        return {
            electronApiAvailable: !!window.electronAPI,
            cacheSize: this.availabilityCache.size,
            pendingChecks: this.pendingChecks.size,
            cachedMethods: Array.from(this.availabilityCache.entries())
        };
    }
}

const ipcAvailability = new IpcAvailabilityManager();
```

### 2. IPC Method Call Error Handling

**Solution:** Standardized IPC call wrapper with retry logic and error classification

```javascript
class IpcCallManager {
    constructor() {
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 5000,
            backoffMultiplier: 2
        };
        this.circuitBreaker = new Map(); // method -> failure stats
        this.callStats = new Map(); // method -> success/failure counts
    }

    // Unified IPC method caller
    async callIpcMethod(methodPath, params = null, options = {}) {
        const {
            timeout = 10000,
            retries = this.retryConfig.maxRetries,
            circuitBreakerEnabled = true,
            fallbackValue = null,
            validateResponse = null
        } = options;

        // Check circuit breaker
        if (circuitBreakerEnabled && this.isCircuitOpen(methodPath)) {
            return this.createErrorResponse('Circuit breaker is open', 'CIRCUIT_OPEN');
        }

        // Record attempt
        this.recordAttempt(methodPath);

        try {
            // Check method availability
            const methodAvailable = await ipcAvailability.checkMethodAvailability(methodPath);
            if (!methodAvailable) {
                return this.createErrorResponse(`Method ${methodPath} not available`, 'METHOD_NOT_AVAILABLE', fallbackValue);
            }

            // Make the call with timeout
            const result = await Promise.race([
                this.makeIpcCall(methodPath, params),
                this.createTimeoutPromise(timeout, methodPath)
            ]);

            // Validate response if validator provided
            if (validateResponse && !validateResponse(result)) {
                throw new Error('Response validation failed');
            }

            // Record success
            this.recordSuccess(methodPath);
            return result;

        } catch (error) {
            // Record failure
            this.recordFailure(methodPath, error);

            // Classify error
            const errorType = this.classifyError(error);

            // Retry logic for retryable errors
            if (retries > 0 && this.isRetryableError(errorType)) {
                safeLogger.warn(`IPC call failed, retrying ${methodPath}:`, error.message);

                // Wait with exponential backoff
                await this.delay(this.calculateBackoffDelay(retries));

                return this.callIpcMethod(methodPath, params, {
                    ...options,
                    retries: retries - 1
                });
            }

            // Create error response
            return this.createErrorResponse(error.message, errorType, fallbackValue);
        }
    }

    async makeIpcCall(methodPath, params) {
        const pathParts = methodPath.split('.');
        let method = window.electronAPI;

        // Navigate to the method
        for (const part of pathParts) {
            method = method[part];
        }

        // Call the method
        if (params !== null) {
            return await method(params);
        } else {
            return await method();
        }
    }

    createTimeoutPromise(timeout, methodPath) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`IPC call timeout: ${methodPath} (${timeout}ms)`));
            }, timeout);
        });
    }

    classifyError(error) {
        const message = error.message.toLowerCase();

        if (message.includes('timeout')) {
            return 'TIMEOUT';
        } else if (message.includes('network') || message.includes('connection')) {
            return 'NETWORK_ERROR';
        } else if (message.includes('permission') || message.includes('access')) {
            return 'PERMISSION_ERROR';
        } else if (message.includes('not found') || message.includes('undefined')) {
            return 'METHOD_NOT_FOUND';
        } else if (message.includes('validation')) {
            return 'VALIDATION_ERROR';
        } else {
            return 'UNKNOWN_ERROR';
        }
    }

    isRetryableError(errorType) {
        const retryableErrors = ['TIMEOUT', 'NETWORK_ERROR', 'UNKNOWN_ERROR'];
        return retryableErrors.includes(errorType);
    }

    calculateBackoffDelay(retriesRemaining) {
        const attempt = this.retryConfig.maxRetries - retriesRemaining + 1;
        const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
            this.retryConfig.maxDelay
        );

        // Add jitter to prevent thundering herd
        return delay + Math.random() * 1000;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Circuit breaker implementation
    isCircuitOpen(methodPath) {
        const stats = this.circuitBreaker.get(methodPath);
        if (!stats) return false;

        const { failures, lastFailure, threshold = 5, resetTimeout = 60000 } = stats;

        // Reset circuit if timeout elapsed
        if (Date.now() - lastFailure > resetTimeout) {
            this.circuitBreaker.delete(methodPath);
            return false;
        }

        return failures >= threshold;
    }

    recordAttempt(methodPath) {
        const stats = this.callStats.get(methodPath) || { attempts: 0, successes: 0, failures: 0 };
        stats.attempts++;
        this.callStats.set(methodPath, stats);
    }

    recordSuccess(methodPath) {
        const stats = this.callStats.get(methodPath) || { attempts: 0, successes: 0, failures: 0 };
        stats.successes++;
        this.callStats.set(methodPath, stats);

        // Reset circuit breaker on success
        this.circuitBreaker.delete(methodPath);
    }

    recordFailure(methodPath, error) {
        const stats = this.callStats.get(methodPath) || { attempts: 0, successes: 0, failures: 0 };
        stats.failures++;
        this.callStats.set(methodPath, stats);

        // Update circuit breaker
        const circuitStats = this.circuitBreaker.get(methodPath) || { failures: 0, lastFailure: 0 };
        circuitStats.failures++;
        circuitStats.lastFailure = Date.now();
        this.circuitBreaker.set(methodPath, circuitStats);

        safeLogger.error(`IPC method ${methodPath} failed:`, error);
    }

    createErrorResponse(message, type = 'UNKNOWN_ERROR', fallbackValue = null) {
        return {
            success: false,
            error: message,
            errorType: type,
            timestamp: new Date().toISOString(),
            data: fallbackValue
        };
    }

    getStats() {
        return {
            callStats: Object.fromEntries(this.callStats),
            circuitBreakerStatus: Object.fromEntries(this.circuitBreaker),
            activeCircuits: Array.from(this.circuitBreaker.keys()).filter(method => this.isCircuitOpen(method))
        };
    }
}

const ipcCallManager = new IpcCallManager();
```

### 3. IPC Event Listener Error Handling

**Problem:** Event listeners may fail to register or may receive malformed data.

**Solution:** Safe event listener setup with error recovery

```javascript
class IpcEventManager {
    constructor() {
        this.registeredListeners = new Map();
        this.eventQueue = [];
        this.maxQueueSize = 1000;
        this.listenersReady = false;
        this.eventStats = new Map();
    }

    // Safe event listener registration
    async registerEventListener(eventName, handler, options = {}) {
        const {
            maxRetries = 3,
            retryDelay = 1000,
            queueEvents = true,
            validateData = null
        } = options;

        let attempts = 0;

        while (attempts < maxRetries) {
            try {
                // Ensure electronAPI is available
                const apiAvailable = await ipcAvailability.waitForElectronAPI();
                if (!apiAvailable) {
                    throw new Error('ElectronAPI not available');
                }

                // Check if method exists
                const methodName = `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;
                if (typeof window.electronAPI[methodName] !== 'function') {
                    throw new Error(`Event method ${methodName} not available`);
                }

                // Create safe wrapper handler
                const safeHandler = this.createSafeHandler(eventName, handler, validateData);

                // Register the listener
                window.electronAPI[methodName](safeHandler);

                // Track registration
                this.registeredListeners.set(eventName, {
                    originalHandler: handler,
                    safeHandler: safeHandler,
                    registeredAt: Date.now(),
                    eventCount: 0,
                    errorCount: 0
                });

                safeLogger.log(`Event listener registered successfully: ${eventName}`);

                // Process queued events if applicable
                if (queueEvents) {
                    this.processQueuedEvents(eventName);
                }

                return true;

            } catch (error) {
                attempts++;
                safeLogger.error(`Failed to register event listener ${eventName} (attempt ${attempts}):`, error);

                if (attempts < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    safeLogger.error(`Failed to register event listener ${eventName} after ${maxRetries} attempts`);
                    return false;
                }
            }
        }

        return false;
    }

    createSafeHandler(eventName, originalHandler, validateData) {
        return (data) => {
            const listenerInfo = this.registeredListeners.get(eventName);

            try {
                // Update event stats
                if (listenerInfo) {
                    listenerInfo.eventCount++;
                }

                this.recordEventReceived(eventName);

                // Validate data if validator provided
                if (validateData) {
                    const isValid = validateData(data);
                    if (!isValid) {
                        throw new Error(`Event data validation failed for ${eventName}`);
                    }
                }

                // Handle null/undefined data
                if (data === null || data === undefined) {
                    safeLogger.warn(`Received null/undefined data for event ${eventName}`);
                    data = {}; // Provide default empty object
                }

                // Call original handler with error boundary
                originalHandler(data);

            } catch (error) {
                // Update error stats
                if (listenerInfo) {
                    listenerInfo.errorCount++;
                }

                this.recordEventError(eventName, error);
                safeLogger.error(`Error in event handler for ${eventName}:`, error);

                // Don't let handler errors crash the application
                // Optionally queue for retry or notify error handling system
            }
        };
    }

    // Queue events if listeners aren't ready
    queueEvent(eventName, data) {
        if (this.eventQueue.length >= this.maxQueueSize) {
            // Remove oldest events to maintain size limit
            this.eventQueue.shift();
            safeLogger.warn('Event queue full, dropping oldest event');
        }

        this.eventQueue.push({
            eventName,
            data,
            timestamp: Date.now()
        });

        safeLogger.log(`Event queued: ${eventName} (queue size: ${this.eventQueue.length})`);
    }

    processQueuedEvents(eventName = null) {
        const eventsToProcess = eventName
            ? this.eventQueue.filter(event => event.eventName === eventName)
            : this.eventQueue;

        eventsToProcess.forEach(event => {
            const listenerInfo = this.registeredListeners.get(event.eventName);
            if (listenerInfo) {
                try {
                    listenerInfo.safeHandler(event.data);
                } catch (error) {
                    safeLogger.error(`Error processing queued event ${event.eventName}:`, error);
                }
            }
        });

        // Remove processed events from queue
        if (eventName) {
            this.eventQueue = this.eventQueue.filter(event => event.eventName !== eventName);
        } else {
            this.eventQueue = [];
        }

        safeLogger.log(`Processed ${eventsToProcess.length} queued events`);
    }

    recordEventReceived(eventName) {
        const stats = this.eventStats.get(eventName) || {
            received: 0,
            errors: 0,
            firstReceived: Date.now(),
            lastReceived: Date.now()
        };

        stats.received++;
        stats.lastReceived = Date.now();
        this.eventStats.set(eventName, stats);
    }

    recordEventError(eventName, error) {
        const stats = this.eventStats.get(eventName) || {
            received: 0,
            errors: 0,
            firstReceived: Date.now(),
            lastReceived: Date.now()
        };

        stats.errors++;
        this.eventStats.set(eventName, stats);
    }

    // Batch registration for multiple events
    async registerMultipleListeners(eventConfigs) {
        const results = await Promise.allSettled(
            eventConfigs.map(config =>
                this.registerEventListener(config.eventName, config.handler, config.options)
            )
        );

        const successful = results.filter(result => result.status === 'fulfilled' && result.value).length;
        const failed = results.length - successful;

        safeLogger.log(`Event listener registration: ${successful} successful, ${failed} failed`);

        return {
            successful,
            failed,
            results
        };
    }

    // Unregister event listeners (for cleanup)
    unregisterEventListener(eventName) {
        const listenerInfo = this.registeredListeners.get(eventName);
        if (listenerInfo) {
            // Note: Electron doesn't typically provide unregister methods
            // This is mainly for tracking purposes
            this.registeredListeners.delete(eventName);
            safeLogger.log(`Event listener unregistered: ${eventName}`);
            return true;
        }
        return false;
    }

    getEventStats() {
        return {
            registeredListeners: Array.from(this.registeredListeners.keys()),
            queuedEvents: this.eventQueue.length,
            eventStats: Object.fromEntries(this.eventStats)
        };
    }

    cleanup() {
        // Clear queued events
        this.eventQueue = [];

        // Clear stats
        this.eventStats.clear();

        // Note: Actual event listener cleanup would require cooperation from main process
        this.registeredListeners.clear();

        safeLogger.log('IPC Event Manager cleaned up');
    }
}

const ipcEventManager = new IpcEventManager();
```

### 4. SCORM Inspector Specific IPC Patterns

**Implementation:** Apply IPC error handling to SCORM Inspector methods

```javascript
class ScormInspectorIpc {
    constructor() {
        this.ipcCall = ipcCallManager;
        this.eventManager = ipcEventManager;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Register all SCORM Inspector event listeners
            const eventConfigs = [
                {
                    eventName: 'scormInspectorDataUpdated',
                    handler: (data) => this.handleDataUpdate(data),
                    options: {
                        validateData: this.validateApiCallData,
                        queueEvents: true
                    }
                },
                {
                    eventName: 'scormInspectorErrorUpdated',
                    handler: (errorData) => this.handleErrorUpdate(errorData),
                    options: {
                        validateData: this.validateErrorData,
                        queueEvents: true
                    }
                },
                {
                    eventName: 'scormDataModelUpdated',
                    handler: (dataModel) => this.handleDataModelUpdate(dataModel),
                    options: {
                        validateData: this.validateDataModel,
                        queueEvents: true
                    }
                },
                {
                    eventName: 'courseLoaded',
                    handler: () => this.handleCourseLoaded(),
                    options: { queueEvents: false }
                },
                {
                    eventName: 'sessionStateChanged',
                    handler: () => this.handleSessionStateChanged(),
                    options: { queueEvents: false }
                }
            ];

            const registrationResult = await this.eventManager.registerMultipleListeners(eventConfigs);

            if (registrationResult.failed > 0) {
                safeLogger.warn(`${registrationResult.failed} event listeners failed to register`);
            }

            this.initialized = true;
            safeLogger.log('SCORM Inspector IPC initialized successfully');

        } catch (error) {
            safeLogger.error('Failed to initialize SCORM Inspector IPC:', error);
            throw error;
        }
    }

    // Data validation functions
    validateApiCallData(data) {
        return data &&
               typeof data.method === 'string' &&
               typeof data.timestamp !== 'undefined';
    }

    validateErrorData(data) {
        return data &&
               typeof data.error === 'string' &&
               typeof data.timestamp !== 'undefined';
    }

    validateDataModel(data) {
        return data && typeof data === 'object';
    }

    // IPC method wrappers with error handling
    async getScormInspectorHistory() {
        return await this.ipcCall.callIpcMethod('getScormInspectorHistory', null, {
            timeout: 15000,
            fallbackValue: { history: [], errors: [], dataModel: {} },
            validateResponse: (response) => {
                return response &&
                       typeof response.success === 'boolean' &&
                       (response.success === false || response.data);
            }
        });
    }

    async getActivityTree() {
        return await this.ipcCall.callIpcMethod('getActivityTree', null, {
            timeout: 10000,
            fallbackValue: { activities: [] },
            validateResponse: (response) => response && typeof response.success === 'boolean'
        });
    }

    async getNavigationRequests() {
        return await this.ipcCall.callIpcMethod('getNavigationRequests', null, {
            timeout: 5000,
            fallbackValue: [],
            validateResponse: (response) => Array.isArray(response) ||
                                          (response && response.success !== undefined)
        });
    }

    async getObjectives() {
        return await this.ipcCall.callIpcMethod('getObjectives', null, {
            timeout: 5000,
            fallbackValue: { globalObjectives: [], localObjectives: [] },
            validateResponse: (response) => response && typeof response === 'object'
        });
    }

    async getSSPBuckets() {
        return await this.ipcCall.callIpcMethod('getSSPBuckets', null, {
            timeout: 5000,
            fallbackValue: [],
            validateResponse: (response) => Array.isArray(response) ||
                                          (response && response.success !== undefined)
        });
    }

    // Event handlers with error boundaries
    handleDataUpdate(data) {
        try {
            if (window.scormInspector && typeof window.scormInspector.addApiCall === 'function') {
                window.scormInspector.addApiCall(data);
            } else {
                safeLogger.warn('SCORM Inspector instance not available for data update');
            }
        } catch (error) {
            safeLogger.error('Error handling data update:', error);
        }
    }

    handleErrorUpdate(errorData) {
        try {
            if (window.scormInspector && typeof window.scormInspector.addError === 'function') {
                window.scormInspector.addError(errorData);
            } else {
                safeLogger.warn('SCORM Inspector instance not available for error update');
            }
        } catch (error) {
            safeLogger.error('Error handling error update:', error);
        }
    }

    handleDataModelUpdate(dataModel) {
        try {
            if (window.scormInspector && typeof window.scormInspector.updateDataModel === 'function') {
                window.scormInspector.updateDataModel(dataModel);
            } else {
                safeLogger.warn('SCORM Inspector instance not available for data model update');
            }
        } catch (error) {
            safeLogger.error('Error handling data model update:', error);
        }
    }

    handleCourseLoaded() {
        try {
            if (window.scormInspector) {
                // Delayed refresh to allow session creation
                setTimeout(() => {
                    window.scormInspector.refreshData();
                    window.scormInspector.refreshActivityTree();
                    window.scormInspector.refreshNavigation();
                    window.scormInspector.refreshObjectives();
                    window.scormInspector.refreshSSP();
                }, 500);
            }
        } catch (error) {
            safeLogger.error('Error handling course loaded event:', error);
        }
    }

    handleSessionStateChanged() {
        try {
            if (window.scormInspector && typeof window.scormInspector.refreshData === 'function') {
                setTimeout(() => {
                    window.scormInspector.refreshData();
                }, 100);
            }
        } catch (error) {
            safeLogger.error('Error handling session state change:', error);
        }
    }

    getStats() {
        return {
            initialized: this.initialized,
            ipcStats: this.ipcCall.getStats(),
            eventStats: this.eventManager.getEventStats()
        };
    }

    cleanup() {
        this.eventManager.cleanup();
        this.initialized = false;
        safeLogger.log('SCORM Inspector IPC cleaned up');
    }
}

// Global instance
const scormInspectorIpc = new ScormInspectorIpc();
```

### 5. IPC Health Monitoring

**Implementation:** Monitor IPC health and performance

```javascript
class IpcHealthMonitor {
    constructor() {
        this.healthChecks = new Map();
        this.performanceMetrics = new Map();
        this.alertThresholds = {
            responseTime: 5000,      // 5 seconds
            errorRate: 0.1,          // 10%
            circuitBreakerTrips: 3   // per hour
        };
        this.monitoringInterval = null;
    }

    // Register health check for IPC method
    registerHealthCheck(methodPath, checkFunction) {
        this.healthChecks.set(methodPath, {
            check: checkFunction,
            lastCheck: 0,
            consecutiveFailures: 0,
            status: 'unknown'
        });
    }

    // Run health checks
    async runHealthChecks() {
        const results = new Map();

        for (const [methodPath, healthCheck] of this.healthChecks) {
            try {
                const startTime = Date.now();
                const result = await Promise.race([
                    healthCheck.check(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Health check timeout')), 5000)
                    )
                ]);

                const duration = Date.now() - startTime;

                healthCheck.lastCheck = Date.now();
                healthCheck.consecutiveFailures = 0;
                healthCheck.status = 'healthy';

                results.set(methodPath, {
                    status: 'healthy',
                    duration,
                    result
                });

                this.recordPerformanceMetric(methodPath, duration, true);

            } catch (error) {
                healthCheck.consecutiveFailures++;
                healthCheck.status = 'unhealthy';
                healthCheck.lastCheck = Date.now();

                results.set(methodPath, {
                    status: 'unhealthy',
                    error: error.message,
                    consecutiveFailures: healthCheck.consecutiveFailures
                });

                this.recordPerformanceMetric(methodPath, 0, false);
                safeLogger.error(`Health check failed for ${methodPath}:`, error);
            }
        }

        // Check for alerts
        this.checkHealthAlerts(results);

        return results;
    }

    recordPerformanceMetric(methodPath, duration, success) {
        const metrics = this.performanceMetrics.get(methodPath) || {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalDuration: 0,
            avgDuration: 0,
            maxDuration: 0,
            minDuration: Infinity
        };

        metrics.totalCalls++;

        if (success) {
            metrics.successfulCalls++;
            metrics.totalDuration += duration;
            metrics.avgDuration = metrics.totalDuration / metrics.successfulCalls;
            metrics.maxDuration = Math.max(metrics.maxDuration, duration);
            metrics.minDuration = Math.min(metrics.minDuration, duration);
        } else {
            metrics.failedCalls++;
        }

        this.performanceMetrics.set(methodPath, metrics);
    }

    checkHealthAlerts(results) {
        results.forEach((result, methodPath) => {
            const metrics = this.performanceMetrics.get(methodPath);

            if (metrics) {
                // Check error rate
                const errorRate = metrics.failedCalls / metrics.totalCalls;
                if (errorRate > this.alertThresholds.errorRate) {
                    safeLogger.error(`High error rate alert: ${methodPath} (${(errorRate * 100).toFixed(1)}%)`);
                }

                // Check response time
                if (metrics.avgDuration > this.alertThresholds.responseTime) {
                    safeLogger.warn(`Slow response time alert: ${methodPath} (${metrics.avgDuration}ms avg)`);
                }
            }

            // Check consecutive failures
            const healthCheck = this.healthChecks.get(methodPath);
            if (healthCheck && healthCheck.consecutiveFailures >= 3) {
                safeLogger.error(`Multiple consecutive failures alert: ${methodPath} (${healthCheck.consecutiveFailures} failures)`);
            }
        });
    }

    startMonitoring(intervalMs = 60000) {
        this.stopMonitoring(); // Stop existing monitoring

        this.monitoringInterval = setInterval(async () => {
            try {
                await this.runHealthChecks();
            } catch (error) {
                safeLogger.error('Error during health check monitoring:', error);
            }
        }, intervalMs);

        safeLogger.log(`IPC health monitoring started (${intervalMs}ms interval)`);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            safeLogger.log('IPC health monitoring stopped');
        }
    }

    getHealthReport() {
        const report = {
            timestamp: new Date().toISOString(),
            healthChecks: {},
            performanceMetrics: {},
            overallStatus: 'healthy'
        };

        // Compile health check status
        this.healthChecks.forEach((check, methodPath) => {
            report.healthChecks[methodPath] = {
                status: check.status,
                lastCheck: check.lastCheck,
                consecutiveFailures: check.consecutiveFailures
            };

            if (check.status !== 'healthy') {
                report.overallStatus = 'degraded';
            }
        });

        // Compile performance metrics
        this.performanceMetrics.forEach((metrics, methodPath) => {
            report.performanceMetrics[methodPath] = { ...metrics };

            if (metrics.failedCalls / metrics.totalCalls > this.alertThresholds.errorRate) {
                report.overallStatus = 'degraded';
            }
        });

        return report;
    }
}

const ipcHealthMonitor = new IpcHealthMonitor();

// Register health checks for SCORM Inspector methods
ipcHealthMonitor.registerHealthCheck('getScormInspectorHistory', async () => {
    const result = await scormInspectorIpc.getScormInspectorHistory();
    return result.success !== false;
});

ipcHealthMonitor.registerHealthCheck('getActivityTree', async () => {
    const result = await scormInspectorIpc.getActivityTree();
    return result.success !== false;
});

// Start monitoring
ipcHealthMonitor.startMonitoring(30000); // Every 30 seconds
```

## Integration Example

```javascript
// Initialize all IPC error handling systems
async function initializeIpcErrorHandling() {
    try {
        // Initialize SCORM Inspector IPC with full error handling
        await scormInspectorIpc.initialize();

        // Start health monitoring
        ipcHealthMonitor.startMonitoring();

        safeLogger.log('IPC error handling systems initialized successfully');

    } catch (error) {
        safeLogger.error('Failed to initialize IPC error handling:', error);

        // Fallback: Basic initialization without advanced features
        try {
            await scormInspectorIpc.initialize();
            safeLogger.warn('IPC initialized with basic error handling only');
        } catch (fallbackError) {
            safeLogger.error('Complete IPC initialization failure:', fallbackError);
            throw fallbackError;
        }
    }
}

// Call during application startup
initializeIpcErrorHandling();
```

## Summary

The comprehensive IPC error handling patterns provide:

1. **Robust Connectivity** - Graceful handling of API availability issues
2. **Retry Logic** - Automatic retry with exponential backoff
3. **Circuit Breaker** - Prevents cascading failures
4. **Event Safety** - Safe event listener registration and handling
5. **Health Monitoring** - Continuous monitoring of IPC health
6. **Performance Tracking** - Metrics collection and alerting
7. **Graceful Degradation** - Fallback behavior when IPC fails

These patterns ensure the SCORM Inspector remains functional and responsive even when IPC communication encounters issues, providing a stable user experience under all conditions.