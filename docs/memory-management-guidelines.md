# Memory Management Guidelines

## Overview

Effective memory management is crucial for long-running applications like the SCORM Inspector. This guide documents the comprehensive memory management strategies implemented to prevent memory leaks, optimize performance, and ensure stable operation.

## Memory Management Principles

### 1. Resource Lifecycle Management

Every resource must have clear creation, usage, and cleanup phases:

```javascript
class ResourceManager {
    constructor() {
        this.resources = new Map();
        this.timeouts = new Set();
        this.intervals = new Set();
        this.eventListeners = [];
        this.isDestroyed = false;
    }

    // Safe resource allocation
    allocateResource(id, resource) {
        if (this.isDestroyed) {
            safeLogger.warn(`Attempt to allocate resource ${id} after destruction`);
            return false;
        }

        // Clean up existing resource if it exists
        if (this.resources.has(id)) {
            this.releaseResource(id);
        }

        this.resources.set(id, {
            data: resource,
            createdAt: Date.now(),
            lastAccessed: Date.now()
        });

        return true;
    }

    // Safe resource access with usage tracking
    getResource(id) {
        if (this.isDestroyed) return null;

        const resource = this.resources.get(id);
        if (resource) {
            resource.lastAccessed = Date.now();
            return resource.data;
        }
        return null;
    }

    // Resource cleanup
    releaseResource(id) {
        const resource = this.resources.get(id);
        if (resource) {
            // Cleanup specific to resource type
            if (typeof resource.data?.destroy === 'function') {
                try {
                    resource.data.destroy();
                } catch (error) {
                    safeLogger.error(`Error destroying resource ${id}:`, error);
                }
            }

            this.resources.delete(id);
            safeLogger.log(`Resource ${id} released`);
        }
    }

    // Complete cleanup
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

        // Remove all event listeners
        this.eventListeners.forEach(({ element, event, handler }) => {
            try {
                element.removeEventListener(event, handler);
            } catch (error) {
                safeLogger.warn('Error removing event listener:', error);
            }
        });
        this.eventListeners = [];

        // Release all resources
        for (const id of this.resources.keys()) {
            this.releaseResource(id);
        }

        safeLogger.log('ResourceManager destroyed successfully');
    }
}
```

### 2. Data Structure Size Limits

Implement size limits to prevent unbounded growth:

```javascript
class BoundedDataStructures {
    constructor() {
        this.apiHistory = new BoundedArray(2000);
        this.errorHistory = new BoundedArray(1000);
        this.dataModelHistory = new BoundedMap(500);
        this.logEntries = new BoundedArray(5000);
    }
}

class BoundedArray {
    constructor(maxSize = 1000) {
        this.items = [];
        this.maxSize = maxSize;
        this.totalItemsAdded = 0;
        this.totalItemsRemoved = 0;
    }

    add(item) {
        try {
            // Add to beginning (newest first)
            this.items.unshift(item);
            this.totalItemsAdded++;

            // Maintain size limit
            if (this.items.length > this.maxSize) {
                const removedCount = this.items.length - this.maxSize;
                this.items = this.items.slice(0, this.maxSize);
                this.totalItemsRemoved += removedCount;

                // Log memory management action
                if (this.totalItemsRemoved % 100 === 0) {
                    safeLogger.log(`BoundedArray: ${this.totalItemsRemoved} items removed to maintain size limit`);
                }
            }
        } catch (error) {
            safeLogger.error('Error adding item to BoundedArray:', error);
        }
    }

    clear() {
        const itemCount = this.items.length;
        this.items = [];
        this.totalItemsRemoved += itemCount;
        safeLogger.log(`BoundedArray cleared: ${itemCount} items removed`);
    }

    getItems(limit) {
        try {
            return limit ? this.items.slice(0, limit) : [...this.items];
        } catch (error) {
            safeLogger.error('Error getting items from BoundedArray:', error);
            return [];
        }
    }

    getStats() {
        return {
            currentSize: this.items.length,
            maxSize: this.maxSize,
            totalAdded: this.totalItemsAdded,
            totalRemoved: this.totalItemsRemoved,
            memoryPressure: this.items.length / this.maxSize
        };
    }
}

class BoundedMap {
    constructor(maxSize = 500) {
        this.data = new Map();
        this.maxSize = maxSize;
        this.accessOrder = []; // Track access order for LRU
    }

    set(key, value) {
        try {
            // Remove from access order if it exists
            const existingIndex = this.accessOrder.indexOf(key);
            if (existingIndex !== -1) {
                this.accessOrder.splice(existingIndex, 1);
            }

            // Add to front of access order
            this.accessOrder.unshift(key);
            this.data.set(key, value);

            // Maintain size limit using LRU eviction
            if (this.data.size > this.maxSize) {
                const lruKey = this.accessOrder.pop();
                this.data.delete(lruKey);
                safeLogger.log(`BoundedMap: LRU evicted key ${lruKey}`);
            }
        } catch (error) {
            safeLogger.error('Error setting BoundedMap value:', error);
        }
    }

    get(key) {
        const value = this.data.get(key);

        if (value !== undefined) {
            // Move to front of access order
            const index = this.accessOrder.indexOf(key);
            if (index > 0) {
                this.accessOrder.splice(index, 1);
                this.accessOrder.unshift(key);
            }
        }

        return value;
    }

    clear() {
        const size = this.data.size;
        this.data.clear();
        this.accessOrder = [];
        safeLogger.log(`BoundedMap cleared: ${size} items removed`);
    }
}
```

