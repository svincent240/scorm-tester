// @ts-check

/**
 * Progress Tracking Component
 *
 * Displays overall progress information (percentage, completion/success status,
 * score and time) as a standalone widget. Pure consumer of UIState.
 */

import { BaseComponent } from '../base-component.js';

class ProgressTracking extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, {
      ...options,
      className: 'progress-tracking',
      attributes: { 'data-component': 'progress-tracking', ...(options.attributes || {}) },
    });

    this.state = {
      progressPercentage: 0,
      completionStatus: 'not attempted',
      successStatus: 'unknown',
      scoreRaw: null,
      scoreScaled: null,
      timeSpent: '00:00:00',
      totalTime: '00:00:00'
    };
  }

  async setup() {
    // BaseComponent.initialize() calls loadDependencies() before setup(),
    // so this.uiState should already be available here.
    // Seed initial values from UIState if present
    try {
      const pd = this.uiState && this.uiState.getState ? (this.uiState.getState('progressData') || {}) : {};
      this.applyProgressSnapshot(pd);
    } catch (_) { /* intentionally empty */ }
  }

  renderContent() {
    // Minimal, accessible structure
    this.element.innerHTML = `
      <div class="pt__container">
        <div class="pt__row">
          <div class="pt__bar" aria-label="Progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="pt__bar-fill" style="width:0%"></div>
          </div>
          <div class="pt__percentage" id="pt-percentage">0%</div>
        </div>
        <div class="pt__row pt__meta">
          <div class="pt__status">
            <span id="pt-completion">not attempted</span>
            <span>•</span>
            <span id="pt-success">unknown</span>
          </div>
          <div class="pt__score-time">
            <span id="pt-score"></span>
            <span id="pt-time"></span>
          </div>
        </div>
      </div>`;

    // Cache elements
    this.$bar = this.element.querySelector('.pt__bar');
    this.$fill = this.element.querySelector('.pt__bar-fill');
    this.$pct = this.element.querySelector('#pt-percentage');
    this.$completion = this.element.querySelector('#pt-completion');
    this.$success = this.element.querySelector('#pt-success');
    this.$score = this.element.querySelector('#pt-score');
    this.$time = this.element.querySelector('#pt-time');

    // First paint from current state
    this.updateProgress(this.state);
  }

  setupEventSubscriptions() {
    // Central progress stream from UIState
    this.subscribe('progress:updated', (data) => {
      const d = (data && data.data) ? data.data : (data || {});
      this.applyProgressSnapshot(d);
      this.updateProgress(this.state);
    });

    // Also react to specific SCORM data changes for snappier UI
    this.subscribe('ui:scorm:dataChanged', (data) => {
      const element = (data && data.data && data.data.element) ? data.data.element : (data ? data.element : undefined);
      const value = (data && data.data && data.data.value) ? data.data.value : (data ? data.value : undefined);
      if (element === 'cmi.progress_measure') {
        const pct = this._toPct(value);
        if (!Number.isNaN(pct)) this.state.progressPercentage = pct;
        this.updateProgress(this.state);
      } else if (element === 'cmi.completion_status') {
        this.state.completionStatus = String(value || 'not attempted');
        this.updateProgress(this.state);
      } else if (element === 'cmi.success_status') {
        this.state.successStatus = String(value || 'unknown');
        this.updateProgress(this.state);
      } else if (element && element.startsWith('cmi.score')) {
        this._updateScoreFromCacheLike();
        this.updateProgress(this.state);
      }
    });

    // Time updates may be provided by services; listen to a generic UI slice change
    this.subscribe('state:changed', (payload) => {
      try {
        const current = payload && payload.current ? payload.current : undefined;
        const t = current && typeof current.sessionTime === 'string' ? current.sessionTime : null;
        if (typeof t === 'string') {
          this.state.timeSpent = t;
          this.updateProgress(this.state);
        }
      } catch (_) { /* intentionally empty */ }
    });
  }

  applyProgressSnapshot(pd) {
    try {
      const pct = this._toPct(pd.progressMeasure);
      this.state.progressPercentage = Number.isNaN(pct) ? (this.state.progressPercentage || 0) : pct;
      if (pd.completionStatus) this.state.completionStatus = String(pd.completionStatus);
      if (pd.successStatus) this.state.successStatus = String(pd.successStatus);

      // score
      if (pd.scoreRaw != null || pd.scoreScaled != null) {
        this.state.scoreRaw = (pd.scoreRaw != null && pd.scoreRaw !== '') ? Number(pd.scoreRaw) : null;
        this.state.scoreScaled = (pd.scoreScaled != null && pd.scoreScaled !== '') ? Number(pd.scoreScaled) : null;
      }

      // time (best-effort)
      if (pd.timeSpent) this.state.timeSpent = String(pd.timeSpent);
      if (pd.totalTime) this.state.totalTime = String(pd.totalTime);
    } catch (e) {
      try {
        import('../../utils/renderer-logger.js').then((mod) => {
          const logger = mod && mod.rendererLogger ? mod.rendererLogger : null;
          if (logger && logger.warn) logger.warn('ProgressTracking.applyProgressSnapshot failed', (e && (e.message || e)));
        });
      } catch (_) { /* intentionally empty */ }
    }
  }

  updateProgress(data) {
    if (!this.element) return;
    const pct = Math.max(0, Math.min(100, Math.round(Number(data.progressPercentage || 0))));

    if (this.$fill) this.$fill.style.width = `${pct}%`;
    if (this.$bar) this.$bar.setAttribute('aria-valuenow', String(pct));
    if (this.$pct) this.$pct.textContent = `${pct}%`;

    if (this.$completion) this.$completion.textContent = String(data.completionStatus || 'not attempted');
    if (this.$success) this.$success.textContent = String(data.successStatus || 'unknown');

    // Score display preference: scaled% if present, else raw
    if (this.$score) {
      const scaled = (typeof data.scoreScaled === 'number') ? `${Math.round(data.scoreScaled * 100)}%` : null;
      const raw = (typeof data.scoreRaw === 'number') ? `${data.scoreRaw}` : null;
      const text = (scaled !== null && scaled !== undefined) ? scaled : (raw ? `Score: ${raw}` : '');
      this.$score.textContent = text;
      this.$score.style.display = text ? '' : 'none';
    }

    if (this.$time) {
      const t = (data.timeSpent && typeof data.timeSpent === 'string') ? data.timeSpent : '';
      this.$time.textContent = t ? `• ${t}` : '';
      this.$time.style.display = t ? '' : 'none';
    }
  }

  reset() {
    this.state = {
      progressPercentage: 0,
      completionStatus: 'not attempted',
      successStatus: 'unknown',
      scoreRaw: null,
      scoreScaled: null,
      timeSpent: '00:00:00',
      totalTime: '00:00:00'
    };
    this.updateProgress(this.state);
  }

  getProgressPercentage() { return this.state.progressPercentage || 0; }
  getTimeSpent() { return this.state.timeSpent || '00:00:00'; }
  getScore() { return { raw: (this.state.scoreRaw !== null && this.state.scoreRaw !== undefined) ? this.state.scoreRaw : undefined, scaled: (this.state.scoreScaled !== null && this.state.scoreScaled !== undefined) ? this.state.scoreScaled : undefined }; }
  getState() { return { ...this.state }; }

  // Helpers
  _toPct(progressMeasure) {
    const n = Number(progressMeasure);
    if (Number.isFinite(n)) {
      // If value looks like 0..1 treat as fraction; if > 1 assume already %
      return n <= 1 ? Math.round(n * 100) : Math.round(n);
    }
    return NaN;
  }

  _updateScoreFromCacheLike() {
    try {
      // Prefer UIState centralized snapshot if available
      const pd = (this.uiState && typeof this.uiState.getState === 'function') ? (this.uiState.getState('progressData') || {}) : {};
      this.state.scoreRaw = (pd.scoreRaw != null && pd.scoreRaw !== '') ? Number(pd.scoreRaw) : this.state.scoreRaw;
      this.state.scoreScaled = (pd.scoreScaled != null && pd.scoreScaled !== '') ? Number(pd.scoreScaled) : this.state.scoreScaled;
    } catch (_) { /* intentionally empty */ }
  }
}

export { ProgressTracking };

