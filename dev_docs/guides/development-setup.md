# Development Setup Guide

## Overview

This guide provides comprehensive instructions for setting up a development environment for the SCORM Tester application, including tools, dependencies, and workflows optimized for both human developers and AI-assisted development.

## Prerequisites

### System Requirements
- **Node.js**: Version 18.x or higher (LTS recommended)
- **npm**: Version 8.x or higher (comes with Node.js)
- **Git**: Version 2.30 or higher
- **Operating System**: Windows 10/11, macOS 10.15+, or Linux (Ubuntu 20.04+)

### Development Tools
- **Code Editor**: Visual Studio Code (recommended) with extensions
- **Terminal**: PowerShell (Windows), Terminal (macOS), or Bash (Linux)
- **Browser**: Chrome/Chromium for debugging (DevTools support)

## Installation

### 1. Clone Repository
```bash
git clone https://github.com/your-org/scorm-tester.git
cd scorm-tester
```

### 2. Install Dependencies
```bash
# Install all dependencies
npm install

# Install development dependencies
npm install --only=dev
```

### 3. Verify Installation
```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Verify Electron installation
npx electron --version
```

## Development Environment Configuration

### Visual Studio Code Setup

#### Required Extensions
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-vscode.vscode-json",
    "redhat.vscode-xml",
    "ms-vscode.test-adapter-converter",
    "hbenl.vscode-test-explorer"
  ]
}
```

#### Workspace Settings
Create `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "files.associations": {
    "*.xml": "xml",
    "imsmanifest.xml": "xml"
  },
  "emmet.includeLanguages": {
    "javascript": "javascriptreact"
  },
  "typescript.preferences.includePackageJsonAutoImports": "on",
  "javascript.preferences.includePackageJsonAutoImports": "on"
}
```

### Environment Variables

Create `.env` file in project root:
```env
# Development settings
NODE_ENV=development
DEBUG=scorm-tester:*
LOG_LEVEL=debug

# SCORM settings
SCORM_VERSION=2004_4th_Edition
DEFAULT_LMS_PROFILE=generic

# Testing settings
TEST_TIMEOUT=30000
COVERAGE_THRESHOLD=90

# Development server
DEV_SERVER_PORT=3000
HOT_RELOAD=true
```

### Git Configuration

#### Git Hooks Setup
```bash
# Install husky for git hooks
npm install --save-dev husky
npx husky install

# Add pre-commit hook
npx husky add .husky/pre-commit "npm run lint && npm run test:unit"

# Add commit message hook
npx husky add .husky/commit-msg "npx commitlint --edit $1"
```

#### .gitignore Updates
Ensure `.gitignore` includes:
```gitignore
# Development
.env
.env.local
.vscode/settings.json
*.log

# Build outputs
dist/
build/
out/

# Testing
coverage/
.nyc_output/
test-results/

# SCORM packages (for testing)
test-packages/
temp-extracts/

# OS specific
.DS_Store
Thumbs.db
```

## Development Workflow

### Project Structure Understanding

```
scorm-tester/
├── src/                    # Source code (new modular structure)
│   ├── main/              # Main Electron process
│   ├── renderer/          # Renderer process
│   └── shared/            # Shared utilities and types
├── dev_docs/              # Development documentation
├── tests/                 # Test suites
├── references/            # SCORM specification references
├── utils/                 # Legacy utilities (to be refactored)
├── main.js               # Legacy main file (to be refactored)
├── app.js                # Legacy app file (to be refactored)
└── index.html            # Legacy HTML (to be refactored)
```

### Development Scripts

#### Available npm Scripts
```bash
# Development
npm run dev                 # Start development mode with hot reload
npm run dev:main           # Start main process in debug mode
npm run dev:renderer       # Start renderer process development server

# Building
npm run build              # Build for production
npm run build:main         # Build main process only
npm run build:renderer     # Build renderer process only

# Testing
npm run test               # Run all tests
npm run test:unit          # Run unit tests only
npm run test:integration   # Run integration tests
npm run test:e2e           # Run end-to-end tests
npm run test:scorm         # Run SCORM compliance tests
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Generate coverage report

# Code Quality
npm run lint               # Run ESLint
npm run lint:fix           # Fix ESLint issues automatically
npm run format             # Format code with Prettier
npm run type-check         # Run TypeScript type checking

# Documentation
npm run docs:generate      # Generate API documentation
npm run docs:serve         # Serve documentation locally

# SCORM Validation
npm run scorm:validate     # Validate SCORM compliance
npm run scorm:test-package # Test with sample SCORM package
```

### Development Mode

#### Starting Development Environment
```bash
# Start full development environment
npm run dev

# Or start components separately
npm run dev:main &
npm run dev:renderer
```

#### Hot Reload Configuration
The development setup includes hot reload for both main and renderer processes:

- **Main Process**: Automatically restarts on file changes
- **Renderer Process**: Hot module replacement for UI components
- **Shared Modules**: Triggers rebuild of dependent processes

### Debugging

#### Main Process Debugging
```bash
# Start with Node.js debugger
npm run dev:main -- --inspect=9229

