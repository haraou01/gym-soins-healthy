import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

// Configuration PostgreSQL (utilisée par TypeOrmModule)
export const postgresqlFactory = registerAs('postgresql', () => ({
  type: 'postgres' as const,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  username: process.env.POSTGRES_USERNAME || 'admin',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'gymsoins',
  logging: process.env.NODE_ENV === 'development',
}));

// Configuration JWT / sécurité
export const jwtFactory = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'dev-secret-change-me',
  expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
}));

// Configuration Licence / Anti-distribution
const parseFlag = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
const isProductionEnvironment = nodeEnvironment === 'production';
const isDevelopmentEnvironment = nodeEnvironment === 'development';

export const licenseFactory = registerAs('license', () => ({
  secret: process.env.LICENSE_SECRET || 'dev-license-secret-change-me',
  defaultTtlDays: parseInt(process.env.LICENSE_DEFAULT_TTL_DAYS, 10) || 365,
  // En local : tous les modules sans clé. En production : validation obligatoire,
  // même si LICENSE_DEV_MODE=true est présent par erreur dans l'environnement.
  devMode:
    !isProductionEnvironment &&
    parseFlag(process.env.LICENSE_DEV_MODE, isDevelopmentEnvironment),
}));

// Validation de l'environnement au démarrage
export const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),

  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USERNAME: Joi.string().default('admin'),
  POSTGRES_PASSWORD: Joi.string().allow('').default(''),
  POSTGRES_DATABASE: Joi.string().default('gymsoins'),

  JWT_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().optional(),
  }),
  JWT_EXPIRES_IN: Joi.string().optional(),
  JWT_REFRESH_SECRET: Joi.string().allow('').optional(),

  LICENSE_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().optional(),
  }),
  LICENSE_DEFAULT_TTL_DAYS: Joi.number().optional(),
  LICENSE_DEV_MODE: Joi.boolean().allow('').optional(),

  CORS_ORIGINS: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().default(
      'http://localhost:5173,tauri://localhost,http://tauri.localhost',
    ),
  }),
  REQUEST_BODY_LIMIT: Joi.string().default('1mb'),
  TRUST_PROXY: Joi.boolean().default(false),
  OBSERVABILITY_LOG_ENABLED: Joi.boolean().default(true),
  METRICS_TOKEN: Joi.string().min(16).allow('').optional(),
  THROTTLE_TTL_MS: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(300),

  AUTH_LOGIN_EMAIL_MAX_ATTEMPTS: Joi.number().default(20),
  AUTH_LOGIN_IP_MAX_ATTEMPTS: Joi.number().default(30),
  AUTH_LOGIN_RATE_WINDOW_SECONDS: Joi.number().default(60),
  AUTH_REGISTER_EMAIL_MAX_ATTEMPTS: Joi.number().default(5),
  AUTH_REGISTER_IP_MAX_ATTEMPTS: Joi.number().default(5),
  AUTH_REGISTER_RATE_WINDOW_SECONDS: Joi.number().default(3600),
  AUTH_REFRESH_IP_MAX_ATTEMPTS: Joi.number().default(30),
  AUTH_REFRESH_RATE_WINDOW_SECONDS: Joi.number().default(60),

  RETENTION_PURGE_ENABLED: Joi.boolean().default(false),
  RETENTION_PURGE_INTERVAL_MS: Joi.number().default(21_600_000),
  RETENTION_PURGE_MAX_BATCHES: Joi.number().default(20),
  IDEMPOTENCY_RETENTION_DAYS: Joi.number().default(30),
  IDEMPOTENCY_PURGE_BATCH_SIZE: Joi.number().default(500),
  OUTBOX_RETENTION_DAYS: Joi.number().default(30),
  OUTBOX_PURGE_BATCH_SIZE: Joi.number().default(500),
  RETENTION_WORKER_HEALTH_HOST: Joi.string().default('127.0.0.1'),
  RETENTION_WORKER_HEALTH_PORT: Joi.number().default(3003),

  OUTBOX_WORKER_ENABLED: Joi.boolean().allow('').optional(),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().optional(),
  OUTBOX_BATCH_SIZE: Joi.number().optional(),
  OUTBOX_MAX_ATTEMPTS: Joi.number().optional(),
  OUTBOX_BASE_BACKOFF_MS: Joi.number().optional(),
  OUTBOX_MAX_BACKOFF_MS: Joi.number().optional(),
  OUTBOX_LOCK_TIMEOUT_MS: Joi.number().optional(),
  WORKER_HEALTH_HOST: Joi.string().default('127.0.0.1'),
  WORKER_HEALTH_PORT: Joi.number().default(3002),
}).unknown(true);

export default { postgresqlFactory, jwtFactory, licenseFactory, configSchema };
