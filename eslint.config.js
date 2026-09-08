// Lint config: one tool, one config, mirrored by lint-staged and CI.
// Presence of JSDoc is NOT enforced (format is); tests are the exception, via
// scripts/check-test-titles.ts. Complexity limits here are also measured
// independently by scripts/check-complexity-ratchet.ts with inline-config
// disabled, so an eslint-disable comment cannot hide growth.
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'app/migrations/**',
      'app/static/**',
      '.claude/worktrees/**',
      '.codex/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  jsdoc.configs['flat/recommended-typescript-error'],
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.node,
    },
    rules: {
      complexity: ['error', 10],
      'max-params': ['error', 5],
      'max-statements': ['error', 50],
      'no-console': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      // Fastify plugins and handlers are async by contract and often have no await.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
      ],
      // JSDoc: format is enforced, presence is not.
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/tag-lines': 'off',
    },
  },
  {
    files: ['tests/**/*.ts', 'evals/**/*.ts', 'scripts/**/*.ts', 'tasks.ts'],
    rules: {
      'max-params': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
