/*
 * Integrated Inspector Panel Component (Phase 2 skeleton)
 * Renders inside the main window and replaces the legacy separate Inspector window.
 * Listens to UI intent events and exposes simple show/hide/toggle methods.
 */

// @ts-check
import { BaseComponent } from '../base-component.js';
import { snBridge } from '../../services/sn-bridge.js';

class InspectorPanel extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, {
      className: 'inspector-panel',
      ...options,
    });
    this.visible = false;
    this.loaded = false;
    this.activeTab = 'api';
    this.state = {
      history: [],
      errors: [],
      dataModel: {},
      activityTree: {},
      navigation: [],
      objectives: [],
      ssp: []
    };
    this._unsubs = [];
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      attributes: { 'data-component': 'inspector-panel' },
    };
  }

  renderContent() {
    // Shell with tabs, controls, summary, and per-tab containers
    this.element.innerHTML = `
      <div class="inspector-panel__container" style="display:none">
        <div class="inspector-panel__header">
          <strong>SCORM Inspector (Integrated)</strong>
          <div class="inspector-panel__header-actions">
            <button class="js-refresh-tab" title="Refresh current tab">⟳ Refresh</button>
            <button class="inspector-panel__close" title="Close">✕</button>
          </div>
        </div>
        <div class="inspector-panel__tabs">
          <button data-tab="api">API Log</button>
          <button data-tab="tree">Activity Tree</button>
          <button data-tab="objectives">Objectives</button>
          <button data-tab="ssp">SSP Buckets</button>
        </div>
        <div class="inspector-panel__body">
          <div class="inspector-panel__summary">
            <span class="summary__item">API calls: <b class="js-api-count">0</b></span>
            <span class="summary__item">Errors: <b class="js-error-count">0</b></span>
            <span class="summary__item">Objectives: <b class="js-objective-count">0</b></span>
            <span class="summary__item">Nav records: <b class="js-nav-count">0</b></span>
          </div>
          <div class="inspector-tab" id="inspector-tab-api"></div>
          <div class="inspector-tab" id="inspector-tab-tree" style="display:none"></div>
          <div class="inspector-tab" id="inspector-tab-objectives" style="display:none"></div>
          <div class="inspector-tab" id="inspector-tab-ssp" style="display:none"></div>
        </div>
      </div>
    `;
    this.container = this.element.querySelector('.inspector-panel__container');
    this.tabsEl = this.element.querySelector('.inspector-panel__tabs');
    this.bodyEl = this.element.querySelector('.inspector-panel__body');
    this.tabEls = {
      api: this.element.querySelector('#inspector-tab-api'),
      tree: this.element.querySelector('#inspector-tab-tree'),
      objectives: this.element.querySelector('#inspector-tab-objectives'),
      ssp: this.element.querySelector('#inspector-tab-ssp'),
    };
    const closeBtn = this.element.querySelector('.inspector-panel__close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
    const refreshBtn = this.element.querySelector('.js-refresh-tab');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshActiveTab());

    this._summary = {
      api: this.element.querySelector('.js-api-count'),
      err: this.element.querySelector('.js-error-count'),
      obj: this.element.querySelector('.js-objective-count'),
      nav: this.element.querySelector('.js-nav-count')
    };

    // Filters/paging state for API tab
    this.filters = this.filters || { method: 'all', errorsOnly: false, page: 1, pageSize: 100 };

    // Initial tab render
    try { this.setActiveTab(this.activeTab || 'api'); } catch (_) {}

    // Initial tab render

  setActiveTab(tab) {
    const allowed = ['api','tree','objectives','ssp'];
    const next = allowed.includes(tab) ? tab : 'api';
    this.activeTab = next;
    // Toggle tab containers
    Object.entries(this.tabEls || {}).forEach(([key, el]) => {
      if (!el) return;
      el.style.display = key === next ? '' : 'none';
    });
    // Toggle active state on tab buttons for styling
    try {
      if (this.tabsEl) {
        const buttons = this.tabsEl.querySelectorAll('button[data-tab]');
        buttons.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-tab') === next);
        });
      }
    } catch (_) {}
    this.renderActiveTab();
  }

  async refreshActiveTab() {
    try {
      switch (this.activeTab) {
        case 'api': {
          const hist = await snBridge.getScormInspectorHistory();
          if (hist?.success && hist.data) {
            this.state.history = hist.data.history || [];
            this.state.errors = hist.data.errors || [];
            this.state.dataModel = hist.data.dataModel || {};
          }
          break;
        }
        case 'tree': {
          const tree = await snBridge.getActivityTree();
          if (tree?.success) this.state.activityTree = tree.data || {};
          break;
        }
        case 'objectives': {
          const obj = await snBridge.getGlobalObjectives();
          if (obj?.success) this.state.objectives = obj.data || [];
          break;
        }
        case 'ssp': {
          const ssp = await snBridge.getSSPBuckets();
          if (ssp?.success) this.state.ssp = ssp.data || [];
          break;
        }
      }
      this.updateSummaryCounts();
      this.renderActiveTab();
    } catch (e) {
      this.uiState?.showNotification({ type: 'error', message: 'Refresh failed', details: e?.message || String(e) });
    }
  }

  renderActiveTab() {
    switch (this.activeTab) {
      case 'api': return this.renderApiLog();
      case 'tree': return this.renderActivityTree();
      case 'objectives': return this.renderObjectives();
      case 'ssp': return this.renderSSP();
      default: return this.renderApiLog();
    }
  }

  // Helpers for API tab
  _getMethods() {
    const hist = Array.isArray(this.state.history) ? this.state.history : [];
    const methods = new Set();
    hist.forEach(it => {
      const m = it?.method || it?.name;
      if (m) methods.add(String(m));
    });
    return Array.from(methods).sort();
  }

  _applyApiFilters(items) {
    let out = items;
    const { method, errorsOnly } = this.filters || {};
    if (method && method !== 'all') {
      out = out.filter(it => (it?.method || it?.name) === method);
    }
    if (errorsOnly) {
      out = out.filter(it => it?.error || it?.level === 'error');
    }
    return out;
  }

  _paginate(items) {
    const pageSize = Math.max(10, Math.min(500, this.filters?.pageSize || 100));
    const page = Math.max(1, this.filters?.page || 1);
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const clampedPage = Math.min(page, pages);
    const start = (clampedPage - 1) * pageSize;
    const end = start + pageSize;
    return { slice: items.slice(start, end), page: clampedPage, pages, total, pageSize };
  }

  // Simple, defensive renderers
  renderApiLog() {
    const el = this.tabEls?.api; if (!el) return;
    const all = Array.isArray(this.state.history) ? this.state.history : [];
    const filtered = this._applyApiFilters(all);
    const { slice, page, pages, total, pageSize } = this._paginate(filtered);

    const methodOptions = ['<option value="all">All methods</option>', ...this._getMethods().map(m => `<option value="${this._esc(m)}" ${this.filters?.method===m?'selected':''}>${this._esc(m)}</option>`)].join('');

    const controls = `
      <div class="api-controls">
        <label>Method <select class="js-api-filter">${methodOptions}</select></label>
        <label><input type="checkbox" class="js-api-errors" ${this.filters?.errorsOnly?'checked':''}/> Errors only</label>
        <span class="api-paging">Page ${page}/${pages} • ${total} items</span>
        <div class="api-paging__buttons">
          <button class="js-page-prev" ${page<=1?'disabled':''}>Prev</button>
          <button class="js-page-next" ${page>=pages?'disabled':''}>Next</button>
        </div>
      </div>`;

    const list = ['<ul class="api-log">',
      ...slice.map((it) => `<li><code>${this._esc(it?.method || it?.name || 'unknown')}</code>`+
        `${it?.timestamp ? ` <small>${this._esc(String(it.timestamp))}</small>` : ''}`+
        `${it?.args ? ` <small>${this._esc(JSON.stringify(it.args))}</small>` : ''}`+
        `${it?.error ? ` <small class="error">${this._esc(String(it.error))}</small>` : ''}`+
      `</li>`),
      '</ul>'].join('');

    const errorsBlock = this.state.errors?.length && this.filters?.errorsOnly
      ? `<div class="tab-section"><h4>Errors (${this.state.errors.length})</h4><ul class="api-errors">${this.state.errors.slice(0,100).map(e=>`<li>${this._esc(e?.message||String(e))}</li>`).join('')}</ul></div>`
      : '';

    el.innerHTML = `<div class="tab-section"><h4>API Calls</h4>${controls}${list}</div>${errorsBlock}`;
  }

  renderActivityTree() {
    const el = this.tabEls?.tree; if (!el) return;
    const tree = this.state.activityTree || {};
    const renderNode = (n) => {
      if (!n || typeof n !== 'object') return '';
      const title = this._esc(n.title || n.identifier || n.id || 'node');
      const status = n.status ? ` <small>(${this._esc(String(n.status))})</small>` : '';
      const children = Array.isArray(n.children) ? n.children.map(renderNode).join('') : '';
      return `<li>${title}${status}${children ? `<ul>${children}</ul>` : ''}</li>`;
    };
    const body = tree && tree.root ? renderNode(tree.root) : (tree?.children ? tree.children.map(renderNode).join('') : '');
    el.innerHTML = `<div class="tab-section"><h4>Activity Tree</h4><ul class="activity-tree">${body || '<li><em>No activity tree available</em></li>'}</ul></div>`;
  }

  renderObjectives() {
    const el = this.tabEls?.objectives; if (!el) return;
    const rows = Array.isArray(this.state.objectives) ? this.state.objectives : [];
    const renderRow = (o) => {
      const id = this._esc(String(o?.id || o?.objectiveId || ''));
      const satisfied = this._esc(String(o?.satisfied ?? o?.isSatisfied ?? ''));
      const measure = this._esc(String(o?.measure ?? ''));
      const score = this._esc(String(o?.score ?? o?.rawScore ?? ''));
      return `<tr><td>${id}</td><td>${satisfied}</td><td>${measure}</td><td>${score}</td></tr>`;
    };
    el.innerHTML = `<div class="tab-section"><h4>Objectives</h4>
      <table class="kv"><thead><tr><th>ID</th><th>Satisfied</th><th>Measure</th><th>Score</th></tr></thead>
      <tbody>${rows.slice(0,200).map(renderRow).join('') || '<tr><td colspan="4"><em>No objectives</em></td></tr>'}</tbody></table></div>`;
  }

  renderSSP() {
    const el = this.tabEls?.ssp; if (!el) return;
    const rows = Array.isArray(this.state.ssp) ? this.state.ssp : [];
    const renderRow = (b) => {
      const id = this._esc(String(b?.id || b?.name || 'bucket'));
      const used = this._esc(String(b?.used || b?.usage || ''));
      const size = this._esc(String(b?.size || b?.maxSize || ''));
      return `<tr><td>${id}</td><td>${used}</td><td>${size}</td></tr>`;
    };
    el.innerHTML = `<div class="tab-section"><h4>SSP Buckets</h4>
      <table class="kv"><thead><tr><th>Bucket</th><th>Used</th><th>Size</th></tr></thead>
      <tbody>${rows.slice(0,200).map(renderRow).join('') || '<tr><td colspan="3"><em>No SSP data</em></td></tr>'}</tbody></table></div>`;
  }

  _esc(v) { try { return String(v).replace(/[&<>"]+/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); } catch (e) { return ''; } }

  bindEvents() {
    super.bindEvents();
    // Tabs click handler
    try {
      if (this.tabsEl) {
        this.tabsEl.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[data-tab]');
          if (btn && btn.dataset?.tab) this.setActiveTab(btn.dataset.tab);
        });
      }
    } catch (_) {}

    // API tab controls (delegated)
    try {
      const apiTab = this.tabEls?.api;
      if (apiTab) {
        apiTab.addEventListener('change', (e) => {
          if (e.target?.classList?.contains('js-api-filter')) {
            this.filters.method = e.target.value || 'all';
            this.filters.page = 1;
            this.renderApiLog();
          } else if (e.target?.classList?.contains('js-api-errors')) {
            this.filters.errorsOnly = !!e.target.checked;
            this.filters.page = 1;
            this.renderApiLog();
          }
        });
        apiTab.addEventListener('click', (e) => {
          const t = e.target;
          if (t?.classList?.contains('js-page-prev')) {
            this.filters.page = Math.max(1, (this.filters.page||1)-1);
            this.renderApiLog();
          } else if (t?.classList?.contains('js-page-next')) {
            this.filters.page = (this.filters.page||1)+1;
            this.renderApiLog();
          }
        });
      }
    } catch (_) {}

    // Subscribe to main-pushed inspector updates
    try {
      const off = snBridge.onScormInspectorDataUpdated((payload) => {

          try {
            if (payload?.history) this.state.history = payload.history;
            if (payload?.errors) this.state.errors = payload.errors;
            if (payload?.dataModel) this.state.dataModel = payload.dataModel;
            this.updateSummaryCounts();
            this.renderActiveTab();
          } catch (_) {}
        });
        this._unsubs.push(off);
    } catch (_) {}
  }

  show() {
    this.visible = true;
    if (this.container) this.container.style.display = 'block';
    if (!this.loaded) this.loadInitialData();
    try { this.uiState?.setState('ui.inspectorVisible', true, true); } catch (_) {}
    try { this.eventBus?.emit('inspector:state:updated', { visible: true }); } catch (_) {}
    this.emit('visibilityChanged', { visible: true });
  }

  hide() {
    this.visible = false;
    if (this.container) this.container.style.display = 'none';
    try { this.uiState?.setState('ui.inspectorVisible', false, true); } catch (_) {}
    try { this.eventBus?.emit('inspector:state:updated', { visible: false }); } catch (_) {}
    this.emit('visibilityChanged', { visible: false });
  }

  toggleVisibility() {
    if (this.visible) this.hide(); else this.show();
  }


  async loadInitialData() {
    try {
      const [hist, tree, nav, obj, ssp] = await Promise.all([
        snBridge.getScormInspectorHistory(),
        snBridge.getActivityTree(),
        snBridge.getNavigationRequests(),
        snBridge.getGlobalObjectives(),
        snBridge.getSSPBuckets()
      ]);

      if (hist?.success && hist.data) {
        this.state.history = hist.data.history || [];
        this.state.errors = hist.data.errors || [];
        this.state.dataModel = hist.data.dataModel || {};
      }
      if (tree?.success) this.state.activityTree = tree.data || {};
      if (nav?.success) this.state.navigation = nav.data || [];
      if (obj?.success) this.state.objectives = obj.data || [];
      if (ssp?.success) this.state.ssp = ssp.data || [];

      this.updateSummaryCounts();
      this.loaded = true;
      this.emit('dataLoaded', { ok: true });
    } catch (error) {
      this.uiState?.showNotification({ type: 'error', message: 'Inspector load failed', details: error?.message || String(error) });
      this.emit('dataLoaded', { ok: false, error });
    }
  }

  updateSummaryCounts() {
    try {
      if (this._summary?.api) this._summary.api.textContent = String(this.state.history.length || 0);
      if (this._summary?.err) this._summary.err.textContent = String(this.state.errors.length || 0);
      if (this._summary?.obj) this._summary.obj.textContent = String(this.state.objectives.length || 0);
      if (this._summary?.nav) this._summary.nav.textContent = String(this.state.navigation.length || 0);
    } catch (_) {}
  }

  destroy() {
    try { this._unsubs?.forEach((off) => { try { off(); } catch (_) {} }); } catch (_) {}
    super.destroy();
  }

  getStatus() {
    return { visible: this.visible, loaded: this.loaded, counts: {
      api: this.state.history.length,
      errors: this.state.errors.length,
      objectives: this.state.objectives.length,
      navigation: this.state.navigation.length
    }};
  }
}

export { InspectorPanel };

