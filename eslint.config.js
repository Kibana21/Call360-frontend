import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src/api/generated', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Raw HTML rendering is not allowed (TM-22).' },
        { selector: "MemberExpression[object.name='localStorage']", message: 'No browser storage for session data (IAM-008).' },
        { selector: "MemberExpression[object.name='sessionStorage']", message: 'No browser storage for session data (IAM-008).' },
      ],
    },
  },
  { files: ['e2e/**/*.ts', 'src/**/*.test.{ts,tsx}'], rules: { 'no-restricted-syntax': 'off' } },
);
