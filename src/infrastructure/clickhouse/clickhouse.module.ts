import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClickHouseService } from './clickhouse.service';
import { clickhouseConfig } from './clickhouse.config';

@Module({
  imports: [ConfigModule.forFeature(clickhouseConfig)],
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
