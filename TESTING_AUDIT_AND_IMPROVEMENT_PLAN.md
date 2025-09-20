# Testing Audit and Improvement Plan

This document provides a comprehensive audit of the current testing landscape for the SCORM Tester application and outlines a strategic plan for its improvement. The audit is based on a review of the project's test files, source code, and key architectural documents as of September 2025.

## Part 1: Current Testing Status (The Audit)

### 1.1. Overview & Tooling
The project employs a sophisticated and modern testing stack:
- **Test Runner & Framework:** Jest is used for unit, contract, integration, and performance testing.
- **E2E Testing:** Playwright is used for end-to-end testing with real Electron instances.
- **Configuration:** The `package.json` file contains a well-structured and granular set of test scripts (e.g., `test:unit`, `test:integration`, `test:e2e`), which is excellent practice.

### 1.2. Test Structure & Organization
The test directory structure aligns well with the layered model defined in `legacy_dev_docs/guides/testing-strategy.md`, with distinct folders for `unit`, `contract`, `integration`, `perf`, and `e2e` tests. This indicates a strong architectural vision for testing.

A minor area for improvement is the organization within `tests/unit`, which could be further structured by application module (RTE, CAM, SN) to more precisely mirror the application's architecture.

### 1.3. Analysis of Test Layers
- **Unit Tests:** There is extensive unit test coverage, especially for the MCP and core SCORM services. This provides a strong foundation for catching module-specific bugs.
- **Contract Tests:** The presence of a `tests/contract` directory is a sign of a mature testing strategy. These tests are crucial for maintaining architectural integrity by verifying the "contracts" between modules.
- **Integration Tests:** A solid suite of integration tests exists, covering key cross-module workflows for CAM, SN, and the renderer.
- **Performance Tests:** The `tests/perf` directory shows a forward-thinking approach, with tests already in place for API latency and sequencing rule evaluation.
- **E2E Tests:** The `e2e` directory and `playwright.config.ts` confirm a functional E2E setup. The use of a `ConsoleMonitor` helper for robust error checking in E2E tests is a particularly strong and commendable practice.

### 1.4. Obsolete Tests
The `APP_REFACTOR_PLAN.md` outlines significant architectural changes. Based on this plan, the following test areas are or will become obsolete:
- **Main Process IPC Rate-Limiting:** The plan involves removing rate-limiting logic from the main process `IpcHandler`. Any tests that specifically validate this server-side throttling are no longer necessary.
- **Legacy Path Handling:** The `legacy_dev_docs/archive/path-handling-simplification-plan.md` details a major refactor of file and path logic. Tests written for the older, more complex system are likely redundant.

### 1.5. Gaps in Test Coverage
- **Refactoring Plan Mandates:** The `APP_REFACTOR_PLAN.md` explicitly calls for several new tests to validate the refactoring effort, which appear to be missing:
    - `tests/integration/ipc-stress.test.js`: To verify the new client-side IPC management strategy.
    - `tests/security/path.test.js`: To audit `FileManager` and `PathUtils` against path traversal vulnerabilities.
    - `tests/integration/course-outline.test.js`: To ensure the UI correctly enforces authoritative state from the main process.
    - `tests/integration/mcp-purity.test.js`: To harden the AI-facing MCP interface by ensuring `stdout` contains only pure JSON-RPC.
- **Architectural Principles:** There are opportunities to add tests that explicitly verify the core principles defined in the specification documents. For example, dedicated tests that attempt to violate the "Fail-Fast" and "No Fallbacks" rules (`CORE_APP_SPEC.md`) or the "Pure Consumer of State" principle (`GUI_APP_SPEC.md`) would further harden the architecture.

---

## Part 2: Proposed Improvement Plan

This plan is designed to be executed in phases, moving from cleanup and alignment to filling critical gaps and finally evolving the E2E strategy.

### 2.1. Phase 1: Cleanup and Realignment (Low Effort, High Impact)
- **Action:** Systematically identify and delete obsolete tests, starting with those related to the server-side IPC rate-limiter and legacy path handling.
- **Action:** Reorganize the `tests/unit` directory. Create subdirectories for `rte`, `cam`, and `sn` and move existing unit tests into the appropriate module directory, as envisioned in `testing-strategy.md`.
- **Justification:** This phase aligns the test suite with the current and future architecture, reduces maintenance overhead, and improves developer clarity.

### 2.2. Phase 2: Fill Critical Test Gaps (Medium Effort)
- **Action:** Implement the four new integration and security tests mandated by the `APP_REFACTOR_PLAN.md`. These are critical for validating the success of the refactoring effort.
- **Action:** Create new contract tests that explicitly attempt to violate the core architectural principles (e.g., "Fail-Fast," "No Fallbacks") to ensure they are properly enforced by the system.
- **Justification:** These tests will provide high confidence that the refactoring is successful and that the application's foundational architectural rules are robust and resilient.

### 2.3. Phase 3: Evolve E2E Testing with MCP (High Value)
Your `MCP_APP_SPEC.md` provides a powerful, built-in interface for deep application testing. This can be leveraged to create a new, highly effective E2E testing suite that complements Playwright.

- **Action:** Develop a new E2E test suite that drives the application by executing `npm run mcp` and communicating with it via its JSON-RPC interface.
- **Visual Regression Testing:** Use the `scorm_take_screenshot` tool. Test scenarios can be executed, followed by an MCP call to capture a screenshot, which is then compared against a baseline image to automatically detect visual regressions in the UI.
- **Complex Scenario & Data Validation:** Use tools like `scorm_test_api_integration` and `scorm_test_navigation_flow` to programmatically execute complex SCORM interactions. This allows for deep validation of the SCORM engine's state, which is very difficult to achieve with UI-driven tools alone.
- **Hybrid Testing:** A single test could use Playwright to perform a UI action (e.g., click a button) and then use an MCP call to verify the deep internal state of the application, providing the best of both worlds.
- **Justification:** This approach leverages the unique capabilities of your application to create a world-class E2E testing environment. It enables a level of validation that goes far beyond what UI-only testing can achieve.

### 2.4. Phase 4: Mature the Testing Process
- **Action:** Implement and enforce the code coverage thresholds defined in `legacy_dev_docs/guides/testing-strategy.md` (e.g., 80% global coverage) within the CI pipeline to prevent regressions.
- **Action:** Integrate the performance tests from `tests/perf` into the CI pipeline. Initially, have them report trends without failing the build. Flag any significant regressions for review.
- **Justification:** This phase matures your development process, making it more resilient to regressions in both code quality and performance.
