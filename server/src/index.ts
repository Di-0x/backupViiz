import { buildApp } from './app';
import { db } from './db';

const app = await buildApp();
const port = Number(process.env.PORT ?? 3000);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'arrêt en cours');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await app.close();
    db.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'erreur à l’arrêt');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port, host: '0.0.0.0' });
