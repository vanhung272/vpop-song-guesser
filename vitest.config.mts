import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Default environment is node. Later tasks that test React components can opt in
// per file with `// @vitest-environment jsdom` or add `environmentMatchGlobs`/projects here.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
  },
});
