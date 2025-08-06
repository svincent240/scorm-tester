/**
 * Debug Panel Component
 * 
 * Provides real-time SCORM API monitoring, data model inspection,
 * and debugging tools for SCORM content development and testing.
 * 
 * @fileoverview SCORM debug panel component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { scormClient } from '../../services/scorm-client.js';
import { eventBus } from '../../services/event-bus.js';
import { debugDataAggregator } from '../../services/debug-data-aggregator.js';

/**
 * Debug Panel Class
 */
class DebugPanel extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    this.activeTab = 'api-calls';
    this.apiCalls = [];
    this.maxApiCalls = 1000;
    this.uiState = null; // Will be set in setup

    // Diagnostics selectors cache
    this._diag = {
      level: 'all',
      search: ''
    };

    // Bind methods to preserve instance context for event listeners
    this.clearLog = this.clearLog.bind(this);
    this.exportLog = this.exportLog.bind(this);
    this.closePanel = this.closePanel.bind(this);
    this.switchTab = this.switchTab.bind(this);
  }

  async setup() {
    this.uiState = await uiStatePromise;
    this.loadApiCallHistory();

    // Initialize diagnostics cursors
    this._apiRafScheduled = false;
    this._diag = this._diag || { level: 'all', search: '' };
    this._diagCursorTs = Date.now();

    // Subscribe to aggregator updates to refresh current views when visible (batched)
    this._dbgUnsub = eventBus.on('debug:update', () => {
      if (this.activeTab === 'api-calls') {
        if (!this._apiRafScheduled) {
          this._apiRafScheduled = true;
          requestAnimationFrame(() => {
            try { this.refreshApiCallsView?.(); } finally { this._apiRafScheduled = false; }
          });
        }
      }
      if (this.activeTab === 'diagnostics') this.refreshDiagnostics?.();
      if (this.activeTab === 'errors') this.refreshErrorsView?.();
    });
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'debug-panel',
      showTimestamps: true,
      enableExport: true,
      attributes: { 'data-component': 'debug-panel' }
    };
  }


  renderContent() {
    // Create the debug panel HTML structure if elements don't exist
    if (!this.element.querySelector('.debug-tabs')) {
      this.element.innerHTML = `
        <div class="debug-panel__container">
          <div class="debug-panel__header">
            <h3>SCORM Debug Panel</h3>
            <div class="debug-panel__controls">
              <button id="debug-clear" class="debug-btn debug-btn--secondary">Clear</button>
              <button id="debug-export" class="debug-btn debug-btn--secondary">Export</button>
              <button id="debug-close" class="debug-btn debug-btn--close">×</button>
            </div>
          </div>
          
          <div class="debug-tabs">
            <button class="debug-tab debug-tab--active" data-tab="api-calls">API Timeline</button>
            <button class="debug-tab" data-tab="attempt">Attempt</button>
            <button class="debug-tab" data-tab="data-model">Data</button>
            <button class="debug-tab" data-tab="sequencing">Sequencing</button>
            <button class="debug-tab" data-tab="diagnostics">Diagnostics</button>
            <button class="debug-tab" data-tab="errors">Errors</button>
            <button class="debug-tab" data-tab="manifest">Manifest</button>
          </div>
          
          <div class="debug-content-area">
            <!-- API Timeline -->
            <div id="debug-api-calls" class="debug-content debug-content--active">
              <div id="api-calls-log" class="debug-log">
                <div class="debug-log__empty">No API calls recorded</div>
              </div>
            </div>

            <!-- Attempt Lifecycle Controls -->
            <div id="debug-attempt" class="debug-content">
              <div id="attempt-controls" class="debug-controls">
                <button class="debug-btn" data-intent="attempt:start" title="Start Attempt">Start</button>
                <button class="debug-btn" data-intent="attempt:suspend" title="Suspend Attempt" disabled>Suspend</button>
                <button class="debug-btn" data-intent="attempt:resume" title="Resume Attempt" disabled>Resume</button>
                <button class="debug-btn" data-intent="api:commit" title="Commit Data" disabled>Commit</button>
                <button class="debug-btn debug-btn--danger" data-intent="attempt:terminate" title="Terminate Attempt" disabled>Terminate</button>
                <div class="debug-hint" id="attempt-controls-hint"></div>
              </div>
            </div>
            
            <!-- Data Model Viewer -->
            <div id="debug-data-model" class="debug-content">
              <div id="data-model-view" class="debug-data">
                <div class="debug-data__empty">SCORM not initialized</div>
              </div>
              <div id="data-sandbox" class="debug-sandbox">
                <div class="sandbox-header">Sandbox (staged SetValue)</div>
                <div class="sandbox-body">
                  <input id="sandbox-element" placeholder="cmi.element" />
                  <input id="sandbox-value" placeholder="value" />
                  <button id="sandbox-stage" class="debug-btn">Stage</button>
                  <button id="sandbox-apply" class="debug-btn" disabled>Apply</button>
                  <button id="sandbox-clear" class="debug-btn debug-btn--secondary">Clear</button>
                  <div id="sandbox-staged-list" class="sandbox-list"></div>
                  <div id="sandbox-result" class="sandbox-result"></div>
                </div>
              </div>
            </div>

            <!-- Sequencing Visualizer (skeleton) -->
            <div id="debug-sequencing" class="debug-content">
              <div id="sn-activity-tree" class="debug-tree">
                <div class="debug-log__empty">Sequencing state not available</div>
              </div>
              <div id="sn-next-steps" class="debug-list">
                <div class="debug-log__empty">No advisory available</div>
              </div>
            </div>

            <!-- Diagnostics (EventBus Inspector + Logger View) -->
            <div id="debug-diagnostics" class="debug-content">
              <div class="diagnostics-section">
                <div class="diagnostics-header">EventBus Inspector</div>
                <div class="diagnostics-controls">
                  <input id="event-filter" placeholder="Filter by topic..." />
                  <button id="event-refresh" class="debug-btn">Refresh</button>
                </div>
                <div id="event-log" class="debug-log">
                  <div class="debug-log__empty">No events recorded</div>
                </div>
              </div>
              <div class="diagnostics-section">
                <div class="diagnostics-header">Unified Logger View</div>
                <div class="diagnostics-controls">
                  <select id="log-level-filter">
                    <option value="all">All</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                    <option value="debug">Debug</option>
                  </select>
                  <input id="log-search" placeholder="Search..." />
                </div>
                <div id="renderer-log" class="debug-log">
                  <div class="debug-log__empty">No logs</div>
                </div>
              </div>
            </div>

            <!-- Error Intelligence -->
            <div id="debug-errors" class="debug-content">
              <div id="errors-log" class="debug-log">
                <div class="debug-log__empty">No errors recorded</div>
              </div>
            </div>

            <!-- Manifest Diagnostics -->
            <div id="debug-manifest" class="debug-content">
              <div id="manifest-results" class="debug-data">
                <div class="debug-log__empty">Manifest diagnostics not run</div>
              </div>
              <div class="debug-controls">
                <button id="manifest-parse" class="debug-btn">Parse Manifest</button>
                <button id="manifest-validate" class="debug-btn">Validate Content</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }
    
    // Get references to elements
    this.clearBtn = this.element.querySelector('#debug-clear');
    this.exportBtn = this.element.querySelector('#debug-export');
    this.closeBtn = this.element.querySelector('#debug-close');
    this.apiLog = this.element.querySelector('#api-calls-log');
    this.dataModelView = this.element.querySelector('#data-model-view');
    this.sessionInfo = this.element.querySelector('#session-info');
    this.errorLog = this.element.querySelector('#errors-log');

    // Attempt controls
    this.attemptControls = this.element.querySelector('#attempt-controls');
    this.attemptHint = this.element.querySelector('#attempt-controls-hint');

    // Diagnostics
    this.eventLog = this.element.querySelector('#event-log');
    this.eventFilter = this.element.querySelector('#event-filter');
    this.eventRefresh = this.element.querySelector('#event-refresh');
    this.rendererLog = this.element.querySelector('#renderer-log');
    this.logLevelFilter = this.element.querySelector('#log-level-filter');
    this.logSearch = this.element.querySelector('#log-search');

    // Manifest
    this.manifestResults = this.element.querySelector('#manifest-results');
    this.manifestParseBtn = this.element.querySelector('#manifest-parse');
    this.manifestValidateBtn = this.element.querySelector('#manifest-validate');

    // Benchmarks (diagnostics tab UI will be appended lazily)
    this._benchSectionInjected = false;

    // Verify we have the elements we need
    if (!this.clearBtn || !this.exportBtn || !this.closeBtn) {
      // route to app log instead of console
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('DebugPanel: Some control buttons not found after creation');
      }).catch(() => {});
    }
    
    if (!this.apiLog || !this.dataModelView || !this.sessionInfo || !this.errorLog) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('DebugPanel: Some content areas not found after creation');
      }).catch(() => {});
    }
    
    // Bind events after DOM is created to ensure tabs and controls are interactive
    try {
      this.bindEvents();
    } catch (_) {
      // best-effort; BaseComponent may call this separately in its lifecycle
    }

    // Initialize the panel with empty state
    this.refreshActiveTab();

    // Subscribe to state changes that affect enablement
    if (this.uiState && typeof this.uiState.subscribe === 'function') {
      // Any UI update or progress/nav/session change can influence enablement
      this.uiState.subscribe(() => this.refreshAttemptControls?.(), 'ui.devModeEnabled');
      this.uiState.subscribe(() => this.refreshAttemptControls?.(), 'navigationState');
      this.uiState.subscribe(() => this.refreshAttemptControls?.(), 'progressData');
    }
  }

  setupEventSubscriptions() {
    // API timeline
    this.subscribe('api:call', this.handleApiCall);
    this.subscribe('scorm:error', this.handleScormError);
    this.subscribe('scorm:initialized', this.handleScormInitialized);
    this.subscribe('scorm:dataChanged', this.handleDataChanged);

    // Diagnostics placeholder: EventBus debug mode is controlled via UIState; panel will fetch snapshots on demand
    this.subscribe('ui:devModeChanged', () => {});
  }

  bindEvents() {
    super.bindEvents();
    
    if (this.clearBtn) this.clearBtn.addEventListener('click', this.clearLog);
    if (this.exportBtn) this.exportBtn.addEventListener('click', this.exportLog);
    if (this.closeBtn) this.closeBtn.addEventListener('click', this.closePanel);
    
    // Tab switching (use delegation-safe dataset read)
    this.findAll('.debug-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget || e.target;
        const tabName = target?.dataset?.tab;
        if (!tabName) return;
        // low-noise log to app log
        import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
          rendererLogger.info('DebugPanel: switchTab', { tab: tabName });
        }).catch(() => {});
        this.switchTab(tabName);
      });
    });

    // Attempt intents (guardrails applied via UIState selectors; emit intents to EventBus)
    if (this.attemptControls) {
      this.attemptControls.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-intent]');
        if (!btn) return;
        const intent = btn.dataset.intent;
        try {
          eventBus.emit(intent, { source: 'debug-panel' });
        } catch (_) {
          // Non-fatal: fall back to component emit for any legacy listeners
          this.emit(intent);
        }
      });
    }

    // Diagnostics controls (snapshots)
    if (this.eventRefresh) {
      this.eventRefresh.addEventListener('click', () => this.refreshDiagnostics?.());
    }
    if (this.logLevelFilter) {
      this.logLevelFilter.addEventListener('change', () => this.refreshDiagnostics?.());
    }
    if (this.logSearch) {
      this.logSearch.addEventListener('input', () => this.refreshDiagnostics?.());
    }

    // Auto-refresh diagnostics when EventBus is in debug mode and events flow
    this._diagUnsub = eventBus.on('state:changed', () => {
      if (this.activeTab === 'diagnostics') this.refreshDiagnostics?.();
    });
    this._diagUnsub2 = eventBus.on('api:call', () => {
      if (this.activeTab === 'diagnostics') this.refreshDiagnostics?.();
    });
    this._diagUnsub3 = eventBus.on('error', () => {
      if (this.activeTab === 'diagnostics') this.refreshDiagnostics?.();
    });

    // Manifest controls (wire to preload bridges and render structured summaries)
    if (this.manifestParseBtn) {
      this.manifestParseBtn.addEventListener('click', async () => {
        try {
          await this.runManifestParse();
        } catch (_e) {
          this.renderManifestMessage('Parse failed (see app log)');
          try {
            const { rendererLogger } = await import('../../utils/renderer-logger.js');
            rendererLogger.error('[CAM/Debug] manifest parse error', String(_e?.message || _e));
          } catch (_) {}
        }
      });
    }
    if (this.manifestValidateBtn) {
      this.manifestValidateBtn.addEventListener('click', async () => {
        try {
          await this.runManifestValidate();
        } catch (_e) {
          this.renderManifestMessage('Validation failed (see app log)');
          try {
            const { rendererLogger } = await import('../../utils/renderer-logger.js');
            rendererLogger.error('[CAM/Debug] content validate error', String(_e?.message || _e));
          } catch (_) {}
        }
      });
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    
    // Update tab buttons
    this.findAll('.debug-tab').forEach(tab => {
      tab.classList.toggle('debug-tab--active', tab.dataset.tab === tabName);
    });
    
    // Update content panels
    this.findAll('.debug-content').forEach(content => {
      content.classList.toggle('debug-content--active', content.id === `debug-${tabName}`);
    });
    
    this.refreshActiveTab();
  }

  // Diagnostics: API Latency Benchmarks UI (in-panel) and runner
  injectBenchmarksUiIfNeeded() {
    if (this._benchSectionInjected) return;
    const diagRoot = this.element.querySelector('#debug-diagnostics');
    if (!diagRoot) return;
    const section = document.createElement('div');
    section.className = 'diagnostics-section';
    section.innerHTML = `
      <div class="diagnostics-header">API Latency Benchmarks</div>
      <div class="diagnostics-controls">
        <button id="bench-run" class="debug-btn">Run Benchmarks</button>
        <span id="bench-status" class="debug-hint"></span>
      </div>
      <div id="bench-results" class="debug-log">
        <div class="debug-log__empty">No benchmark results</div>
      </div>
    `;
    diagRoot.appendChild(section);
    this._benchSectionInjected = true;

    const runBtn = section.querySelector('#bench-run');
    const status = section.querySelector('#bench-status');
    const results = section.querySelector('#bench-results');

    const renderSummary = (summary) => {
      const html = Object.entries(summary).map(([name, stats]) => {
        return `<div class="debug-info__item"><span class="debug-info__label">${name}</span><span class="debug-info__value">min ${stats.min}ms • avg ${stats.avg}ms • p95 ${stats.p95}ms</span></div>`;
      }).join('');
      results.innerHTML = html || '<div class="debug-log__empty">No benchmark results</div>';
    };

    const computeStats = (arr) => {
      if (!arr.length) return { min: 0, avg: 0, p95: 0 };
      const sorted = [...arr].sort((a,b)=>a-b);
      const min = Math.min(...sorted);
      const avg = Math.round(sorted.reduce((s,v)=>s+v,0)/sorted.length);
      const p95 = sorted[Math.floor(0.95*(sorted.length-1))];
      return { min, avg, p95 };
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const run = async () => {
      const { rendererLogger } = await import('../../utils/renderer-logger.js');
      const iterations = 20;
      const summary = { Initialize: [], GetValue: [], SetValue: [], Commit: [], Terminate: [] };
      status.textContent = 'Running...';
      try {
        // Initialize
        for (let i=0;i<iterations;i++) {
          const t0 = performance.now();
          try { scormClient.Initialize?.(''); } catch(e){}
          const t1 = performance.now();
          summary.Initialize.push(Math.round(t1 - t0));
          if (i % 5 === 4) await sleep(0);
        }
        // GetValue
        for (let i=0;i<iterations;i++) {
          const t0 = performance.now();
          try { scormClient.GetValue?.('cmi.location'); } catch(e){}
          const t1 = performance.now();
          summary.GetValue.push(Math.round(t1 - t0));
          if (i % 5 === 4) await sleep(0);
        }
        // SetValue
        for (let i=0;i<iterations;i++) {
          const t0 = performance.now();
          try { scormClient.SetValue?.('cmi.location', 'x'); } catch(e){}
          const t1 = performance.now();
          summary.SetValue.push(Math.round(t1 - t0));
          if (i % 5 === 4) await sleep(0);
        }
        // Commit
        for (let i=0;i<iterations;i++) {
          const t0 = performance.now();
          try { scormClient.Commit?.(''); } catch(e){}
          const t1 = performance.now();
          summary.Commit.push(Math.round(t1 - t0));
          if (i % 5 === 4) await sleep(0);
        }
        // Terminate
        for (let i=0;i<iterations;i++) {
          const t0 = performance.now();
          try { scormClient.Terminate?.(''); } catch(e){}
          const t1 = performance.now();
          summary.Terminate.push(Math.round(t1 - t0));
          if (i % 5 === 4) await sleep(0);
        }

        const stats = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, computeStats(v)]));
        renderSummary(stats);

        // Try writing artifacts via preload fs bridge if any (guarded)
        try {
          if (window.electronAPI?.logger?.info) {
            rendererLogger.info('[Perf] RTE API latency benchmarks complete', stats);
          }
          if (window.electronAPI?.writePerfArtifact) {
            await window.electronAPI.writePerfArtifact('rte-api-latency', { when: new Date().toISOString(), stats });
          }
        } catch (_) { /* no-op */ }

      } catch (e) {
        rendererLogger.error('[Perf] Benchmarks failed', String(e?.message || e));
      } finally {
        status.textContent = 'Done';
      }
    };

    runBtn.addEventListener('click', () => { void run(); });
  }

  addApiCall(apiCall) {
    // Avoid re-emitting into UIState to prevent api:call <-> state:changed feedback cycles.
    // The centralized history and aggregator already consume eventBus 'api:call'.
    // Maintain only a local ring buffer for immediate view responsiveness.
    this.apiCalls.push({
      ...apiCall,
      timestamp: apiCall.timestamp || Date.now(),
      id: apiCall.id || Date.now() + Math.random()
    });
    if (this.apiCalls.length > this.maxApiCalls) {
      this.apiCalls.shift();
    }
    if (this.activeTab === 'api-calls') {
      if (!this._apiRafScheduled) {
        this._apiRafScheduled = true;
        requestAnimationFrame(() => {
          try { this.refreshApiCallsView(); } finally { this._apiRafScheduled = false; }
        });
      }
    }
  }

  refreshApiCallsView() {
    // Safety check: ensure element references are available
    if (!this.apiLog) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug('DEBUG PANEL: apiLog element not yet available, skipping refresh');
      }).catch(() => {});
      return;
    }

    // Prefer aggregator-provided timeline; fallback to local buffer
    let rows = [];
    try {
      rows = debugDataAggregator.getApiTimeline(200);
    } catch (_) {
      rows = this.apiCalls.slice(-200);
    }

    if (!rows || rows.length === 0) {
      this.apiLog.innerHTML = '<div class="debug-log__empty">No API calls recorded</div>';
      return;
    }

    // Windowed rendering: render last 200 only
    const windowed = rows.slice(-200);
    const html = windowed.map(call => this.formatApiCall(call)).join('');
    this.apiLog.innerHTML = html;
    this.apiLog.scrollTop = this.apiLog.scrollHeight;
  }

  formatApiCall(call) {
    const timestamp = this.options.showTimestamps ?
      new Date(call.timestamp).toLocaleTimeString() : '';
    const isError = call.errorCode && call.errorCode !== '0';
    const statusClass = isError ? 'debug-call--error' : 'debug-call--success';
    const dur = typeof call.durationMs === 'number' ? `<span class="debug-call__duration">${call.durationMs}ms</span>` : '';
    
    return `
      <div class="debug-call ${statusClass}">
        <div class="debug-call__header">
          <span class="debug-call__method">${call.method}</span>
          ${dur}
          ${timestamp ? `<span class="debug-call__time">${timestamp}</span>` : ''}
        </div>
        <div class="debug-call__details">
          <div class="debug-call__param">${call.parameter || ''}</div>
          <div class="debug-call__result">→ ${call.result}</div>
          ${isError ? `<div class="debug-call__error">Error: ${call.errorCode}</div>` : ''}
        </div>
      </div>
    `;
  }

  refreshDataModelView() {
    // Safety check: ensure element references are available
    if (!this.dataModelView) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug('DEBUG PANEL: dataModelView element not yet available, skipping refresh');
      }).catch(() => {});
      return;
    }
    
    if (!scormClient.getInitialized()) {
      this.dataModelView.innerHTML = '<div class="debug-data__empty">SCORM not initialized</div>';
      // reset previous cache on disconnect to avoid false highlights
      this._prevDataValues = {};
      return;
    }
    
    const elements = [
      'cmi.completion_status', 'cmi.success_status', 'cmi.score.raw',
      'cmi.progress_measure', 'cmi.location', 'cmi.session_time'
    ];

    // ensure previous map exists
    this._prevDataValues = this._prevDataValues || {};
    
    const html = elements.map(element => {
      const value = scormClient.getCachedValue(element);
      const display = (value == null || value === '') ? '--' : String(value);
      const changed = this._prevDataValues[element] !== undefined && this._prevDataValues[element] !== display;
      const cls = changed ? ' debug-data__value--changed' : '';
      return `
        <div class="debug-data__item">
          <span class="debug-data__element">${element}</span>
          <span class="debug-data__value${cls}">${display}</span>
        </div>
      `;
    }).join('');
    
    this.dataModelView.innerHTML = html;

    // update cache after render
    for (const el of elements) {
      const v = scormClient.getCachedValue(el);
      this._prevDataValues[el] = (v == null || v === '') ? '--' : String(v);
    }
  }

  // Attempt controls enablement (guardrails via UIState selectors)
  refreshAttemptControls() {
    if (!this.attemptControls) return;
    try {
      const selectors = (this.uiState && this.uiState.getAttemptEnablement) ? this.uiState.getAttemptEnablement() : null;

      const setBtn = (intent, enabled, reason = '') => {
        const btn = this.attemptControls.querySelector(`button[data-intent="${intent}"]`);
        if (!btn) return;
        btn.disabled = !enabled;
        if (!enabled) btn.setAttribute('title', reason || 'Disabled'); else btn.removeAttribute('title');
      };

      if (selectors) {
        // Ensure mutually exclusive suspend/resume visibility based on suspended flag
        setBtn('attempt:start', selectors.canStart, selectors.reasons.start);
        setBtn('attempt:suspend', selectors.canSuspend, selectors.reasons.suspend);
        setBtn('attempt:resume', selectors.canResume, selectors.reasons.resume);
        setBtn('api:commit', selectors.canCommit, selectors.reasons.commit);
        setBtn('attempt:terminate', selectors.canTerminate, selectors.reasons.terminate);
        if (this.attemptHint) {
          const disabledReasons = Object.entries(selectors.reasons)
            .filter(([k]) => {
              switch (k) {
                case 'start': return !selectors.canStart;
                case 'suspend': return !selectors.canSuspend;
                case 'resume': return !selectors.canResume;
                case 'commit': return !selectors.canCommit;
                case 'terminate': return !selectors.canTerminate;
                default: return false;
              }
            })
            .map(([, v]) => v)
            .filter(Boolean);
          this.attemptHint.textContent = disabledReasons[0] || '';
        }
      } else {
        // Fallback to minimal client-based heuristic
        const initialized = !!scormClient.getInitialized();
        const terminated = false;
        const canStart = !initialized;
        const canSuspend = initialized && !terminated;
        const canResume = false; // without suspended flag, avoid enabling both
        const canCommit = initialized && !terminated;
        const canTerminate = initialized && !terminated;
        setBtn('attempt:start', canStart, initialized ? 'Already initialized (RTE 3.2.1)' : '');
        setBtn('attempt:suspend', canSuspend, !initialized ? 'Initialize first (RTE 3.2.1)' : '');
        setBtn('attempt:resume', canResume, 'Not suspended');
        setBtn('api:commit', canCommit, !initialized ? 'Initialize first (RTE 3.2.1)' : '');
        setBtn('attempt:terminate', canTerminate, !initialized ? 'Initialize first (RTE 3.2.1)' : '');
        if (this.attemptHint) {
          this.attemptHint.textContent = initialized ? '' : 'Initialize to enable Commit/Terminate. See RTE lifecycle.';
        }
      }
    } catch (_e) {
      // Non-fatal UI
    }
  }

  // Diagnostics snapshotters
  refreshDiagnostics() {
    if (!this.eventLog) return;
    try {
      // Events via aggregator/eventBus
      let events = [];
      try {
        events = debugDataAggregator.getEvents(200);
      } catch (_) {
        // fallback to eventBus snapshot
        if (eventBus && typeof eventBus.getDebugSnapshot === 'function') {
          events = eventBus.getDebugSnapshot(200);
        } else {
          const dbg = this.uiState?.getState('debug') || {};
          events = Array.isArray(dbg.lastEvents) ? dbg.lastEvents.slice(-200) : [];
        }
      }
      const topic = this.eventFilter?.value?.trim();
      if (topic) {
        events = events.filter(e => (e?.event || '').includes(topic));
      }
      const eventsHtml = events.map(e => {
        const ts = new Date(e.timestamp || Date.now()).toLocaleTimeString();
        const payload = typeof e.data === 'string' ? e.data : JSON.stringify(e.data || {});
        return `<div class="debug-call"><div class="debug-call__header"><span class="debug-call__method">${e.event}</span><span class="debug-call__time">${ts}</span></div><div class="debug-call__details"><div class="debug-call__result">${payload}</div></div></div>`;
      }).join('');

      // Logs via aggregator with filters and sinceTs cursor
      this._diag.level = this.logLevelFilter?.value || 'all';
      this._diag.search = this.logSearch?.value || '';
      let logs = [];
      try {
        logs = debugDataAggregator.getLogs({ level: this._diag.level, search: this._diag.search, sinceTs: this._diagCursorTs || 0 });
        if (logs.length > 0) {
          const lastTs = logs[logs.length - 1].timestamp || Date.now();
          this._diagCursorTs = Math.max(this._diagCursorTs || 0, lastTs);
        }
      } catch (_) {
        logs = [];
      }
      const logsHtml = logs.map(l => {
        const ts = new Date(l.timestamp || Date.now()).toLocaleTimeString();
        const meta = l.meta ? ` ${JSON.stringify(l.meta)}` : '';
        return `<div class="debug-call"><div class="debug-call__header"><span class="debug-call__method">${l.level.toUpperCase()}</span><span class="debug-call__time">${ts}</span></div><div class="debug-call__details"><div class="debug-call__result">${l.message}${meta}</div></div></div>`;
      }).join('');

      this.eventLog.innerHTML = eventsHtml || '<div class="debug-log__empty">No events recorded</div>';
      if (this.rendererLog) this.rendererLog.innerHTML = logsHtml || '<div class="debug-log__empty">No logs</div>';
    } catch (_) {
      this.eventLog.innerHTML = '<div class="debug-log__empty">No events recorded</div>';
      if (this.rendererLog) this.rendererLog.innerHTML = '<div class="debug-log__empty">No logs</div>';
    }
  }

  // Sequencing skeleton (wire to sn-bridge when available)
  async refreshSequencingSkeleton() {
    const tree = this.element.querySelector('#sn-activity-tree');
    const steps = this.element.querySelector('#sn-next-steps');

    try {
      const { snBridge } = await import('../../services/sn-bridge.js');
      // Ensure initialized connection
      if (!snBridge.isServiceConnected()) {
        await snBridge.initialize();
      }
      if (!snBridge.isServiceConnected()) {
        if (tree) tree.innerHTML = '<div class="debug-log__empty">Sequencing state not available (bridge offline)</div>';
        if (steps) steps.innerHTML = '<div class="debug-log__empty">No advisory available</div>';
        return;
      }
      const state = await snBridge.getSequencingState();
      if (!state || state.success === false) {
        if (tree) tree.innerHTML = '<div class="debug-log__empty">Sequencing state not available</div>';
        if (steps) steps.innerHTML = '<div class="debug-log__empty">No advisory available</div>';
        return;
      }
      const act = state.currentActivity || {};
      const summary = `
        <div class="debug-info__item">
          <span class="debug-info__label">Current Activity:</span>
          <span class="debug-info__value">${act.id || '--'}</span>
        </div>
        <div class="debug-info__item">
          <span class="debug-info__label">Suspended:</span>
          <span class="debug-info__value">${String(state.suspended || false)}</span>
        </div>
      `;
      if (tree) tree.innerHTML = summary;

      const advisories = (state.next || []);
      const list = advisories.length
        ? advisories.map(a => `<div class="debug-call"><div class="debug-call__details"><div class="debug-call__result">${a.request || a}</div></div></div>`).join('')
        : '<div class="debug-log__empty">No advisory available</div>';
      if (steps) steps.innerHTML = list;
    } catch (e) {
      try {
        const { rendererLogger } = await import('../../utils/renderer-logger.js');
        rendererLogger.warn('[CAM/Debug] Sequencing snapshot wiring pending or failed', String(e?.message || e));
      } catch (_) {}
      if (tree) tree.innerHTML = '<div class="debug-log__empty">Sequencing snapshot wiring pending</div>';
      if (steps) steps.innerHTML = '<div class="debug-log__empty">Advisory wiring pending</div>';
    }
  }

  // Manifest diagnostics wired: structured summaries and graceful fallbacks
  refreshManifestDiagnostics() {
    if (!this.manifestResults) return;
    this.manifestResults.innerHTML = '<div class="debug-log__empty">Use Parse/Validate to run diagnostics</div>';
  }

  renderManifestMessage(msg) {
    if (!this.manifestResults) return;
    this.manifestResults.innerHTML = `<div class="debug-info__item">${msg}</div>`;
  }

  renderManifestStructured(data) {
    if (!this.manifestResults) return;
    try {
      const manifest = data?.manifest || data?.cam?.manifest || data?.data?.manifest || null;
      const analysis = data?.analysis || data?.cam?.analysis || null;
      const validation = data?.validation || data?.cam?.validation || null;
      const metadata = data?.metadata || data?.cam?.metadata || null;

      // basic counts
      const orgs = Number(analysis?.orgCount ?? (manifest?.organizations ? 1 : 0));
      const items = Number(analysis?.itemCount ?? 0);
      const resources = Number(analysis?.resourceCount ?? (manifest?.resources?.length || 0));
      const defaultOrg = manifest?.organizations?.default || analysis?.defaultOrganizationId || '--';
      const outlineLen = Array.isArray(analysis?.uiOutline) ? analysis.uiOutline.length : (Array.isArray(manifest?.organizations?.organization) ? manifest.organizations.organization.length : 0);
      const hasMeta = !!(metadata || manifest?.metadata);

      const html = `
        <div class="debug-info__item"><span class="debug-info__label">Default Organization:</span><span class="debug-info__value">${defaultOrg}</span></div>
        <div class="debug-info__item"><span class="debug-info__label">Organizations:</span><span class="debug-info__value">${orgs}</span></div>
        <div class="debug-info__item"><span class="debug-info__label">Items:</span><span class="debug-info__value">${items}</span></div>
        <div class="debug-info__item"><span class="debug-info__label">Resources:</span><span class="debug-info__value">${resources}</span></div>
        <div class="debug-info__item"><span class="debug-info__label">Outline Entries:</span><span class="debug-info__value">${outlineLen}</span></div>
        <div class="debug-info__item"><span class="debug-info__label">Metadata Present:</span><span class="debug-info__value">${hasMeta ? 'Yes' : 'No'}</span></div>
        ${validation ? `<pre class="debug-pre">${JSON.stringify(validation, null, 2)}</pre>` : ''}
      `;
      this.manifestResults.innerHTML = html;
    } catch (_) {
      this.manifestResults.innerHTML = `<pre class="debug-pre">${JSON.stringify(data ?? { message: 'wiring not available' }, null, 2)}</pre>`;
    }
  }

  async runManifestParse() {
    const { rendererLogger } = await import('../../utils/renderer-logger.js');
    try {
      const coursePath = this.uiState?.getState('currentCoursePath') || null;
      if (!window.electronAPI || typeof window.electronAPI.getCourseManifest !== 'function') {
        this.renderManifestMessage('wiring not available (preload missing)');
        return;
      }
      const result = await window.electronAPI.getCourseManifest(coursePath);
      if (result == null) {
        this.renderManifestMessage('wiring not available (preload returned null/undefined)');
        return;
      }
      rendererLogger.info('[CAM/Debug] manifest parse invoked');
      this.renderManifestStructured(result);
    } catch (e) {
      rendererLogger.error('[CAM/Debug] manifest parse error', String(e?.message || e));
      this.renderManifestMessage('Parse failed (see app log)');
    }
  }

  async runManifestValidate() {
    const { rendererLogger } = await import('../../utils/renderer-logger.js');
    try {
      const coursePath = this.uiState?.getState('currentCoursePath') || null;
      if (!window.electronAPI || typeof window.electronAPI.processScormManifest !== 'function') {
        this.renderManifestMessage('wiring not available (preload missing)');
        return;
      }
      const result = await window.electronAPI.processScormManifest(coursePath);
      if (result == null) {
        this.renderManifestMessage('wiring not available (preload returned null/undefined)');
        return;
      }
      rendererLogger.info('[CAM/Debug] content validate invoked');
      this.renderManifestStructured(result);
    } catch (e) {
      rendererLogger.error('[CAM/Debug] content validate error', String(e?.message || e));
      this.renderManifestMessage('Validation failed (see app log)');
    }
  }

  refreshSessionInfo() {
    // Safety check: ensure element references are available
    if (!this.sessionInfo) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug('DEBUG PANEL: sessionInfo element not yet available, skipping refresh');
      }).catch(() => {});
      return;
    }
    
    const sessionId = scormClient.getSessionId() || '--';
    const status = scormClient.getInitialized() ? 'Connected' : 'Not Connected';
    
    this.sessionInfo.innerHTML = `
      <div class="debug-info__item">
        <span class="debug-info__label">Status:</span>
        <span class="debug-info__value">${status}</span>
      </div>
      <div class="debug-info__item">
        <span class="debug-info__label">Session ID:</span>
        <span class="debug-info__value">${sessionId}</span>
      </div>
    `;
  }

  refreshActiveTab() {
    switch (this.activeTab) {
      case 'api-calls':
        this.refreshApiCallsView();
        break;
      case 'attempt':
        this.refreshAttemptControls?.();
        break;
      case 'data-model':
        this.refreshDataModelView();
        break;
      case 'sequencing':
        // attempt to fetch snapshot
        this.refreshSequencingSkeleton?.();
        break;
      case 'diagnostics':
        this.injectBenchmarksUiIfNeeded();
        this.refreshDiagnostics?.();
        break;
      case 'session':
        this.refreshSessionInfo();
        break;
      case 'errors':
        this.refreshErrorsView();
        break;
      case 'manifest':
        this.refreshManifestDiagnostics?.();
        break;
    }
  }

  refreshErrorsView() {
    // Safety check: ensure element references are available
    if (!this.errorLog) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.debug('DEBUG PANEL: errorLog element not yet available, skipping refresh');
      }).catch(() => {});
      return;
    }

    // Prefer aggregator error index for immediate reflection
    let errorCalls = [];
    try {
      errorCalls = (debugDataAggregator.getErrors && debugDataAggregator.getErrors(200)) || [];
    } catch (_) {
      // Fallback to local buffer filter
      errorCalls = this.apiCalls.filter(call => call.errorCode && call.errorCode !== '0').slice(-200);
    }

    if (!errorCalls || errorCalls.length === 0) {
      this.errorLog.innerHTML = '<div class="debug-log__empty">No errors recorded</div>';
      return;
    }

    const html = errorCalls.map(call => this.formatApiCall(call)).join('');
    this.errorLog.innerHTML = html;
  }

  clearLog() {
    this.apiCalls = [];
    // clear diff highlighting cache as well
    this._prevDataValues = {};
    this.refreshActiveTab();
    this.emit('logCleared');
  }

  exportLog() {
    const data = {
      timestamp: new Date().toISOString(),
      sessionId: scormClient.getSessionId(),
      apiCalls: this.apiCalls
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scorm-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  closePanel() {
    this.hide();
    this.emit('panelClosed');
  }

  loadApiCallHistory() {
    if (!this.uiState) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('DebugPanel: uiState not yet initialized, skipping API call history load');
      }).catch(() => {});
      return;
    }
    const history = this.uiState.getState('apiCallHistory') || [];
    this.apiCalls = history;
    this.refreshActiveTab();
  }

  handleApiCall(data) {
    // Normalize payload shape from scorm-api-bridge { data: apiCall } or direct apiCall
    const payload = data && data.data ? data.data : data;
    this.addApiCall(payload);
  }

  handleScormError(data) {
    this.addApiCall({
      method: 'Error',
      parameter: data.errorCode,
      result: data.message,
      errorCode: data.errorCode
    });
  }

  handleScormInitialized() {
    this.refreshSessionInfo();
  }

  handleDataChanged() {
    if (this.activeTab === 'data-model') {
      this.refreshDataModelView();
    }
  }

  destroy() {
    this.clearLog();
    try {
      if (this._diagUnsub) this._diagUnsub();
      if (this._diagUnsub2) this._diagUnsub2();
      if (this._diagUnsub3) this._diagUnsub3();
      if (this._dbgUnsub) this._dbgUnsub();
    } catch (_) { /* no-op */ }
    super.destroy();
  }
}

export { DebugPanel };