### 3. Memory Leak Prevention

Identify and prevent common memory leak sources:

```javascript
class MemoryLeakPrevention {
    constructor() {
        this.weakRefs = new Set();
        this.observers = new Set();
        this.timers = new Map();
    }

    // Safe event listener management
    addEventListenerWithCleanup(element, event, handler, options) {
        if (!element) return null;

        // Wrap handler to track usage
        const wrappedHandler = (event) => {
            try {
                handler(event);
            } catch (error) {
                safeLogger.error('Event handler error:', error);
            }
        };

        element.addEventListener(event, wrappedHandler, options);

        // Return cleanup function
        const cleanup = () => {
            try {
                element.removeEventListener(event, wrappedHandler, options);
            } catch (error) {
                safeLogger.warn('Error removing event listener:', error);
            }
        };

        return cleanup;
    }

    // Safe timeout management
    setTimeoutWithCleanup(callback, delay, id = null) {
        const timeoutId = setTimeout(() => {
            try {
                callback();
            } catch (error) {
                safeLogger.error('Timeout callback error:', error);
            } finally {
                // Auto-cleanup
                this.timers.delete(id || timeoutId);
            }
        }, delay);

        this.timers.set(id || timeoutId, timeoutId);
        return timeoutId;
    }

    // Safe interval management
    setIntervalWithCleanup(callback, interval, id = null) {
        const intervalId = setInterval(() => {
            try {
                callback();
            } catch (error) {
                safeLogger.error('Interval callback error:', error);
                // Stop interval on error
                this.clearInterval(id || intervalId);
            }
        }, interval);

        this.timers.set(id || intervalId, intervalId);
        return intervalId;
    }

    clearTimeout(id) {
        const timeoutId = this.timers.get(id) || id;
        clearTimeout(timeoutId);
        this.timers.delete(id);
    }

    clearInterval(id) {
        const intervalId = this.timers.get(id) || id;
        clearInterval(intervalId);
        this.timers.delete(id);
    }

    // Observer pattern with automatic cleanup
    createObserver(callback) {
        const observer = {
            id: Date.now() + Math.random(),
            callback,
            isDestroyed: false,
            destroy() {
                this.isDestroyed = true;
                this.callback = null;
            }
        };

        this.observers.add(observer);

        return {
            observer,
            unsubscribe: () => {
                observer.destroy();
                this.observers.delete(observer);
            }
        };
    }

    notifyObservers(data) {
        // Notify active observers and clean up destroyed ones
        const activeObservers = [];

        this.observers.forEach(observer => {
            if (observer.isDestroyed) {
                this.observers.delete(observer);
            } else {
                try {
                    observer.callback(data);
                    activeObservers.push(observer);
                } catch (error) {
                    safeLogger.error('Observer callback error:', error);
                }
            }
        });

        return activeObservers.length;
    }

    // Complete cleanup
    destroy() {
        // Clear all timers
        this.timers.forEach((timerId, key) => {
            try {
                clearTimeout(timerId);
                clearInterval(timerId);
            } catch (error) {
                safeLogger.warn(`Error clearing timer ${key}:`, error);
            }
        });
        this.timers.clear();

        // Destroy all observers
        this.observers.forEach(observer => {
            try {
                observer.destroy();
            } catch (error) {
                safeLogger.warn('Error destroying observer:', error);
            }
        });
        this.observers.clear();

        // Clear weak references
        this.weakRefs.clear();

        safeLogger.log('MemoryLeakPrevention destroyed');
    }
}
```

