import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, IHeaders, logLevel } from 'kafkajs';

interface KafkaRuntimeConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  connectionTimeout: number;
  requestTimeout: number;
  retry: {
    initialRetryTime: number;
    retries: number;
    maxRetryTime: number;
    multiplier: number;
  };
}

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka!: Kafka;
  private producer!: Producer;
  private readonly managedConsumers = new Set<Consumer>();
  private readonly logger = new Logger(KafkaService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const config = this.configService.get<KafkaRuntimeConfig>('kafka');

    if (!config) {
      throw new Error('Kafka configuration is missing');
    }

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

    try {
      await this.producer.connect();
      this.logger.log('Connected Kafka producer successfully');
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

      for (const consumer of this.managedConsumers) {
        await consumer.disconnect();
      }

      this.managedConsumers.clear();
      this.logger.log('Kafka connections closed');
    } catch (error) {
      this.logger.error('Error closing Kafka connections', error);
    }
  }

  async send(params: {
    topic: string;
    messages: Array<{
      key?: string;
      value: string;
      headers?: IHeaders;
    }>;
  }) {
    return this.producer.send(params);
  }

  async createConsumer(groupId: string): Promise<Consumer> {
    const consumer = this.kafka.consumer({
      groupId,
      allowAutoTopicCreation: true,
    });

    await consumer.connect();
    this.managedConsumers.add(consumer);

    return consumer;
  }

  async releaseConsumer(consumer: Consumer): Promise<void> {
    await consumer.disconnect();
    this.managedConsumers.delete(consumer);
  }
}
