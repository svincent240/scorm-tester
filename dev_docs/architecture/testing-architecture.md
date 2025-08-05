# Testing Architecture

Authoritative reference for how tests interact with the SCORM Tester architecture. Complements [architecture/overview.md](overview.md:1) and the refreshed strategy in [guides/testing-strategy.md](../guides/testing-strategy.md:1). This document defines boundaries, seams, adapters, harness patterns, and anti-flake rules to ensure encapsulated, modular tests.

Objectives
- Make module seams explicit (CAM, RTE, SN, Renderer).
- Provide stable test adapters for contracts without deep-imports.
- Standardize deterministic, fast, and isolated execution.
- Support CI sharding and reproducible performance trend capture.

Architecture Boundaries and Public Entry Points
Strictly import through public module entry points; tests must not deep-import internal private files.

- CAM: [src/main/services/scorm/cam/index.js](../../src/main/services/scorm/cam/index.js:1)
- RTE: [src/main/services/scorm/rte/api-handler.js](../../src/main/services/scorm/rte/api-handler.js:1)
- SN:  [src/main/services/scorm/sn/index.js](../../src/main/services/scorm/sn/index.js:1)
- Shared: [src/shared/constants/*](../../src/shared/constants/error-codes.js:1), [src/shared/utils/*](../../src/shared/utils/logger.js:1)
- Renderer services: [src/renderer/services/*](../../src/renderer/services/app-manager.js:1) (import only via service entry files in integration/scenario tests)

Contract Surfaces
Contract tests validate inter-module interfaces using real adapters at the boundary.

RTE ↔ DataModel
- Surface: ScormApiHandler public methods (Initialize, GetValue, SetValue, Commit, Terminate, GetLastError, GetErrorString, GetDiagnostic)
- Guarantees:
  - DataModel validation of cmi.* per [src/shared/constants/data-model-schema.js](../../src/shared/constants/data-model-schema.js:1)
  - Error codes from [src/shared/constants/error-codes.js](../../src/shared/constants/error-codes.js:1)
  - Lifecycle: not_initialized → running → terminated
- Contract Tests: tests/contract/rte-data-model/*.test.js

CAM ↔ Validator
- Surface: parseManifest → content-validation invariants
- Guarantees:
  - Valid manifests produce deterministic organization/resource maps
  - Validation reports classify errors/warnings consistently
- Contract Tests: tests/contract/cam-validator/*.test.js

SN ↔ Navigation
- Surface: SequencingEngine and NavigationHandler public methods
- Guarantees:
  - Requests map to deterministic results given activity state
  - Rule evaluation outcomes stable under fixed clock/seed
- Contract Tests: tests/contract/sn-navigation/*.test.js

Renderer ↔ Main (IPC)
- Surface: IPC channels used by renderer services (scorm:*, renderer-log-*)
- Guarantees:
  - Rate limiting: first engagement logs one INFO per channel; subsequent rate-limited calls produce no further logs
  - Renderer never uses console.*; logs route through [src/renderer/utils/renderer-logger.js](../../src/renderer/utils/renderer-logger.js:1)
- Checked via integration harness with controlled app.log taps.

Testing Harness Design

Time and Determinism
- Use jest.useFakeTimers(); drive logical time via advanceTimersByTime.
- Avoid real setTimeout/setInterval in tests; all timers under fake clock.
- Seeded RNG in [tests/setup.js](../../tests/setup.js:1) with helpers.

Filesystem
- Unit/contract: in-memory stubs or memfs equivalents.
- Integration/scenario: OS temp directories via helper utils; cleanup in afterEach/afterAll.
- No writes outside controlled tmp roots; path joins audited through [src/shared/utils/path-utils.js](../../src/shared/utils/path-utils.js:1) when used.

IPC and Process Adapters
- Never launch real Electron windows for tests.
- Provide lightweight IPC stubs at the boundary with predictable semantics:
  - invoke(channel, payload) → Promise<Result> with rate-limited logs simulated in main stub
  - on/off handlers tracked per test for leak detection
- Renderer-side code exercised as plain modules where possible, focusing on state/intent flows.

Logging Adapter
- All renderer logs go through [src/renderer/utils/renderer-logger.js](../../src/renderer/utils/renderer-logger.js:1) and [src/shared/utils/logger.js](../../src/shared/utils/logger.js:1).
- Test harness captures emitted log lines to a test sink file (under tmp) or in-memory buffer to assert:
  - Single INFO per channel when rate-limit engages
  - No console.* usage in renderer

Project Sharding and Isolation
Jest projects split by layer for parallel CI execution:
- unit, contract, integration, scenario, perf
- Global singletons (if any) are isolated by project boundaries; tests requiring serialization run in a dedicated project or use maxWorkers=1 for that project.

Anti-Flake Playbook
- No reliance on arbitrary sleeps; drive fake timers explicitly.
- Event-driven flows assert via microtask drains:
  - await jest.runAllTimersAsync() or synthetic flushMicrotasks()
- Stable snapshots: prefer explicit assertions over broad snapshots that are sensitive to formatting.
- Random inputs: use seeded generators; include seed in failure output.

Fixtures Strategy
Canonical fixtures live under tests/fixtures with README catalog and provenance:
- manifests/: tiny, typical, complex, invalid variants
- packages/: zipped/extracted small–large samples (optional large via on-demand download)
- activity-trees/: prepared canonical trees and edge cases
- data-model/: cmi.* and adl.nav.* snapshots for baseline states
Rules:
- Reuse across layers; do not duplicate fixtures per test
- Keep deterministic; avoid date/time within fixture payloads
- When compressing packages, document exact tool/version used

Coverage and Performance Instrumentation
Coverage
- Enforced thresholds (see [guides/testing-strategy.md](../guides/testing-strategy.md:1)):
  - Global: 80% lines / 75% branches
  - RTE/SN: 85% lines / 80% branches
  - CAM: 80% lines / 75% branches
- Module minima checked via per-project coverageThreshold.

Performance
- Non-gating benchmarks with trend artifacts (JSON + human-readable):
  - 8 RTE API functions p95 ≤ 1.0ms (dev); CI tolerance +25%
  - SN rule-eval p95 targets defined in perf tests
- Output location: artifacts/perf/<project>-<date>.json
- Warnings logged when budgets exceeded; CI does not fail initially.

Renderer-Specific Testing Rules
- State authority: assert UIState drives enablement; components emit intents only.
- No console.*: verify absence and presence of logger routing.
- Rate-limit behavior: verify single INFO per channel upon first engagement.
- CAM outline usage: assert renderer consumes analysis.uiOutline from CAM; renderer must not reconstruct outline.

CI Execution Model (Conceptual)
- Matrix strategy: one job per Jest project (unit, contract, integration, scenario, perf)
- Artifacts: LCOV, JUnit, perf trends, failing logs bundle
- Retry policy: allow 1 re-run of flaked job, but track flake count and surface to maintainers

Migration Guidance
- Replace deep-import tests with contract tests at public boundaries.
- Move bespoke inline manifest/XML into fixtures.
- Convert ad-hoc wall-clock waits into fake timers and microtask flushes.
- Group integration tests by vertical flow (RTE, CAM, SN, renderer) with temp resources per test file.
- Raise thresholds gradually after stabilization.

Future Work
- Debug Window testing deferred until post-refactor; see [dev_docs/debug-window-plan.md](../debug-window-plan.md:1) for intended panels and signals.
- Consider adopting a lightweight DOM harness for selective renderer view-model assertions if needed, while keeping headless.

Checklists

Unit Checklist
- [ ] Imports through public entry point
- [ ] Fake timers used; no real time
- [ ] No filesystem/network/IPC
- [ ] Deterministic seed used for randomness
- [ ] Both success and failure paths asserted
- [ ] Error codes validated via shared constants

Contract Checklist
- [ ] Real adapters at boundary; mocks external environment only
- [ ] Invariants asserted (types, error codes, lifecycle)
- [ ] No deep-import access to private internals

Integration/Scenario Checklist
- [ ] Temp filesystem only; cleaned up
- [ ] IPC/Logger adapters plugged
- [ ] Coverage of happy path and edge conditions
- [ ] Renderer logging and rate-limit rules asserted (where applicable)

Perf Checklist
- [ ] Warm-up excluded from measurements
- [ ] min/avg/p95 captured and logged
- [ ] Trend JSON emitted; budgets compared with non-gating warnings

References
- Architecture overview: [architecture/overview.md](overview.md:1)
- Style and renderer rules: [style.md](../style.md:42)
- SCORM data model: [src/shared/constants/data-model-schema.js](../../src/shared/constants/data-model-schema.js:1)
- SCORM error codes: [src/shared/constants/error-codes.js](../../src/shared/constants/error-codes.js:1)