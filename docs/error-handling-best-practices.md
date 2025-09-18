# Error Handling Best Practices Guide

## Overview

This guide documents the comprehensive error handling patterns implemented in the SCORM Inspector application and provides best practices for maintaining robust error handling in JavaScript/Electron applications.

## Core Error Handling Philosophy

### 1. Graceful Degradation
Always provide fallback behavior rather than crashing:

```javascript
// ❌ Bad: Crashes the application
function getApiData() {
    return window.electronAPI.getData(); // Crashes if electronAPI is undefined
}

// ✅ Good: Graceful degradation
async function getApiData() {
    try {
        if (!window.electronAPI?.getData) {
            safeLogger.warn('API method not available, using fallback');
            return { success: false, error: 'API not available', data: null };
        }
        return await window.electronAPI.getData();
    } catch (error) {
        safeLogger.error('API call failed:', error);
        return { success: false, error: error.message, data: null };
    }
}
```

### 2. Safe Logger Pattern
Never use undefined loggers that can crash the application:

```javascript
// Safe logger implementation with fallbacks
const safeLogger = {
    error: (...args) => {
        try {
            if (typeof rendererLogger !== 'undefined' && rendererLogger?.error) {
                rendererLogger.error(...args);
            } else {
                console.error(...args);
            }
        } catch (e) {
            console.error(...args);
        }
    },
    warn: (...args) => {
        try {
            if (typeof rendererLogger !== 'undefined' && rendererLogger?.warn) {
                rendererLogger.warn(...args);
            } else {
                console.warn(...args);
            }
        } catch (e) {
            console.warn(...args);
        }
    },
    log: (...args) => {
        try {
            if (typeof rendererLogger !== 'undefined' && rendererLogger?.log) {
                rendererLogger.log(...args);
            } else {
                console.log(...args);
            }
        } catch (e) {
            console.log(...args);
        }
    }
};
```

## Error Handling Patterns

### 1. Async/Await Error Handling

```javascript
// ✅ Comprehensive async error handling
async function processApiCall(method, params) {
    try {
        // Validate inputs
        if (!method || typeof method !== 'string') {
            throw new Error('Invalid method parameter');
        }

        // Check API availability
        const apiAvailable = await this.waitForElectronAPI();
        if (!apiAvailable) {
            return this.createErrorResponse('Electron API not available');
        }

        // Make the call
        const result = await window.electronAPI[method](params);

        // Validate response
        if (!result || typeof result !== 'object') {
            return this.createErrorResponse('Invalid API response format');
        }

        return result;

    } catch (error) {
        safeLogger.error(`API call failed for method ${method}:`, error);
        return this.createErrorResponse(error.message);
    }
}

createErrorResponse(message) {
    return {
        success: false,
        error: message,
        data: null,
        timestamp: new Date().toISOString()
    };
}
```

### 2. DOM Element Safety

```javascript
// ✅ Safe DOM manipulation
function updateElement(elementId, content) {
    try {
        const element = document.getElementById(elementId);
        if (!element) {
            safeLogger.warn(`Element ${elementId} not found, skipping update`);
            return false;
        }

        // Escape content to prevent XSS
        element.innerHTML = this.escapeHtml(content);
        return true;

    } catch (error) {
        safeLogger.error(`Failed to update element ${elementId}:`, error);
        return false;
    }
}

// Safe HTML escaping
escapeHtml(text) {
    if (text == null) return '';

    try {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    } catch (error) {
        // Fallback manual escaping
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
```

### 3. JSON Serialization Safety

```javascript
// Safe JSON stringification with circular reference protection
const safeJsonStringify = (obj, replacer = null, space = null) => {
    const seen = new WeakSet();

    const jsonReplacer = (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular Reference]';
            }
            seen.add(value);
        }

        // Apply custom replacer if provided
        if (typeof replacer === 'function') {
            return replacer(key, value);
        }

        return value;
    };

    try {
        return JSON.stringify(obj, jsonReplacer, space);
    } catch (error) {
        safeLogger.error('Failed to stringify object:', error);
        return JSON.stringify({
            error: 'Failed to serialize data',
            type: typeof obj,
            keys: obj && typeof obj === 'object' ? Object.keys(obj) : []
        }, null, space);
    }
};
```

