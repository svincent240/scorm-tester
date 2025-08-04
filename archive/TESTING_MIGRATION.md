# Testing Framework Migration Guide

## Overview

The SCORM Tester project has been migrated from custom test runners to a standardized Jest-based testing framework. This document outlines the changes and provides guidance for using the new testing system.

## Migration Summary

### What Changed

1. **Framework Standardization**: All tests now use Jest as the primary testing framework
2. **File Organization**: Tests moved from main directory to structured `tests/` directory
3. **Consistent Setup**: Unified test setup with shared utilities and mocks
4. **Enhanced Coverage**: Improved test coverage reporting and thresholds
5. **Better Integration**: Seamless integration with CI/CD and development workflows

### File Migrations

| Legacy File | New Location | NPM Script |
|-------------|--------------|------------|
| `error-handling-test.js` | `tests/integration/error-handling.test.js` | `npm run test:error-handling` |
| `integration-test.js` | `tests/integration/phase-integration.test.js` | `npm run test:phase-integration` |
| `scorm-compliance-test.js` | `tests/integration/scorm-compliance.test.js` | `npm run test:compliance` |
| `performance-benchmark.js` | `tests/integration/performance-benchmark.test.js` | `npm run test:performance` |

## New Testing Structure

```
tests/
├── setup.js                           # Global test configuration
├── fixtures/                          # Test data and mock files
├── unit/                              # Unit tests
│   └── scorm/                         # SCORM-specific unit tests
│       ├── api-handler.test.js        # RTE API handler tests
│       ├── cam/                       # CAM module tests
│       │   └── manifest-parser.test.js
│       └── sn/                        # SN module tests
│           └── activity-tree.test.js
└── integration/                       # Integration tests
    ├── error-handling.test.js         # Error handling scenarios
    ├── scorm-compliance.test.js       # SCORM 2004 4th Edition compliance
    ├── performance-benchmark.test.js  # Performance benchmarks
    ├── phase-integration.test.js      # Multi-phase integration
    ├── phase4-integration.test.js     # Phase 4 main process
    ├── cam-workflow.test.js           # CAM workflow tests
    ├── scorm-workflow.test.js         # Complete SCORM workflow
    └── sn-workflow.test.js            # SN workflow tests
```

## Available Test Scripts

### Primary Test Commands

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode (for development)
npm run test:watch
```

### Category-Specific Tests

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# All tests (unit + integration)
npm run test:all
```

### Module-Specific Tests

```bash
# SCORM-related tests
npm run test:scorm

# CAM module tests
npm run test:cam

# Sequencing & Navigation tests
npm run test:sn
```

### Feature-Specific Tests

```bash
# SCORM compliance validation
npm run test:compliance

# Performance benchmarks
npm run test:performance

# Error handling scenarios
npm run test:error-handling

# Phase integration tests
npm run test:phase-integration
```

## Test Utilities and Setup

### Global Test Utilities

All tests have access to `global.testUtils` with helpful functions:

```javascript
// Create mock logger
const mockLogger = global.testUtils.createMockLogger();

// Create mock session manager
const mockSessionManager = global.testUtils.createMockSessionManager();

// Generate test SCORM data
const testData = global.testUtils.createTestScormData();

// Utility functions
await global.testUtils.wait(1000);
const randomId = global.testUtils.randomString(10);
```

### Custom Jest Matchers

SCORM-specific matchers for validation:

```javascript
// SCORM error code validation
expect(errorCode).toBeValidScormErrorCode();

// SCORM boolean validation
expect(value).toBeScormBoolean();

// Scaled score validation (-1 to 1)
expect(score).toBeValidScaledScore();

// ISO 8601 duration validation
expect(duration).toBeValidTimeInterval();
```

### SCORM Test Constants

Access to SCORM vocabulary via `global.SCORM_TEST_CONSTANTS`:

```javascript
// Valid completion statuses
SCORM_TEST_CONSTANTS.VALID_COMPLETION_STATUSES
// ['completed', 'incomplete', 'not attempted', 'unknown']

// Valid success statuses
SCORM_TEST_CONSTANTS.VALID_SUCCESS_STATUSES
// ['passed', 'failed', 'unknown']

// Valid interaction types
SCORM_TEST_CONSTANTS.VALID_INTERACTION_TYPES
// ['true-false', 'choice', 'fill-in', ...]
```

## Coverage Requirements

The project maintains strict coverage thresholds:

- **Branches**: 80% minimum
- **Functions**: 80% minimum
- **Lines**: 80% minimum
- **Statements**: 80% minimum

### Viewing Coverage Reports

```bash
# Generate and view coverage report
npm run test:coverage

# Coverage reports are generated in:
# - Terminal output (summary)
# - coverage/lcov-report/index.html (detailed HTML report)
```

## Migration Benefits

### 1. Consistency
- All tests use the same framework and patterns
- Unified setup and teardown procedures
- Consistent mocking and assertion patterns

### 2. Developer Experience
- Better IDE integration and debugging
- Watch mode for rapid development
- Clear test output and error reporting

### 3. CI/CD Integration
- Standardized test execution
- Reliable coverage reporting
- Easy integration with build pipelines

### 4. Maintainability
- Shared test utilities reduce duplication
- Clear test organization and naming
- Comprehensive documentation

## Best Practices

### 1. Test Organization
```javascript
describe('ComponentName', () => {
  let component;
  let mockDependency;

  beforeEach(() => {
    mockDependency = global.testUtils.createMockLogger();
    component = new ComponentName(mockDependency);
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

### 2. SCORM API Testing
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

### 3. Integration Testing
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

## Troubleshooting

### Common Issues

1. **Legacy Test Files**: If you encounter legacy test files in the main directory, they are migration notices. Use the new Jest-based tests instead.

2. **Missing Dependencies**: Ensure all test dependencies are installed:
   ```bash
   npm install
   ```

3. **Coverage Failures**: If coverage falls below thresholds, add tests for uncovered code or adjust thresholds in `package.json`.

4. **Mock Issues**: Use the provided global test utilities for consistent mocking.

### Getting Help

- **Documentation**: See `dev_docs/guides/testing-strategy.md` for comprehensive testing strategy
- **Examples**: Look at existing test files for patterns and examples
- **Setup**: Check `tests/setup.js` for global configuration

## Future Enhancements

### Planned Improvements

1. **Visual Regression Testing**: Add screenshot comparison tests for UI components
2. **End-to-End Testing**: Implement full browser automation tests
3. **Performance Monitoring**: Continuous performance regression detection
4. **Test Data Management**: Enhanced test fixture management

### Contributing

When adding new tests:

1. Follow the established patterns and structure
2. Use the provided test utilities
3. Maintain coverage thresholds
4. Update documentation as needed

## Conclusion

The migration to Jest provides a solid foundation for reliable, maintainable testing. The new structure supports the project's growth while ensuring SCORM 2004 4th Edition compliance and robust error handling.

For detailed testing strategy and patterns, see [`dev_docs/guides/testing-strategy.md`](dev_docs/guides/testing-strategy.md).