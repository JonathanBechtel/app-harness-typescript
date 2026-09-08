/** Server entrypoint: `node dist/app/main.js` (or `npm run dev`). */

import { buildApp } from './app.js';
import { settings } from './config.js';

const app = await buildApp();

const shutdown = (signal: string): void => {
  app.log.info({ signal }, 'shutting down');
  void app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  shutdown('SIGINT');
});

try {
  await app.listen({ host: settings.host, port: settings.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