### 4. Race Condition Prevention

```javascript
// Flag-based race condition prevention
class DataProcessor {
    constructor() {
        this.isProcessing = false;
        this.pendingData = null;
        this.processTimeout = null;
    }

    processData(newData) {
        // Prevent concurrent processing
        if (this.isProcessing) {
            this.pendingData = newData;
            return;
        }

        // Debounce rapid updates
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
        }

        this.processTimeout = setTimeout(() => {
            this.performProcessing(this.pendingData || newData);
        }, 100);
    }

    async performProcessing(data) {
        this.isProcessing = true;

        try {
            // Actual processing logic
            await this.doProcessing(data);
        } catch (error) {
            safeLogger.error('Data processing failed:', error);
        } finally {
            this.isProcessing = false;

            // Process any pending data
            if (this.pendingData) {
                const pending = this.pendingData;
                this.pendingData = null;
                setTimeout(() => this.processData(pending), 10);
            }
        }
    }
}
```

### 5. Event Listener Management

```javascript
class ComponentManager {
    constructor() {
        this.eventListeners = [];
        this.isDestroyed = false;
    }

    // Safe event listener registration
    addEventListener(element, event, handler, options) {
        if (!element || this.isDestroyed) {
            safeLogger.warn('Cannot add event listener: element not available or component destroyed');
            return;
        }

        try {
            element.addEventListener(event, handler, options);
            this.eventListeners.push({ element, event, handler, options });
        } catch (error) {
            safeLogger.error('Failed to add event listener:', error);
        }
    }

    // Cleanup all event listeners
    destroy() {
        this.isDestroyed = true;

        this.eventListeners.forEach(({ element, event, handler }) => {
            try {
                element.removeEventListener(event, handler);
            } catch (error) {
                safeLogger.warn('Error removing event listener:', error);
            }
        });

        this.eventListeners = [];
    }
}
```

## IPC Error Handling Patterns

### 1. API Availability Checking

```javascript
// Comprehensive API availability checking
async waitForElectronAPI(timeout = 5000) {
    const startTime = Date.now();

    while (!window.electronAPI) {
        if (Date.now() - startTime > timeout) {
            safeLogger.error('Timeout waiting for electronAPI to be available');
            return false; // Return false for graceful degradation
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    return true;
}

// Usage pattern for IPC methods
async callIpcMethod(methodName, params) {
    try {
        // Check if API is available
        const apiAvailable = await this.waitForElectronAPI();
        if (!apiAvailable) {
            return this.createErrorResponse('Electron API not available');
        }

        // Check if specific method exists
        if (typeof window.electronAPI[methodName] !== 'function') {
            safeLogger.warn(`IPC method ${methodName} not available`);
            return this.createErrorResponse(`Method ${methodName} not available`);
        }

        // Make the call
        const result = await window.electronAPI[methodName](params);

        // Validate response structure
        if (!result || typeof result !== 'object') {
            return this.createErrorResponse('Invalid response format from IPC call');
        }

        return result;

    } catch (error) {
        safeLogger.error(`IPC call failed for ${methodName}:`, error);
        return this.createErrorResponse(error.message);
    }
}
```

### 2. IPC Event Listener Setup

```javascript
setupIpcEventListeners() {
    try {
        // Check if electronAPI is available
        if (!window.electronAPI) {
            safeLogger.warn('electronAPI not available, deferring IPC setup');
            setTimeout(() => this.setupIpcEventListeners(), 1000);
            return;
        }

        // Register data update listener with error handling
        if (typeof window.electronAPI.onScormInspectorDataUpdated === 'function') {
            try {
                window.electronAPI.onScormInspectorDataUpdated((data) => {
                    try {
                        this.handleDataUpdate(data);
                    } catch (error) {
                        safeLogger.error('Error handling data update:', error);
                    }
                });
            } catch (error) {
                safeLogger.error('Failed to register data update listener:', error);
            }
        } else {
            safeLogger.warn('onScormInspectorDataUpdated method not available');
        }

        // Register error listener with error handling
        if (typeof window.electronAPI.onScormInspectorErrorUpdated === 'function') {
            try {
                window.electronAPI.onScormInspectorErrorUpdated((errorData) => {
                    try {
                        this.handleErrorUpdate(errorData);
                    } catch (error) {
                        safeLogger.error('Error handling error update:', error);
                    }
                });
            } catch (error) {
                safeLogger.error('Failed to register error update listener:', error);
            }
        } else {
            safeLogger.warn('onScormInspectorErrorUpdated method not available');
        }

    } catch (error) {
        safeLogger.error('Failed to setup IPC event listeners:', error);
    }
}
```

