// @ts-check

/**
 * JSON Viewer Utility
 * 
 * Renders JSON data as an interactive, collapsible tree structure.
 * Provides expand/collapse functionality for nested objects and arrays.
 */

import { rendererLogger } from './renderer-logger.js';

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render a JSON value as HTML with expand/collapse functionality
 * @param {any} data - JSON data to render
 * @param {Object} options - Rendering options
 * @param {boolean} options.expanded - Whether to expand all nodes by default
 * @param {number} options.maxDepth - Maximum depth to auto-expand (default: 2)
 * @param {number} options.currentDepth - Current depth (internal use)
 * @returns {string} HTML string
 */
export function renderJsonViewer(data, options = {}) {
  const { expanded = false, maxDepth = 2, currentDepth = 0 } = options;
  
  // Auto-expand based on depth
  const shouldExpand = expanded || currentDepth < maxDepth;
  
  return renderValue(data, currentDepth, shouldExpand, maxDepth);
}

/**
 * Render a single value (primitive, object, or array)
 * @private
 */
function renderValue(value, depth, shouldExpand, maxDepth) {
  if (value === null) {
    return '<span class="json-null">null</span>';
  }

  if (value === undefined) {
    return '<span class="json-undefined">undefined</span>';
  }

  const type = typeof value;

  if (type === 'boolean') {
    return `<span class="json-boolean">${value}</span>`;
  }

  if (type === 'number') {
    return `<span class="json-number">${value}</span>`;
  }

  if (type === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(value);
        // It's a JSON string, render it as an object or array
        return renderValue(parsed, depth, shouldExpand, maxDepth);
      } catch (e) {
        // Not a valid JSON string, treat as a regular string
      }
    }
    return `<span class="json-string">"${escapeHtml(value)}"</span>`;
  }

  if (Array.isArray(value)) {
    return renderArray(value, depth, shouldExpand, maxDepth);
  }

  if (type === 'object') {
    return renderObject(value, depth, shouldExpand, maxDepth);
  }

  // Fallback for functions, symbols, etc.
  return `<span class="json-other">${escapeHtml(String(value))}</span>`;
}

/**
 * Render an object
 * @private
 */
function renderObject(obj, depth, shouldExpand, maxDepth) {
  const keys = Object.keys(obj);
  
  if (keys.length === 0) {
    return '<span class="json-empty">{}</span>';
  }
  
  const expandedClass = shouldExpand ? 'json-expanded' : 'json-collapsed';
  const toggleIcon = shouldExpand ? '▼' : '▶';
  
  const entries = keys.map(key => {
    const value = obj[key];
    const renderedValue = renderValue(value, depth + 1, depth + 1 < maxDepth, maxDepth);
    return `
      <div class="json-property">
        <span class="json-key">"${escapeHtml(key)}"</span>: ${renderedValue}
      </div>
    `;
  }).join('');
  
  return `
    <div class="json-object ${expandedClass}">
      <span class="json-toggle" data-action="toggle">${toggleIcon}</span>
      <span class="json-bracket">{</span>
      <span class="json-count">${keys.length} ${keys.length === 1 ? 'property' : 'properties'}</span>
      <div class="json-content">
        ${entries}
      </div>
      <span class="json-bracket">}</span>
    </div>
  `;
}

/**
 * Render an array
 * @private
 */
function renderArray(arr, depth, shouldExpand, maxDepth) {
  if (arr.length === 0) {
    return '<span class="json-empty">[]</span>';
  }
  
  const expandedClass = shouldExpand ? 'json-expanded' : 'json-collapsed';
  const toggleIcon = shouldExpand ? '▼' : '▶';
  
  const items = arr.map((item, index) => {
    const renderedValue = renderValue(item, depth + 1, depth + 1 < maxDepth, maxDepth);
    return `
      <div class="json-array-item">
        <span class="json-index">${index}</span>: ${renderedValue}
      </div>
    `;
  }).join('');
  
  return `
    <div class="json-array ${expandedClass}">
      <span class="json-toggle" data-action="toggle">${toggleIcon}</span>
      <span class="json-bracket">[</span>
      <span class="json-count">${arr.length} ${arr.length === 1 ? 'item' : 'items'}</span>
      <div class="json-content">
        ${items}
      </div>
      <span class="json-bracket">]</span>
    </div>
  `;
}

