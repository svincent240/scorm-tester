// @ts-check

/**
 * Renderer Logger Adapter with adaptive backoff + coalescing
 *
 * Calls preload-exposed IPC logger in main and applies:
 *  - Rolling window rate limit for debug
 *  - Backoff when main reports "Rate limit exceeded" for any level
 *  - Per-level message coalescing in a short window to drop duplicates
 *
 * Usage: import { rendererLogger } from this module and use info/warn/error/debug.
 */
const DEBUG_RATE_LIMIT = { WINDOW_MS: 400, MAX_PER_WINDOW: 20 };
let debugWindowStart = 0;
let debugCount = 0;

const BACKOFF_MS = 1500;     // backoff for any level after a rate-limit error
let backoffUntil = 0;
let backoffNotifiedUntil = 0;
let coalesceDrops = 0;
let coalesceWindowStart = 0;
let suppressedDebugCount = 0;

// Coalescing settings
const COALESCE_WINDOW_MS = 400;
const lastSent = {
  info: { sig: null, at: 0 },
  warn: { sig: null, at: 0 },
  error: { sig: null, at: 0 },
  debug: { sig: null, at: 0 },
};

const getBridge = () => {
  try {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.logger) {
      return window.electronAPI.logger;
    }
  } catch (_) { /* intentionally empty */ }
  return null;
};

const inBackoff = () => Date.now() < backoffUntil;

const makeSig = (args) => {
  try {
    // Reduce args to a shallow signature; stringify safely
    return JSON.stringify(
      (args || []).map((a) => {
        if (a && typeof a === 'object') {
          // keep only a couple of stable fields to avoid huge strings
          const keys = Object.keys(a).slice(0, 5);
          const o = {};
          for (const k of keys) o[k] = a[k];
          return o;
        }
        return a;
      })
    );
  } catch (_) {
    return String(args?.[0] ?? '');
  }
};

const shouldCoalesceDrop = (level, args) => {
  const now = Date.now();
  const sig = makeSig(args);
  const entry = lastSent[level] || (lastSent[level] = { sig: null, at: 0 });

  if (entry.sig === sig && (now - entry.at) < COALESCE_WINDOW_MS) {
    return true; // drop duplicate in coalescing window
  }
  // update tracking (we consider it "sent" if we pass this check)
  entry.sig = sig;
  entry.at = now;
  return false;
};

const safeCall = async (method, args, isDebug = false) => {
  const bridge = getBridge();
  // Apply backoff first
  if (inBackoff()) {
    try {
      if (Date.now() > backoffNotifiedUntil) {
        backoffNotifiedUntil = backoffUntil;
        if (bridge && typeof bridge.warn === 'function') {
          await bridge.warn('RENDERER_BACKOFF_ACTIVE', { until: backoffUntil });
        }
      }
    } catch (_) { /* intentionally empty */ }
    return; // skip flooding but surface state once
  }

  // Coalesce duplicates per level
  if (shouldCoalesceDrop(method, args)) {
    const now = Date.now();
    if (now - coalesceWindowStart > COALESCE_WINDOW_MS) {
      coalesceWindowStart = now;
      coalesceDrops = 0;
      try { if (bridge && typeof bridge.info === 'function') { await bridge.info('RENDERER_COALESCE_WINDOW_START'); } } catch (_) { /* intentionally empty */ }
    }
    coalesceDrops += 1;
    if (coalesceDrops === 1) {
      try { if (bridge && typeof bridge.warn === 'function') { await bridge.warn('RENDERER_COALESCED_DUPLICATES', { dropped: coalesceDrops }); } } catch (_) { /* intentionally empty */ }
    }
    return;
  }

  // Apply debug rolling window limit (no silent drops)
  if (isDebug) {
    const now = Date.now();
    if (now - debugWindowStart > DEBUG_RATE_LIMIT.WINDOW_MS) {
      if (suppressedDebugCount > 0) {
        try { if (bridge && typeof bridge.info === 'function') { await bridge.info('RENDERER_DEBUG_SUPPRESSED_SUMMARY', { suppressed: suppressedDebugCount }); } } catch (_) { /* intentionally empty */ }
        suppressedDebugCount = 0;
      }
      debugWindowStart = now;
      debugCount = 0;
    }
    if (debugCount >= DEBUG_RATE_LIMIT.MAX_PER_WINDOW) {
      suppressedDebugCount += 1;
      if (suppressedDebugCount === 1) {
        try { if (bridge && typeof bridge.warn === 'function') { await bridge.warn('RENDERER_DEBUG_RATE_LIMIT', { windowMs: DEBUG_RATE_LIMIT.WINDOW_MS, max: DEBUG_RATE_LIMIT.MAX_PER_WINDOW }); } } catch (_) { /* intentionally empty */ }
      }
      return; // drop but surfaced via WARN
    }
    debugCount += 1;
  }

  if (!bridge || typeof bridge[method] !== 'function') return;

  try {
    await bridge[method](...args);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    // Enter non-silent backoff on any rate-limit indication
    if (msg.includes('Rate limit exceeded')) {
      backoffUntil = Date.now() + BACKOFF_MS;
      try { if (bridge && typeof bridge.warn === 'function') { await bridge.warn('RENDERER_BACKOFF_ENTER', { until: backoffUntil }); } } catch (_) { /* intentionally empty */ }
      return;
    }
    // For any other error, swallow but emit a single info for visibility
    try { if (bridge && typeof bridge.info === 'function') { await bridge.info('RENDERER_LOG_SEND_ERROR', { error: msg }); } } catch (_) { /* intentionally empty */ }
    return;
  }
};

/**
 * Renderer logger surface
 * All methods forward to main logger via IPC only, never console.
 */
const rendererLogger = {
  info: (...args) => { void safeCall('info', args, false); },
  warn: (...args) => { void safeCall('warn', args, false); },
  error: (...args) => { void safeCall('error', args, false); },
  debug: (...args) => { void safeCall('debug', args, true); },
};

export { rendererLogger };