import tseslint from 'typescript-eslint';
import baseConfig from './eslint.base.js';

export const nextConfig = tseslint.config(...baseConfig, {
  files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  rules: {
    'no-html-link-for-pages': 'off'
  }
});

export default nextConfig;
