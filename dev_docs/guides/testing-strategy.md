# Testing Strategy Guide

## Overview

This document outlines the comprehensive testing strategy for the SCORM Tester application, ensuring SCORM 2004 4th Edition compliance and robust functionality across all components.

## Testing Framework

### Primary Framework: Jest
- **Framework**: Jest 29.5.0 with Node.js environment
- **Setup**: Global test setup in [`tests/setup.js`](../../tests/setup.js)
- **Configuration**: Defined in [`package.json`](../../package.json) jest section
- **Coverage**: 80% minimum threshold for branches, functions, lines, and statements

### Test Environment Configuration
```javascript
{
  "testEnvironment": "node",
  "setupFilesAfterEnv": ["<rootDir>/tests/setup.js"],
  "testTimeout": 10000,
  "coverageThreshold": {
    "global": {
      "branches": 80,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  }
}
```

## Test Structure

### Directory Organization
```
tests/
├── setup.js                    # Global test setup and utilities
├── fixtures/                   # Test data and mock files
├── unit/                       # Unit tests
│   └── scorm/                  # SCORM-specific unit tests
│       ├── api-handler.test.js
│       ├── cam/
│       └── sn/
└── integration/                # Integration tests
    ├── phase4-integration.test.js
    ├── cam-workflow.test.js
    ├── scorm-workflow.test.js
    └── sn-workflow.test.js
```

### Test Categories

### Renderer Integration Scenarios

The renderer must validate the quick local test workflow. Add or maintain integration tests that verify:

1. Initialization error handling
   - On startup failure, a persistent notification is shown
   - No inline error HTML is injected
   - Logs are written via the centralized renderer logger
   - Events: eventBus emits app:error
   - References: [src/renderer/app.js](src/renderer/app.js:31), [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:349)

2. Course load workflow
   - Course load success updates ContentViewer and CourseOutline
   - ContentViewer loads the entry URL and begins API verification
   - UIState course and structure state are updated and events emitted
   - Renderer consumes CAM-provided analysis.uiOutline and renders CourseOutline; renderer MUST NOT reconstruct outline from raw manifest

3. Navigation buttons state
   - Buttons enable/disable based on normalized UIState.navigationState
   - EventBus debug traces are off by default and toggle via UIState.devModeEnabled
   - References: [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:90), [src/renderer/services/event-bus.js](src/renderer/services/event-bus.js:219)

4. Footer progress updates
   - FooterProgressBar and FooterStatusDisplay reflect progress:updated events
   - No misuse of awaited uiState instances in components

5. CSS hover/active behavior for navigation controls
   - Basic DOM style checks confirm :hover and :active selectors function (no nested & usage)

6. IPC rate limiting and log suppression
   - Force rate-limit engagement for channels renderer-log-* and scorm-*; assert exactly one INFO log per engaged channel in app.log
   - Assert no subsequent rate-limit logs after the first per channel
   - Assert renderer does not emit any rate-limit warnings and applies silent backoff (coalesced renderer logs still reach app.log without spam)

7. SCORM client throttling and serialization
   - Assert cmi.session_time SetValue is not sent more than once every 3 seconds under bursty updates
   - Assert Commit and Terminate are serialized (no overlapping in-flight operations)

8. Graceful shutdown
   - Trigger shutdown with an active session; assert best-effort termination occurs before IPC teardown
   - Assert no ERROR-level logs for benign “already terminated” or late shutdown cases; WARN/INFO only if any

### Directory Organization
```
tests/
├── setup.js                    # Global test setup and utilities
├── fixtures/                   # Test data and mock files
├── unit/                       # Unit tests
│   └── scorm/                  # SCORM-specific unit tests
│       ├── api-handler.test.js
│       ├── cam/
│       └── sn/
└── integration/                # Integration tests
    ├── phase4-integration.test.js
    ├── cam-workflow.test.js
    ├── scorm-workflow.test.js
    └── sn-workflow.test.js
```

### Global Test Utilities
Available via `global.testUtils` in all test files:

