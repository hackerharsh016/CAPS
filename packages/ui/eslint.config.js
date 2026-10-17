import { baseConfig } from '@caps/config';

export default [
  ...baseConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  }
];
