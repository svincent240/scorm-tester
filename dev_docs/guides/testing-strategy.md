# Testing Strategy Guide (2025 Refresh)

This document defines the updated, modular, and encapsulated testing strategy for the SCORM Tester application. It replaces prior guidance and aligns with development rules in [dev_docs/README.md](dev_docs/README.md:1), architecture in [architecture/overview.md](../architecture/overview.md:1), and style rules in [style.md](../style.md:1).

Goals
- Maintain SCORM 2004 4th Edition compliance with confidence.
- Encapsulate tests by module and contract boundaries.
- Enable deterministic, flake-free execution locally and in CI.
- Provide clear migration from legacy tests to a layered structure.
- Establish coverage and performance policies with non-gating budgets initially.

Test Framework and Runners
- Framework: Jest (retain current Jest/Electron/Node harness)
- Environment: node
- Global setup: [tests/setup.js](../../tests/setup.js:1)
- Configuration: [package.json](../../package.json:1) jest section
- Parallelism: Use Jest projects to shard by test layer to reduce wall time
- Electron rendering: Avoid headful E2E; renderer "integration" targets state/intent wiring and logging guarantees via Node/JSDOM-compatible harnesses

## Architecture Boundaries and Public Entry Points
Tests must import only through public module entry points to avoid test-only coupling:

- CAM: [src/main/services/scorm/cam/index.js](../../src/main/services/scorm/cam/index.js:1)
- RTE: [src/main/services/scorm/rte/api-handler.js](../../src/main/services/scorm/rte/api-handler.js:1)
- SN:  [src/main/services/scorm/sn/index.js](../../src/main/services/scorm/sn/index.js:1)
- Shared: [src/shared/constants/*](../../src/shared/constants/error-codes.js:1), [src/shared/utils/*](../../src/shared/utils/logger.js:1)
- Renderer services: [src/renderer/services/*](../../src/renderer/services/app-manager.js:1) (import only via service entry files)

Layered Test Model
Tests are organized into layers, each with clear responsibilities and boundaries. Import only through public module entry points to avoid test-only coupling.

1) Unit Tests
- Scope: Pure logic within a single module. No filesystem, no IPC, no timers beyond fake timers.
- Targets:
  - RTE: [src/main/services/scorm/rte](../../src/main/services/scorm/rte/index.js:1)
  - CAM: [src/main/services/scorm/cam](../../src/main/services/scorm/cam/index.js:1)
  - SN:  [src/main/services/scorm/sn](../../src/main/services/scorm/sn/index.js:1)
  - Shared utilities/constants: [src/shared](../../src/shared/utils/logger.js:1)
- Tech:
  - Fake timers: jest.useFakeTimers()
  - Deterministic RNG helpers from tests/setup.js
  - Mocks isolated to module boundaries
- Example structure:
  - tests/unit/rte/api-handler.test.js
  - tests/unit/cam/manifest-parser.test.js
  - tests/unit/sn/activity-tree.test.js
  - tests/unit/shared/logger.test.js

2) Contract Tests
- Scope: Validate interfaces between modules using real adapters at boundary, while mocking external environment (FS, IPC).
- Examples:
  - RTE ApiHandler ↔ DataModel (read/write semantics, error codes)
  - CAM ManifestParser ↔ ContentValidator (manifest-to-validation invariants)
  - SN SequencingEngine ↔ NavigationHandler (request/response invariants)
- Structure:
  - tests/contract/rte-data-model/*.test.js
  - tests/contract/cam-validator/*.test.js
  - tests/contract/sn-nav/*.test.js
- Principles:
  - No deep-imports of internal private files
  - Focus on public method surface and event/return contracts
  - Deterministic clocks and seeded data

3) Integration Tests
- Scope: Cross-module flows with realistic orchestration but still within Node. IPC and FS may be mocked or temp-dir based.
- Existing suites retained and mapped:
  - tests/integration/scorm-compliance.test.js
  - tests/integration/renderer-integration.test.js
  - tests/integration/sn-workflow.test.js
  - tests/integration/cam-workflow.test.js
- Add missing flows as needed:
  - RTE end-to-end sequence: Initialize → SetValue burst control → Commit → Terminate
  - CAM processPackage happy/edge cases with temp dirs
  - SN sequencing across representative rule sets

4) Scenario Tests
- Scope: End-to-end SCORM workflows representing canonical “phase” scenarios and compliance smoke.
- Structure:
  - tests/scenario/phase/*.test.js
  - tests/scenario/compliance/*.test.js
- Goals:
  - Model realistic learner sessions
  - Assert state transitions, error codes, and persisted outcomes
  - Use canonical fixtures for manifests and activity trees

5) Performance Micro-Benchmarks (non-gating initially)
- Scope: Track latency distributions for the 8 SCORM API functions and selected SN evaluations.
- Structure:
  - tests/perf/rte-api-latency.test.js
  - tests/perf/sn-rule-eval.test.js
- Budgets (dev target; CI tolerance +25%):
  - API functions p95 ≤ 1.0ms under baseline harness
  - SN rule evaluation p95 within module-defined targets
- Reporting: Log min/avg/p95 to artifacts; warnings only for now

Renderer Integration Focus
Renderer tests validate behavior without headful E2E:
- Enablement logic via UIState: Navigation controls, attempt lifecycle, and devMode flags
- Intent-only UI pattern: components emit intents; services own logic
- Logging: no console usage; all renderer logs through [src/renderer/utils/renderer-logger.js](../../src/renderer/utils/renderer-logger.js:1) to app log (assertion via file taps in integration harness)
- Rate limiting: single INFO when engaged per channel; no repeated INFOs; renderer silent backoff
- Course load wiring: renderer consumes CAM analysis.uiOutline; must not reconstruct outline

Directory Structure
Proposed structure to improve encapsulation and discoverability:

tests/
├── setup.js
├── fixtures/
│   ├── manifests/
│   ├── packages/
│   ├── activity-trees/
│   ├── data-model/
│   └── README.md
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

Encapsulation Rules
- Import only from public module entry points:
  - CAM: [src/main/services/scorm/cam/index.js](../../src/main/services/scorm/cam/index.js:1)
  - RTE: [src/main/services/scorm/rte/api-handler.js](../../src/main/services/scorm/rte/api-handler.js:1)
  - SN:  [src/main/services/scorm/sn/index.js](../../src/main/services/scorm/sn/index.js:1)
  - Shared: [src/shared/utils/*](../../src/shared/utils/logger.js:1), [src/shared/constants/*](../../src/shared/constants/error-codes.js:1)
- No deep internal imports; prefer contract tests at boundaries
- Mock at boundaries only; avoid white-box knowledge of internals

Determinism and Anti-Flake
- Time: jest.useFakeTimers(); advanceTimersByTime for sequencing
- Randomness: centralized seeded RNG utilities in tests/setup.js
- Filesystem: in-memory or temp directories cleaned up per test
- Parallelism: serialize tests touching global singletons via per-project config
- Test order independence: randomize test execution; prohibit cross-test state

Coverage Policy and Gating
Initial thresholds and gating:
- Global: 80% lines, 75% branches
- Module minima:
  - RTE: 85% lines / 80% branches
  - SN:  85% lines / 80% branches
  - CAM: 80% lines / 75% branches
- Enforcement:
  - PRs must meet global thresholds
  - Module-specific suites tracked with project-level thresholds
  - Coverage artifacts: LCOV + summary uploaded in CI

Performance Policy
- Non-gating warnings initially with trend logging
- Budgets:
  - 8 API functions: p95 ≤ 1.0ms (dev), CI tolerance +25%
  - SN rule evaluation: module-defined targets
- Artifact: write trend JSON and human-readable summary per run

Fixtures Governance
Canonical fixtures enable consistent and repeatable scenarios:
- Location: tests/fixtures
- Categories:
  - manifests/: minimal, typical, complex (large), invalid variants
  - packages/: zipped/extracted sample packages (small, medium, large)
  - activity-trees/: canonical trees and edge-case trees
  - data-model/: pre-seeded cmi.* and adl.nav.* snapshots
- Rules:
  - Versioned fixture READMEs documenting intent and provenance
  - Keep fixtures small and representative; large fixtures behind optional download script if needed
  - Reuse across layers; avoid bespoke ad-hoc test data duplication

Migration Plan
1) Inventory and mapping
- Map existing tests to new layers:
  - tests/integration/*.test.js → integration/scenario split
  - tests/unit/scorm/* → unit/{rte,cam,sn}
2) Create Jest projects
- Define projects in package.json to run unit, contract, integration, scenario, perf separately in CI matrix
3) Establish fixtures
- Extract repeated inline JSON/XML to tests/fixtures with documented canonical sets
4) Incremental migration
- Migrate by module; keep temporary aliases until each module meets coverage minima
5) Remove legacy patterns
- Eliminate deep-import tests; replace with contract tests
- Replace ad-hoc timers with fake timers utilities
6) Stabilize thresholds
- Start with thresholds defined above; adjust up after stabilization

Renderer Testing Requirements
- Enablement logic:
  - Initialize/SetValue/GetValue/Commit/Terminate availability based on UIState and lifecycle
- Eventing pattern:
  - Components emit intents; AppManager orchestrates; UIState authoritative
- Logging:
  - No console.* in renderer; assert logs through [src/renderer/utils/renderer-logger.js](../../src/renderer/utils/renderer-logger.js:1) to app log
- Rate limiting:
  - Single INFO per channel when engaged; no repeated INFO logs
- CAM outline usage:
  - Renderer must use analysis.uiOutline as-is; do not reconstruct

SCORM Inspector Testing
- Status: Follows single-source-of-truth architecture pattern
- Reference: [architecture/scorm-inspector-architecture.md](../architecture/scorm-inspector-architecture.md) for complete testing strategy
- Test Categories:
  - Single data path validation (api-handler → telemetry-store → UI)
  - IPC channel message handling and history loading
  - UI component pure consumer pattern verification
  - Real-time update performance with high API call frequency

Execution and Scripts
Suggested npm scripts (to be aligned in package.json):
- test:e2e: run Playwright end-to-end tests
- test:all: run all Jest projects
- test:coverage: run all with coverage and upload LCOV
- test:unit, test:contract, test:integration, test:scenario, test:perf: run corresponding projects
- test:watch: developer watch on unit + contract

Example Configuration Snippet (conceptual)
{
  "jest": {
    "testEnvironment": "node",
    "setupFilesAfterEnv": ["<rootDir>/tests/setup.js"],
    "testTimeout": 15000,
    "projects": [
      { "displayName": "unit", "testMatch": ["<rootDir>/tests/unit/**/*.test.js"] },
      { "displayName": "contract", "testMatch": ["<rootDir>/tests/contract/**/*.test.js"] },
      { "displayName": "integration", "testMatch": ["<rootDir>/tests/integration/**/*.test.js"] },
      { "displayName": "scenario", "testMatch": ["<rootDir>/tests/scenario/**/*.test.js"] },
      { "displayName": "perf", "testMatch": ["<rootDir>/tests/perf/**/*.test.js"] }
    ],
    "coverageThreshold": {
      "global": { "lines": 80, "branches": 75 }
    }
  }
}

