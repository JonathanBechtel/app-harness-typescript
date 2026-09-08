/** Health probe response shapes. */

import { z } from 'zod';

/** Liveness response. */
export const HealthSchema = z.object({
  status: z.string(),
  env: z.string(),
  releaseSha: z.string().nullable(),
});
export type Health = z.infer<typeof HealthSchema>;

/** Readiness response. */
export const DbHealthSchema = z.object({
  status: z.string(),
  databaseOk: z.boolean(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type DbHealth = z.infer<typeof DbHealthSchema>;
