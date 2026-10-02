/**
 * Central runtime/deployment contract.
 *
 * The application deliberately has a development fallback so the existing local self-tests
 * remain runnable, but production is fail-closed: it cannot silently boot against the JSON
 * stores, file-backed sessions, local process state, sandbox adapters or bootstrap password
 * environment variables. A real deployment must satisfy this contract before it can expose
 * financial or authenticated traffic.
 */
export type AppEnvironment = 'DEVELOPMENT' | 'TEST' | 'STAGING' | 'PRODUCTION';

function normalizeEnvironment(value: string | undefined): AppEnvironment {
  const normalized = (value ?? 'DEVELOPMENT').trim().toUpperCase();
  if (normalized === 'PROD' || normalized === 'PRODUCTION') return 'PRODUCTION';
  if (normalized === 'DEV') return 'DEVELOPMENT';
  if (normalized === 'TEST') return 'TEST';
  if (normalized === 'STAGING') return 'STAGING';
  return 'DEVELOPMENT';
}

const appEnvironmentSource = process.env.APP_ENV || process.env.NODE_ENV;
const appEnvironment = normalizeEnvironment(appEnvironmentSource);

export const runtimeConfig = Object.freeze({
  appEnvironment,
  isProduction: appEnvironment === 'PRODUCTION',
  isNonLocal: appEnvironment === 'STAGING' || appEnvironment === 'PRODUCTION',
  storageBackend: (process.env.STORAGE_BACKEND ?? 'json').trim().toLowerCase(),
  sessionBackend: (process.env.SESSION_BACKEND ?? 'file').trim().toLowerCase(),
  jobBackend: (process.env.JOB_BACKEND ?? 'inline').trim().toLowerCase(),
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  bearerFallbackEnabled: process.env.AUTH_BEARER_FALLBACK !== '0',
  paymentEnvironment: (process.env.PAYMENT_ENVIRONMENT ?? (appEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST')).trim().toUpperCase(),
  metricsToken: process.env.METRICS_AUTH_TOKEN ?? '',
  buildVersion: process.env.BUILD_VERSION ?? 'unknown',
});

export interface RuntimeValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateRuntimeConfig(): RuntimeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const config = runtimeConfig;

  if (config.isNonLocal) {
    if (config.storageBackend !== 'postgres') errors.push('STORAGE_BACKEND=postgres is required in STAGING/PRODUCTION; JSON storage is disabled');
    if (!config.databaseUrl) errors.push('DATABASE_URL is required in STAGING/PRODUCTION');
    if (config.sessionBackend !== 'redis' && config.sessionBackend !== 'postgres') errors.push('SESSION_BACKEND must be redis or postgres in STAGING/PRODUCTION');
    if (!config.redisUrl && config.sessionBackend === 'redis') errors.push('REDIS_URL is required for SESSION_BACKEND=redis');
    if (config.jobBackend !== 'bullmq') errors.push('JOB_BACKEND=bullmq is required in STAGING/PRODUCTION; inline jobs are disabled');
    if (!config.redisUrl && config.jobBackend === 'bullmq') errors.push('REDIS_URL is required for JOB_BACKEND=bullmq');
    if (config.allowedOrigins.length === 0) errors.push('ALLOWED_ORIGINS must explicitly list STAGING/PRODUCTION frontend origins');
    if (config.bearerFallbackEnabled) errors.push('AUTH_BEARER_FALLBACK=0 is required in STAGING/PRODUCTION');
    if (config.isProduction && config.paymentEnvironment !== 'PRODUCTION') errors.push('PAYMENT_ENVIRONMENT must be PRODUCTION for a production deployment');
    if (config.appEnvironment === 'STAGING' && !['TEST', 'STAGING'].includes(config.paymentEnvironment)) errors.push('PAYMENT_ENVIRONMENT must be TEST or STAGING in STAGING');
    if (config.isProduction && process.env.ADMIN_BOOTSTRAP_PASSWORD) errors.push('ADMIN_BOOTSTRAP_PASSWORD must not be used in PRODUCTION; provision through the admin migration/bootstrap procedure');
    if (!config.metricsToken) errors.push('METRICS_AUTH_TOKEN is required in STAGING/PRODUCTION for the metrics endpoint');
  } else {
    if (config.storageBackend === 'json') warnings.push('JSON storage is enabled outside production only; it is not a production ledger');
    if (config.sessionBackend === 'file') warnings.push('File-backed sessions are enabled outside production only; use a shared session backend for staging');
    if (config.jobBackend === 'inline') warnings.push('Inline work is enabled outside production only; use BullMQ for staging/production');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Called before any HTTP listener is exposed. This prevents a deployment mistake from
 * turning the local JSON stores into an accidental production financial source of truth. */
export function assertRuntimeConfig(): void {
  const validation = validateRuntimeConfig();
  for (const warning of validation.warnings) console.warn(`[runtime] ${warning}`);
  if (!validation.ok) {
    throw new Error(`Runtime configuration is not safe to start:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`);
  }
}

// This module is imported by every persistence module, so invalid non-local configuration
// fails before a JSON store can even be loaded.
if (runtimeConfig.isNonLocal) assertRuntimeConfig();

export function assertJsonStorageAllowed(subsystem: string): void {
  if (runtimeConfig.isNonLocal) {
    throw new Error(`Non-local startup refused: ${subsystem} attempted to use JSON/file storage. Configure the PostgreSQL repository before enabling STAGING/PRODUCTION.`);
  }
}
