/** Page routes. Thin: build a context object, hand it to a template. */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { settings } from '../config.js';
import { HtmlPage } from '../schemas/web.js';

export const webRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { response: { 200: HtmlPage } } }, async (_request, reply) => {
    // Landing page. Replace or delete once the app has a real front door.
    return reply.view('index.njk', { env: settings.env, releaseSha: settings.releaseSha ?? null });
  });
};
