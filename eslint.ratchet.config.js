// Isolated config for scripts/check-complexity-ratchet.ts: ONLY the three
// complexity rules, no per-file overrides, run with --no-inline-config so neither
// this config nor an eslint-disable comment can hide growth inside a file.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'app/migrations/**', 'app/static/**'] },
  {
    files: ['app/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      complexity: ['error', 10],
      'max-params': ['error', 5],
      'max-statements': ['error', 50],
    },
  },
);