### 4. DOM Memory Management

Handle DOM-related memory efficiently:

```javascript
class DomMemoryManager {
    constructor() {
        this.mutationObserver = null;
        this.resizeObserver = null;
        this.intersectionObserver = null;
        this.documentFragments = [];
    }

    // Efficient DOM rendering with fragments
    renderWithFragment(container, renderFunction) {
        if (!container) return false;

        try {
            // Create fragment for efficient DOM manipulation
            const fragment = document.createDocumentFragment();
            const tempContainer = document.createElement('div');

            // Render content
            const html = renderFunction();
            tempContainer.innerHTML = html;

            // Move nodes to fragment
            while (tempContainer.firstChild) {
                fragment.appendChild(tempContainer.firstChild);
            }

            // Apply to DOM atomically
            container.innerHTML = '';
            container.appendChild(fragment);

            // Clean up temporary elements
            tempContainer.remove();

            return true;
        } catch (error) {
            safeLogger.error('Error rendering with fragment:', error);
            return false;
        }
    }

    // Safe mutation observer setup
    observeMutations(target, callback, options = {}) {
        if (!target || this.mutationObserver) return null;

        try {
            this.mutationObserver = new MutationObserver((mutations) => {
                try {
                    callback(mutations);
                } catch (error) {
                    safeLogger.error('Mutation observer callback error:', error);
                }
            });

            this.mutationObserver.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                ...options
            });

            return this.mutationObserver;
        } catch (error) {
            safeLogger.error('Error setting up mutation observer:', error);
            return null;
        }
    }

    // Element cleanup with proper disposal
    cleanupElement(element) {
        if (!element) return;

        try {
            // Remove all event listeners (modern browsers)
            if (element.cloneNode) {
                const cleanClone = element.cloneNode(false);
                if (element.parentNode) {
                    element.parentNode.replaceChild(cleanClone, element);
                }
            }

            // Clear content to release references
            if (element.innerHTML !== undefined) {
                element.innerHTML = '';
            }

            // Remove from DOM if still attached
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }

            // Clear custom properties
            Object.keys(element).forEach(key => {
                if (key.startsWith('_custom') || key.startsWith('data')) {
                    delete element[key];
                }
            });

        } catch (error) {
            safeLogger.warn('Error cleaning up element:', error);
        }
    }

    // Batch DOM updates for efficiency
    batchDomUpdates(updates) {
        if (!Array.isArray(updates) || updates.length === 0) return;

        try {
            // Batch all updates in a single frame
            requestAnimationFrame(() => {
                updates.forEach(update => {
                    try {
                        const { element, property, value } = update;
                        if (element && property && value !== undefined) {
                            element[property] = value;
                        }
                    } catch (error) {
                        safeLogger.error('Error applying DOM update:', error);
                    }
                });
            });
        } catch (error) {
            safeLogger.error('Error batching DOM updates:', error);
        }
    }

    destroy() {
        // Disconnect all observers
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        // Clean up fragments
        this.documentFragments.forEach(fragment => {
            try {
                // Clear fragment contents
                while (fragment.firstChild) {
                    fragment.removeChild(fragment.firstChild);
                }
            } catch (error) {
                safeLogger.warn('Error cleaning fragment:', error);
            }
        });
        this.documentFragments = [];

        safeLogger.log('DomMemoryManager destroyed');
    }
}
```

### 5. LocalStorage Management

Handle browser storage efficiently:

