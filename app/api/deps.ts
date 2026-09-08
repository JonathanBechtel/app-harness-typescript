/**
 * Shared Fastify plumbing.
 *
 * `app.db` (decorated here) is the one sanctioned way for a route to reach the
 * database; `scripts/check-route-conventions.ts` (R3) rejects route modules
 * that build their own client or import the module-level one.
 */

import fp from 'fastify-plugin';

import type { Db } from '../utils/db.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The application database. Services receive it (or a transaction on it) as a parameter. */
    db: Db;
  }
}

export interface DatabasePluginOptions {
  readonly db: Db;
}

export const databasePlugin = fp<DatabasePluginOptions>(
  (app, options, done) => {
    app.decorate('db', options.db);
    done();
  },
  { name: 'database', fastify: '5.x' },
);
