import { defineConfig } from 'drizzle-kit';

// app/models/ is the canonical schema. `npm run mig.generate m="..."` diffs it
// against app/migrations/meta and writes the next SQL revision. The runtime
// applies revisions with app/cli/migrate.ts (per-revision transactions, lock
// timeout); drizzle-kit's own `migrate` is not used.
export default defineConfig({
  dialect: 'postgresql',
  schema: './app/models/*.ts',
  out: './app/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
