import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,

  // ── CommonJS source files (the entire backend) ───────────────────────────
  {
    files: ['src/**/*.js'],
    ignores: ['src/models/**/*.js'],
    languageOptions: {
      ecmaVersion:  2022,
      sourceType:   'script',   // CommonJS — require/module.exports
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Warn on unused variables; allow underscore-prefixed as intentional no-ops
      'no-unused-vars': ['warn', {
        vars:              'all',
        args:              'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Catch typos — referencing a name that was never defined
      'no-undef': 'error',

      // Empty catch blocks hide errors silently — warn, don't hard-fail
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // preserve-caught-error is too strict for the current codebase — disable
      'no-unused-expressions': 'warn',

      // Prefer === over == (null is exempt — common pattern: val == null)
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],

      // console.log is replaced by Winston — warn so devs notice, don't block CI
      'no-console': 'warn',

      // Prevent unreachable code after return/throw/break
      'no-unreachable': 'error',

      // Duplicate keys in an object literal are almost always a bug
      'no-dupe-keys': 'error',

      // Node 18 exposes `crypto` as a global; code that does `const crypto = require('crypto')`
      // would trigger no-redeclare. Allow shadowing built-in globals.
      'no-redeclare': ['error', { builtinGlobals: false }],

      // preserve-caught-error is an ESLint v10 recommended rule requiring `cause` on
      // rethrown errors. Existing codebase doesn't follow this pattern — downgrade to warn.
      'preserve-caught-error': 'warn',
    },
  },

  // ── ES-module model files ────────────────────────────────────────────────
  // src/models/*.js use import/export syntax (legacy ORM layer)
  {
    files: ['src/models/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console':     'warn',
    },
  },

  // ── Database scripts ─────────────────────────────────────────────────────
  // Migration and seed scripts use console.log intentionally
  {
    files: ['src/database/**/*.js'],
    rules: {
      'no-console': 'off',
      'no-empty':   'off',
    },
  },
];
