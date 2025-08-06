/**
 * Perf (non-gating): RTE API latency sampling
 * - Captures min/avg/p95 for 8 SCORM API functions
 * - Writes artifacts under artifacts/perf
 * - Emits warnings via console.warn is disallowed; write to file only
 *
 * NOTE: Non-gating by policy. Do not fail tests based on budgets.
 */

const fs = require('fs');
const path = require('path');
const ApiHandler = require('../../src/main/services/scorm/rte/api-handler.js');

function now() { return Number(process.hrtime.bigint()) / 1e6; } // ms

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function stats(samples) {
  const min = samples.length ? Math.min(...samples) : 0;
  const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  const p95 = percentile(samples, 95);
  return { min, avg, p95 };
}

function writeArtifact(project, data) {
  const dir = path.join(process.cwd(), 'artifacts', 'perf');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${project}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  // Also write a small txt summary
  const summary = [
    `Project: ${project}`,
    `Samples: ${data.sampleCount}`,
    `Initialize: p95=${data.metrics.Initialize.p95.toFixed(3)}ms avg=${data.metrics.Initialize.avg.toFixed(3)}ms`,
    `GetValue:  p95=${data.metrics.GetValue.p95.toFixed(3)}ms avg=${data.metrics.GetValue.avg.toFixed(3)}ms`,
    `SetValue:  p95=${data.metrics.SetValue.p95.toFixed(3)}ms avg=${data.metrics.SetValue.avg.toFixed(3)}ms`,
    `Commit:    p95=${data.metrics.Commit.p95.toFixed(3)}ms avg=${data.metrics.Commit.avg.toFixed(3)}ms`,
    `Terminate: p95=${data.metrics.Terminate.p95.toFixed(3)}ms avg=${data.metrics.Terminate.avg.toFixed(3)}ms`
  ].join('\n');
  fs.writeFileSync(file.replace(/\.json$/, '.txt'), summary, 'utf8');
}

describe('Perf: RTE API Latency (non-gating)', () => {
  test('sample latency and emit artifacts', () => {
    const iterations = 50;
    const metrics = {
      Initialize: [],
      GetValue: [],
      SetValue: [],
      Commit: [],
      Terminate: []
    };

    for (let i = 0; i < iterations; i++) {
      const api = new ApiHandler();

      let t0 = now();
      api.Initialize('');
      metrics.Initialize.push(now() - t0);

      t0 = now();
      api.GetValue('cmi.completion_status');
      metrics.GetValue.push(now() - t0);

      t0 = now();
      api.SetValue('cmi.location', `loc-${i}`);
      metrics.SetValue.push(now() - t0);

      t0 = now();
      api.Commit('');
      metrics.Commit.push(now() - t0);

      t0 = now();
      api.Terminate('');
      metrics.Terminate.push(now() - t0);
    }

    const computed = {
      Initialize: stats(metrics.Initialize),
      GetValue: stats(metrics.GetValue),
      SetValue: stats(metrics.SetValue),
      Commit: stats(metrics.Commit),
      Terminate: stats(metrics.Terminate)
    };

    writeArtifact('rte-api-latency', {
      sampleCount: iterations,
      metrics: computed,
      budgets: {
        // Non-gating budgets from docs (dev baseline; CI may be +25% tolerance)
        rte_api_p95_ms: 1.0
      },
      note: 'Non-gating perf capture. Review artifacts for trends.'
    });

    // Do not assert on thresholds; the suite is informational by policy.
    expect(Object.keys(computed).length).toBeGreaterThan(0);
  });
});