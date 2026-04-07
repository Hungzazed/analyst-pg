import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { postgresConfig } from './postgres.config';
import { PostgresService } from './postgres.service';

@Module({
  imports: [ConfigModule.forFeature(postgresConfig)],
  providers: [PostgresService],
  exports: [PostgresService],
})
export class PostgresModule {}
