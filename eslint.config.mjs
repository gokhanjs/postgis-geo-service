import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Pre-refactor CommonJS entry points. These are replaced wholesale by the
  // TypeScript sources in src/, so they are held to the old conventions rather
  // than rewritten twice.
  {
    files: ['*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
    },
  },

  // Architecture contract, mirrored in AGENTS.md: database access is confined
  // to the repository layer. Anything above it must go through a repository.
  {
    files: ['src/routes/**', 'src/services/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'pg', message: 'SQL belongs in src/repositories/.' }] },
      ],
    },
  },
);
