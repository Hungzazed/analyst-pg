import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, ClickHouseClient } from '@clickhouse/client';

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private client: ClickHouseClient;
  private readonly logger = new Logger(ClickHouseService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const config = this.configService.get('clickhouse');
    this.client = createClient({
      host: `http://${config.host}:${config.port}`,
      database: config.database,
      username: config.username,
      password: config.password,
      request_timeout: config.request_timeout,
    });

    try {
      const ping = await this.client.ping();
      if (ping.success) {
        this.logger.log('✓ Connected to ClickHouse successfully');
      }
    } catch (error) {
      this.logger.error('Failed to connect to ClickHouse', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.logger.log('✓ ClickHouse connection closed');
    }
  }

  getClient(): ClickHouseClient {
    if (!this.client) {
      throw new Error('ClickHouse client is not initialized');
    }
    return this.client;
  }

  async query(sql: string, params?: any[]) {
    try {
      const result = await this.client.query({
        query: sql,
        query_params: params ? Object.fromEntries(
          params.map((param, index) => [`param${index}`, param])
        ) : undefined,
      });
      return result;
    } catch (error) {
      this.logger.error(`Query failed: ${sql}`, error);
      throw error;
    }
  }

  async insert(table: string, data: any[], format: string = 'JSONEachRow') {
    try {
      await this.client.insert({
        table,
        values: data,
        format: format as any,
      });
    } catch (error) {
      this.logger.error(`Insert failed for table: ${table}`, error);
      throw error;
    }
  }

  async select(table: string, conditions?: string, limit: number = 100) {
    const whereClause = conditions ? `WHERE ${conditions}` : '';
    const sql = `SELECT * FROM ${table} ${whereClause} LIMIT ${limit}`;
    return this.query(sql);
  }
}