```javascript
// Mock logger creation
const mockLogger = global.testUtils.createMockLogger();

// Mock session manager creation
const mockSessionManager = global.testUtils.createMockSessionManager();

// Test data generation
const testScormData = global.testUtils.createTestScormData();

// Utility functions
await global.testUtils.wait(1000); // Wait helper
const randomId = global.testUtils.randomString(10); // Random string generator
```

### Custom Jest Matchers
SCORM-specific matchers for validation:

```javascript
// SCORM error code validation
expect(errorCode).toBeValidScormErrorCode();

// SCORM boolean validation
expect(value).toBeScormBoolean();

// Scaled score validation
expect(score).toBeValidScaledScore();

// ISO 8601 duration validation
expect(duration).toBeValidTimeInterval();
```

### SCORM Test Constants
Available via `global.SCORM_TEST_CONSTANTS`:

```javascript
// Valid vocabulary values
VALID_COMPLETION_STATUSES: ['completed', 'incomplete', 'not attempted', 'unknown']
VALID_SUCCESS_STATUSES: ['passed', 'failed', 'unknown']
VALID_INTERACTION_TYPES: ['true-false', 'choice', 'fill-in', ...]
// ... and more
```

## Testing Patterns

### 1. Service Testing Pattern
```javascript
describe('ServiceName', () => {
  let service;
  let mockDependency;

  beforeEach(() => {
    mockDependency = global.testUtils.createMockLogger();
    service = new ServiceName(mockDependency);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    test('should handle valid input', () => {
      // Test implementation
    });

    test('should handle invalid input', () => {
      // Error case testing
    });
  });
});
```

### 2. SCORM API Testing Pattern
```javascript
describe('SCORM API Function', () => {
  let apiHandler;

  beforeEach(() => {
    const mockSessionManager = global.testUtils.createMockSessionManager();
    const mockLogger = global.testUtils.createMockLogger();
    apiHandler = new ScormApiHandler(mockSessionManager, mockLogger);
    apiHandler.Initialize('');
  });

  test('should comply with SCORM specification', () => {
    const result = apiHandler.SomeFunction('validParameter');
    expect(result).toBe('true');
    expect(apiHandler.GetLastError()).toBe('0');
  });
});
```

### 3. Integration Testing Pattern
```javascript
describe('Component Integration', () => {
  let mainComponent;
  let dependencies;

  beforeEach(async () => {
    dependencies = await setupTestDependencies();
    mainComponent = new MainComponent(dependencies);
    await mainComponent.initialize();
  });

  afterEach(async () => {
    await mainComponent.shutdown();
  });

  test('should handle complete workflow', async () => {
    // Test full workflow
  });
});
```

## Test Execution

### NPM Scripts
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:scorm

