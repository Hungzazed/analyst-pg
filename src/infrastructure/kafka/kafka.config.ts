import { registerAs } from '@nestjs/config';

export const kafkaConfig = registerAs('kafka', () => {
  return {
    brokers: (process.env.KAFKA_BROKER_URL || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'analyst-service',
    groupId: process.env.KAFKA_GROUP_ID || 'analyst-group',
    logLevel: process.env.KAFKA_LOG_LEVEL || 'WARN',
    connectionTimeout: 10000,
    requestTimeout: 30000,
    retry: {
      initialRetryTime: 300,
      retries: 8,
      maxRetryTime: 30000,
      multiplier: 2,
    },
  };
});
