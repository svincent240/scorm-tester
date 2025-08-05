# Testing CI Policy

This document defines continuous integration (CI) policies for the refreshed testing strategy. It complements [guides/testing-strategy.md](testing-strategy.md:1) and [architecture/testing-architecture.md](../architecture/testing-architecture.md:1). The policy focuses on reliable, deterministic runs, modular sharding, coverage thresholds, performance trend capture, and artifact retention.

Objectives
- Ensure fast, deterministic CI with clear pass/fail signals.
- Enforce baseline coverage thresholds globally and per module.
- Capture performance trends as non-gating warnings initially.
- Provide actionable artifacts for failures and regressions.

Execution Model
Jobs are sharded by Jest “project” layer to reduce wall time and isolate global singletons.

Recommended matrix (conceptual):
- unit
- contract
- integration
- scenario
- perf

Environment
- Node: LTS (align with dev environment)
- OS: Windows-latest and Ubuntu-latest optional; primary should match local contributors (choose one as required to avoid OS-specific flake)
- Caches: node_modules, Jest cache
- Timeout: each job ≤ 15 min; individual test timeouts controlled in Jest config

Coverage Thresholds and Gating
Thresholds must be enforced by Jest coverageThreshold and validated in CI. These numbers align with approved targets.

Global
- Lines ≥ 80%
- Branches ≥ 75%

Module minima (enforced by per-project or per-path thresholds)
- RTE:  lines ≥ 85%, branches ≥ 80%
- SN:   lines ≥ 85%, branches ≥ 80%
- CAM:  lines ≥ 80%, branches ≥ 75%

Implementation approaches
- Jest projects with per-project coverageThreshold
- Or path-based thresholds via coverageReporters plus a post-check script

Artifacts
Always upload the following on every CI run:
- Coverage:
  - LCOV: coverage/lcov.info
  - Summary: coverage/coverage-summary.json
- JUnit/XML: test-results/**/*.xml (if configured)
- Performance trends (perf project only):
  - artifacts/perf/*.json
  - artifacts/perf/*.txt (human-readable summary)
- Logs for failures:
  - Captured app log taps (if applicable in integration runs)
  - Jest failure outputs

Performance Policy (Non-Gating Initially)
Budgets
- RTE 8 API functions: p95 ≤ 1.0ms (developer baseline); CI tolerance +25%
- SN rule evaluation: module-defined targets, CI tolerance +25%

Behavior
- Exceeding budget produces warnings and attaches perf trend artifacts.
- Builds do not fail on perf regressions initially.
- After stabilization, promote specific budget classes to hard gates with agreed tolerances.

Retry/Flake Policy
- Allow a single automatic job retry for known flaky layers (initially integration or scenario).
- Track flake counts per test and surface a flake report:
  - A flake is defined as a failure followed by a pass on immediate re-run without changes.
- Flakes older than N weeks must be resolved or quarantined (move to a quarantine project that is non-gating and labeled).

Quarantine Flow
- Temporarily move flaky tests to tests/_quarantine/<layer>/...
- Quarantine suite runs in CI but is non-gating.
- Issue must be opened and linked; SLA to remove from quarantine.

Log and Rate-Limit Assertions
Renderer integration tests must assert:
- Exactly one INFO log line when a channel first engages rate limiting.
- No console.* calls appear in captured logs.
- Use test sink files/buffers to assert behavior deterministically.

Parallelism and Isolation
- unit and contract: run with default Jest parallelism
- integration and scenario: may use reduced maxWorkers and/or runInBand if global state is unavoidable
- perf: run isolated to avoid noisy neighbors affecting measurements

Example NPM Scripts (conceptual)
Add to package.json to align local and CI invocations:

"scripts": {
  "test": "jest --projects unit contract integration scenario perf",
  "test:coverage": "jest --coverage --projects unit contract integration scenario",
  "test:unit": "jest --selectProjects unit",
  "test:contract": "jest --selectProjects contract",
  "test:integration": "jest --selectProjects integration",
  "test:scenario": "jest --selectProjects scenario",
  "test:perf": "jest --selectProjects perf",
  "test:ci": "npm run test:coverage && npm run test:perf"
}

Example Jest Projects (conceptual)
{
  "jest": {
    "testEnvironment": "node",
    "setupFilesAfterEnv": ["<rootDir>/tests/setup.js"],
    "projects": [
      {
        "displayName": "unit",
        "testMatch": ["<rootDir>/tests/unit/**/*.test.js"],
        "coverageThreshold": { "global": { "lines": 80, "branches": 75 } }
      },
      {
        "displayName": "contract",
        "testMatch": ["<rootDir>/tests/contract/**/*.test.js"],
        "coverageThreshold": { "global": { "lines": 80, "branches": 75 } }
      },
      {
        "displayName": "integration",
        "testMatch": ["<rootDir>/tests/integration/**/*.test.js"],
        "coverageThreshold": { "global": { "lines": 80, "branches": 75 } }
      },
      {
        "displayName": "scenario",
        "testMatch": ["<rootDir>/tests/scenario/**/*.test.js"],
        "coverageThreshold": { "global": { "lines": 80, "branches": 75 } }
      },
      {
        "displayName": "perf",
        "testMatch": ["<rootDir>/tests/perf/**/*.test.js"],
        "collectCoverage": false
      }
    ],
    "coverageReporters": ["json-summary", "lcov", "text"]
  }
}

Reporting
- Display per-project summaries in CI logs.
- Attach trend graphs or JSON to PR checks as artifacts.
- Consider PR comments that post coverage deltas and perf p95 deltas vs. main.

Security and Resource Use
- No external network during tests unless explicitly mocked or using recorded fixtures.
- Temp directories must be cleaned up to prevent disk pressure.
- Large fixtures are optional downloads guarded by a flag; tests skip gracefully if missing.

Governance and Evolution
- Threshold updates require approval and must include rationale and recent trend snapshots.
- Performance budgets can graduate to hard gates after a minimum of 2 green weeks and low variance.
- Any new module must define:
  - Public entry point(s)
  - Contract surfaces and associated tests
  - Coverage expectations
  - Performance expectations (if latency-sensitive)

Future Work
- Integrate perf trend comparison against a persisted baseline store.
- Add flaky-test detector to auto-quarantine after repeated failures.
- Consider lightweight visual regression only for non-renderer UI (if applicable), still avoiding headful browser.

References
- Strategy: [guides/testing-strategy.md](testing-strategy.md:1)
- Architecture: [../architecture/testing-architecture.md](../architecture/testing-architecture.md:1)
- Style and renderer rules: [../style.md](../style.md:42)