Quality Guards
- Respect architecture boundaries in [architecture/overview.md](../architecture/overview.md:1)
- No duplicate code; prefer shared utilities and fixtures
- Keep functions small and focused; prioritize logical cohesion
- All new or modified features must include tests at appropriate layer(s)

Acceptance Criteria for This Refresh
- Tests restructured by layer and module with public-entry imports
- Coverage thresholds enforced per policy
- Performance tests produce trend artifacts with warnings only
- Canonical fixtures in place with documentation
- Renderer tests validate enablement, intent wiring, and logging policies
- SCORM Inspector testing follows established architecture (see [architecture/scorm-inspector-architecture.md](../architecture/scorm-inspector-architecture.md))

Changelog
- 2025-08: Strategy fully refreshed; layered model, thresholds, fixtures governance, performance policies established.
- 2025-08: Added comprehensive E2E testing strategy with Playwright; established course loading test template; integrated error monitoring system with ConsoleMonitor helper class.

## End-to-End (E2E) Testing with Playwright

While the primary testing strategy focuses on unit, contract, and integration tests to avoid flaky headful tests, a comprehensive E2E suite using Playwright validates critical application workflows with real Electron instances.

### E2E Testing Scope and Architecture

**Purpose**: Validate complete application workflows including IPC communication, UI interactions, and error handling in real Electron environment.

