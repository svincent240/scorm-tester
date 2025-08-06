# Testing Migration — Relocation Mapping Plan (Non-Breaking)

Scope
- Define how existing tests will be mapped into the layered structure without modifying production code to satisfy tests.
- Keep CI green: migrate incrementally, run both legacy and new layers until completion.
- Remove deep imports; rely on public entrypoints.
- Preserve behavior; do not weaken core assertions to pass.

Reference
- Strategy: [guides/testing-migration-and-fixtures.md](testing-migration-and-fixtures.md:1)
- Architecture: [../architecture/testing-architecture.md](../architecture/testing-architecture.md:1)
- Contracts: [../modules/scorm-engine.testing-contracts.md](../modules/scorm-engine.testing-contracts.md:1)

Target Structure
- tests/
  - unit/
  - contract/      (created)
  - integration/
  - scenario/
  - perf/          (created)
  - fixtures/      (created)

Public Entrypoints
- RTE: [src/main/services/scorm/rte/api-handler.js](../../src/main/services/scorm/rte/api-handler.js:1)
- CAM: [src/main/services/scorm/cam/index.js](../../src/main/services/scorm/cam/index.js:1)
- SN:  [src/main/services/scorm/sn/index.js](../../src/main/services/scorm/sn/index.js:1)
- Renderer (service-level only in integration/scenario): [src/renderer/services/app-manager.js](../../src/renderer/services/app-manager.js:1)

Relocation Map (Phase 1)
1) Integration tests
   - tests/integration/cam-workflow.test.js → keep in integration/ (no change)
   - tests/integration/sn-workflow.test.js → keep in integration/ (no change)
   - tests/integration/renderer-integration.test.js → keep in integration/ (no change)
   - tests/integration/scorm-workflow.test.js → keep in integration/
   - tests/integration/scorm-compliance.test.js → keep in integration/
   - tests/integration/error-handling.test.js → keep in integration/
   - tests/integration/phase-integration.test.js → keep in integration/
   - tests/integration/phase4-integration.test.js → keep in integration/
   - tests/integration/performance-benchmark.test.js → migrate content into perf/ or deprecate overlap; keep file for now but skip duplicate measures if present

2) Unit tests
   - tests/unit/scorm/api-handler.test.js → stays in unit/ (RTE isolated logic)
   - tests/unit/scorm/cam/manifest-parser.test.js → stays in unit/ (CAM isolated logic)
   - tests/unit/scorm/sn/activity-tree.test.js → stays in unit/ (SN tree mechanics)

3) Contract tests (newly added)
   - tests/contract/rte-data-model/rte-data-model.contract.test.js (added)
   - tests/contract/cam-validator/cam-validator.contract.test.js (added)
   - tests/contract/sn-navigation/sn-navigation.contract.test.js (added)

4) Perf tests (non-gating) (newly added)
   - tests/perf/rte-api-latency.test.js (added)
   - Add sn-rule-eval later; leave current integration/performance-benchmark.test.js in place temporarily

Rules for Relocation and Cleanup
- Do not break existing imports; when moving files, update imports to public entrypoints only.
- Replace any deep imports (into private module files) with contract-level assertions via public API.
- Renderer tests must not use console.*; use logger sink helpers from tests/setup.js.
- For temporarily overlapping coverage (e.g., perf), mark the legacy test as redundant with a comment and migrate gradually.

Planned Moves (Phase 2)
- Identify any integration tests that actually assert contract invariants; split into contract where appropriate.
- Identify unit tests that rely on implementation internals; refactor to test through public API when feasible, else keep as unit.

Specific File Actions
- tests/integration/performance-benchmark.test.js
  - Status: Overlaps with new perf suite.
  - Action: Retain for now; annotate with comment to migrate metrics into perf/*. Non-gating.
- tests/integration/renderer-integration.test.js
  - Ensure it uses service-level entry points and avoids real windows.
  - Verify logging assertions route through shared logger, not console.

Non-Goals
- No production code changes to satisfy tests.
- No weakening of core behavioral assertions.

Exit Criteria for Relocation Phase
- No deep imports in tests.
- Contract suites cover RTE↔DataModel, CAM↔Validator, SN↔Navigation using fixtures.
- Perf artifacts written to artifacts/perf with budgets noted (non-gating).
- CI runs test:all for layered suites; legacy commands remain operational during transition.

Implementation Checklist
- [x] Fixtures scaffold added (manifests, activity-trees, data-model)
- [x] Setup utils: RNG, temp dir, logger sink, fake timers
- [x] Contract suites: RTE, CAM, SN
- [x] Perf suite: RTE API latency
- [ ] Annotate legacy perf benchmark with migration note
- [ ] Audit tests for deep imports; replace with public entrypoints
- [ ] If any renderer console usage appears in tests, re-route to logger sink