```javascript
class StorageManager {
    constructor(prefix = 'scorm-inspector') {
        this.prefix = prefix;
        this.maxStorageSize = 5 * 1024 * 1024; // 5MB limit
        this.compressionThreshold = 10240; // 10KB
    }

    // Safe storage operations
    setItem(key, value, options = {}) {
        const fullKey = `${this.prefix}.${key}`;

        try {
            let serialized = JSON.stringify(value);

            // Check size and compress if needed
            if (serialized.length > this.compressionThreshold) {
                safeLogger.log(`Compressing storage item ${key} (${serialized.length} bytes)`);
                serialized = this.compress(serialized);
                options.compressed = true;
            }

            // Check total size limit
            const currentSize = this.getStorageSize();
            if (currentSize + serialized.length > this.maxStorageSize) {
                this.performCleanup(serialized.length);
            }

            // Store with metadata
            const storageItem = {
                data: serialized,
                timestamp: Date.now(),
                options
            };

            localStorage.setItem(fullKey, JSON.stringify(storageItem));
            return true;

        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                safeLogger.error('Storage quota exceeded, performing cleanup');
                this.performCleanup();
                return false;
            } else {
                safeLogger.error(`Error storing item ${key}:`, error);
                return false;
            }
        }
    }

    getItem(key) {
        const fullKey = `${this.prefix}.${key}`;

        try {
            const stored = localStorage.getItem(fullKey);
            if (!stored) return null;

            const storageItem = JSON.parse(stored);
            let data = storageItem.data;

            // Decompress if needed
            if (storageItem.options?.compressed) {
                data = this.decompress(data);
            }

            return JSON.parse(data);

        } catch (error) {
            safeLogger.error(`Error retrieving item ${key}:`, error);
            // Clean up corrupted item
            this.removeItem(key);
            return null;
        }
    }

    removeItem(key) {
        const fullKey = `${this.prefix}.${key}`;
        try {
            localStorage.removeItem(fullKey);
            return true;
        } catch (error) {
            safeLogger.error(`Error removing item ${key}:`, error);
            return false;
        }
    }

    // Storage cleanup strategies
    performCleanup(requiredSpace = 0) {
        try {
            const items = this.getAllItems();

            // Sort by last access time (oldest first)
            items.sort((a, b) => a.timestamp - b.timestamp);

            let freedSpace = 0;
            let itemsRemoved = 0;

            for (const item of items) {
                if (freedSpace >= requiredSpace && itemsRemoved >= 5) {
                    break; // Minimum cleanup done
                }

                const itemSize = JSON.stringify(item).length;
                this.removeItem(item.key.replace(`${this.prefix}.`, ''));
                freedSpace += itemSize;
                itemsRemoved++;
            }

            safeLogger.log(`Storage cleanup: removed ${itemsRemoved} items, freed ${freedSpace} bytes`);

        } catch (error) {
            safeLogger.error('Error during storage cleanup:', error);
        }
    }

    getAllItems() {
        const items = [];

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.prefix)) {
                    const stored = localStorage.getItem(key);
                    if (stored) {
                        const item = JSON.parse(stored);
                        items.push({
                            key,
                            timestamp: item.timestamp || 0,
                            size: stored.length
                        });
                    }
                }
            }
        } catch (error) {
            safeLogger.error('Error getting all storage items:', error);
        }

        return items;
    }

    getStorageSize() {
        let totalSize = 0;

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.prefix)) {
                    const value = localStorage.getItem(key);
                    if (value) {
                        totalSize += value.length;
                    }
                }
            }
        } catch (error) {
            safeLogger.error('Error calculating storage size:', error);
        }

        return totalSize;
    }

    // Simple compression (for demonstration)
    compress(data) {
        // In real implementation, use proper compression library
        // This is a placeholder for LZ compression
        return btoa(data);
    }

    decompress(data) {
        // In real implementation, use proper decompression
        return atob(data);
    }

    getStorageStats() {
        const allItems = this.getAllItems();
        const totalSize = this.getStorageSize();

        return {
            itemCount: allItems.length,
            totalSize: totalSize,
            maxSize: this.maxStorageSize,
            utilizationPercent: (totalSize / this.maxStorageSize) * 100,
            oldestItem: allItems.length > 0 ? new Date(Math.min(...allItems.map(i => i.timestamp))) : null,
            newestItem: allItems.length > 0 ? new Date(Math.max(...allItems.map(i => i.timestamp))) : null
        };
    }

    clear() {
        try {
            const keysToRemove = [];

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.prefix)) {
                    keysToRemove.push(key);
                }
            }

            keysToRemove.forEach(key => localStorage.removeItem(key));
            safeLogger.log(`Storage cleared: ${keysToRemove.length} items removed`);

        } catch (error) {
            safeLogger.error('Error clearing storage:', error);
        }
    }
}
```

