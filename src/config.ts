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

// Configuration Redis / Bull Queue (files d'attente)
export const redisFactory = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
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

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

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

  OUTBOX_WORKER_ENABLED: Joi.boolean().allow('').optional(),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().optional(),
  OUTBOX_BATCH_SIZE: Joi.number().optional(),
  OUTBOX_MAX_ATTEMPTS: Joi.number().optional(),
  OUTBOX_BASE_BACKOFF_MS: Joi.number().optional(),
  OUTBOX_MAX_BACKOFF_MS: Joi.number().optional(),
  OUTBOX_LOCK_TIMEOUT_MS: Joi.number().optional(),
}).unknown(true);

export default { postgresqlFactory, redisFactory, jwtFactory, licenseFactory, configSchema };
