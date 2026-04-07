import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KafkaService } from './kafka.service';
import { kafkaConfig } from './kafka.config';

@Module({
  imports: [ConfigModule.forFeature(kafkaConfig)],
  providers: [KafkaService],
  exports: [KafkaService],
})
export class KafkaModule {}
