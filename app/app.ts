/**
 * Composition root: wires settings, logging, plugins, routers, and lifecycle.
 *
 * Nothing here contains behaviour. Routers are registered by name so the route
 * table is readable in one place; `tests/unit/route-table.test.ts` snapshots it
 * through `app.routeTable`.
 */

import path from 'node:path';

import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import Fastify, { LogController } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import nunjucks from 'nunjucks';

import { databasePlugin } from './api/deps.js';
import { healthRoutes } from './api/routes/health.js';
import { settings } from './config.js';
import { configureLogging } from './logging-config.js';
import { FIELD_REQUEST_ID, getLogger, getRootLogger } from './observability/index.js';
import { requestCorrelation, requestIdFromHeaders } from './observability/middleware.js';
import { type Db, db as defaultDb, disposeEngine } from './utils/db.js';
import { webRoutes } from './web/routes.js';
import { registerTemplateFilters } from './web/templating.js';

const STATIC_DIR = path.join(import.meta.dirname, 'static');
const TEMPLATES_DIR = path.join(import.meta.dirname, 'templates');
const logger = getLogger('app.main');

export interface RouteEntry {
  readonly method: string;
  readonly url: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every (method, url) the app serves, in registration order. */
    routeTable: readonly RouteEntry[];
  }
}

export interface BuildAppOptions {
  /** Database to serve from; tests inject their own. Default: the process pool. */
  readonly db?: Db;
}

function createInstance() {
  return Fastify({
    loggerInstance: getRootLogger(),
    // Per-request access lines are off (a proxy already writes them); errors still log.
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: FIELD_REQUEST_ID,
    }),
    trustProxy: true,
    genReqId: (request) => requestIdFromHeaders(request.headers),
    requestIdHeader: false,
  });
}

/** The application instance type (pino logger, default type provider at the root). */
export type App = Awaited<ReturnType<typeof createInstance>>;

/** Build a ready-to-listen application. */
export async function buildApp(options: BuildAppOptions = {}): Promise<App> {
  configureLogging();
  const app = createInstance();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const routeTable: RouteEntry[] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method !== 'HEAD') {
        routeTable.push({ method, url: route.url });
      }
    }
  });

  await app.register(requestCorrelation);
  await app.register(databasePlugin, { db: options.db ?? defaultDb });

  // Optional web layer. An API-only project can leave app/web untouched; it costs
  // nothing until a template route is added (see app/web/CLAUDE.md).
  await app.register(fastifyStatic, { root: STATIC_DIR, prefix: '/static/' });
  await app.register(fastifyView, {
    engine: { nunjucks },
    root: TEMPLATES_DIR,
    viewExt: 'njk',
    options: { onConfigure: registerTemplateFilters },
  });

  await app.register(healthRoutes);
  await app.register(webRoutes);

  app.addHook('onReady', (done) => {
    logger.info({ env: settings.env, release: settings.releaseSha ?? null }, 'startup');
    done();
  });
  if (options.db === undefined) {
    app.addHook('onClose', async () => {
      await disposeEngine();
      logger.info('shutdown complete');
    });
  }
  return app;
}
