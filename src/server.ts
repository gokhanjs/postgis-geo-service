import { buildApp } from './app.ts';
import { config } from './config/index.ts';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = await buildApp();

let shuttingDown = false;

/**
 * A second signal must not start a second shutdown, and a stuck connection must
 * not hold the process open forever, so the guard and the timeout are both
 * required for a clean exit.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    app.log.error('Shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.services.health.checkDatabase();
  app.log.info('Database connection established');

  const purged = await app.services.collections.purgeExpired();
  if (purged > 0) app.log.info(`Purged ${purged} expired collection tokens`);

  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error({ err }, 'Startup failed');
  process.exit(1);
}