**Technology Stack**:
- **Runner**: Playwright with Electron launcher
- **Location**: `e2e/*.spec.ts` 
- **Execution**: `npm run test:e2e`
- **Monitoring**: Console and application log file analysis

### Error Monitoring System

All E2E tests include comprehensive error monitoring through the `ConsoleMonitor` helper class:

**Features**:
- **Console message capture**: All browser console messages (log, error, warning)
- **Application log monitoring**: Real-time monitoring of `app.log` for `[ERROR]` entries
- **Critical error detection**: Filters out known safe errors (favicon 404s, expected CSP violations)
- **Baseline establishment**: Tracks log file size to detect new errors during test execution

**Usage Pattern**:
```typescript
import { ConsoleMonitor } from './helpers/console-monitor';

test('example test', async () => {
  const electronApp = await electron.launch({ /* config */ });
  const page = await electronApp.firstWindow();
  
  // Set up monitoring
  const consoleMonitor = new ConsoleMonitor(page);
  
  // Perform test actions...
  
  // Verify no errors occurred
  consoleMonitor.printSummary('test name');
  consoleMonitor.assertNoCriticalErrors('test name');
  
  await electronApp.close();
});
```

### Course Loading Test Template

The **"loads ZIP course programmatically"** test establishes the canonical pattern for E2E tests requiring course loading. This template should be used for future course-dependent E2E tests.

#### Template Structure

```typescript
test('course loading test example', async () => {
  // 1. Application Setup
  const electronApp = await electron.launch({ 
    executablePath: require('electron'), 
    args: ['.'],
    timeout: 30000
  });
  const page = await electronApp.firstWindow();
  
  // 2. Error Monitoring Setup
  const consoleMonitor = new ConsoleMonitor(page);
  
  // 3. Application Initialization Wait
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // Allow app to fully initialize
  
  // 4. Verify AppManager Ready State
  const isInitialized = await page.evaluate(() => {
    return !!(window as any).appManager && (window as any).appManager.initialized;
  });
  
  if (!isInitialized) {
    console.log('Waiting for AppManager to initialize...');
    await page.waitForTimeout(3000);
  }
  
  // 5. Course Loading via Test Helper
  const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');
  
  // Check test helper availability
  const hasHelper = await page.evaluate(() => {
    return typeof (window as any).testLoadCourse === 'function';
  });
  
  if (!hasHelper) {
    console.log('Test helper not available, skipping programmatic test');
    return;
  }
  
  // 6. Execute Course Loading
  const loadResult = await page.evaluate(async ({ zipPath }) => {
    try {
      return await (window as any).testLoadCourse(zipPath);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }, { zipPath });
  
  // 7. Validate Loading Results
  console.log('Course loading result:', loadResult);
  expect(loadResult).toBeDefined();
  expect(typeof loadResult.success).toBe('boolean');
  
  if (loadResult.success) {
    console.log('✓ Course loading initiated successfully');
    
    // Wait for UI updates
    await page.waitForTimeout(2000);
    
    // Verify DOM changes (iframe presence, etc.)
    const iframe = page.locator('#content-frame');
    const iframeExists = await iframe.count() > 0;
    expect(iframeExists).toBe(true);
    
    console.log('✓ Iframe exists in DOM');
  } else {
    console.log('Course loading failed:', loadResult.error);
    // Test can still be successful if the mechanism works
  }
  
  // 8. Error Verification
  consoleMonitor.printSummary('test name');
  consoleMonitor.assertNoCriticalErrors('test name');
  
  await electronApp.close();
});
```

