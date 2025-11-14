/**
 * @file api.js
 * @description Public automation API exposed on window.SCORMAutomation
 * Provides programmatic control over interactions, navigation, and course state
 * for testing and AI-driven automation.
 * 
 * This module is ONLY loaded in development/testing mode and is completely excluded
 * from production builds via Vite's tree-shaking.
 */

import automationRegistry from './registry.js';
import { eventBus } from '../core/event-bus.js';
import * as NavigationActions from '../navigation/NavigationActions.js';
import * as NavigationState from '../navigation/NavigationState.js';
import { courseConfig } from '../../../course/course-config.js';
import { recordInteractionResult } from '../components/interactions/interaction-base.js';
import engagementManager from '../managers/engagement-manager.js';

/**
 * Automation trace log for observability
 * @type {Array<Object>}
 */
const automationTrace = [];

/**
 * Adds an entry to the automation trace log
 * @private
 */
function logTrace(action, details) {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        ...details
    };
    automationTrace.push(entry);
    eventBus.emit('automation:trace', entry);
}

/**
 * SCORMAutomation API
 * All methods throw errors on failure (no silent failures)
 */
const SCORMAutomationAPI = {
    // ===== Discovery Methods =====

    /**
     * Lists all registered interactions
     * @returns {Array<Object>} Array of {id, type, registeredAt}
     */
    listInteractions() {
        const interactions = automationRegistry.list();
        logTrace('listInteractions', { count: interactions.length });
        return interactions;
    },

    /**
     * Gets metadata for a specific interaction
     * @param {string} interactionId - The interaction ID
     * @returns {Object} Metadata object
     * @throws {Error} If interaction not found
     */
    getInteractionMetadata(interactionId) {
        const entry = automationRegistry.get(interactionId);
        if (!entry) {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" not found`);
        }
        logTrace('getInteractionMetadata', { interactionId });
        return {
            id: entry.id,
            type: entry.metadata.type,
            registeredAt: entry.metadata.registeredAt
        };
    },

    // ===== State Access Methods =====

    /**
     * Gets the current response for an interaction
     * @param {string} interactionId - The interaction ID
     * @returns {*} The current response value
     * @throws {Error} If interaction not found or getResponse fails
     */
    getResponse(interactionId) {
        const entry = automationRegistry.get(interactionId);
        if (!entry) {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" not found`);
        }
        
        if (typeof entry.questionObj.getResponse !== 'function') {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" does not support getResponse`);
        }

        const response = entry.questionObj.getResponse();
        logTrace('getResponse', { interactionId, response });
        return response;
    },

    /**
     * Gets the correct answer for an interaction (only in automation mode)
     * @param {string} interactionId - The interaction ID
     * @returns {*} The correct answer
     * @throws {Error} If not enabled, interaction not found, or not supported
     */
    getCorrectResponse(interactionId) {
        // Check if this feature is enabled
        if (!courseConfig.environment?.automation?.exposeCorrectAnswers) {
            throw new Error('SCORMAutomation: getCorrectResponse requires automation.exposeCorrectAnswers=true in course config');
        }

        const entry = automationRegistry.get(interactionId);
        if (!entry) {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" not found`);
        }

        if (typeof entry.questionObj.getCorrectAnswer !== 'function') {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" does not support getCorrectAnswer`);
        }

        const correctAnswer = entry.questionObj.getCorrectAnswer();
        logTrace('getCorrectResponse', { interactionId });
        return correctAnswer;
    },

    // ===== State Mutation Methods =====

    /**
     * Sets the response for an interaction
     * @param {string} interactionId - The interaction ID
     * @param {*} response - The response value (format depends on interaction type)
     *
     * Response formats by interaction type:
     * - Multiple Choice: string - Single letter ('a', 'b', 'c', etc.)
     *   Example: 'b'
     *
     * - True/False: boolean
     *   Example: true
     *
     * - Fill-in: object - Keys are full blank IDs (interactionId_blank_N), values are strings
     *   Example: {"question-1_blank_0": "answer1", "question-1_blank_1": "answer2"}
     *
     * - Drag-Drop: object - Keys are item IDs, values are zone IDs (maps items to zones)
     *   Example: {"item-1": "zone-a", "item-2": "zone-b"}
     *   NOTE: This is {itemId: zoneId} format, NOT {zoneId: [itemIds]}
     *
     * - Numeric: number
     *   Example: 42 or 3.14
     *
     * - Matching: object - Keys are pair IDs, values are matched values
     *   Example: {"pair-1": "match-a", "pair-2": "match-b"}
     *
     * - Hotspot: string - The ID of the selected hotspot
     *   Example: "hotspot-1"
     *
     * @throws {Error} If interaction not found, invalid response, or setResponse fails
     */
    setResponse(interactionId, response) {
        const entry = automationRegistry.get(interactionId);
        if (!entry) {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" not found`);
        }

        if (typeof entry.questionObj.setResponse !== 'function') {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" does not support setResponse`);
        }

        try {
            entry.questionObj.setResponse(response);
            logTrace('setResponse', { interactionId, response });
        } catch (error) {
            logTrace('setResponse:error', { interactionId, response, error: error.message });
            throw new Error(`SCORMAutomation: Failed to set response for "${interactionId}": ${error.message}`);
        }
    },

    // ===== Evaluation Methods =====

    /**
     * Checks the answer for an interaction
     * @param {string} interactionId - The interaction ID
     * @returns {Object} Evaluation result {correct, score, feedback, etc.}
     * @throws {Error} If interaction not found or evaluation fails
     */
    checkAnswer(interactionId) {
        const entry = automationRegistry.get(interactionId);
        if (!entry) {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" not found`);
        }

        if (typeof entry.questionObj.checkAnswer !== 'function') {
            throw new Error(`SCORMAutomation: Interaction "${interactionId}" does not support checkAnswer`);
        }

        try {
            const evaluation = entry.questionObj.checkAnswer();
            logTrace('checkAnswer', { interactionId, evaluation });

            // Record to SCORM InteractionManager (unless in controlled mode)
            // Get config from metadata if available
            const config = entry.metadata.config || { id: interactionId, scormType: entry.metadata.type || 'other' };
            if (!config.controlled) {
                try {
                    recordInteractionResult(config, evaluation);
                } catch (recordError) {
                    console.warn(`[SCORMAutomation] Failed to record interaction "${interactionId}" to SCORM: ${recordError.message}`);
                }
            }

            return evaluation;
        } catch (error) {
            logTrace('checkAnswer:error', { interactionId, error: error.message });
            throw new Error(`SCORMAutomation: Failed to check answer for "${interactionId}": ${error.message}`);
        }
    },

    /**
     * Checks all answers on the current slide (or specified slide)
     * @param {string} slideId - Optional slide ID (defaults to current slide)
     * @returns {Array<Object>} Array of evaluation results, one per interaction
     * Each result contains: { interactionId, type, evaluation?, error? }
     * @throws {Error} If slideId is invalid or navigation fails
     */
    checkSlideAnswers(slideId = null) {
        // Determine target slide
        let targetSlideId = slideId;
        if (!targetSlideId) {
            targetSlideId = this.getCurrentSlide();
            if (!targetSlideId) {
                throw new Error('SCORMAutomation: No current slide found');
            }
        }

        // Get all registered interactions
        const allInteractions = automationRegistry.list();
        
        // Filter interactions that belong to this slide
        // Interaction IDs typically follow patterns like "slideId-questionId" or just "questionId"
        // We'll check if the interaction ID starts with the slide ID or if it exists in the DOM
        const slideInteractions = allInteractions.filter(interaction => {
            // Check if interaction ID starts with slide ID
            if (interaction.id.startsWith(targetSlideId)) {
                return true;
            }

            // Check if element exists in DOM (even if hidden in tabs or other UI patterns)
            const element = document.querySelector(`[data-interaction-id="${interaction.id}"]`) ||
                           document.querySelector(`[data-testid="${interaction.id}-controls"]`) ||
                           document.getElementById(interaction.id);

            // Return true if element exists, regardless of visibility
            // This allows checking interactions that are in inactive tabs, collapsed sections, etc.
            return element !== null;
        });

        if (slideInteractions.length === 0) {
            logTrace('checkSlideAnswers', { 
                slideId: targetSlideId, 
                found: 0,
                message: 'No interactions found on slide'
            });
            return [];
        }

        // Check each interaction and collect results
        const results = [];
        for (const interactionInfo of slideInteractions) {
            try {
                const evaluation = this.checkAnswer(interactionInfo.id);
                results.push({
                    interactionId: interactionInfo.id,
                    type: interactionInfo.type,
                    evaluation
                });
            } catch (error) {
                results.push({
                    interactionId: interactionInfo.id,
                    type: interactionInfo.type,
                    error: error.message
                });
            }
        }

        logTrace('checkSlideAnswers', { 
            slideId: targetSlideId, 
            total: slideInteractions.length,
            successful: results.filter(r => !r.error).length,
            failed: results.filter(r => r.error).length
        });

        return results;
    },

    // ===== Navigation Methods (Phase 2) =====

    /**
     * Gets the course structure
     * @returns {Array} Course structure from config
     */
    getCourseStructure() {
        logTrace('getCourseStructure', {});
        return courseConfig.structure;
    },

    /**
     * Gets the current slide ID
     * @returns {string} Current slide ID
     */
    getCurrentSlide() {
        const currentSlide = NavigationActions.getCurrentSlide();
        logTrace('getCurrentSlide', { slideId: currentSlide?.id });
        return currentSlide?.id || null;
    },

    /**
     * Navigates to a specific slide
     * @param {string} slideId - Target slide ID
     * @param {Object} context - Optional context to pass to slide
     * @throws {Error} If navigation fails
     */
    goToSlide(slideId, context = {}) {
        try {
            NavigationActions.goToSlide(slideId, context);
            logTrace('goToSlide', { slideId, context });
        } catch (error) {
            logTrace('goToSlide:error', { slideId, context, error: error.message });
            throw new Error(`SCORMAutomation: Failed to navigate to "${slideId}": ${error.message}`);
        }
    },

    // ===== Observability Methods =====

    /**
     * Gets the automation trace log
     * @returns {Array<Object>} Copy of the trace log
     */
    getAutomationTrace() {
        return [...automationTrace];
    },

    /**
     * Clears the automation trace log
     */
    clearAutomationTrace() {
        const count = automationTrace.length;
        automationTrace.length = 0;
        logTrace('clearAutomationTrace', { clearedCount: count });
        console.log(`[SCORMAutomation] Cleared ${count} trace entries`);
    },

    // ===== Layout & Style Introspection (Phase 4) =====

    /**
     * Gets a simplified layout tree of the current slide's structure
     * @returns {Object} Layout tree with key elements
     */
    getLayoutTree() {
        const slideContainer = document.getElementById('slide-container');
        if (!slideContainer) {
            throw new Error('SCORMAutomation: No slide container found');
        }

        /**
         * Recursively builds a simplified tree for key elements
         * @private
         */
        function buildTree(element, maxDepth = 3, currentDepth = 0) {
            if (currentDepth >= maxDepth) return null;

            const tagName = element.tagName.toLowerCase();
            const id = element.id || null;
            const testid = element.getAttribute('data-testid') || null;
            const interactionId = element.getAttribute('data-interaction-id') || null;
            const classes = Array.from(element.classList);
            const rect = element.getBoundingClientRect();

            // Only include elements that are significant (not purely structural)
            const isSignificant = 
                id || 
                testid || 
                interactionId ||
                ['section', 'article', 'header', 'nav', 'main', 'aside', 'footer', 
                 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
                 'button', 'input', 'select', 'textarea',
                 'img', 'video', 'audio', 'canvas', 'svg'].includes(tagName) ||
                classes.some(c => c.startsWith('interaction-') || c.startsWith('slide-') || c.startsWith('assessment-'));

            const node = {
                tag: tagName,
                id,
                testid,
                interactionId,
                classes,
                bounds: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                visible: rect.width > 0 && rect.height > 0 && 
                         window.getComputedStyle(element).display !== 'none' &&
                         window.getComputedStyle(element).visibility !== 'hidden'
            };

            // Recursively process children for significant elements
            if (isSignificant && currentDepth < maxDepth - 1) {
                const children = Array.from(element.children)
                    .map(child => buildTree(child, maxDepth, currentDepth + 1))
                    .filter(child => child !== null);
                
                if (children.length > 0) {
                    node.children = children;
                }
            }

            return isSignificant ? node : null;
        }

        const tree = buildTree(slideContainer);
        logTrace('getLayoutTree', { elementCount: JSON.stringify(tree).split('"tag":').length - 1 });
        return tree;
    },

    /**
     * Gets detailed layout and style information for a specific element
     * @param {string} testid - The data-testid attribute value
     * @returns {Object} Element details including bounding box and computed styles
     * @throws {Error} If element not found
     */
    getElementDetails(testid) {
        const element = document.querySelector(`[data-testid="${testid}"]`);
        if (!element) {
            throw new Error(`SCORMAutomation: Element with data-testid="${testid}" not found`);
        }

        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);

        // Curated list of important style properties
        const importantStyles = {
            // Layout
            display: computedStyle.display,
            position: computedStyle.position,
            top: computedStyle.top,
            left: computedStyle.left,
            right: computedStyle.right,
            bottom: computedStyle.bottom,
            width: computedStyle.width,
            height: computedStyle.height,
            margin: computedStyle.margin,
            padding: computedStyle.padding,
            
            // Typography
            fontSize: computedStyle.fontSize,
            fontFamily: computedStyle.fontFamily,
            fontWeight: computedStyle.fontWeight,
            lineHeight: computedStyle.lineHeight,
            textAlign: computedStyle.textAlign,
            
            // Colors
            color: computedStyle.color,
            backgroundColor: computedStyle.backgroundColor,
            
            // Visibility
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            overflow: computedStyle.overflow,
            overflowX: computedStyle.overflowX,
            overflowY: computedStyle.overflowY,
            
            // Flex/Grid
            display: computedStyle.display,
            flexDirection: computedStyle.flexDirection,
            justifyContent: computedStyle.justifyContent,
            alignItems: computedStyle.alignItems,
            gap: computedStyle.gap,
            
            // Z-index
            zIndex: computedStyle.zIndex
        };

        const details = {
            testid,
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            classes: Array.from(element.classList),
            boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left
            },
            computedStyle: importantStyles,
            visible: rect.width > 0 && rect.height > 0 && 
                     computedStyle.display !== 'none' &&
                     computedStyle.visibility !== 'hidden',
            inViewport: rect.top >= 0 && 
                       rect.left >= 0 && 
                       rect.bottom <= window.innerHeight && 
                       rect.right <= window.innerWidth,
            textContent: element.textContent?.trim().substring(0, 100) || null // First 100 chars
        };

        logTrace('getElementDetails', { testid });
        return details;
    },

    /**
     * Validates the current page layout and returns potential issues
     * @returns {Array<Object>} Array of layout issues found
     */
    validatePageLayout() {
        const issues = [];
        const slideContainer = document.getElementById('slide-container');
        
        if (!slideContainer) {
            issues.push({
                type: 'error',
                category: 'structure',
                message: 'No slide container found',
                element: null
            });
            return issues;
        }

        // Get all visible elements with testids (key interactive elements)
        const elements = Array.from(document.querySelectorAll('[data-testid]'));
        const elementRects = elements.map(el => ({
            element: el,
            testid: el.getAttribute('data-testid'),
            rect: el.getBoundingClientRect(),
            style: window.getComputedStyle(el)
        }));

        // Check 1: Off-screen content (partially or fully outside viewport)
        elementRects.forEach(({ element, testid, rect, style }) => {
            if (style.display === 'none' || style.visibility === 'hidden') return;
            
            if (rect.width > 0 && rect.height > 0) {
                const isOffScreen = 
                    rect.right < 0 || 
                    rect.left > window.innerWidth ||
                    rect.bottom < 0 ||
                    rect.top > window.innerHeight;
                
                const isPartiallyOffScreen = 
                    !isOffScreen && (
                        rect.left < 0 ||
                        rect.right > window.innerWidth ||
                        rect.top < 0 ||
                        rect.bottom > window.innerHeight
                    );

                if (isOffScreen) {
                    issues.push({
                        type: 'error',
                        category: 'layout',
                        message: `Element is completely off-screen`,
                        element: testid,
                        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
                    });
                } else if (isPartiallyOffScreen) {
                    issues.push({
                        type: 'warning',
                        category: 'layout',
                        message: `Element is partially off-screen`,
                        element: testid,
                        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
                    });
                }
            }
        });

        // Check 2: Overlapping elements (interactive elements shouldn't overlap)
        const interactiveElements = elementRects.filter(({ testid }) => 
            testid.includes('button') || 
            testid.includes('choice') || 
            testid.includes('check') ||
            testid.includes('submit') ||
            testid.includes('nav-')
        );

        for (let i = 0; i < interactiveElements.length; i++) {
            for (let j = i + 1; j < interactiveElements.length; j++) {
                const elem1 = interactiveElements[i];
                const elem2 = interactiveElements[j];
                
                if (elem1.style.display === 'none' || elem2.style.display === 'none') continue;
                
                const rect1 = elem1.rect;
                const rect2 = elem2.rect;
                
                // Check if rectangles overlap
                const overlaps = !(
                    rect1.right < rect2.left ||
                    rect1.left > rect2.right ||
                    rect1.bottom < rect2.top ||
                    rect1.top > rect2.bottom
                );
                
                if (overlaps) {
                    issues.push({
                        type: 'warning',
                        category: 'layout',
                        message: `Interactive elements overlap`,
                        elements: [elem1.testid, elem2.testid]
                    });
                }
            }
        }

        // Check 3: Text overflow
        elements.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            
            const hasTextContent = el.textContent && el.textContent.trim().length > 0;
            if (hasTextContent) {
                // Check if scrollHeight > clientHeight (vertical overflow)
                if (el.scrollHeight > el.clientHeight + 2) { // +2 for rounding
                    issues.push({
                        type: 'warning',
                        category: 'content',
                        message: `Element has vertical text overflow (content is clipped)`,
                        element: el.getAttribute('data-testid'),
                        details: { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
                    });
                }
                
                // Check if scrollWidth > clientWidth (horizontal overflow)
                if (el.scrollWidth > el.clientWidth + 2) {
                    issues.push({
                        type: 'warning',
                        category: 'content',
                        message: `Element has horizontal text overflow (content is clipped)`,
                        element: el.getAttribute('data-testid'),
                        details: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
                    });
                }
            }
        });

        // Check 4: Low contrast (WCAG AA requires 4.5:1 for normal text, 3:1 for large text)
        function getLuminance(r, g, b) {
            const [rs, gs, bs] = [r, g, b].map(c => {
                c = c / 255;
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }

        function getContrastRatio(color1, color2) {
            const l1 = getLuminance(...color1);
            const l2 = getLuminance(...color2);
            const lighter = Math.max(l1, l2);
            const darker = Math.min(l1, l2);
            return (lighter + 0.05) / (darker + 0.05);
        }

        function parseColor(colorStr) {
            // Simple RGB/RGBA parser
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
            }
            return null;
        }

        elements.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            
            const hasTextContent = el.textContent && el.textContent.trim().length > 0;
            if (hasTextContent) {
                const textColor = parseColor(style.color);
                const bgColor = parseColor(style.backgroundColor);
                
                if (textColor && bgColor) {
                    const contrast = getContrastRatio(textColor, bgColor);
                    const fontSize = parseFloat(style.fontSize);
                    const isLargeText = fontSize >= 18 || (fontSize >= 14 && style.fontWeight >= 700);
                    const minContrast = isLargeText ? 3 : 4.5;
                    
                    if (contrast < minContrast) {
                        issues.push({
                            type: 'error',
                            category: 'accessibility',
                            message: `Low color contrast (${contrast.toFixed(2)}:1, requires ${minContrast}:1)`,
                            element: el.getAttribute('data-testid'),
                            details: { 
                                contrast: contrast.toFixed(2), 
                                required: minContrast,
                                textColor: style.color,
                                backgroundColor: style.backgroundColor
                            }
                        });
                    }
                }
            }
        });

        // Check 5: Zero-size visible elements (likely layout errors)
        elementRects.forEach(({ testid, rect, style }) => {
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                if (rect.width === 0 || rect.height === 0) {
                    issues.push({
                        type: 'warning',
                        category: 'layout',
                        message: `Element has zero ${rect.width === 0 ? 'width' : 'height'}`,
                        element: testid,
                        bounds: { width: Math.round(rect.width), height: Math.round(rect.height) }
                    });
                }
            }
        });

        logTrace('validatePageLayout', { 
            issuesFound: issues.length,
            errors: issues.filter(i => i.type === 'error').length,
            warnings: issues.filter(i => i.type === 'warning').length
        });

        return issues;
    },

    // ===== Engagement Methods =====

    /**
     * Gets engagement state for current slide
     * @returns {Object} { complete, progress, requirements, tracked }
     * @throws {Error} If no active slide
     */
    getEngagementState() {
        const slideId = NavigationState.getCurrentSlideId();
        if (!slideId) {
            throw new Error('SCORMAutomation: No active slide');
        }

        const state = engagementManager.getSlideState(slideId);
        logTrace('getEngagementState', { slideId, state });
        return state;
    },

    /**
     * Gets user-friendly progress for current slide
     * @returns {Object} { percentage, items: [{label, complete, type}] }
     * @throws {Error} If no active slide
     */
    getEngagementProgress() {
        const slideId = NavigationState.getCurrentSlideId();
        if (!slideId) {
            throw new Error('SCORMAutomation: No active slide');
        }

        const progress = engagementManager.getProgress(slideId);
        logTrace('getEngagementProgress', { slideId, progress });
        return progress;
    },

    /**
     * Manually marks a tab as viewed (for testing)
     * @param {string} tabId - Tab identifier
     * @throws {Error} If no active slide
     */
    markTabViewed(tabId) {
        const slideId = NavigationState.getCurrentSlideId();
        if (!slideId) {
            throw new Error('SCORMAutomation: No active slide');
        }

        engagementManager.trackTabView(slideId, tabId);
        logTrace('markTabViewed', { slideId, tabId });
    },

    /**
     * Manually sets scroll depth (for testing)
     * @param {number} percentage - 0-100
     * @throws {Error} If no active slide or invalid percentage
     */
    setScrollDepth(percentage) {
        const slideId = NavigationState.getCurrentSlideId();
        if (!slideId) {
            throw new Error('SCORMAutomation: No active slide');
        }

        if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
            throw new Error('SCORMAutomation: Scroll depth must be a number between 0 and 100');
        }

        engagementManager.trackScrollDepth(slideId, percentage);
        logTrace('setScrollDepth', { slideId, percentage });
    },

    /**
     * Resets engagement for current slide (for testing)
     * @throws {Error} If no active slide
     */
    resetEngagement() {
        const slideId = NavigationState.getCurrentSlideId();
        if (!slideId) {
            throw new Error('SCORMAutomation: No active slide');
        }

        engagementManager.resetSlide(slideId);
        logTrace('resetEngagement', { slideId });
    },

    // ===== Version Info =====

    /**
     * Gets API version info
     * @returns {Object} Version information
     */
    getVersion() {
        return {
            api: '1.3.0',
            phase: 5, // Phases 1-5 complete (added engagement tracking)
            features: [
                'discovery',
                'state-access',
                'state-mutation',
                'evaluation',
                'navigation',
                'observability',
                'ergonomic-helpers',
                'layout-introspection',
                'engagement-tracking'
            ]
        };
    }
};

export default SCORMAutomationAPI;
