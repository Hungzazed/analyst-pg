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
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
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

  getProducer(): Producer {
    if (!this.producer) {
      throw new Error('Kafka producer is not initialized');
    }
    return this.producer;
  }

  getConsumer(): Consumer {
    if (!this.consumer) {
      throw new Error('Kafka consumer is not initialized');
    }
    return this.consumer;
  }

  async sendMessage(topic: string, messages: any[]) {
    try {
      const result = await this.producer.send({
        topic,
        messages: messages.map((msg) => ({
          key: msg.key || null,
          value: JSON.stringify(msg.value || msg),
          headers: msg.headers || {},
        })),
      });
      this.logger.debug(`Message sent to topic: ${topic}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to send message to topic: ${topic}`, error);
      throw error;
    }
  }

  async subscribe(topics: string[], callback: (message: any) => Promise<void>) {
    try {
      await this.consumer.subscribe({ topics });
      
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const valueStr = message.value?.toString();
            if (!valueStr) {
              this.logger.warn(`Empty message received from topic: ${topic}`);
              return;
            }
            const value = JSON.parse(valueStr);
            await callback({
              topic,
              partition,
              offset: message.offset,
              value,
              key: message.key?.toString(),
              headers: message.headers,
            });
          } catch (error) {
            this.logger.error(
              `Error processing message from topic: ${topic}`,
              error,
            );
          }
        },
      });

      this.logger.log(`✓ Subscribed to topics: ${topics.join(', ')}`);
    } catch (error) {
      this.logger.error('Failed to subscribe to topics', error);
      throw error;
    }
  }

  async createTopic(topic: string, partitions: number = 3, replicationFactor: number = 1) {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.createTopics({
        topics: [
          {
            topic,
            numPartitions: partitions,
            replicationFactor,
          },
        ],
      });
      this.logger.log(`✓ Topic created: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to create topic: ${topic}`, error);
    } finally {
      await admin.disconnect();
    }
  }
}
