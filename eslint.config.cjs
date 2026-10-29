const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/**', 'netlify-dist/**', 'tmp/**', 'docs/qa/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: { ecmaVersion: 'latest' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['scripts/**/*.cjs', 'tests/**/*.{js,cjs}', '*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['*.js', 'src/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', require: 'readonly' },
    },
  },
];
