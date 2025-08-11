/**
 * Debug Data Aggregator
 *
 * Centralizes throttled buffers and selectors for:
 *  - API Timeline (from EventBus 'api:call' and UIState history)
 *  - Event snapshots (from EventBus debug mirror)
 *  - Renderer logs (placeholder via preload; gated)
 *
 * Emits 'debug:update' via EventBus when throttled aggregates update.
 * No console usage; logs routed via renderer-logger if needed.
 */
 
 
class DebugDataAggregator {
  constructor() {
    this._inited = false;
 
    // API timeline ring
    this.timeline = [];
    this.maxTimeline = 1000;

    // Error index ring
    this.errors = [];
    this.maxErrors = 300;
 
    // Basic throttle
    this._pending = false;
    this._throttleMs = 200;

    // Correlation pairing
    this._pendingByKey = new Map();
    this._pairWindowMs = 1500;
 
    // Optional log ring (placeholder; filled only if preload exposes a stream)
    this.logs = [];
    this.maxLogs = 500;
 
    // Binds
    this._onApiCall = this._onApiCall.bind(this);
    this._onError = this._onError.bind(this);
    this._flush = this._flush.bind(this);
  }
 
  async start() {
    if (this._inited) return;
    this._inited = true;
 
    // Seed from EventBus history if any
    try {
      const { eventBus } = await import('./event-bus.js');
      const seed = eventBus.getHistory('api:call', 200) || [];
      for (const evt of seed) {
        const api = evt?.data?.data || evt?.data || evt;
        const norm = this._normalizeApiCall(api);
        this._applyCorrelation(norm);
        this._pushTimeline(norm);
        this._maybeIndexError(norm);
      }
      // Subscribe to live events
      this._unsubApi = eventBus.on('api:call', this._onApiCall);
      this._unsubErr = eventBus.on('error', this._onError);
    } catch (_) { /* no-op */ }
 
    // Attempt to hook to renderer log stream (optional)
    try {
      if (window.electronAPI?.logger?.subscribeRenderer) {
        this._unsubLogs = window.electronAPI.logger.subscribeRenderer((entry) => {
          // Expect shape: { level, message, ts, meta? }
          const ts = Number(entry?.ts) || Date.now();
          const item = {
            id: ts + Math.random(),
            timestamp: ts,
            level: String(entry?.level || 'info'),
            message: String(entry?.message || ''),
            meta: entry?.meta || null,
          };
          this.logs.push(item);
          while (this.logs.length > this.maxLogs) this.logs.shift();
          this._scheduleFlush();
        });
      }
    } catch (_) { /* no-op */ }
  }
 
  stop() {
    if (!this._inited) return;
    this._inited = false;
    try { this._unsubApi && this._unsubApi(); } catch (_) {}
    try { this._unsubErr && this._unsubErr(); } catch (_) {}
    try { this._unsubLogs && this._unsubLogs(); } catch (_) {}
    this._unsubApi = null;
    this._unsubErr = null;
    this._unsubLogs = null;
  }
 
  destroy() {
    this.stop();
    this.timeline = [];
    this.logs = [];
    this.errors = [];
    this._pendingByKey.clear();
  }
 
  // Event handlers
  _onApiCall(payload) {
    const api = payload && payload.data ? payload.data : payload;
    const norm = this._normalizeApiCall(api);
    this._applyCorrelation(norm);
    this._pushTimeline(norm);
    this._maybeIndexError(norm);
    this._scheduleFlush();
  }
 
  _onError(err) {
    // link errors back to latest API if applicable; minimal heuristic
    try {
      const last = this.timeline[this.timeline.length - 1];
      if (last && (last.errorCode === '0' || !last.errorCode)) {
        last.errorCode = String(err?.errorCode || '101');
        last.error = err?.message || String(err);
        this._maybeIndexError(last);
      }
    } catch (_) { /* no-op */ }
    this._scheduleFlush();
  }
 
  // Helpers
  _pushTimeline(item) {
    this.timeline.push(item);
    while (this.timeline.length > this.maxTimeline) this.timeline.shift();
  }

  _maybeIndexError(item) {
    try {
      if (item && item.errorCode && item.errorCode !== '0') {
        this.errors.push(item);
        while (this.errors.length > this.maxErrors) this.errors.shift();
      }
    } catch (_) { /* no-op */ }
  }

  _makeKey(method, parameter) {
    try {
      const m = String(method || '').trim();
      const p = String(parameter || '').replace(/\s+/g, ' ').trim().slice(0, 64);
      return `${m}:${p}`;
    } catch (_) {
      return String(method || '');
    }
  }

  _applyCorrelation(item) {
    try {
      const key = this._makeKey(item.method, item.parameter);
      const prev = this._pendingByKey.get(key);
      const now = Number(item.timestamp) || Date.now();
      if (prev && (now - prev.timestamp) <= this._pairWindowMs) {
        // Pair found; set duration on the latter (current) entry
        item.durationMs = now - prev.timestamp;
      }
      // Update the map to current item for next potential pairing
      this._pendingByKey.set(key, { timestamp: now, id: item.id });
    } catch (_) { /* no-op */ }
  }
 
  _normalizeApiCall(api) {
    const ts = Number(api?.timestamp) || Date.now();
    const resStr = String(api?.result ?? '');
    const item = {
      id: api?.id || (ts + Math.random()),
      seq: api?.seq || ts,
      method: String(api?.method || ''),
      parameter: String(api?.parameter || '').slice(0, 512),
      result: resStr,
      errorCode: String(api?.errorCode ?? (resStr === 'false' ? '101' : '0')),
      timestamp: ts,
    };
    return item;
  }
 
  _scheduleFlush() {
    if (this._pending) return;
    this._pending = true;
    setTimeout(this._flush, this._throttleMs);
  }
 
  async _flush() {
    this._pending = false;
    try {
      const { eventBus } = await import('./event-bus.js');
      eventBus.emit('debug:update', {
        counts: {
          api: this.timeline.length,
          logs: this.logs.length,
          errors: this.errors.length
        }
      });
    } catch (_) { /* no-op */ }
  }
 
  // Selectors
  getApiTimeline(limit = 200) {
    const arr = this.timeline;
    if (!limit || limit <= 0) return arr.slice();
    return arr.slice(-limit);
  }

  getErrors(limit = 200) {
    const arr = this.errors;
    if (!limit || limit <= 0) return arr.slice();
    return arr.slice(-limit);
  }
 
  async getEvents(limit = 200) {
    const { eventBus } = await import('./event-bus.js');
    if (eventBus && typeof eventBus.getDebugSnapshot === 'function') {
      return eventBus.getDebugSnapshot(limit);
    }
    return [];
  }
 
  getLogs({ level = 'all', search = '', sinceTs = 0 } = {}) {
    let list = this.logs.slice(-this.maxLogs);
    if (sinceTs) {
      const s = Number(sinceTs) || 0;
      list = list.filter(l => Number(l.timestamp || 0) >= s);
    }
    if (level && level !== 'all') {
      list = list.filter(l => l.level === level);
    }
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(l => (l.message || '').toLowerCase().includes(q));
    }
    return list;
  }
}
 
// Singleton
const debugDataAggregator = new DebugDataAggregator();
debugDataAggregator.start();
 
export { DebugDataAggregator, debugDataAggregator };