## Memory Management Best Practices

### 1. Resource Cleanup

```javascript
class ResourceManager {
    constructor() {
        this.resources = new Map();
        this.timeouts = new Set();
        this.intervals = new Set();
        this.isDestroyed = false;
    }

    // Safe timeout management
    setTimeout(callback, delay) {
        if (this.isDestroyed) return null;

        const timeoutId = setTimeout(() => {
            try {
                callback();
            } catch (error) {
                safeLogger.error('Timeout callback error:', error);
            } finally {
                this.timeouts.delete(timeoutId);
            }
        }, delay);

        this.timeouts.add(timeoutId);
        return timeoutId;
    }

    // Cleanup all resources
    destroy() {
        this.isDestroyed = true;

        // Clear all timeouts
        this.timeouts.forEach(timeoutId => {
            try {
                clearTimeout(timeoutId);
            } catch (error) {
                safeLogger.warn('Error clearing timeout:', error);
            }
        });
        this.timeouts.clear();

        // Clear all intervals
        this.intervals.forEach(intervalId => {
            try {
                clearInterval(intervalId);
            } catch (error) {
                safeLogger.warn('Error clearing interval:', error);
            }
        });
        this.intervals.clear();

        // Clear resource map
        this.resources.clear();
    }
}
```

### 2. Data Structure Management

```javascript
// Safe array operations with size limits
class SafeArray {
    constructor(maxSize = 2000) {
        this.items = [];
        this.maxSize = maxSize;
    }

    add(item) {
        try {
            // Add to beginning (latest first)
            this.items.unshift(item);

            // Maintain size limit to prevent memory issues
            if (this.items.length > this.maxSize) {
                this.items = this.items.slice(0, this.maxSize);
            }
        } catch (error) {
            safeLogger.error('Error adding item to array:', error);
        }
    }

    clear() {
        this.items = [];
    }

    getItems(limit) {
        try {
            return limit ? this.items.slice(0, limit) : [...this.items];
        } catch (error) {
            safeLogger.error('Error getting items:', error);
            return [];
        }
    }
}
```

## Input Validation and Sanitization

### 1. Data Type Validation

```javascript
// Comprehensive data validation
function validateData(data, schema) {
    const errors = [];

    try {
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: ['Data must be an object'] };
        }

        Object.keys(schema).forEach(key => {
            const rule = schema[key];
            const value = data[key];

            // Required field check
            if (rule.required && (value === undefined || value === null)) {
                errors.push(`${key} is required`);
                return;
            }

            // Type check
            if (value !== undefined && rule.type && typeof value !== rule.type) {
                errors.push(`${key} must be of type ${rule.type}`);
                return;
            }

            // Custom validation
            if (rule.validate && typeof rule.validate === 'function') {
                try {
                    const validationResult = rule.validate(value);
                    if (!validationResult) {
                        errors.push(`${key} failed validation`);
                    }
                } catch (error) {
                    errors.push(`${key} validation error: ${error.message}`);
                }
            }
        });

        return {
            valid: errors.length === 0,
            errors: errors
        };

    } catch (error) {
        safeLogger.error('Validation error:', error);
        return { valid: false, errors: ['Validation process failed'] };
    }
}

// Usage example
const userDataSchema = {
    id: { required: true, type: 'string' },
    name: { required: true, type: 'string' },
    email: {
        required: false,
        type: 'string',
        validate: (value) => !value || /\S+@\S+\.\S+/.test(value)
    }
};

const validationResult = validateData(userData, userDataSchema);
if (!validationResult.valid) {
    safeLogger.error('Invalid data:', validationResult.errors);
}
```

### 2. Input Sanitization

