/**
 * @file index.js
 * @description Entry point for the automation module.
 * Initializes the automation registry and exposes the SCORMAutomation API on window.
 * 
 * This entire module is ONLY loaded in development/testing mode when:
 * 1. import.meta.env.MODE !== 'production'
 * 2. courseConfig.environment.automation.enabled === true
 * 
 * In production builds, Vite's tree-shaking will completely eliminate this code.
 */

import automationRegistry from './registry.js';
import SCORMAutomationAPI from './api.js';
import { eventBus } from '../core/event-bus.js';

/**
 * Initializes the automation system
 * - Initializes the registry
 * - Exposes window.SCORMAutomation API
 * - Sets up event listeners for tracking
 */
export function initializeAutomation() {
    console.log('[Automation] Initializing automation system...');

    // Initialize the registry
    automationRegistry.initialize();

    // Expose the API globally
    window.SCORMAutomation = SCORMAutomationAPI;
    
    // Expose the registry for internal use by interaction components
    window.__automationRegistry = automationRegistry;

    // Log when interactions are registered/unregistered
    eventBus.on('automation:interaction:registered', ({ id, metadata }) => {
        console.log(`[Automation] ✓ Registered: ${id} (${metadata.type || 'unknown'})`);
    });

    eventBus.on('automation:interaction:unregistered', ({ id }) => {
        console.log(`[Automation] ✗ Unregistered: ${id}`);
    });

    // Clear registry BEFORE slide navigation (not after)
    //
    // CRITICAL: We listen to 'view:before-change' and clear BEFORE the new view renders.
    // This ensures:
    // 1. Old slide interactions are removed BEFORE new slide renders
    // 2. New slide interactions register and stay in the registry
    // 3. Component-internal ViewManager changes (e.g., assessment phases) don't clear
    // 4. We check the 'scope' property to determine if this is main navigation
    //
    // ViewManager scopes:
    // - 'main': Main course navigation (slides) → CLEAR registry
    // - 'assessment': Assessment internal views → KEEP registry
    // - 'local': Other component-internal views → KEEP registry
    eventBus.on('view:before-change', ({ oldView, newView, scope }) => {
        // Only clear registry on main navigation (main slides changing)
        if (scope === 'main') {
            console.log(`[Automation] Main navigation (${oldView} → ${newView}), clearing registry`);
            automationRegistry.clear();
        } else {
            console.log(`[Automation] Component navigation [${scope}] (${oldView} → ${newView}), keeping registry`);
        }
    });

    console.log('[Automation] ✓ Automation system initialized');
    console.log('[Automation] window.SCORMAutomation API is now available');
    console.log('[Automation] Use window.SCORMAutomation.getVersion() for feature info');

    // Emit initialization event
    eventBus.emit('automation:initialized', {
        version: SCORMAutomationAPI.getVersion()
    });
}

// Export registry for internal use by components
export { automationRegistry };