# Or use VS Code launch configuration
```

VS Code `launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/main/main.js",
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "scorm-tester:*"
      },
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Renderer Process",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:3000",
      "webRoot": "${workspaceFolder}/src/renderer"
    }
  ]
}
```

#### SCORM Content Debugging
```javascript
// Enable SCORM API debugging
window.scormDebug = true;

// Log all API calls
const originalAPI = window.API_1484_11;
window.API_1484_11 = new Proxy(originalAPI, {
  get(target, prop) {
    const value = target[prop];
    if (typeof value === 'function') {
      return function(...args) {
        console.log(`SCORM API: ${prop}(${args.join(', ')})`);
        const result = value.apply(target, args);
        console.log(`SCORM API: ${prop} returned:`, result);
        return result;
      };
    }
    return value;
  }
});
```

## Testing Setup

### Test Environment Configuration

#### Jest Configuration (`jest.config.js`)
```javascript
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/index.js'
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000
};
```

#### Test Setup (`tests/setup.js`)
```javascript
// Global test setup
const { app } = require('electron');

// Mock Electron APIs for testing
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test'),
    on: jest.fn(),
    quit: jest.fn()
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn()
  },
  BrowserWindow: jest.fn(() => ({
    loadFile: jest.fn(),
    webContents: {
      send: jest.fn()
    }
  }))
}));

// SCORM test utilities
global.createMockScormAPI = () => ({
  Initialize: jest.fn(() => "true"),
  Terminate: jest.fn(() => "true"),
  GetValue: jest.fn(() => ""),
  SetValue: jest.fn(() => "true"),
  Commit: jest.fn(() => "true"),
  GetLastError: jest.fn(() => "0"),
  GetErrorString: jest.fn(() => "No Error"),
  GetDiagnostic: jest.fn(() => "")
});
```

### Running Tests

#### Unit Tests
```bash
# Run all unit tests
npm run test:unit

# Run specific test file
npm run test:unit -- src/main/services/scorm/rte/api-handler.test.js

# Run tests in watch mode
npm run test:unit -- --watch

# Run with coverage
npm run test:unit -- --coverage
```

#### SCORM Compliance Tests
```bash
# Run SCORM compliance test suite
npm run test:scorm

# Test specific SCORM functionality
npm run test:scorm -- --grep "API functions"

# Test with specific SCORM package
npm run test:scorm -- --package=references/SL360_LMS_SCORM_2004.zip
```

## Code Quality Standards

### ESLint Configuration (`.eslintrc.js`)
```javascript
module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended',
    '@electron/eslint-config-electron'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    'max-lines': ['error', { max: 200 }],
    'max-complexity': ['error', 10],
    'no-console': 'warn',
    'prefer-const': 'error',
    'no-unused-vars': 'error'
  }
};
```

### Prettier Configuration (`.prettierrc`)
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

### File Size Limits
- **Maximum file size**: 200 lines
- **Maximum function complexity**: 10 (cyclomatic complexity)
- **Maximum function length**: 50 lines

## AI Development Support

### TypeScript Definitions
Comprehensive TypeScript definitions are provided in `src/shared/types/` for:
- SCORM API interfaces
- Data model types
- Error handling types
- Configuration types

### Documentation Standards
All modules include:
- JSDoc comments for all public functions
- Type annotations for parameters and return values
- Usage examples in documentation
- Architecture decision records (ADRs)

### AI-Friendly Patterns
- Small, focused files (max 200 lines)
- Clear separation of concerns
- Consistent naming conventions
- Comprehensive test coverage
- Detailed error messages

## Troubleshooting

### Common Issues

#### Electron App Won't Start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Check Electron version compatibility
npx electron --version
```

#### SCORM API Not Found
```javascript
// Verify API object is properly exposed
console.log('API available:', !!window.API_1484_11);

// Check window hierarchy
let win = window;
while (win) {
  console.log('Window has API:', !!win.API_1484_11);
  win = win.parent !== win ? win.parent : null;
}
```

#### Test Failures
```bash
# Clear Jest cache
npx jest --clearCache

# Run tests with verbose output
npm run test -- --verbose

# Debug specific test
npm run test -- --testNamePattern="API Handler" --verbose
```

### Performance Issues
```bash
# Profile application startup
npm run dev -- --trace-warnings

# Monitor memory usage
npm run dev -- --max-old-space-size=4096

# Enable V8 profiling
npm run dev -- --prof
```

## Contributing Guidelines

### Code Style
- Follow ESLint and Prettier configurations
- Use meaningful variable and function names
- Keep functions small and focused
- Write comprehensive tests for new features

### Commit Messages
Follow conventional commit format:
```
type(scope): description

feat(scorm): add data model validation
fix(api): handle edge case in GetValue
docs(readme): update installation instructions
test(unit): add tests for error handler
```

### Pull Request Process
1. Create feature branch from `main`
2. Implement changes with tests
3. Ensure all tests pass
4. Update documentation
5. Submit pull request with clear description

This development setup provides a robust foundation for both human developers and AI tools to work effectively with the SCORM Tester codebase while maintaining high code quality and SCORM compliance standards.