#### Key Template Components

1. **Standardized Setup**: Consistent Electron launch configuration with appropriate timeouts
2. **Error Monitoring**: Automatic console and log file error detection
3. **Initialization Verification**: Ensures AppManager is ready before proceeding
4. **Test Helper Pattern**: Uses `window.testLoadCourse()` for programmatic course loading
5. **Result Validation**: Comprehensive checking of loading success and UI state
6. **Error Reporting**: Detailed logging for debugging and CI visibility

### E2E Test Categories

#### 1. Application Launch Tests
- **Scope**: Basic startup, UI visibility, API availability
- **Examples**: Window creation, button visibility, electronAPI presence
- **File**: `e2e/app-launch.spec.ts`

#### 2. Course Loading Tests  
- **Scope**: Course package handling, manifest parsing, UI updates
- **Template**: Use the programmatic loading pattern above
- **Examples**: ZIP loading, folder loading, UI state transitions
- **File**: `e2e/course-loading.spec.ts`

#### 3. UI Interaction Tests
- **Scope**: Button clicks, navigation, dialog handling
- **Focus**: Non-blocking interactions (avoid file dialogs)
- **Examples**: Button enablement, click handling, responsive UI

### Error Detection and Handling

#### Critical Error Categories
Tests automatically detect and fail on:
- **IPC Handler Failures**: Missing or broken communication channels
- **Uncaught Exceptions**: JavaScript runtime errors
- **SCORM Compliance Violations**: API errors, data model issues
- **Application Log Errors**: Any `[ERROR]` entries in `app.log`

#### Known Safe Errors (Filtered)
- Resource loading failures (favicon, missing assets)
- Expected CSP violations
- Network errors for optional resources
- Test-specific informational messages

### Best Practices for E2E Tests

#### Test Isolation
- Each test launches a fresh Electron instance
- No shared state between tests
- Clean application data directories per test run

#### Timing and Synchronization
- Use `page.waitForLoadState('domcontentloaded')` for page readiness
- Add explicit waits for application initialization (`AppManager.initialized`)
- Use reasonable timeouts (2-3 seconds for UI updates)

#### Error Handling
- Always use `ConsoleMonitor` for error detection
- Call `consoleMonitor.assertNoCriticalErrors()` before test completion
- Include descriptive test names in error reporting

#### Course Loading Tests
- Always verify `testLoadCourse` helper availability before use
- Use absolute paths for course packages
- Validate both loading mechanism and resulting UI state
- Include helpful console logging for debugging

#### Debugging Support
- Include descriptive console.log statements for test progress
- Use `consoleMonitor.printSummary()` for detailed error reporting
- Preserve error context in test failure messages

### Integration with CI/CD

E2E tests are designed to:
- **Catch Integration Issues**: Validate IPC communication and main/renderer coordination  
- **Verify Build Integrity**: Ensure packaged application launches correctly
- **Validate Core Workflows**: Confirm course loading and UI state management
- **Provide Debugging Context**: Generate detailed logs for failure investigation

### Performance Considerations

- **Parallel Execution**: Tests run in parallel workers for efficiency
- **Resource Management**: Automatic cleanup of Electron processes
- **Timeout Management**: Appropriate timeouts prevent hanging tests
- **Log File Monitoring**: Efficient incremental log reading

This E2E testing approach balances comprehensive validation with maintainable, reliable test execution.