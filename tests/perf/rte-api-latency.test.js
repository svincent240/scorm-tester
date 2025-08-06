/**
 * RTE API Latency Performance (Non-Gating)
 *
 * Purpose:
 * - Probe latency characteristics of the SCORM RTE public API (Initialize, GetValue, SetValue, Commit, Terminate).
 * - Deterministic harness, artifacts written to artifacts/perf (JSON + TXT).
 * - No console.* usage; tests should not gate CI on performance outcomes.
 *
 * References:
 * - RTE public entry: src/main/services/scorm/rte/api-handler.js
 * - Determinism helpers: tests/setup.js
 * - Policy: dev_docs/architecture/testing-architecture.md, dev_docs/guides/testing-migration-and-fixtures.md
 */

const fs = require('fs').promises;
const path = require('path');
const ScormApiHandler = require('../../src/main/services/scorm/rte/api-handler.js');
const { createSeededRng } = require('../setup.js');

function now() {
  return Date.now();
}

function summarizeTimings(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((s, v) => s + v, 0);
  const p95 = percentile(sorted, 0.95);
  return {
    min: sorted[0] || 0,
    avg: arr.length ? sum / arr.length : 0,
    p95,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length) - 1));
  return sorted[idx];
}

function makeSessionManager() {
  return {
    registerSession: () => {},
    unregisterSession: () => {},
    persistSessionData: () => true,
    getLearnerInfo: () => ({ id: 'learner-001', name: 'Perf Probe' }),
  };
}

function makeLoggerSink() {
  // In perf, avoid console.*; capture in-memory if needed
  const entries = [];
  return {
    info: (m, meta) => entries.push({ level: 'info', m, meta: meta ?? null }),
    warn: (m, meta) => entries.push({ level: 'warn', m, meta: meta ?? null }),
    error: (m, meta) => entries.push({ level: 'error', m, meta: meta ?? null }),
    debug: (m, meta) => entries.push({ level: 'debug', m, meta: meta ?? null }),
    entries,
    clear: () => { entries.length = 0; },
  };
}

describe('Perf: RTE API latency (non-gating)', () => {
  let rng;

  beforeAll(() => {
    rng = createSeededRng(24601);
  });

  test('Initialize → burst SetValue → Commit → Terminate latency snapshot', async () => {
    const samples = 200;
    const timings = [];

    // Warm-up single run (not counted)
    runRteSequenceOnce();

    for (let i = 0; i < samples; i++) {
      const t0 = now();
      runRteSequenceOnce({ burst: 5, rng });
      timings.push(now() - t0);
    }

    const stats = summarizeTimings(timings);

    const outDir = path.join(process.cwd(), 'artifacts', 'perf');
    await fs.mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `rte-api-latency-${stamp}`;

    const payload = {
      project: 'rte',
      suite: 'api-latency',
      samples,
      stats,
      meta: {
        node: process.version,
        seed: 24601,
        burstMin: 5,
        burstMax: 5,
        notes: 'Non-gating perf snapshot; budgets are warnings-only in CI policy.',
      },
    };

    const jsonPath = path.join(outDir, `${base}.json`);
    const txtPath = path.join(outDir, `${base}.txt`);

    await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.writeFile(
      txtPath,
      [
        'RTE API Latency Perf Snapshot',
        `samples: ${samples}`,
        `min(ms): ${stats.min.toFixed(3)}`,
        `avg(ms): ${stats.avg.toFixed(3)}`,
        `p95(ms): ${stats.p95.toFixed(3)}`,
        `seed: ${payload.meta.seed}`,
        `burst writes: ${payload.meta.burstMin}..${payload.meta.burstMax}`,
        '',
        'Non-gating: see dev_docs/guides/testing-migration-and-fixtures.md',
      ].join('\n'),
      'utf8'
    );

    // After writing, prune artifacts to keep most recent 5 JSON/TXT pairs for this suite
    await prunePerfArtifacts(outDir, 'rte-api-latency-', 5);

    // Non-gating: only sanity-check non-negative timing
    expect(stats.min).toBeGreaterThanOrEqual(0);
  });
});

function runRteSequenceOnce(options = {}) {
  const { burst = 5, rng = Math.random } = options;

  const logger = makeLoggerSink();
  const sessionManager = makeSessionManager();
  const api = new ScormApiHandler(sessionManager, logger, {
    strictMode: true,
    maxCommitFrequency: 10000,
  });

  // Initialize
  const init = api.Initialize('');
  if (init !== 'true') {
    // If initialization fails we short-circuit; perf test remains non-gating
    return;
  }

  // Burst of writes to a small set of keys (deterministic-ish)
  const keys = ['cmi.location', 'cmi.exit', 'cmi.learner_preference.audio_level'];
  for (let i = 0; i < burst; i++) {
    const k = keys[Math.floor(rng() * keys.length)];
    const v = pickValue(k, rng);
    try { api.SetValue(k, v); } catch (_) {}
  }

  // A couple of reads
  try { api.GetValue('cmi.location'); } catch (_) {}
  try { api.GetValue('cmi.exit'); } catch (_) {}

  // Commit
  try { api.Commit(''); } catch (_) {}

  // Terminate
  try { api.Terminate(''); } catch (_) {}
}

function pickValue(key, rng) {
  switch (key) {
    case 'cmi.location': {
      const n = 1 + Math.floor(rng() * 10);
      return `lesson-${n}`;
    }
    case 'cmi.exit': {
      const options = ['suspend', 'logout', 'normal', ''];
      return options[Math.floor(rng() * options.length)];
    }
    case 'cmi.learner_preference.audio_level': {
      // Return a string per API surface; actual validation is internal
      const level = (rng() * 1.0).toFixed(2);
      return `${level}`;
    }
    default:
      return '';
  }
}

/**
 * Prune artifacts/perf to keep most recent N JSON/TXT pairs per suite prefix.
 * A "pair" is two files sharing the same basename and differing by .json/.txt.
 * This function deletes older pairs atomically by basename.
 *
 * @param {string} outDir directory path like artifacts/perf
 * @param {string} prefix suite-specific basename prefix e.g. 'rte-api-latency-'
 * @param {number} keep how many most recent pairs to retain
 */
async function prunePerfArtifacts(outDir, prefix, keep) {
  try {
    const all = await fs.readdir(outDir);
    // Filter by prefix and extension
    const candidates = all.filter(n => n.startsWith(prefix) && (n.endsWith('.json') || n.endsWith('.txt')));

    // Group by timestamped basename (without extension)
    const groups = new Map();
    for (const name of candidates) {
      const ext = name.endsWith('.json') ? '.json' : '.txt';
      const base = name.slice(0, -ext.length); // remove extension
      if (!groups.has(base)) groups.set(base, new Set());
      groups.get(base).add(ext);
    }

    // Consider only complete pairs that have both .json and .txt
    const bases = Array.from(groups.entries())
      .filter(([, exts]) => exts.has('.json') && exts.has('.txt'))
      .map(([base]) => base);

    // Sort bases descending by timestamp (lexicographic works due to ISO-like stamp)
    bases.sort((a, b) => b.localeCompare(a));

    // Determine deletions beyond "keep" newest
    const toDelete = bases.slice(keep);

    for (const base of toDelete) {
      const jsonFile = path.join(outDir, `${base}.json`);
      const txtFile = path.join(outDir, `${base}.txt`);
      // Best-effort deletions; ignore errors
      try { await fs.unlink(jsonFile); } catch (_) {}
      try { await fs.unlink(txtFile); } catch (_) {}
    }
  } catch (_) {
    // Non-gating; ignore errors
  }
}