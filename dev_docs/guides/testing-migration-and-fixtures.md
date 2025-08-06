# Testing Migration, Directory Restructure, and Fixtures Governance

This document provides the actionable migration plan to the refreshed layered testing strategy, the target directory structure, and the canonical fixtures governance. It complements [guides/testing-strategy.md](testing-strategy.md:1), [architecture/testing-architecture.md](../architecture/testing-architecture.md:1), and [guides/testing-ci-policy.md](testing-ci-policy.md:1).

Objectives
- Restructure tests into clear layers and module scopes.
- Migrate existing tests with minimal disruption and no loss of coverage.
- Establish a canonical fixtures catalog with deterministic, reusable assets.
- Document performance budgets and non-gating trend capture.

Target Directory Structure
All tests live under tests/. Layers run as separate Jest “projects” in CI.

tests/
├── setup.js
├── fixtures/
│   ├── README.md
│   ├── manifests/
│   │   ├── minimal/
│   │   ├── typical/
│   │   ├── complex/
│   │   └── invalid/
│   ├── packages/        # small reproducible samples; large are optional downloads
│   ├── activity-trees/
│   └── data-model/
├── unit/
│   ├── rte/
│   ├── cam/
│   ├── sn/
│   └── shared/
├── contract/
│   ├── rte-data-model/
│   ├── cam-validator/
│   └── sn-navigation/
├── integration/
│   ├── rte-integration.test.js
│   ├── cam-workflow.test.js
│   ├── sn-workflow.test.js
│   └── renderer-integration.test.js
├── scenario/
│   ├── phase/
│   └── compliance/
└── perf/
    ├── rte-api-latency.test.js
    └── sn-rule-eval.test.js

Migration Plan

Phase 0 — Preparation
- Create tests/fixtures with README.md and subfolders.
- Add helper utilities to tests/setup.js:
  - Seeded RNG helpers
  - Temp directory helpers
  - Logger test sink helpers
  - Fake timer utilities
- Ensure package.json (to be updated later) supports project selection scripts listed in [testing-ci-policy.md](testing-ci-policy.md:1).

Phase 1 — Mapping and Relocation
- Inventory existing tests:
  - tests/integration/*.test.js
  - tests/unit/scorm/**/* (rte/cam/sn)
- Map each to a target layer:
  - Strict logic → unit
  - Module boundary invariants → contract
  - Multi-module flows → integration
  - Full workflows and compliance smoke → scenario
  - Timed latency probes → perf
- Relocate files accordingly and update imports to use public entry points:
  - RTE: [src/main/services/scorm/rte/api-handler.js](../../src/main/services/scorm/rte/api-handler.js:1)
  - CAM: [src/main/services/scorm/cam/index.js](../../src/main/services/scorm/cam/index.js:1)
  - SN:  [src/main/services/scorm/sn/index.js](../../src/main/services/scorm/sn/index.js:1)
  - Renderer: service-level entry files only in integration/scenario, e.g., [src/renderer/services/app-manager.js](../../src/renderer/services/app-manager.js:1)
- Remove deep imports into private files; replace with contract-level assertions.

Phase 2 — Contract Tests First
- Author missing contract suites per [modules/scorm-engine.testing-contracts.md](../modules/scorm-engine.testing-contracts.md:1):
  - rte-data-model
  - cam-validator
  - sn-navigation
- Use fixtures (below) and fake timers for determinism.

Phase 3 — Integration/Scenario
- Ensure integration tests use temp directories and IPC/logger stubs as per [architecture/testing-architecture.md](../architecture/testing-architecture.md:1).
- Scenario tests represent realistic learner flows (Initialize → SetValue bursts → Commit → Terminate), plus SN navigation paths and CAM outline consumption in renderer.

Phase 4 — Perf (Non-Gating)
- Add perf tests capturing min/avg/p95 for:
  - 8 SCORM API functions
  - SN rule evaluation batches
- Emit JSON artifacts under artifacts/perf; add warnings on budget exceedance.

Phase 5 — Cleanup
- Delete or quarantine legacy tests that can’t be mapped cleanly.
- Raise coverage incrementally to meet thresholds defined in [testing-strategy.md](testing-strategy.md:1).

Fixtures Governance

Principles
- Canonical, deterministic, small where possible.
- Reusable across layers; no duplicated ad-hoc data.
- Document provenance and intent in fixtures/README.md.

