/**
 * @file registry.js
 * @description Central registry for all interactions in the course.
 * Interactions register themselves on creation, enabling programmatic discovery and control.
 * 
 * This module is ONLY loaded in development/testing mode and is completely excluded
 * from production builds via Vite's tree-shaking.
 */

import { eventBus } from '../core/event-bus.js';

/**
 * AutomationRegistry - Singleton registry for interaction discovery
 */
class AutomationRegistry {
    constructor() {
        this.interactions = new Map();
        this.isInitialized = false;
    }

    /**
     * Initializes the registry
     * @throws {Error} If already initialized
     */
    initialize() {
        if (this.isInitialized) {
            throw new Error('AutomationRegistry: Already initialized');
        }
        this.isInitialized = true;
        console.log('[AutomationRegistry] Initialized');
        eventBus.emit('automation:registry:initialized');
    }

    /**
     * Registers an interaction with the automation system
     * @param {string} id - Unique interaction ID
     * @param {Object} questionObj - The interaction object with evaluate, getResponse, setResponse, etc.
     * @param {Object} metadata - Additional metadata about the interaction
     * @throws {Error} If id is missing or interaction already exists
     */
    register(id, questionObj, metadata = {}) {
        if (!id || typeof id !== 'string') {
            throw new Error('AutomationRegistry: Interaction ID must be a non-empty string');
        }

        if (this.interactions.has(id)) {
            console.warn(`[AutomationRegistry] Interaction "${id}" is already registered. Overwriting.`);
        }

        if (!questionObj || typeof questionObj !== 'object') {
            throw new Error(`AutomationRegistry: Question object for "${id}" must be an object`);
        }

        // Validate required methods
        const requiredMethods = ['evaluate', 'getResponse'];
        for (const method of requiredMethods) {
            if (typeof questionObj[method] !== 'function') {
                throw new Error(`AutomationRegistry: Interaction "${id}" missing required method: ${method}`);
            }
        }

        this.interactions.set(id, {
            id,
            questionObj,
            metadata: {
                type: questionObj.type || 'unknown',
                registeredAt: new Date().toISOString(),
                ...metadata
            }
        });

        console.log(`[AutomationRegistry] Registered interaction: ${id}`, metadata);
        eventBus.emit('automation:interaction:registered', { id, metadata });
    }

    /**
     * Unregisters an interaction
     * @param {string} id - Interaction ID to unregister
     */
    unregister(id) {
        if (this.interactions.has(id)) {
            this.interactions.delete(id);
            console.log(`[AutomationRegistry] Unregistered interaction: ${id}`);
            eventBus.emit('automation:interaction:unregistered', { id });
        }
    }

    /**
     * Gets a registered interaction by ID
     * @param {string} id - Interaction ID
     * @returns {Object|null} The interaction entry or null if not found
     */
    get(id) {
        return this.interactions.get(id) || null;
    }

    /**
     * Lists all registered interactions
     * @returns {Array<Object>} Array of interaction summaries
     */
    list() {
        return Array.from(this.interactions.values()).map(entry => ({
            id: entry.id,
            type: entry.metadata.type,
            registeredAt: entry.metadata.registeredAt
        }));
    }

    /**
     * Clears all registered interactions (useful for slide transitions)
     */
    clear() {
        const count = this.interactions.size;
        this.interactions.clear();
        console.log(`[AutomationRegistry] Cleared ${count} interactions`);
        eventBus.emit('automation:registry:cleared', { count });
    }

    /**
     * Gets the number of registered interactions
     * @returns {number}
     */
    count() {
        return this.interactions.size;
    }
}

// Export singleton instance
const automationRegistry = new AutomationRegistry();
export default automationRegistry;
