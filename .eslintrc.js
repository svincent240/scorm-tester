module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'prefer-const': 'error',
    'no-var': 'error',
    // Enforce global logging standard: no direct console usage in source code
    'no-console': 'error'
  },
  overrides: [
    {
      // Allow console only in our logger implementation and Node test/scripts files
      files: [
        'src/shared/utils/logger.js',
        'tests/**/*',
        'scripts/**/*',
        '*.config.*',
        'playwright.config.*'
      ],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // Phase 1 Architectural Guardrails for Renderer Components
      files: [
        'src/renderer/components/**/*.js'
      ],
      excludedFiles: ['src/renderer/components/base-component.js'],
      rules: {
        // Ban direct DOM access via document.* in components
        'no-restricted-properties': [
          'error,
          {
            object: 'document',
            property: 'getElementById',
            message: 'Components must not call document.getElementById directly. Use BaseComponent.find/findAll and mount points managed by AppManager.'
          },
          {
            object: 'document',
            property: 'querySelector',
            message: 'Components must not call document.querySelector directly. Use BaseComponent.find/findAll scoped to the component root.'
          },
          {
            object: 'document',
            property: 'querySelectorAll',
            message: 'Components must not call document.querySelectorAll directly. Use BaseComponent.findAll.'
          }
        ],
        // Ban direct IPC usage in components
        'no-restricted-globals': [
          'error',
          { name: 'electronAPI', message: 'Components must not access electronAPI directly. Use ScormClient or services via AppManager.' }
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='window'][property.name='electronAPI']",
            message: 'Components must not access window.electronAPI directly. Use ScormClient or services via AppManager.'
          }
        ]
      }
    }
  ],
  globals: {
    electronAPI: 'readonly',
    window: 'readonly',
    document: 'readonly'
  }
};