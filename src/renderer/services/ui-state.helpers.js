/**
 * UI State Helpers
 * Pure utility functions extracted from ui-state.js to satisfy architecture limits.
 * All functions are side-effect free except safePersistState/safeLoadPersistedUI,
 * which guard DOM access and custom protocol conditions.
 */

/**
 * Deep merge objects (non-array, shallow for primitives)
 * - Does not mutate inputs
 */
export function deepMerge(target = {}, source = {}) {
  const result = { ...target };
  for (const key in source) {
    const val = source[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(result[key] || {}, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Get nested value from object using dot notation
 */
export function getNestedValue(obj, path) {
  if (!obj || !path || typeof path !== 'string') return undefined;
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Set nested value in object using dot notation (mutates the target object)
 */
export function setNestedValue(obj, path, value) {
  if (!obj || !path || typeof path !== 'string') return;
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key];
  }, obj);
  target[lastKey] = value;
}

/**
 * Safely persist UI slice to localStorage with DOM guards and protocol checks.
 */
export function safePersistState(persistenceKey, uiSlice) {
  try {
    // Guard: require window to exist
    if (typeof window === 'undefined') return;

    // Guard: localStorage may be unavailable in this protocol/environment
    if (typeof localStorage === 'undefined') {
      try {
        import(`${window.electronAPI?.rendererBaseUrl || ''}utils/renderer-logger.js`)
          .then(({ rendererLogger }) => {
            try { rendererLogger.info('[UIStateHelpers] safePersistState skipped: localStorage unavailable', { persistenceKey }); } catch (_) {}
          })
          .catch(() => {});
      } catch (_) {}
      return;
    }

    // Guard: skip persistence when running under the scorm-app custom protocol
    if (window.location?.protocol === 'scorm-app:') {
      try {
        import(`${window.electronAPI?.rendererBaseUrl || ''}utils/renderer-logger.js`)
          .then(({ rendererLogger }) => {
            try { rendererLogger.info('[UIStateHelpers] safePersistState skipped: scorm-app protocol (no localStorage)', { persistenceKey }); } catch (_) {}
          })
          .catch(() => {});
      } catch (_) {}
      return;
    }

    const payload = { ui: {
      theme: uiSlice?.theme,
      debugPanelVisible: uiSlice?.debugPanelVisible,
      sidebarCollapsed: uiSlice?.sidebarCollapsed,
      devModeEnabled: uiSlice?.devModeEnabled
    }};
    localStorage.setItem(persistenceKey, JSON.stringify(payload));
  } catch (_e) {
    // swallow per logging rules (renderer console not used)
  }
}

/**
 * Safely load persisted UI slice from localStorage with DOM guards and protocol checks.
 * Returns a partial state object { ui: {...} } or null if unavailable.
 */
export function safeLoadPersistedUI(persistenceKey) {
  try {
    if (typeof window === 'undefined') return null;

    if (typeof localStorage === 'undefined') {
      try {
        import(`${window.electronAPI?.rendererBaseUrl || ''}utils/renderer-logger.js`)
          .then(({ rendererLogger }) => {
            try { rendererLogger.info('[UIStateHelpers] safeLoadPersistedUI skipped: localStorage unavailable', { persistenceKey }); } catch (_) {}
          })
          .catch(() => {});
      } catch (_) {}
      return null;
    }

    if (window.location?.protocol === 'scorm-app:') {
      try {
        import(`${window.electronAPI?.rendererBaseUrl || ''}utils/renderer-logger.js`)
          .then(({ rendererLogger }) => {
            try { rendererLogger.info('[UIStateHelpers] safeLoadPersistedUI skipped: scorm-app protocol (no localStorage)', { persistenceKey }); } catch (_) {}
          })
          .catch(() => {});
      } catch (_) {}
      return null;
    }

    const persisted = localStorage.getItem(persistenceKey);
    if (!persisted) return null;
    const parsed = JSON.parse(persisted);
    if (parsed && parsed.ui) {
      // Filter out centrally-managed keys; main AppState is the source of truth
      const filtered = { ...parsed.ui };
      for (const k of ['theme','debugPanelVisible','sidebarCollapsed','sidebarVisible','devModeEnabled']) {
        if (k in filtered) delete filtered[k];
      }
      // Return only if any non-central keys remain
      if (Object.keys(filtered).length > 0) return { ui: filtered };
      return null;
    }
    return null;
  } catch (_e) {
    // Swallow but log parse/load issues to renderer logger if available
    try {
      if (typeof window !== 'undefined') {
        import(`${window.electronAPI?.rendererBaseUrl || ''}utils/renderer-logger.js`)
          .then(({ rendererLogger }) => {
            try { rendererLogger.warn('[UIStateHelpers] safeLoadPersistedUI failed to parse persisted data', { persistenceKey }); } catch (_) {}
          })
          .catch(() => {});
      }
    } catch (_) {}
    return null;
  }
}