/**
 * Attach event handlers to a JSON viewer element
 * @param {HTMLElement} element - Container element with JSON viewer content
 */
export function attachJsonViewerHandlers(element) {
  if (!element) return;
  
  // Use event delegation for toggle clicks
  element.addEventListener('click', (e) => {
    const target = e.target;
    
    if (target && target.classList && target.classList.contains('json-toggle')) {
      const container = target.parentElement;
      
      if (container) {
        const isExpanded = container.classList.contains('json-expanded');
        
        if (isExpanded) {
          container.classList.remove('json-expanded');
          container.classList.add('json-collapsed');
          target.textContent = '▶';
        } else {
          container.classList.remove('json-collapsed');
          container.classList.add('json-expanded');
          target.textContent = '▼';
        }
      }
    }
  });
}

/**
 * Create a complete JSON viewer with controls
 * @param {any} data - JSON data to render
 * @param {Object} options - Rendering options
 * @param {boolean} options.showControls - Whether to show expand/collapse all controls
 * @param {boolean} options.showCopy - Whether to show copy button
 * @param {string} options.title - Optional title for the viewer
 * @returns {Object} Object with html string, controlsHtml string, and setup function
 */
export function createJsonViewer(data, options = {}) {
  const {
    showControls = true,
    showCopy = true,
    title = 'JSON Data',
    expanded = false,
    maxDepth = 2
  } = options;

  const viewerId = `json-viewer-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  const jsonHtml = renderJsonViewer(data, { expanded, maxDepth });

  const controlsHtml = showControls ? `
    <div class="json-viewer-controls">
      <button class="json-expand-all" data-viewer="${viewerId}">Expand All</button>
      <button class="json-collapse-all" data-viewer="${viewerId}">Collapse All</button>
      ${showCopy ? `<button class="json-copy" data-viewer="${viewerId}" title="Copy JSON to clipboard">📋 Copy JSON</button>` : ''}
    </div>
  ` : '';

  const html = `
    <div class="json-viewer" id="${viewerId}">
      <div class="json-viewer-content">
        ${jsonHtml}
      </div>
    </div>
  `;
  
  /**
   * Setup function to attach event handlers after the HTML is inserted into DOM
   * @param {HTMLElement} containerElement - The container element
   */
  const setup = (containerElement) => {
    const viewer = containerElement.querySelector(`#${viewerId}`);
    if (!viewer) return;

    const content = viewer.querySelector('.json-viewer-content');
    if (content) {
      attachJsonViewerHandlers(content);
    }

    // Expand all button - look in container, not just viewer
    const expandAllBtn = containerElement.querySelector(`.json-expand-all[data-viewer="${viewerId}"]`);
    if (expandAllBtn && content) {
      expandAllBtn.addEventListener('click', () => {
        const allCollapsed = content.querySelectorAll('.json-collapsed');
        allCollapsed.forEach(el => {
          el.classList.remove('json-collapsed');
          el.classList.add('json-expanded');
          const toggle = el.querySelector('.json-toggle');
          if (toggle) toggle.textContent = '▼';
        });
      });
    }

    // Collapse all button - look in container, not just viewer
    const collapseAllBtn = containerElement.querySelector(`.json-collapse-all[data-viewer="${viewerId}"]`);
    if (collapseAllBtn && content) {
      collapseAllBtn.addEventListener('click', () => {
        const allExpanded = content.querySelectorAll('.json-expanded');
        allExpanded.forEach(el => {
          el.classList.remove('json-expanded');
          el.classList.add('json-collapsed');
          const toggle = el.querySelector('.json-toggle');
          if (toggle) toggle.textContent = '▶';
        });
      });
    }

    // Copy button - look in container, not just viewer
    const copyBtn = containerElement.querySelector(`.json-copy[data-viewer="${viewerId}"]`);
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          const jsonString = JSON.stringify(data, null, 2);
          await navigator.clipboard.writeText(jsonString);
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 1000);
        } catch (err) {
          rendererLogger.error('Failed to copy JSON to clipboard', { error: err?.message });
        }
      });
    }
  };

  return { html, controlsHtml, setup };
}

