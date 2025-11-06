/*
 * Integrated Inspector Panel Component
 * Hosts the in-app inspector timeline and supporting SCORM views.
 */

// @ts-check
import { BaseComponent } from '../base-component.js';
import { snBridge } from '../../services/sn-bridge.js';
import { createJsonViewer } from '../../utils/json-viewer.js';
import { rendererLogger } from '../../utils/renderer-logger.js';

/**
 * @typedef {import('../../services/sn-bridge.js').SNBridge} SNBridgeType
 * @typedef {'api-call'|'data-model-change'} TimelineKind
 * @typedef {{
 *   kind: TimelineKind;
 *   timestampMs: number;
 *   timestampIso: string;
 *   data: Record<string, any>;
 *   method?: string;
 *   hasError?: boolean;
 *   element?: string;
 *   source?: string;
 *   sessionId?: string;
 * }} TimelineEntry
 * @typedef {Record<string, any>} HistoryEntry
 * @typedef {Record<string, any>} DataModelChangeEntry
 * @typedef {object} InspectorPanelState
 * @property {HistoryEntry[]} history
 * @property {DataModelChangeEntry[]} dataModelChanges
 * @property {Record<string, any>[]} errors
 * @property {Record<string, any>} dataModel
 * @property {Record<string, any>} activityTree
 * @property {Record<string, any>[]} navigation
 * @property {Record<string, any>[]} objectives
 * @property {Record<string, any>[]} ssp
 * @property {Record<string, any>} sn
 * @typedef {{ total: number; hasMore: boolean }} HistoryMetaSummary
 * @typedef {{ history: HistoryMetaSummary; dataModelChanges: HistoryMetaSummary }} InspectorStateMeta
 * @typedef {{ method: string; errorsOnly: boolean; showApi: boolean; showDataModel: boolean }} InspectorTimelineFilters
 * @typedef {{ page: number; pageSize: number }} InspectorTimelinePager
 * @typedef {{ api: HTMLElement | null; tree: HTMLElement | null; objectives: HTMLElement | null; ssp: HTMLElement | null; model: HTMLElement | null; sn: HTMLElement | null }} InspectorTabMap
 * @typedef {{ api: HTMLElement | null; dm: HTMLElement | null; err: HTMLElement | null; obj: HTMLElement | null; nav: HTMLElement | null }} InspectorSummaryRefs
 * @typedef {{ changes: DataModelChangeEntry[]; total: number; hasMore: boolean; success?: boolean; error?: string }} DataModelHistoryResult
 * @typedef {{ slice: TimelineEntry[]; page: number; pages: number; total: number; pageSize: number }} TimelinePagination
 */

