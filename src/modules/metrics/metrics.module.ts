import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [PrismaModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
