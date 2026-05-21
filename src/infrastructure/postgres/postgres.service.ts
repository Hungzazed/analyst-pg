import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg'; // Đã xóa QueryResultRow, QueryResult, PoolClient không dùng đến

// 1. Định nghĩa interface rõ ràng cho cấu hình Postgres
interface PostgresConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  maxPoolSize?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  private readonly logger = new Logger(PostgresService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    // 2. Ép kiểu (Type Assertion) từ any sang PostgresConfig để ESLint không bắt lỗi
    const config = this.configService.get<PostgresConfig>('postgres') || {};

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
      // 3. Ép kiểu error thành Error object hoặc unknown để log an toàn
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to connect to PostgreSQL', err.stack);
      throw err;
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