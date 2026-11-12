import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'api/**/*', 'src/**/*', 'server.ts', 'vite.config.ts']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
