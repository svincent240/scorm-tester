# Test Fixtures Catalog

Purpose
- Canonical, deterministic, reusable fixtures shared across all layers (unit, contract, integration, scenario, perf).
- No ad-hoc duplicated data in tests. All test data should reference a fixture here.

Directory Structure
- manifests/: SCORM imsmanifest.xml samples by complexity and validity
- packages/: Optional zipped course samples (small, medium); large samples are optional downloads
- activity-trees/: Deterministic trees for SN contract and perf
- data-model/: Canonical cmi.* baselines and invalid write catalogs

Provenance and Intent
- Each fixture folder includes notes on the SCORM features exercised and the intended test contracts.
- Sizes are kept minimal for determinism and speed. Larger samples are optional and tests must gracefully skip when missing.

Usage
- Import using relative paths from tests. Do not inline JSON/XML in test files if the same data exists here.
- Treat these fixtures as read-only. If a test needs to mutate data, copy to a temp directory via helpers in tests/setup.js.

Notes
- Renderer tests must not rely on real windows. Utilize services and state/intent flows only.
- Logging in tests must go through the shared logger test sink helpers defined in tests/setup.js.