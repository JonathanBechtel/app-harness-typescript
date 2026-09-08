/**
 * Liveness and readiness probes.
 *
 * Two probes, deliberately separate. `/health` touches no database: an
 * orchestrator should restart a replica on it, and a database outage is not a
 * reason to cycle every replica. `/health/db` runs a bounded `SELECT 1`
 * through the app's own pool and reports 503 when that fails, so a saturated
 * pool or an unreachable database is visible to monitoring instead of inferred
 * from user reports.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { settings } from '../../config.js';
import { type DbHealth, DbHealthSchema, HealthSchema } from '../../schemas/health.js';
import { checkDatabaseReadiness } from '../../utils/db.js';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', { schema: { response: { 200: HealthSchema } } }, async () => ({
    status: 'ok',
    env: settings.env,
    releaseSha: settings.releaseSha ?? null,
  }));

  app.get(
    '/health/db',
    { schema: { response: { 200: DbHealthSchema, 503: DbHealthSchema } } },
    async (_request, reply) => {
      const report = await checkDatabaseReadiness(app.db);
      const payload: DbHealth = {
        status: report.databaseOk ? 'ok' : 'unavailable',
        databaseOk: report.databaseOk,
        latencyMs: report.latencyMs,
        error: report.error,
      };
      return reply.code(report.databaseOk ? 200 : 503).send(payload);
    },
  );
};
