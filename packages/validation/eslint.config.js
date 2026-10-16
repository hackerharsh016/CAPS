import { nodeConfig } from '@caps/config';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  }
];