class InspectorPanel extends BaseComponent {
  /**
   * @param {string} elementId
   * @param {Record<string, any>} [options]
   */
  constructor(elementId, options = {}) {
    super(elementId, { className: 'inspector-panel', ...options });
    /** @type {boolean} */
    this.visible = false;
    /** @type {boolean} */
    this.loaded = false;
    /** @type {'api'|'tree'|'objectives'|'ssp'|'model'|'sn'} */
    this.activeTab = 'api';
    /** @type {InspectorPanelState} */
    this.state = {
      history: [],
      dataModelChanges: [],
      errors: [],
      dataModel: {},
      activityTree: {},
      navigation: [],
      objectives: [],
      ssp: [],
      sn: {}
    };
    /** @type {InspectorStateMeta} */
    this.stateMeta = {
      history: { total: 0, hasMore: false },
      dataModelChanges: { total: 0, hasMore: false }
    };
    /** @type {InspectorTimelineFilters} */
    this._timelineFilters = {
      method: 'all',
      errorsOnly: false,
      showApi: true,
      showDataModel: true
    };
    /** @type {InspectorTimelinePager} */
    this._timelinePager = { page: 1, pageSize: 100 };
    /** @type {number} */
    this._maxHistory = 2000;
    /** @type {number} */
    this._maxDataModelHistory = 5000;
    /** @type {number} */
    this._maxErrors = 200;
    /** @type {InspectorSummaryRefs} */
    this._summary = { api: null, dm: null, err: null, obj: null, nav: null };
    /** @type {Array<() => void>} */
    this._unsubs = [];
    /** @type {(() => void) | null} */
    this._resizeCleanup = null;
    /** @type {HTMLElement | null} */
    this.container = null;
    /** @type {HTMLElement | null} */
    this.tabsEl = null;
    /** @type {HTMLElement | null} */
    this.bodyEl = null;
    /** @type {InspectorTabMap} */
    this.tabEls = { api: null, tree: null, objectives: null, ssp: null, model: null, sn: null };
    /** @type {boolean} */
    this._subscriptionsBound = false;
    /** @type {boolean} */
    this._runtimeSubscriptionsBound = false;
    /** @type {boolean} */
    this._domEventsBound = false;
    /** @type {((event: Event) => void) | null} */
    this._tabsClickHandler = null;
    /** @type {((event: Event) => void) | null} */
    this._apiChangeHandler = null;
    /** @type {((event: Event) => void) | null} */
    this._apiClickHandler = null;
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      attributes: { 'data-component': 'inspector-panel' },
    };
  }

  async setup() {
    if (!this._subscriptionsBound) {
      try {
        // Removed ui:inspector:toggle-request - AppManager handles this and calls toggleVisibility() directly
        // Keeping show/hide requests for potential future use
        this.subscribe('ui:inspector:show-request', () => this.show());
        this.subscribe('ui:inspector:hide-request', () => this.hide());
      } catch (error) {
        rendererLogger.error('InspectorPanel: event bus subscription failed', error);
      }
      this._subscriptionsBound = true;
    }

    this._registerRuntimeSubscriptions();
  }

  renderContent() {
    this._unbindDomEvents();

    this.element.innerHTML = `
      <div class="inspector-panel__resize-handle" title="Drag to resize"></div>
      <div class="inspector-panel__container" style="display:none">
        <div class="inspector-panel__header">
          <strong>SCORM Inspector</strong>
          <div class="inspector-panel__header-actions">
            <button class="js-refresh-tab" title="Refresh current tab">⟳ Refresh</button>
            <button class="inspector-panel__close" title="Close">✕</button>
          </div>
        </div>
        <div class="inspector-panel__tabs">
          <button data-tab="api">Timeline</button>
          <button data-tab="tree">Activity Tree</button>
          <button data-tab="objectives">Objectives</button>
          <button data-tab="ssp">SSP Buckets</button>
          <button data-tab="model">Data Model</button>
          <button data-tab="sn">Sequencing State</button>
        </div>
        <div class="inspector-panel__body">
          <div class="inspector-panel__summary">
            <span class="summary__item">Timeline: <b class="js-api-count">0</b></span>
            <span class="summary__item">Data changes: <b class="js-dm-count">0</b></span>
            <span class="summary__item">Errors: <b class="js-error-count">0</b></span>
            <span class="summary__item">Objectives: <b class="js-objective-count">0</b></span>
            <span class="summary__item">Nav records: <b class="js-nav-count">0</b></span>
          </div>
          <div class="inspector-tab" id="inspector-tab-api"></div>
          <div class="inspector-tab" id="inspector-tab-tree" style="display:none"></div>
          <div class="inspector-tab" id="inspector-tab-objectives" style="display:none"></div>
          <div class="inspector-tab" id="inspector-tab-ssp" style="display:none"></div>
          <div class="inspector-tab" id="inspector-tab-model" style="display:none"></div>
          <div class="inspector-tab" id="inspector-tab-sn" style="display:none"></div>
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
      model: this.element.querySelector('#inspector-tab-model'),
      sn: this.element.querySelector('#inspector-tab-sn'),
    };
    const closeBtn = this.element.querySelector('.inspector-panel__close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
    const refreshBtn = this.element.querySelector('.js-refresh-tab');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshActiveTab());

    // Setup resize handle with improved UX
    this._summary = {
      api: this.element.querySelector('.js-api-count'),
      dm: this.element.querySelector('.js-dm-count'),
      err: this.element.querySelector('.js-error-count'),
      obj: this.element.querySelector('.js-objective-count'),
      nav: this.element.querySelector('.js-nav-count')
    };

    this._setupResizeHandle();
    this.setActiveTab(this.activeTab);
    this._domEventsBound = false;
    this._bindDomEvents();
  }

  _setupResizeHandle() {
    const resizeHandle = this.element?.querySelector('.inspector-panel__resize-handle');
    if (!resizeHandle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const handleMouseDown = (event) => {
      isResizing = true;
      startX = event.clientX;
      startWidth = this.element?.offsetWidth || 0;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    };

    const handleMouseMove = (event) => {
      if (!isResizing || !this.element) return;

      const deltaX = event.clientX - startX;
      const newWidth = Math.max(300, Math.min(window.innerWidth * 0.5, startWidth - deltaX));
      this.element.style.width = `${newWidth}px`;
    };

    const handleMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    resizeHandle.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    this._resizeCleanup = () => {
      resizeHandle.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }

  setActiveTab(tab) {
    const allowed = ['api','tree','objectives','ssp','model','sn'];
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
    } catch (_) { /* intentionally empty */ }
    this.renderActiveTab();
  }

  async refreshActiveTab() {
    try {
      switch (this.activeTab) {
        case 'api': {
          await this._refreshTimelineData();
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
        case 'model': {
          const dm = await snBridge.getScormDataModel();
          if (dm?.success) this.state.dataModel = dm.data || {};
          break;
        }
        case 'sn': {
          const sn = await snBridge.getSnState();
          if (sn?.success) this.state.sn = sn;
          break;
        }
      }
      this.updateSummaryCounts();
      this.renderActiveTab();
    } catch (error) {
      this.uiState?.showNotification({
        type: 'error',
        message: 'Refresh failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  renderActiveTab() {
    switch (this.activeTab) {
      case 'api':
        return this.renderApiLog();
      case 'tree': return this.renderActivityTree();
      case 'objectives': return this.renderObjectives();
      case 'ssp': return this.renderSSP();
      case 'model': return this.renderDataModel();
      case 'sn': return this.renderSnState();
      default: return this.renderApiLog();
    }
  }

  _getMethods() {
    const hist = Array.isArray(this.state.history) ? this.state.history : [];
    const methods = new Set();
    hist.forEach((entry) => {
      const method = entry?.method || entry?.name;
      if (method) methods.add(String(method));
    });
    return Array.from(methods).sort();
  }

  _applyTimelineFilters(items) {
    const filters = this._timelineFilters;
    return items.filter((entry) => {
      if (filters.errorsOnly && entry.kind === 'api-call' && !entry.hasError) {
        return false;
      }
      if (!filters.showApi && entry.kind === 'api-call') return false;
      if (!filters.showDataModel && entry.kind === 'data-model-change') return false;
      if (filters.method !== 'all' && entry.kind === 'api-call') {
        return entry.method === filters.method;
      }
      return true;
    });
  }

  _paginate(items) {
    const size = Math.max(10, Math.min(500, Number(this._timelinePager.pageSize) || 100));
    const requestedPage = Math.max(1, Number(this._timelinePager.page) || 1);
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(requestedPage, pages);
    const start = (page - 1) * size;
    const end = start + size;
    return { slice: items.slice(start, end), page, pages, total, pageSize: size };
  }

  _replaceHistory(list, meta = {}) {
    if (Array.isArray(list)) {
      const trimmed = list.length > this._maxHistory ? list.slice(-this._maxHistory) : list.slice();
      this.state.history = trimmed;
      this.stateMeta.history = {
        total: typeof meta.total === 'number' ? meta.total : trimmed.length,
        hasMore: Boolean(meta.hasMore)
      };
    } else {
      this.state.history = [];
      this.stateMeta.history = { total: 0, hasMore: false };
    }
  }

  _replaceDataModelHistory(list, meta = {}) {
    if (Array.isArray(list)) {
      const trimmed = list.length > this._maxDataModelHistory ? list.slice(-this._maxDataModelHistory) : list.slice();
      this.state.dataModelChanges = trimmed;
      this.stateMeta.dataModelChanges = {
        total: typeof meta.total === 'number' ? meta.total : trimmed.length,
        hasMore: Boolean(meta.hasMore)
      };
    } else {
      this.state.dataModelChanges = [];
      this.stateMeta.dataModelChanges = { total: 0, hasMore: false };
    }
  }

  _replaceErrors(list) {
    if (Array.isArray(list)) {
      this.state.errors = list.slice(0, this._maxErrors);
    } else {
      this.state.errors = [];
    }
  }

  _appendHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const list = Array.isArray(this.state.history) ? this.state.history.slice() : [];
    const key = this._getHistoryKey(entry);
    if (key && list.some((item) => this._getHistoryKey(item) === key)) return false;
    list.push(entry);
    if (list.length > this._maxHistory) list.splice(0, list.length - this._maxHistory);
    this.state.history = list;
    this.stateMeta.history.total = Math.max(list.length, this.stateMeta.history.total || 0);
    return true;
  }

  _appendErrorEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const list = Array.isArray(this.state.errors) ? this.state.errors.slice() : [];
    const key = this._getHistoryKey(entry);
    if (key && list.some((item) => this._getHistoryKey(item) === key)) return false;
    list.unshift(entry);
    if (list.length > this._maxErrors) list.length = this._maxErrors;
    this.state.errors = list;
    return true;
  }

  _appendDataModelChange(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const list = Array.isArray(this.state.dataModelChanges) ? this.state.dataModelChanges.slice() : [];
    const key = this._getDataModelChangeKey(entry);
    if (key && list.some((item) => this._getDataModelChangeKey(item) === key)) return false;
    list.push(entry);
    if (list.length > this._maxDataModelHistory) list.splice(0, list.length - this._maxDataModelHistory);
    this.state.dataModelChanges = list;
    this.stateMeta.dataModelChanges.total = Math.max(list.length, this.stateMeta.dataModelChanges.total || 0);
    return true;
  }

  _handleInspectorPayload(payload) {
    let changed = false;
    if (!payload) return changed;

    if (Array.isArray(payload.history)) {
      this._replaceHistory(payload.history, {
        total: payload.historyTotal,
        hasMore: payload.historyHasMore
      });
      changed = true;
    } else if (payload && typeof payload === 'object' && (payload.method || payload.name)) {
      changed = this._appendHistoryEntry(payload) || changed;
    }

    if (Array.isArray(payload.dataModelChanges)) {
      this._replaceDataModelHistory(payload.dataModelChanges, {
        total: payload.dataModelTotal,
        hasMore: payload.dataModelHasMore
      });
      changed = true;
    }

    if (Array.isArray(payload.errors)) {
      this._replaceErrors(payload.errors);
      changed = true;
    }

    if (payload && typeof payload.dataModel === 'object' && payload.dataModel) {
      this.state.dataModel = payload.dataModel;
      changed = true;
    }

    if (Array.isArray(payload.navigation)) {
      this.state.navigation = payload.navigation;
      changed = true;
    }

    return changed;
  }

  _getHistoryKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (entry.id) return String(entry.id);
    if (entry.timestamp && entry.method) return `${entry.timestamp}:${entry.method}`;
    if (entry.timestamp && entry.name) return `${entry.timestamp}:${entry.name}`;
    if (entry.timestamp && entry.element) return `${entry.timestamp}:${entry.element}`;
    return JSON.stringify(entry).slice(0, 120);
  }

  _getDataModelChangeKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (entry.id) return String(entry.id);
    const ts = entry.timestampMs || entry.timestamp || 0;
    const element = entry.element || entry.path || 'unknown';
    return `${ts}:${element}`;
  }

  _normalizeTimestamp(entry) {
    let raw = entry?.timestampMs;
    if (raw == null) {
      const ts = entry?.timestamp;
      if (typeof ts === 'number') raw = ts;
      else if (typeof ts === 'string') raw = Date.parse(ts);
    }
    const ms = Number.isFinite(raw) ? Number(raw) : Date.now();
    return { ms, iso: new Date(ms).toISOString() };
  }

  _decorateTimelineEntry(entry, kind) {
    const { ms, iso } = this._normalizeTimestamp(entry);
    if (kind === 'api-call') {
      return {
        kind,
        timestampMs: ms,
        timestampIso: iso,
        data: entry,
        method: entry?.method ? String(entry.method) : (entry?.name ? String(entry.name) : undefined),
        hasError: Boolean(entry?.errorCode && entry.errorCode !== '0'),
        sessionId: entry?.sessionId ? String(entry.sessionId) : undefined
      };
    }
    return {
      kind,
      timestampMs: ms,
      timestampIso: iso,
      data: entry,
      element: entry?.element ? String(entry.element) : undefined,
      source: entry?.source ? String(entry.source) : undefined,
      sessionId: entry?.sessionId ? String(entry.sessionId) : undefined
    };
  }

  _buildTimeline() {
    const timeline = [];
    if (Array.isArray(this.state.history)) {
      this.state.history.forEach((entry) => {
        timeline.push(this._decorateTimelineEntry(entry, 'api-call'));
      });
    }
    if (Array.isArray(this.state.dataModelChanges)) {
      this.state.dataModelChanges.forEach((entry) => {
        timeline.push(this._decorateTimelineEntry(entry, 'data-model-change'));
      });
    }
    timeline.sort((a, b) => b.timestampMs - a.timestampMs);
    return timeline;
  }

  async _refreshTimelineData() {
    const historyPromise = snBridge.getScormInspectorHistory();
    const dataModelHistoryPromise = snBridge.getScormDataModelHistory({ limit: this._maxDataModelHistory });

    const [historyResult, dataModelHistoryResult] = await Promise.all([historyPromise, dataModelHistoryPromise]);

    if (historyResult?.success && historyResult.data) {
      this._replaceHistory(historyResult.data.history, {
        total: historyResult.data?.totals?.history,
        hasMore: historyResult.data?.hasMore?.history
      });
      this._replaceErrors(historyResult.data.errors);
      if (historyResult.data.dataModel) {
        this.state.dataModel = historyResult.data.dataModel;
      }
      if (Array.isArray(historyResult.data.dataModelChanges)) {
        this._replaceDataModelHistory(historyResult.data.dataModelChanges, {
          total: historyResult.data?.totals?.dataModel,
          hasMore: historyResult.data?.hasMore?.dataModel
        });
      }
      if (Array.isArray(historyResult.data.navigation)) {
        this.state.navigation = historyResult.data.navigation;
      }
    }

    if (dataModelHistoryResult?.success && Array.isArray(dataModelHistoryResult.data)) {
      this._replaceDataModelHistory(dataModelHistoryResult.data, {
        total: typeof dataModelHistoryResult.total === 'number' ? dataModelHistoryResult.total : undefined,
        hasMore: dataModelHistoryResult.hasMore
      });
    }
  }

  _renderTimelineEntry(entry) {
    if (entry.kind === 'api-call') {
      const call = entry.data || {};
      const method = this._esc(entry.method || 'unknown');
      const timestamp = entry.timestampIso ? new Date(entry.timestampIso).toLocaleTimeString() : '';
      const params = call.parameters ?? call.args;
      const result = call.result;
      const errorCode = call.errorCode;
      const errorMessage = call.errorMessage;
      const duration = call.durationMs != null ? `${call.durationMs}ms` : '';
      const sessionId = call.sessionId != null ? String(call.sessionId) : '';
      const recordData = JSON.stringify(call, null, 2);

      let methodClass = 'method-default';
      if (method.includes('Initialize')) methodClass = 'method-init';
      else if (method.includes('Terminate')) methodClass = 'method-terminate';
      else if (method.includes('GetValue')) methodClass = 'method-get';
      else if (method.includes('SetValue')) methodClass = 'method-set';
      else if (method.includes('Commit')) methodClass = 'method-commit';
      else if (method.includes('GetLastError')) methodClass = 'method-error';

      return `<li class="api-call${entry.hasError ? ' api-call-error' : ''}" data-record='${this._esc(recordData)}'>
        <div class="api-call__header">
          <code class="api-call__method ${methodClass}">${method}</code>
          ${timestamp ? `<span class="api-call__timestamp">${this._esc(timestamp)}</span>` : ''}
          ${duration ? `<span class="api-call__duration">${this._esc(duration)}</span>` : ''}
          <button class="api-call__copy js-copy-record" title="Copy record">📋</button>
        </div>
        <div class="api-call__details">
          ${params != null ? `<div><strong>Params:</strong> <code>${this._esc(JSON.stringify(params))}</code></div>` : ''}
          ${result != null ? `<div><strong>Result:</strong> <code>${this._esc(JSON.stringify(result))}</code></div>` : ''}
          ${entry.hasError ? `<div class="api-call__error"><strong>Error ${this._esc(String(errorCode))}:</strong> ${this._esc(errorMessage || 'Unknown error')}</div>` : ''}
          ${sessionId ? `<div><strong>Session:</strong> ${this._esc(sessionId)}</div>` : ''}
        </div>
      </li>`;
    }

    const change = entry.data || {};
    const timestamp = entry.timestampIso ? new Date(entry.timestampIso).toLocaleTimeString() : '';
    const previousValue = change.previousValue === undefined ? '<em>unset</em>' : this._esc(JSON.stringify(change.previousValue));
    const newValue = change.newValue === undefined ? '<em>unset</em>' : this._esc(JSON.stringify(change.newValue));
    const element = change.element ? this._esc(String(change.element)) : '<em>unknown</em>';
    const source = change.source ? this._esc(String(change.source)) : 'unspecified';
    const payload = JSON.stringify(change, null, 2);

    return `<li class="data-model-change" data-record='${this._esc(payload)}'>
      <div class="data-model-change__header">
        <code class="data-model-change__element">${element}</code>
        ${timestamp ? `<span class="data-model-change__timestamp">${this._esc(timestamp)}</span>` : ''}
        <span class="data-model-change__source">${this._esc(source)}</span>
        <button class="data-model-change__copy js-copy-record" title="Copy record">📋</button>
      </div>
      <div class="data-model-change__details">
        <div><strong>Previous:</strong> <code>${previousValue}</code></div>
        <div><strong>New:</strong> <code>${newValue}</code></div>
      </div>
    </li>`;
  }

  renderApiLog() {
    const el = this.tabEls?.api;
    if (!el) return;

    const timeline = this._buildTimeline();
    const filtered = this._applyTimelineFilters(timeline);
    const { slice, page, pages, total } = this._paginate(filtered);

    const methodOptions = ['<option value="all">All methods</option>'];
    this._getMethods().forEach((method) => {
      methodOptions.push(`<option value="${this._esc(method)}" ${this._timelineFilters.method === method ? 'selected' : ''}>${this._esc(method)}</option>`);
    });

    const controls = `
      <div class="api-controls">
        <label>Method <select class="js-api-filter">${methodOptions.join('')}</select></label>
        <label><input type="checkbox" class="js-api-errors" ${this._timelineFilters.errorsOnly ? 'checked' : ''}/> Errors only</label>
        <label><input type="checkbox" class="js-timeline-api" ${this._timelineFilters.showApi ? 'checked' : ''}/> API</label>
        <label><input type="checkbox" class="js-timeline-dm" ${this._timelineFilters.showDataModel ? 'checked' : ''}/> Data model</label>
        <button class="js-clear-timeline" title="Clear timeline">Clear</button>
        <span class="api-paging">Page ${page}/${pages} • ${total} items</span>
        <div class="api-paging__buttons">
          <button class="js-page-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button>
          <button class="js-page-next" ${page >= pages ? 'disabled' : ''}>Next</button>
        </div>
      </div>`;

    const list = slice.length
      ? slice.map((entry) => this._renderTimelineEntry(entry)).join('')
      : '<li class="api-call api-call--empty"><em>No timeline entries yet.</em></li>';

    const errorsBlock = this.state.errors?.length && this._timelineFilters.errorsOnly
      ? `<div class="tab-section"><h4>Errors (${this.state.errors.length})</h4><ul class="api-errors">${this.state.errors.slice(0, 100).map((err) => `<li>${this._esc(err?.message || String(err))}</li>`).join('')}</ul></div>`
      : '';

    el.innerHTML = `
      <div class="tab-section">
        <div class="tab-section__header">
          <h4>API &amp; Data Model Timeline</h4>
          ${controls}
        </div>
        <div class="tab-section__content">
          <ul class="api-log api-log--enhanced">${list}</ul>
        </div>
      </div>
      ${errorsBlock}`;
  }

  renderActivityTree() {
    const el = this.tabEls?.tree; if (!el) return;
    const tree = this.state.activityTree || {};
    const renderNode = (n) => {
      if (!n || typeof n !== 'object') return '';
      const title = this._esc(n.title || n.identifier || n.id || 'node');
      const status = n.status ? ` <small>(${this._esc(String(n.status))})</small>` : '';

      // Show sequencing control modes if available
      let controlModes = '';
      if (n.details?.sequencingDefinition) {
        const seq = n.details.sequencingDefinition;
        const modes = [];
        if (seq.choice !== undefined) modes.push(`choice: ${seq.choice}`);
        if (seq.flow !== undefined) modes.push(`flow: ${seq.flow}`);
        if (seq.forwardOnly !== undefined) modes.push(`forwardOnly: ${seq.forwardOnly}`);
        if (modes.length > 0) {
          controlModes = ` <small style="color: #666;">[${modes.join(', ')}]</small>`;
        }
      }

      const children = Array.isArray(n.children) ? n.children.map(renderNode).join('') : '';
      return `<li>${title}${status}${controlModes}${children ? `<ul>${children}</ul>` : ''}</li>`;
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

  renderDataModel() {
    const el = this.tabEls?.model; if (!el) return;
    const dm = this.state.dataModel || {};

    const { html, controlsHtml, setup } = createJsonViewer(dm, {
      showControls: true,
      showCopy: true,
      title: 'Data Model',
      expanded: false,
      maxDepth: 2
    });

    el.innerHTML = `
      <div class="tab-section">
        <div class="tab-section__header">
          <h4>Data Model</h4>
          ${controlsHtml}
        </div>
        <div class="tab-section__content">
          ${html}
        </div>
      </div>`;

    // Setup event handlers for the JSON viewer
    setup(el);
  }

  renderSnState() {
    const el = this.tabEls?.sn; if (!el) return;
    const sn = this.state.sn || {};

    const { html, controlsHtml, setup } = createJsonViewer(sn, {
      showControls: true,
      showCopy: true,
      title: 'Sequencing State',
      expanded: false,
      maxDepth: 2
    });

    el.innerHTML = `
      <div class="tab-section">
        <div class="tab-section__header">
          <h4>SN State</h4>
          ${controlsHtml}
        </div>
        <div class="tab-section__content">
          ${html}
        </div>
      </div>`;

    // Setup event handlers for the JSON viewer
    setup(el);
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

  _esc(value) {
    try {
      return String(value).replace(/[&<>"']+/g, (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[match] || match));
    } catch (error) {
      try { rendererLogger.warn('InspectorPanel: failed to escape value', error); } catch (_) { /* noop */ }
      return '';
    }
  }

  show() {
    this.visible = true;
    const container = /** @type {HTMLElement | null} */ (this.container);
    if (container) {
      container.style.display = 'block';
      try { rendererLogger.debug('InspectorPanel: Container display set to block'); } catch (_) { /* noop */ }
    } else {
      try { rendererLogger.warn('InspectorPanel: Container element not found in show()'); } catch (_) { /* noop */ }
    }
    const root = /** @type {HTMLElement | null} */ (this.element);
    if (root) root.classList.add('inspector-panel--visible');
  if (!this.loaded) this.loadInitialData();
    try { this.uiState?.setState('ui.inspectorVisible', true, true); } catch (_) { /* intentionally empty */ }
    // Removed inspector:state:updated to prevent event cycle with inspectorpanel:visibilityChanged
    this.emit('visibilityChanged', { visible: true });
    try { rendererLogger.info('InspectorPanel: Shown'); } catch (_) { /* noop */ }
  }

  hide() {
    this.visible = false;
    const container = /** @type {HTMLElement | null} */ (this.container);
    if (container) container.style.display = 'none';
    const root = /** @type {HTMLElement | null} */ (this.element);
    if (root) {
      root.classList.remove('inspector-panel--visible');
      // Clear inline width style to allow CSS transition to collapse the panel
      root.style.width = '';
    }
    try { this.uiState?.setState('ui.inspectorVisible', false, true); } catch (_) { /* intentionally empty */ }
    // Removed inspector:state:updated to prevent event cycle with inspectorpanel:visibilityChanged
    this.emit('visibilityChanged', { visible: false });
  }

  toggleVisibility() {
    try { rendererLogger.info('InspectorPanel: toggleVisibility called', { currentlyVisible: this.visible }); } catch (_) { /* noop */ }
    if (this.visible) this.hide();
    else this.show();
  }

  async loadInitialData() {
    try {
      const [hist, tree, nav, obj, ssp, sn, dmHistory] = await Promise.all([
        snBridge.getScormInspectorHistory(),
        snBridge.getActivityTree(),
        snBridge.getNavigationRequests(),
        snBridge.getGlobalObjectives(),
        snBridge.getSSPBuckets(),
        snBridge.getSnState(),
        snBridge.getScormDataModelHistory({ limit: this._maxDataModelHistory })
      ]);

      if (hist?.success && hist.data) {
        this._replaceHistory(hist.data.history);
        this._replaceErrors(hist.data.errors);
        this.state.dataModel = hist.data.dataModel || {};
        if (Array.isArray(hist.data.dataModelChanges)) {
          this._replaceDataModelHistory(hist.data.dataModelChanges, {
            total: hist.data?.totals?.dataModel,
            hasMore: hist.data?.hasMore?.dataModel
          });
        }
      }
      if (tree?.success) this.state.activityTree = tree.data || {};
      if (nav?.success) this.state.navigation = nav.data || [];
      if (obj?.success) this.state.objectives = obj.data || [];
      if (ssp?.success) this.state.ssp = ssp.data || [];
      if (sn?.success) this.state.sn = sn;
      if (dmHistory?.success && Array.isArray(dmHistory.data)) {
        this._replaceDataModelHistory(dmHistory.data, {
          total: typeof dmHistory.total === 'number' ? dmHistory.total : undefined,
          hasMore: dmHistory.hasMore
        });
      }

      this.updateSummaryCounts();
      this.loaded = true;
      this.emit('dataLoaded', { ok: true });
    } catch (error) {
      const err = /** @type {any} */ (error);
      this.uiState?.showNotification({ type: 'error', message: 'Inspector load failed', details: err?.message || String(err) });
      this.emit('dataLoaded', { ok: false, error: err });
    }
  }

  updateSummaryCounts() {
    try {
      if (this._summary?.api) this._summary.api.textContent = String(this.state.history.length || 0);
      if (this._summary?.dm) this._summary.dm.textContent = String(this.state.dataModelChanges.length || 0);
      if (this._summary?.err) this._summary.err.textContent = String(this.state.errors.length || 0);
      if (this._summary?.obj) this._summary.obj.textContent = String(this.state.objectives.length || 0);
      if (this._summary?.nav) this._summary.nav.textContent = String(this.state.navigation.length || 0);
    } catch (_) { /* intentionally empty */ }
  }

  _registerRuntimeSubscriptions() {
    if (this._runtimeSubscriptionsBound) return;

    try {
      const offCourseLoaded = snBridge.onCourseLoaded(async () => {
        try {
          await snBridge.clearScormInspector();
        } catch (err) {
          rendererLogger.error('InspectorPanel: clearScormInspector failed on course load', err);
        }
        this._replaceHistory([]);
        this._replaceDataModelHistory([]);
        this._replaceErrors([]);
        this.state.dataModel = {};
        this.updateSummaryCounts();
        setTimeout(() => { void this.loadInitialData(); }, 500);
      });
      this._unsubs.push(offCourseLoaded);
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to subscribe to course loaded', error);
    }

    try {
      const offInspectorData = snBridge.onScormInspectorDataUpdated((payload) => {
        const changed = this._handleInspectorPayload(payload);
        if (!changed) return;
        this.updateSummaryCounts();
        if (!this.visible) return;
        if (this.activeTab === 'api') {
          this.renderApiLog();
        } else if (this.activeTab === 'model' && payload && typeof payload.dataModel === 'object') {
          this.renderDataModel();
        }
      });
      this._unsubs.push(offInspectorData);
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to subscribe to inspector data updates', error);
    }

    try {
      const offErrors = snBridge.onScormInspectorErrorUpdated((entry) => {
        if (!this._appendErrorEntry(entry)) return;
        this.updateSummaryCounts();
        if (this.visible && this.activeTab === 'api' && this._timelineFilters.errorsOnly) {
          this.renderApiLog();
        }
      });
      this._unsubs.push(offErrors);
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to subscribe to inspector error updates', error);
    }

    try {
      const offDataModel = snBridge.onScormDataModelUpdated((dataModel) => {
        this.state.dataModel = dataModel || {};
        if (this.visible && this.activeTab === 'model') this.renderDataModel();
        if (this.visible && this.activeTab === 'api') this.renderApiLog();
      });
      this._unsubs.push(offDataModel);
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to subscribe to data model updates', error);
    }

    try {
      const offDataModelChange = snBridge.onScormDataModelChange((entry) => {
        if (!this._appendDataModelChange(entry)) return;
        this.updateSummaryCounts();
        if (this.visible && this.activeTab === 'api') this.renderApiLog();
      });
      this._unsubs.push(offDataModelChange);
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to subscribe to data model change updates', error);
    }

    try {
      const offCleared = snBridge.onScormDataModelHistoryCleared(() => {
        this._replaceDataModelHistory([]);
        this.updateSummaryCounts();
        if (this.visible && this.activeTab === 'api') this.renderApiLog();
      });
      this._unsubs.push(offCleared);
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to subscribe to data model history cleared updates', error);
    }

    this._runtimeSubscriptionsBound = true;
  }

  _bindDomEvents() {
    if (this._domEventsBound) return;

    if (this.tabsEl) {
      this._tabsClickHandler = (event) => {
        const target = event.target;
        const btn = typeof target?.closest === 'function' ? target.closest('button[data-tab]') : null;
        if (btn && btn.dataset?.tab) this.setActiveTab(btn.dataset.tab);
      };
      this.tabsEl.addEventListener('click', this._tabsClickHandler);
    }

    const apiTab = this.tabEls?.api;
    if (apiTab) {
      this._apiChangeHandler = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
        if (target.classList.contains('js-api-filter')) {
          this._timelineFilters.method = target.value || 'all';
          this._timelinePager.page = 1;
          this.renderApiLog();
        } else if (target.classList.contains('js-api-errors')) {
          this._timelineFilters.errorsOnly = Boolean(target.checked);
          this._timelinePager.page = 1;
          this.renderApiLog();
        } else if (target.classList.contains('js-timeline-api')) {
          this._timelineFilters.showApi = Boolean(target.checked);
          this._timelinePager.page = 1;
          this.renderApiLog();
        } else if (target.classList.contains('js-timeline-dm')) {
          this._timelineFilters.showDataModel = Boolean(target.checked);
          this._timelinePager.page = 1;
          this.renderApiLog();
        }
      };
      apiTab.addEventListener('change', this._apiChangeHandler);

      this._apiClickHandler = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains('js-page-prev')) {
          this._timelinePager.page = Math.max(1, (this._timelinePager.page || 1) - 1);
          this.renderApiLog();
        } else if (target.classList.contains('js-page-next')) {
          this._timelinePager.page = (this._timelinePager.page || 1) + 1;
          this.renderApiLog();
        } else if (target.classList.contains('js-clear-timeline')) {
          void this._clearTimeline();
        } else if (target.classList.contains('js-copy-record')) {
          const record = target.closest('li')?.getAttribute('data-record');
          if (record) this._copyRecord(target, record);
        }
      };
      apiTab.addEventListener('click', this._apiClickHandler);
    }

    this._domEventsBound = true;
  }

  _unbindDomEvents() {
    if (!this._domEventsBound) {
      this._tabsClickHandler = null;
      this._apiChangeHandler = null;
      this._apiClickHandler = null;
      return;
    }

    if (this.tabsEl && this._tabsClickHandler) {
      this.tabsEl.removeEventListener('click', this._tabsClickHandler);
    }

    const apiTab = this.tabEls?.api;
    if (apiTab) {
      if (this._apiChangeHandler) {
        apiTab.removeEventListener('change', this._apiChangeHandler);
      }
      if (this._apiClickHandler) {
        apiTab.removeEventListener('click', this._apiClickHandler);
      }
    }

    this._tabsClickHandler = null;
    this._apiChangeHandler = null;
    this._apiClickHandler = null;
    this._domEventsBound = false;
  }

  destroy() {
    this._unbindDomEvents();
    try { this._unsubs?.forEach((off) => { try { off(); } catch (_) { /* intentionally empty */ } }); } catch (_) { /* intentionally empty */ }
    this._unsubs = [];
    this._runtimeSubscriptionsBound = false;
    this._subscriptionsBound = false;
    try { this._resizeCleanup?.(); } catch (_) { /* intentionally empty */ }
    super.destroy();
  }

  async _clearTimeline() {
    try {
      const [apiResult, dmResult] = await Promise.all([
        snBridge.clearScormInspector(),
        snBridge.clearScormDataModelHistory()
      ]);
      if (apiResult?.success) {
        this._replaceHistory([]);
        this._replaceErrors([]);
      }
      if (dmResult?.success) {
        this._replaceDataModelHistory([]);
      }
      this.updateSummaryCounts();
      this.renderApiLog();
    } catch (error) {
      rendererLogger.error('InspectorPanel: failed to clear timeline', error);
      this.uiState?.showNotification({
        type: 'error',
        message: 'Failed to clear inspector timeline',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  _copyRecord(button, payload) {
    try {
      navigator.clipboard.writeText(payload).then(() => {
        button.textContent = '✓';
        setTimeout(() => { button.textContent = '📋'; }, 1000);
      }).catch((error) => {
        rendererLogger.error('InspectorPanel: copy failed', error);
      });
    } catch (error) {
      rendererLogger.error('InspectorPanel: copy failed', error);
    }
  }

  getStatus() {
    return {
      visible: this.visible,
      loaded: this.loaded,
      counts: {
        api: this.state.history.length,
        dataModelChanges: this.state.dataModelChanges.length,
        errors: this.state.errors.length,
        objectives: this.state.objectives.length,
        navigation: this.state.navigation.length
      }
    };
  }
}

export { InspectorPanel };

