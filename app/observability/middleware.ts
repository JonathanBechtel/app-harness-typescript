/**
 * Request correlation as a Fastify plugin.
 *
 * The request id is minted (or adopted from a safe inbound `X-Request-ID`) by
 * `genReqId` in the composition root, so Fastify's own request logger and every
 * `getLogger()` call underneath agree on it. The `onRequest` hook runs the rest
 * of the request inside the bound context and echoes the id on the response
 * header before any handler, so even the error response the framework builds
 * for an unhandled exception carries it.
 */

import fp from 'fastify-plugin';
import type { IncomingHttpHeaders } from 'node:http';

import { bind, FIELD_REQUEST_ID, newCorrelationId, sanitizeCorrelationId } from './context.js';
import { getLogger } from './logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const log = getLogger('app.observability.middleware');

/** Fastify `genReqId`: a safe inbound id is adopted, anything else is replaced. */
export function requestIdFromHeaders(headers: IncomingHttpHeaders): string {
  const raw = headers[REQUEST_ID_HEADER];
  const inbound = Array.isArray(raw) ? raw[0] : raw;
  return sanitizeCorrelationId(inbound) ?? newCorrelationId();
}

export const requestCorrelation = fp(
  (app, _options, done) => {
    app.addHook('onRequest', (request, reply, next) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
      bind({ [FIELD_REQUEST_ID]: request.id }, next);
    });
    app.addHook('onError', (request, _reply, error, next) => {
      log.error({ err: error, method: request.method, path: request.url }, 'unhandled error');
      next();
    });
    done();
  },
  { name: 'request-correlation', fastify: '5.x' },
);
