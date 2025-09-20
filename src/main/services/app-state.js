const BaseService = require('./base-service');

// Allowed theme values
const THEME_VALUES = new Set(['default', 'dark', 'system']);

class AppStateService extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('AppStateService', errorHandler, logger, options);
    this.appState = {
      ui: {
        theme: 'default',
      },
    };
  }

  async doInitialize() {
    // In a future iteration we may hydrate from disk. For now keep in-memory only.
    this.logger?.info('AppStateService initialized');
  }

  getSettings() {
    // Return a shallow clone to avoid external mutation
    return { success: true, settings: { ui: { ...this.appState.ui } } };
  }

  setSettings(partial) {
    try {
      if (!partial || typeof partial !== 'object') {
        return { success: false, error: 'invalid_settings' };
      }

      if (partial.ui && typeof partial.ui === 'object') {
        // theme
        if (Object.prototype.hasOwnProperty.call(partial.ui, 'theme')) {
          const theme = String(partial.ui.theme || '').trim();
          if (!THEME_VALUES.has(theme)) {
            return { success: false, error: 'invalid_theme' };
          }
          this.appState.ui.theme = theme;
        }
        // boolean flags
        const boolKeys = ['debugPanelVisible', 'sidebarCollapsed', 'sidebarVisible', 'devModeEnabled'];
        for (const k of boolKeys) {
          if (Object.prototype.hasOwnProperty.call(partial.ui, k)) {
            const v = partial.ui[k];
            if (typeof v !== 'boolean') {
              return { success: false, error: `invalid_${k}` };
            }
            this.appState.ui[k] = v;
          }
        }
      }

      return { success: true, settings: { ui: { ...this.appState.ui } } };
    } catch (e) {
      this.logger?.error('AppStateService.setSettings failed:', e?.message || e);
      return { success: false, error: e?.message || String(e) };
    }
  }
}

module.exports = AppStateService;

