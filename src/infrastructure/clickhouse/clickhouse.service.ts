import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, ClickHouseClient } from '@clickhouse/client';

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private client!: ClickHouseClient;
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
}
