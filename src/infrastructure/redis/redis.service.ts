import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const config = this.configService.get('redis');

    this.client = createClient({
      url: `redis://${config.password ? ':' + config.password + '@' : ''}${config.host}:${config.port}/${config.db}`,
      socket: {
        reconnectStrategy: config.retryStrategy,
      },
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis error', error);
    });

    this.client.on('connect', () => {
      this.logger.log('✓ Connected to Redis successfully');
    });

    this.client.on('reconnecting', () => {
      this.logger.warn('Reconnecting to Redis...');
    });

    try {
      await this.client.connect();
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('✓ Redis connection closed');
    }
  }

  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }
    return this.client;
  }
}
