import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
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
}
