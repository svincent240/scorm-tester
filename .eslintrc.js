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
    'no-var': 'error'
  },
  overrides: [
    {
      files: ['src/renderer/**/*.js'],
      rules: {
        'no-console': 'error'
      }
    }
  ],
  globals: {
    electronAPI: 'readonly',
    window: 'readonly',
    document: 'readonly'
  }
};