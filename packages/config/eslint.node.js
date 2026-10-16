import tseslint from 'typescript-eslint';
import baseConfig from './eslint.base.js';

export const nodeConfig = tseslint.config(...baseConfig, {
  files: ['**/*.ts', '**/*.js'],
  rules: {
    'no-process-exit': 'off'
  }
});

export default nodeConfig;
