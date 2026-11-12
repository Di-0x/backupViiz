import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: [{ find: /^node:sqlite$/, replacement: fileURLToPath(new URL('./test/sqlite-shim.ts', import.meta.url)) }] },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