```javascript
// Safe input sanitization
function sanitizeInput(input, options = {}) {
    const {
        maxLength = 1000,
        allowHtml = false,
        allowSpecialChars = true
    } = options;

    try {
        if (input === null || input === undefined) {
            return '';
        }

        let sanitized = String(input);

        // Length limiting
        if (sanitized.length > maxLength) {
            sanitized = sanitized.substring(0, maxLength);
            safeLogger.warn(`Input truncated to ${maxLength} characters`);
        }

        // HTML escaping
        if (!allowHtml) {
            sanitized = sanitized
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Special character filtering
        if (!allowSpecialChars) {
            sanitized = sanitized.replace(/[^\w\s.-]/g, '');
        }

        return sanitized;

    } catch (error) {
        safeLogger.error('Input sanitization error:', error);
        return '';
    }
}
```

## Error Recovery Strategies

### 1. Retry Logic

```javascript
// Exponential backoff retry mechanism
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            return await fn();
        } catch (error) {
            attempt++;

            if (attempt >= maxRetries) {
                safeLogger.error(`All ${maxRetries} retry attempts failed:`, error);
                throw error;
            }

            const delay = baseDelay * Math.pow(2, attempt - 1);
            safeLogger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Usage
async function fetchData() {
    return retryWithBackoff(async () => {
        const response = await window.electronAPI.getData();
        if (!response.success) {
            throw new Error(response.error);
        }
        return response.data;
    });
}
```

### 2. Circuit Breaker Pattern

```javascript
class CircuitBreaker {
    constructor(threshold = 5, resetTimeout = 60000) {
        this.threshold = threshold;
        this.resetTimeout = resetTimeout;
        this.failureCount = 0;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = Date.now();
    }

    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error('Circuit breaker is OPEN');
            } else {
                this.state = 'HALF_OPEN';
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }

    onFailure() {
        this.failureCount++;

        if (this.failureCount >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.resetTimeout;
            safeLogger.warn('Circuit breaker opened due to failures');
        }
    }
}
```

## Testing Error Handling

### 1. Error Simulation

```javascript
// Error simulation for testing
class ErrorSimulator {
    constructor() {
        this.errorProbability = 0;
        this.errors = [];
    }

    setErrorProbability(probability) {
        this.errorProbability = Math.max(0, Math.min(1, probability));
    }

    addError(error) {
        this.errors.push(error);
    }

    simulate() {
        if (Math.random() < this.errorProbability && this.errors.length > 0) {
            const randomError = this.errors[Math.floor(Math.random() * this.errors.length)];
            throw new Error(randomError);
        }
    }

    // Wrap any function with error simulation
    wrap(fn) {
        return (...args) => {
            this.simulate();
            return fn.apply(this, args);
        };
    }
}

// Usage in tests
const simulator = new ErrorSimulator();
simulator.setErrorProbability(0.1); // 10% error rate
simulator.addError('Network timeout');
simulator.addError('Invalid response');

const wrappedFunction = simulator.wrap(originalFunction);
```

## Performance Monitoring

### 1. Error Rate Monitoring

```javascript
class ErrorMonitor {
    constructor() {
        this.errorCounts = new Map();
        this.totalOperations = 0;
        this.startTime = Date.now();
    }

    recordError(category, error) {
        const current = this.errorCounts.get(category) || 0;
        this.errorCounts.set(category, current + 1);

        safeLogger.error(`Error in ${category}:`, error);
    }

    recordOperation() {
        this.totalOperations++;
    }

    getStats() {
        const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
        const runtime = Date.now() - this.startTime;

        return {
            totalOperations: this.totalOperations,
            totalErrors: totalErrors,
            errorRate: this.totalOperations > 0 ? totalErrors / this.totalOperations : 0,
            runtime: runtime,
            errorsPerCategory: Object.fromEntries(this.errorCounts)
        };
    }
}
```

## Summary

This comprehensive error handling guide ensures:

1. **Zero Crashes** - All potential error sources are handled gracefully
2. **User-Friendly Experience** - Errors are presented in an understandable way
3. **Debugging Support** - Comprehensive logging for troubleshooting
4. **Performance Monitoring** - Track error rates and system health
5. **Memory Safety** - Proper cleanup and resource management
6. **Security** - Input validation and sanitization
7. **Resilience** - Retry logic and circuit breaker patterns

Following these patterns ensures robust, maintainable applications that handle errors gracefully and provide excellent user experiences even when things go wrong.