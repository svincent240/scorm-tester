// @ts-check

/**
 * Header Controls Component
 *
 * Renders header action buttons and emits intent events via EventBus.
 * No direct service calls; AppManager listens and orchestrates.
 */

import { BaseComponent } from './base-component.js';
import { rendererLogger } from '../utils/renderer-logger.js';

class HeaderControls extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    this.reloadBtn = null;
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'header-controls',
      attributes: { 'data-component': 'header-controls' }
    };
  }

  async setup() {
    // Nothing special; dependencies loaded in BaseComponent
  }

  renderContent() {
    this.element.innerHTML = `
      <div class="header-controls__group">
        <button class="btn btn--secondary btn--sm" id="hc-open-zip" title="Open SCORM Zip">Open ZIP</button>
        <button class="btn btn--secondary btn--sm" id="hc-open-folder" title="Open Folder">Open Folder</button>
        <button class="btn btn--secondary btn--sm" id="course-reload-btn" title="Reload Current Course" disabled>Reload</button>
        <button class="btn btn--secondary btn--sm" id="hc-inspector" title="Toggle Inspector">Inspector</button>
        <button class="btn btn--secondary btn--sm" id="hc-theme" title="Toggle Theme">Theme</button>
      </div>
    `;

    this.reloadBtn = this.element.querySelector('#course-reload-btn');
  }

  bindEvents() {
    super.bindEvents();

    // Idempotency guard: bind header actions only once
    if (this._headerActionsBound) return;
    this._headerActionsBound = true;

    // Delegate all header button clicks through a single listener on the component root
    this.addEventListener('click', function onHeaderClick(event) {
      const target = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!target || !this.element.contains(target)) return;

      switch (target.id) {
        case 'hc-open-zip':
          try { rendererLogger.info('HeaderControls: emit course:open-zip:request'); } catch (_) {}
          this.eventBus.emit('course:open-zip:request');
          break;
        case 'hc-open-folder':
          try { rendererLogger.info('HeaderControls: emit course:open-folder:request'); } catch (_) {}
          this.eventBus.emit('course:open-folder:request');
          break;
        case 'course-reload-btn':
          try { rendererLogger.info('HeaderControls: emit course:reload:request'); } catch (_) {}
          this.eventBus.emit('course:reload:request');
          break;
        case 'hc-inspector':
          this.eventBus.emit('ui:inspector:toggle-request');
          break;
        case 'hc-theme':
          this.eventBus.emit('ui:theme:toggle-request');
          break;
      }
    });
  }

  setupEventSubscriptions() {
    // Enable/disable reload button based on course load state
    this.subscribe('course:loaded', () => {
      if (this.reloadBtn) this.reloadBtn.disabled = false;
    });

    this.subscribe('course:cleared', () => {
      if (this.reloadBtn) this.reloadBtn.disabled = true;
    });
  }
}

export { HeaderControls };

