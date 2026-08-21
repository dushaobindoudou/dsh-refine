import js from '@eslint/js'

export default [
  {
    ignores: [
      'node_modules/**',
      '.npm-cache/**',
      'refs/**',
      'coverage/**',
      'dist/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['lib/**/*.js', 'smoke-host.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    // lib/client.js is a pre-wired browser bundle (window.__ModuleLoader__
    // factory with a `require` parameter and host-injected globals), not a
    // plain ES module — keep syntactic rules, drop module/global assumptions.
    files: ['lib/client.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
    },
    rules: {
      'no-undef': 'off',
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },
]
