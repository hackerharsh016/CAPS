import { nextConfig } from '@caps/config';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**']
  }
];