### 6. Memory Monitoring and Profiling

Monitor memory usage and identify issues:

```javascript
class MemoryMonitor {
    constructor() {
        this.measurements = [];
        this.maxMeasurements = 1000;
        this.alertThresholds = {
            heapUsed: 50 * 1024 * 1024,      // 50MB
            heapTotal: 100 * 1024 * 1024,    // 100MB
            external: 20 * 1024 * 1024        // 20MB
        };
    }

    // Measure current memory usage
    measureMemory() {
        const measurement = {
            timestamp: Date.now(),
            performance: {},
            custom: {}
        };

        try {
            // Performance memory API
            if (performance.memory) {
                measurement.performance = {
                    usedJSHeapSize: performance.memory.usedJSHeapSize,
                    totalJSHeapSize: performance.memory.totalJSHeapSize,
                    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
                };
            }

            // Custom measurements
            measurement.custom = {
                domNodes: document.querySelectorAll('*').length,
                eventListeners: this.countEventListeners(),
                timers: this.countActiveTimers(),
                storageSize: this.getStorageSize()
            };

        } catch (error) {
            safeLogger.error('Error measuring memory:', error);
        }

        // Store measurement
        this.measurements.unshift(measurement);
        if (this.measurements.length > this.maxMeasurements) {
            this.measurements = this.measurements.slice(0, this.maxMeasurements);
        }

        // Check for alerts
        this.checkMemoryAlerts(measurement);

        return measurement;
    }

    countEventListeners() {
        // Approximate count based on registered listeners
        let count = 0;
        try {
            // Count various event listener types
            document.querySelectorAll('*').forEach(element => {
                // This is an approximation - exact count requires framework support
                if (element.onclick || element.onchange || element.oninput) {
                    count++;
                }
            });
        } catch (error) {
            // Fallback count
            count = -1;
        }
        return count;
    }

    countActiveTimers() {
        // This requires cooperation with timer management system
        return window.timerManager ? window.timerManager.getActiveCount() : -1;
    }

    getStorageSize() {
        try {
            let total = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const value = localStorage.getItem(key);
                if (value) {
                    total += value.length;
                }
            }
            return total;
        } catch (error) {
            return -1;
        }
    }

    checkMemoryAlerts(measurement) {
        const alerts = [];

        try {
            const { performance: perfMem } = measurement;

            if (perfMem.usedJSHeapSize > this.alertThresholds.heapUsed) {
                alerts.push({
                    type: 'high_heap_usage',
                    value: perfMem.usedJSHeapSize,
                    threshold: this.alertThresholds.heapUsed,
                    severity: 'warning'
                });
            }

            if (perfMem.totalJSHeapSize > this.alertThresholds.heapTotal) {
                alerts.push({
                    type: 'high_heap_total',
                    value: perfMem.totalJSHeapSize,
                    threshold: this.alertThresholds.heapTotal,
                    severity: 'critical'
                });
            }

            // Check for memory leaks (increasing trend)
            const trend = this.getMemoryTrend();
            if (trend.isIncreasing && trend.rate > 1024 * 1024) { // 1MB/minute
                alerts.push({
                    type: 'memory_leak_suspected',
                    rate: trend.rate,
                    duration: trend.duration,
                    severity: 'warning'
                });
            }

            // Log alerts
            alerts.forEach(alert => {
                safeLogger[alert.severity === 'critical' ? 'error' : 'warn'](
                    `Memory Alert: ${alert.type}`, alert
                );
            });

        } catch (error) {
            safeLogger.error('Error checking memory alerts:', error);
        }

        return alerts;
    }

    getMemoryTrend(windowMinutes = 5) {
        if (this.measurements.length < 2) {
            return { isIncreasing: false, rate: 0, duration: 0 };
        }

        try {
            const now = Date.now();
            const windowMs = windowMinutes * 60 * 1000;

            const recentMeasurements = this.measurements.filter(m =>
                now - m.timestamp < windowMs
            );

            if (recentMeasurements.length < 2) {
                return { isIncreasing: false, rate: 0, duration: 0 };
            }

            const oldest = recentMeasurements[recentMeasurements.length - 1];
            const newest = recentMeasurements[0];

            const memoryChange = newest.performance.usedJSHeapSize - oldest.performance.usedJSHeapSize;
            const timeChange = newest.timestamp - oldest.timestamp;
            const rate = memoryChange / (timeChange / 60000); // bytes per minute

            return {
                isIncreasing: memoryChange > 0,
                rate: rate,
                duration: timeChange,
                change: memoryChange
            };

        } catch (error) {
            safeLogger.error('Error calculating memory trend:', error);
            return { isIncreasing: false, rate: 0, duration: 0 };
        }
    }

    getMemoryStats() {
        if (this.measurements.length === 0) {
            return null;
        }

        try {
            const latest = this.measurements[0];
            const trend = this.getMemoryTrend();

            return {
                current: latest,
                trend: trend,
                averageUsage: this.getAverageUsage(),
                peakUsage: this.getPeakUsage(),
                measurementCount: this.measurements.length
            };

        } catch (error) {
            safeLogger.error('Error getting memory stats:', error);
            return null;
        }
    }

    getAverageUsage() {
        const values = this.measurements.map(m => m.performance.usedJSHeapSize).filter(v => v);
        return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
    }

    getPeakUsage() {
        const values = this.measurements.map(m => m.performance.usedJSHeapSize).filter(v => v);
        return values.length > 0 ? Math.max(...values) : 0;
    }

    startMonitoring(intervalMs = 30000) {
        return setInterval(() => {
            this.measureMemory();
        }, intervalMs);
    }

    generateReport() {
        const stats = this.getMemoryStats();
        if (!stats) return 'No memory data available';

        const report = `
