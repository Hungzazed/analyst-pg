import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private readonly logger = new Logger(PostgresService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const config = this.configService.get('postgres');

    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxPoolSize,
      idleTimeoutMillis: config.idleTimeoutMs,
      connectionTimeoutMillis: config.connectionTimeoutMs,
    });

    try {
      await this.pool.query('SELECT 1');
      await this.ensureMetadataTable();
      this.logger.log('Connected to PostgreSQL successfully');
    } catch (error) {
      this.logger.error('Failed to connect to PostgreSQL', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('PostgreSQL connection pool closed');
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error('PostgreSQL pool is not initialized');
    }
    return this.pool;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureMetadataTable() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS metadata_store (
        meta_key TEXT PRIMARY KEY,
        meta_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async upsertMetadata(key: string, value: unknown) {
    await this.query(
      `
      INSERT INTO metadata_store (meta_key, meta_value)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (meta_key)
      DO UPDATE SET
        meta_value = EXCLUDED.meta_value,
        updated_at = NOW()
      `,
      [key, JSON.stringify(value)],
    );
  }

  async getMetadata<T = unknown>(key: string): Promise<T | null> {
    const result = await this.query<{ meta_value: T }>(
      'SELECT meta_value FROM metadata_store WHERE meta_key = $1',
      [key],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0].meta_value;
  }
}