Catalog (Initial)
manifests/
- minimal/valid-minimal.xml: smallest valid organization with single SCO
- typical/basic-linear.xml: linear path with few items
- complex/branching-choice.xml: choice + forwardOnly sections
- invalid/missing-resource.xml: references non-existent file (validator error)
- invalid/bad-namespaces.xml: namespace violations (parser error)

packages/
- small/basic-linear.zip: zipped form of typical/basic-linear
- medium/branching-choice.zip: medium-size with multiple resources
- Note: Large samples optional via on-demand script; tests must skip gracefully if missing.

activity-trees/
- linear.json: deterministic linear tree
- branching-choice.json: choice-enabled with hidden-from-choice nodes
- remediation.json: retry/remediation paths
- forward-only.json: no backward navigation allowed

data-model/
- baseline.json: cmi.* defaults on Initialize
- post-lesson.json: representative values after a completed attempt
- invalid-writes.json: cases for SetValue negative tests

Fixtures README Template
For each fixture folder, document:
- Purpose and coverage (which contracts/scenarios it supports)
- SCORM features exercised (e.g., rollup rules used)
- Size and performance notes
- Generation steps or source (if derived)

Performance Budgets and Trend Process

Budgets (non-gating)
- RTE API p95 ≤ 1.0ms (dev baseline), CI tolerance +25%
- SN rule-eval p95 targets per scenario; same tolerance
- Note: Renderer perf is out of scope; focus on logic-level timings

Capture
- Each perf suite writes artifacts/perf/<project>-<timestamp>.json and a human-readable summary .txt.
- CI attaches artifacts and posts warnings if budgets exceeded (see [testing-ci-policy.md](testing-ci-policy.md:1)).

Non-Gating Policy
- Perf regressions produce warnings only.
- After 2+ weeks stable, specific perf checks can graduate to hard gates with agreed tolerances.

Renderer-Specific Migration Notes
- Ensure tests assert:
  - No console.* in renderer; logs through [src/renderer/utils/renderer-logger.js](../../src/renderer/utils/renderer-logger.js:1)
  - Single INFO per channel when rate-limiting engages; no repeated INFOs
  - Renderer consumes CAM’s analysis.uiOutline directly
- Headless: no real windows; exercise modules/services and state/intent flows only.

Debug Window Testing
- Deferred (Future Work). Do not add panel tests until refactor lands. Reference: [dev_docs/debug-window-plan.md](../debug-window-plan.md:1)

Checklist — Migration Progress
- [x] Files relocated into unit/contract/integration/scenario/perf (initial pass)
- [x] All applicable integration imports use public entry points where feasible
  - CAM integration aligned to ScormCAMService by passing manifestContent strings: [tests/integration/cam-workflow.test.js](../../tests/integration/cam-workflow.test.js:1)
- [x] Unit tests that deep-import internals include justification comments
  - [tests/unit/scorm/cam/manifest-parser.test.js](../../tests/unit/scorm/cam/manifest-parser.test.js:1)
  - [tests/unit/scorm/sn/activity-tree.test.js](../../tests/unit/scorm/sn/activity-tree.test.js:1)
- [x] Renderer integration includes TODO to migrate to orchestrator entrypoint
  - [tests/integration/renderer-integration.test.js](../../tests/integration/renderer-integration.test.js:1)
- [ ] Contract suites exist for RTE↔DataModel, CAM↔Validator, SN↔Navigation
- [ ] Perf tests emit trend artifacts; budgets warnings enabled
- [ ] Coverage meets thresholds and CI policy gates are active
- [ ] Document remaining exceptions and rationale

Cross-References
- See [architecture/testing-architecture.md](../architecture/testing-architecture.md:1) for layered testing rules
- See [guides/testing-migration-relocation-plan.md](testing-migration-relocation-plan.md:1) for phase mapping and file moves
- Related public entrypoints:
  - RTE: [api-handler.js](../../src/main/services/scorm/rte/api-handler.js:1)
  - CAM: [index.js](../../src/main/services/scorm/cam/index.js:1)
  - SN: [index.js](../../src/main/services/scorm/sn/index.js:1)
  - Renderer orchestrator: [app-manager.js](../../src/renderer/services/app-manager.js:1)