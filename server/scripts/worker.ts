import { createWebhookWorker } from '../src/infrastructure/jobs.js';
import { assertRuntimeConfig, runtimeConfig } from '../src/infrastructure/runtimeConfig.js';

if (!['STAGING', 'PRODUCTION'].includes(runtimeConfig.appEnvironment)) throw new Error('The durable worker requires APP_ENV=STAGING or APP_ENV=PRODUCTION');
assertRuntimeConfig();
const worker = await createWebhookWorker();
console.log(JSON.stringify({ ok: true, event: 'worker.started', queue: 'payment-webhooks', environment: runtimeConfig.appEnvironment }));

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ event: 'worker.shutdown', signal }));
  await worker.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