Memory Usage Report
==================
Current Heap Usage: ${(stats.current.performance.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB
Peak Heap Usage: ${(stats.peakUsage / 1024 / 1024).toFixed(2)} MB
Average Heap Usage: ${(stats.averageUsage / 1024 / 1024).toFixed(2)} MB
Heap Limit: ${(stats.current.performance.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB

Memory Trend: ${stats.trend.isIncreasing ? 'Increasing' : 'Stable'}
Growth Rate: ${(stats.trend.rate / 1024).toFixed(2)} KB/minute

DOM Nodes: ${stats.current.custom.domNodes}
Storage Size: ${(stats.current.custom.storageSize / 1024).toFixed(2)} KB
Measurements: ${stats.measurementCount}
        `;

        return report;
    }
}

// Global memory monitor instance
window.memoryMonitor = new MemoryMonitor();

// Start monitoring
window.memoryMonitor.startMonitoring(30000); // Every 30 seconds
```

## SCORM Inspector Specific Implementations

### 1. Data Model History Management

```javascript
class DataModelMemoryManager {
    constructor() {
        this.historyLimit = 500;
        this.compressionThreshold = 100; // Compress after 100 entries
        this.dataModelHistory = new Map();
    }

    addHistoryEntry(dataModel) {
        const timestamp = Date.now();
        const entry = {
            dataModel: this.deepClone(dataModel),
            timestamp: timestamp,
            serialized: false
        };

        // Add to history
        this.dataModelHistory.set(timestamp, entry);

        // Maintain size limit
        if (this.dataModelHistory.size > this.historyLimit) {
            this.performHistoryCleanup();
        }

        // Compress old entries
        this.compressOldEntries();
    }

    performHistoryCleanup() {
        const entries = Array.from(this.dataModelHistory.entries());
        entries.sort((a, b) => a[0] - b[0]); // Sort by timestamp

        // Remove oldest 20% of entries
        const removeCount = Math.floor(entries.length * 0.2);
        for (let i = 0; i < removeCount; i++) {
            this.dataModelHistory.delete(entries[i][0]);
        }

        safeLogger.log(`Data model history cleanup: removed ${removeCount} entries`);
    }

    compressOldEntries() {
        const cutoffTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago

        this.dataModelHistory.forEach((entry, timestamp) => {
            if (timestamp < cutoffTime && !entry.serialized) {
                try {
                    // Serialize and compress old data
                    entry.serializedData = JSON.stringify(entry.dataModel);
                    entry.dataModel = null; // Free memory
                    entry.serialized = true;
                } catch (error) {
                    safeLogger.warn('Error compressing history entry:', error);
                }
            }
        });
    }

    getHistoryEntry(timestamp) {
        const entry = this.dataModelHistory.get(timestamp);
        if (!entry) return null;

        if (entry.serialized) {
            try {
                // Deserialize on demand
                return {
                    ...entry,
                    dataModel: JSON.parse(entry.serializedData)
                };
            } catch (error) {
                safeLogger.error('Error deserializing history entry:', error);
                return null;
            }
        }

        return entry;
    }

    deepClone(obj) {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch (error) {
            safeLogger.error('Error deep cloning object:', error);
            return {};
        }
    }

    clear() {
        this.dataModelHistory.clear();
        safeLogger.log('Data model history cleared');
    }

    getStats() {
        let serializedCount = 0;
        let totalSize = 0;

        this.dataModelHistory.forEach(entry => {
            if (entry.serialized) {
                serializedCount++;
                totalSize += entry.serializedData?.length || 0;
            } else {
                totalSize += JSON.stringify(entry.dataModel || {}).length;
            }
        });

        return {
            totalEntries: this.dataModelHistory.size,
            serializedEntries: serializedCount,
            estimatedSize: totalSize,
            compressionRatio: serializedCount / this.dataModelHistory.size
        };
    }
}
```

### 2. Component Lifecycle Management

```javascript
class ComponentLifecycleManager {
    constructor() {
        this.components = new Map();
        this.destructionQueue = [];
        this.cleanupInterval = null;
    }

    registerComponent(id, component) {
        // Clean up existing component if it exists
        if (this.components.has(id)) {
            this.destroyComponent(id);
        }

        // Add destroy method if not present
        if (typeof component.destroy !== 'function') {
            component.destroy = () => {
                safeLogger.log(`Default destroy called for component ${id}`);
            };
        }

        this.components.set(id, {
            instance: component,
            createdAt: Date.now(),
            lastUsed: Date.now()
        });

        safeLogger.log(`Component registered: ${id}`);
    }

    useComponent(id) {
        const component = this.components.get(id);
        if (component) {
            component.lastUsed = Date.now();
            return component.instance;
        }
        return null;
    }

    destroyComponent(id) {
        const component = this.components.get(id);
        if (component) {
            try {
                component.instance.destroy();
            } catch (error) {
                safeLogger.error(`Error destroying component ${id}:`, error);
            }

            this.components.delete(id);
            safeLogger.log(`Component destroyed: ${id}`);
        }
    }

    // Automatic cleanup of unused components
    startAutoCleanup(intervalMs = 60000, maxIdleTime = 300000) {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const componentsToDestroy = [];

            this.components.forEach((component, id) => {
                if (now - component.lastUsed > maxIdleTime) {
                    componentsToDestroy.push(id);
                }
            });

            componentsToDestroy.forEach(id => {
                safeLogger.log(`Auto-destroying idle component: ${id}`);
                this.destroyComponent(id);
            });

        }, intervalMs);
    }

    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    destroyAll() {
        this.stopAutoCleanup();

        const componentIds = Array.from(this.components.keys());
        componentIds.forEach(id => this.destroyComponent(id));

        safeLogger.log(`All components destroyed: ${componentIds.length} total`);
    }

    getStats() {
        return {
            activeComponents: this.components.size,
            components: Array.from(this.components.entries()).map(([id, comp]) => ({
                id,
                createdAt: comp.createdAt,
                lastUsed: comp.lastUsed,
                idleTime: Date.now() - comp.lastUsed
            }))
        };
    }
}
```

## Summary

The comprehensive memory management guidelines ensure:

1. **Zero Memory Leaks** - Proper cleanup of all resources
2. **Bounded Growth** - Size limits prevent unbounded memory usage
3. **Efficient Storage** - Smart caching and compression strategies
4. **Monitoring** - Real-time memory usage tracking
5. **Automatic Cleanup** - Idle resource management
6. **Performance** - Optimized DOM and data structure operations
7. **Graceful Degradation** - Handles memory pressure scenarios

These patterns provide a robust foundation for long-running applications that maintain stable memory usage under all operating conditions.