import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const CONTROL_MESSAGE = "Use the control from src/ui. A new exception needs the owner's approval."

const CONTROL_IMPORTS = [
  'Button',
  'ToggleButton',
  'ToggleButtonGroup',
  'Slider',
  'SliderTrack',
  'SliderThumb',
  'Switch',
  'Checkbox',
  'Tabs',
  'TabList',
  'Tab',
  'RadioGroup',
  'Radio',
]

const controlImportPath = {
  name: 'react-aria-components',
  importNames: CONTROL_IMPORTS,
  message: CONTROL_MESSAGE,
}

const sharedLayerPattern = {
  group: ['**/features/**', '**/app/**'],
  message: 'Shared layers never import a feature or the app shell.',
}

export default tseslint.config(
  {
    ignores: ['dist', 'dev-dist', 'playwright-report', 'test-results', 'src/api/schema.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Screens use the library's controls. The library and tests build their own; elsewhere each
    // exception is a reasoned disable comment that eslint/controlAllowlist.js lists.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'JSXOpeningElement[name.name="button"]', message: CONTROL_MESSAGE },
        {
          selector:
            'JSXOpeningElement[name.name="input"]:has(JSXAttribute[name.name="type"][value.value="range"])',
          message: CONTROL_MESSAGE,
        },
      ],
      'no-restricted-imports': ['error', { paths: [controlImportPath] }],
    },
  },
  {
    // The shared layers sit below the features and the app shell, so a feature can change
    // without reaching them. Tests may mount features to exercise a shared module.
    files: ['src/{api,auth,commands,db,domain,layout,platform,sync,text,theme}/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [controlImportPath],
          patterns: [sharedLayerPattern],
        },
      ],
    },
  },
  {
    // The library is the one place a control is built, so it keeps only the layering rule.
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [sharedLayerPattern],
        },
      ],
    },
  },
)
