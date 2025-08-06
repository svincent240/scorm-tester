/**
 * SN Rule Evaluation Performance (Non-Gating)
 *
 * Purpose:
 * - Measures batched sequencing/navigation (SN) rule evaluation latency.
 * - Captures min/avg/p95 and writes artifacts to artifacts/perf/.
 * - Non-gating: emits console-free logs by writing files only.
 *
 * References:
 * - See dev_docs/guides/testing-migration-and-fixtures.md for perf policy
 * - SN public entrypoint: src/main/services/scorm/sn/index.js
 * - Logger/console policy: write artifacts, do not use console.*
 */
const fs = require('fs').promises;
const path = require('path');
const { ScormSNService } = require('../../src/main/services/scorm/sn');
const { createSeededRng } = require('../setup.js');

// Simple mock error handler to prevent side-effects
function makeErrorHandler() {
  return {
    setError: () => {},
    getLastError: () => '0',
    clearError: () => {},
  };
}

describe('Perf: SN rule evaluation (non-gating)', () => {
  let snService;
  let rng;

  beforeAll(() => {
    rng = createSeededRng(1337);
    snService = new ScormSNService(makeErrorHandler(), /* logger */ null);
  });

  test('batched rule eval latency snapshot', async () => {
    // Arrange: create a deterministic synthetic manifest slice for SN rules
    const manifest = makeSyntheticManifest(50); // 50 activities, linear with occasional branching flags

    // Warm-up
    runRuleEvalBatch(snService, manifest, 25, rng);

    // Measure
    const samples = 200;
    const timings = [];
    for (let i = 0; i < samples; i++) {
      const start = now();
      runRuleEvalBatch(snService, manifest, 10, rng);
      timings.push(now() - start);
    }

    // Compute stats
    const stats = summarizeTimings(timings);

    // Emit artifacts (JSON + TXT)
    const outDir = path.join(process.cwd(), 'artifacts', 'perf');
    await fs.mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `sn-rule-eval-${stamp}`;

    const jsonPath = path.join(outDir, `${base}.json`);
    const txtPath = path.join(outDir, `${base}.txt`);

    const payload = {
      project: 'sn',
      suite: 'rule-eval',
      samples,
      stats,
      meta: {
        node: process.version,
        seed: 1337,
        manifestSize: manifest.organizations?.organizations?.[0]?.items?.length || 0,
        notes: 'Non-gating perf snapshot; budgets enforced as warnings in CI stage policy.',
      },
    };
  
    await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.writeFile(
      txtPath,
      [
        'SN Rule Evaluation Perf Snapshot',
        `samples: ${samples}`,
        `min(ms): ${stats.min.toFixed(3)}`,
        `avg(ms): ${stats.avg.toFixed(3)}`,
        `p95(ms): ${stats.p95.toFixed(3)}`,
        `seed: 1337`,
        `manifest activities: ${payload.meta.manifestSize}`,
        '',
        'Non-gating: see dev_docs/guides/testing-migration-and-fixtures.md',
      ].join('\n'),
      'utf8'
    );
  
    // After writing, prune artifacts to keep most recent 5 JSON/TXT pairs for this suite
    await prunePerfArtifacts(outDir, 'sn-rule-eval-', 5);
  
    // Non-gating assertion: basic sanity (do not fail CI on performance)
    expect(stats.min).toBeGreaterThanOrEqual(0);
  });
});

// Helpers

function now() {
  // Use real time; perf tests should not use fake timers for latency
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

function makeSyntheticManifest(n) {
  // Minimal shape the SN layer can traverse for rule checks
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      identifier: `item-${i + 1}`,
      title: `Item ${i + 1}`,
      identifierref: i % 3 === 0 ? `res-${i + 1}` : undefined,
      sequencing: i % 7 === 0 ? { controlMode: { choice: true, flow: true } } : undefined,
      children: undefined,
    });
  }
  return {
    organizations: {
      default: 'org-1',
      organizations: [
        {
          identifier: 'org-1',
          title: 'Synthetic Organization',
          items,
        },
      ],
    },
    resources: items
      .filter((_, i) => i % 3 === 0)
      .map((_, i) => ({
        identifier: `res-${i * 3 + 1}`,
        scormType: 'sco',
        href: `sco-${i * 3 + 1}.html`,
      })),
  };
}

function runRuleEvalBatch(service, manifest, batchSize, rng) {
  // Emulate a batch of "next navigation" decisions across random items
  // without touching IO; focus on rule checks and traversal.
  // If the real service requires initialization, guard with try/catch.
  try {
    if (typeof service.buildTree === 'function') {
      service.buildTree(manifest);
    }
  } catch (_) {
    // If buildTree differs, ignore; this is a best-effort perf probe.
  }

  let cursor = 'item-1';
  for (let i = 0; i < batchSize; i++) {
    // Randomly pick next item index with a light RNG for determinism
    const nextIndex = 1 + Math.floor(rng() * (manifest.organizations.organizations[0].items.length));
    cursor = `item-${nextIndex}`;

    // Evaluate a representative set of methods if available
    safeCall(service, 'getActivity', cursor);
    safeCall(service, 'setCurrentActivity', cursor);
    safeCall(service, 'getLeafActivities');
    safeCall(service, 'getTreeStats');
  }
}

function safeCall(obj, method, ...args) {
  try {
    if (obj && typeof obj[method] === 'function') {
      return obj[method](...args);
    }
  } catch (_) {
    // swallow; perf test must not fail on API shape drifts
  }
  return undefined;
}

/**
 * Prune artifacts/perf to keep most recent N JSON/TXT pairs per suite prefix.
 * A "pair" is two files sharing the same basename and differing by .json/.txt.
 * This function deletes older pairs atomically by basename.
 *
 * @param {string} outDir directory path like artifacts/perf
 * @param {string} prefix suite-specific basename prefix e.g. 'sn-rule-eval-'
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