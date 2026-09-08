/** Shared column helpers for table modules. */

import { timestamp } from 'drizzle-orm/pg-core';

/** Timezone-aware UTC now (column default). */
export function utcNow(): Date {
  return new Date();
}

/** `created_at` / `updated_at` columns, set by the application. Spread into `pgTable(...)`. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(utcNow),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(utcNow)
    .$onUpdateFn(utcNow),
};
