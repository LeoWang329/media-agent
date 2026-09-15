import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: './packages/shared', environment: 'node' } },
      { test: { name: 'server', root: './packages/server', environment: 'node' } },
      { test: { name: 'mock-llm', root: './tools/mock-llm', environment: 'node' } },
    ],
  },
});
