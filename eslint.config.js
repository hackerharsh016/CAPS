import baseConfig from './packages/config/eslint.base.js';

export default [
  ...baseConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'docs/**',
      '**/*.json',
      '**/*.md'
    ]
  }
];
