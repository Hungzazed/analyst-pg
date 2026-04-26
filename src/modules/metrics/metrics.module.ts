import { Module } from '@nestjs/common';
import { KafkaModule, PrismaModule } from '../../infrastructure';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsKafkaConsumer } from './kafka/metrics-kafka.consumer';
import { MetricsKafkaProducer } from './kafka/metrics-kafka.producer';

@Module({
  imports: [PrismaModule, KafkaModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsKafkaProducer, MetricsKafkaConsumer],
})
export class MetricsModule {}
