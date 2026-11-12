// Vite/vitest ne sait pas résoudre `node:sqlite` (builtin récent) : on le charge via require.
import { createRequire } from 'node:module';
const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
export const DatabaseSync = sqlite.DatabaseSync;
export const StatementSync = sqlite.StatementSync;
