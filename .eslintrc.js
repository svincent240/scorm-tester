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
    }
  ],
  globals: {
    electronAPI: 'readonly',
    window: 'readonly',
    document: 'readonly'
  }
};