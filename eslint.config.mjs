import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import boundaries from './tooling/eslint/boundaries.mjs'

export default defineConfig(
  { ignores: ['**/node_modules', '**/out', '**/dist', '**/.turbo', '.yarn'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['packages/ui/**/*.tsx', 'apps/desktop/src/renderer/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite]
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Exported signatures must be typed; inner functions may infer from their declared type.
      '@typescript-eslint/explicit-module-boundary-types': 'error'
    }
  },
  boundaries,
  prettier
)
