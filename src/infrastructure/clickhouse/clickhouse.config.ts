import { registerAs } from '@nestjs/config';

export const clickhouseConfig = registerAs('clickhouse', () => {
  return {
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: parseInt(process.env.CLICKHOUSE_PORT || '8123', 10),
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    username: process.env.CLICKHOUSE_USERNAME || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    request_timeout: 30000,
    max_execution_time: 600,
    allow_experimental_object_type: 1,
  };
});