# Watch mode for development
npm run test:watch
```

### Test Categories by Script
- `test:unit` - All unit tests in `tests/unit/`
- `test:integration` - All integration tests in `tests/integration/`
- `test:scorm` - SCORM-specific tests (unit + integration)
- `test:cam` - CAM module tests
- `test:sn` - Sequencing & Navigation tests

## SCORM Compliance Testing

### Required Test Coverage

#### 1. SCORM API Functions (8 Required Functions)
- `Initialize('')` - Session initialization
- `Terminate('')` - Session termination
- `GetValue(element)` - Data model retrieval
- `SetValue(element, value)` - Data model updates
- `Commit('')` - Data persistence
- `GetLastError()` - Error code retrieval
- `GetErrorString(errorCode)` - Error description
- `GetDiagnostic(errorCode)` - Diagnostic information

#### 2. Data Model Elements
- Core elements (cmi.*)
- Navigation elements (adl.nav.*)
- Interaction tracking
- Objective tracking
- Score tracking

#### 3. Sequencing and Navigation
- Activity tree processing
- Navigation request handling
- Rollup rule processing
- Sequencing rule evaluation

#### 4. Content Aggregation Model (CAM)
- Manifest parsing and validation
- Resource processing
- Organization structure
- Metadata handling
- UI outline generation (organizations-first with resources fallback); renderer must use analysis.uiOutline

## Error Handling Testing

### Error Categories
1. **SCORM API Errors** - Standard SCORM error codes (0-999)
2. **Application Errors** - Custom error codes (600-699 for main process)
3. **System Errors** - File system, network, etc.

### Error Testing Pattern
```javascript
test('should handle error condition gracefully', () => {
  expect(() => {
    service.methodThatShouldFail();
  }).toThrow();
  
  expect(mockErrorHandler.setError).toHaveBeenCalledWith(
    expectedErrorCode,
    expectedMessage,
    expectedContext
  );
});
```

## Performance Testing

### Performance Benchmarks
- Service initialization: < 100ms
- Navigation processing: < 50ms
- Progress updates: < 25ms
- Rollup processing: < 30ms
- Large activity trees: < 200ms

### Memory Testing
- Monitor memory usage during tests
- Verify proper cleanup after service shutdown
- Test with large datasets and activity trees

## Mocking Strategy

### Electron Modules
```javascript
jest.mock('electron', () => ({
  app: { /* mock implementation */ },
  BrowserWindow: jest.fn(),
  ipcMain: { /* mock implementation */ }
}));
```

### External Dependencies
- File system operations
- Network requests
- Database connections
- Logger instances

### Internal Dependencies
- Service dependencies
- Error handlers
- Session managers

## Continuous Integration

### Test Execution in CI
1. **Pre-commit**: Run unit tests and linting
2. **Pull Request**: Full test suite with coverage
3. **Main Branch**: Full test suite + performance benchmarks
4. **Release**: Complete test suite + compliance validation

### Coverage Requirements
- Minimum 80% coverage across all metrics
- 100% coverage for SCORM API functions
- 90% coverage for core services

## Test Data Management

### Fixtures
- Sample SCORM packages in `tests/fixtures/`
- Mock manifest files
- Test interaction data
- Sample learner records

### Test Data Generation
- Use utility functions for consistent test data
- Randomized data for stress testing
- Edge case data for boundary testing

## Debugging Tests

### Debug Configuration
```javascript
// Enable verbose logging in tests
const logger = {
  debug: console.log,  // Enable for debugging
  info: console.log,
  warn: console.warn,
  error: console.error
};
```

### Common Debugging Techniques
1. Use `console.log` strategically
2. Run single tests with `test.only()`
3. Use Jest's `--verbose` flag
4. Check mock call history with `toHaveBeenCalledWith()`

## Best Practices

### 1. Test Organization
- Group related tests in `describe` blocks
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

### 2. Test Independence
- Each test should be independent
- Use `beforeEach`/`afterEach` for setup/cleanup
- Avoid shared state between tests

### 3. Mocking Guidelines
- Mock external dependencies
- Keep mocks simple and focused
- Verify mock interactions when relevant

### 4. Assertion Quality
- Use specific assertions
- Test both success and failure cases
- Verify error conditions explicitly

### 5. Test Maintenance
- Keep tests up-to-date with code changes
- Refactor tests when refactoring code
- Remove obsolete tests promptly

## Migration from Legacy Tests

### Current Issues
The project currently has inconsistent testing approaches:

1. **Main Directory Tests**: Custom test runners (not Jest)
   - `error-handling-test.js`
   - `integration-test.js`
   - `scorm-compliance-test.js`
   - `performance-benchmark.js`

2. **Jest Tests**: Proper Jest structure in `tests/` directory

### Migration Plan
1. Convert main directory tests to Jest format
2. Move to appropriate `tests/` subdirectories
3. Standardize on Jest utilities and patterns
4. Maintain test coverage during migration

## Conclusion

This testing strategy ensures comprehensive coverage of the SCORM Tester application while maintaining SCORM 2004 4th Edition compliance. All tests should follow the established patterns and use the provided utilities for consistency and maintainability.

Regular review and updates of this strategy ensure it remains aligned with the application's evolution and testing best practices.