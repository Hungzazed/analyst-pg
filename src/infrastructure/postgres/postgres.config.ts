import { registerAs } from '@nestjs/config';

export const postgresConfig = registerAs('postgres', () => {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'analyst_metadata',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    schema: process.env.POSTGRES_SCHEMA || 'public',
    maxPoolSize: parseInt(process.env.POSTGRES_MAX_POOL_SIZE || '10', 10),
    idleTimeoutMs: parseInt(
      process.env.POSTGRES_IDLE_TIMEOUT_MS || '30000',
      10,
    ),
    connectionTimeoutMs: parseInt(
      process.env.POSTGRES_CONNECTION_TIMEOUT_MS || '10000',
      10,
    ),
  };
});
