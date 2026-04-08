import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  Producer,
  Consumer,
  logLevel,
} from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka!: Kafka;
  private producer!: Producer;
  private consumer!: Consumer;
  private readonly logger = new Logger(KafkaService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const config = this.configService.get('kafka');
    const logLevelMap = {
      DEBUG: logLevel.DEBUG,
      INFO: logLevel.INFO,
      WARN: logLevel.WARN,
      ERROR: logLevel.ERROR,
    };

    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      logLevel: logLevelMap[config.logLevel] || logLevel.WARN,
      connectionTimeout: config.connectionTimeout,
      requestTimeout: config.requestTimeout,
      retry: config.retry,
    });

    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({
      groupId: config.groupId,
      allowAutoTopicCreation: true,
    });

    try {
      await this.producer.connect();
      await this.consumer.connect();
      this.logger.log('✓ Connected to Kafka successfully');
    } catch (error) {
      this.logger.error('Failed to connect to Kafka', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      if (this.producer) {
        await this.producer.disconnect();
      }
      if (this.consumer) {
        await this.consumer.disconnect();
      }
      this.logger.log('✓ Kafka connection closed');
    } catch (error) {
      this.logger.error('Error closing Kafka connections', error);
    }
  }
}
