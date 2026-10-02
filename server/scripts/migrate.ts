import { runMigrations, closeDatabase } from '../src/infrastructure/database.js';
import { runtimeConfig, validateRuntimeConfig } from '../src/infrastructure/runtimeConfig.js';

const validation = validateRuntimeConfig();
if (!runtimeConfig.databaseUrl) {
  console.error('DATABASE_URL is required to run production migrations. No local/JSON migration is performed.');
  process.exitCode = 1;
} else if (!['STAGING', 'PRODUCTION'].includes(runtimeConfig.appEnvironment)) {
  console.error(`Refusing migrations from APP_ENV=${runtimeConfig.appEnvironment}; use APP_ENV=STAGING or APP_ENV=PRODUCTION explicitly.`);
  process.exitCode = 1;
} else if (validation.errors.filter((error) => error.includes('DATABASE_URL')).length > 0) {
  console.error(validation.errors.join('\n'));
  process.exitCode = 1;
} else {
  try {
    await runMigrations();
    console.log(JSON.stringify({ ok: true, event: 'database.migrations.applied', environment: runtimeConfig.appEnvironment }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, event: 'database.migrations.failed', message: error instanceof Error ? error.message : 'migration failed' }));
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
