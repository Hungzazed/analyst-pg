import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth';
import { MetricsModule } from './modules/metrics';
import { WebsiteModule } from './modules/website';
import {
  KafkaModule,
  RedisModule,
  PostgresModule,
  PrismaModule,
} from './infrastructure';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    KafkaModule,
    RedisModule,
    PostgresModule,
    PrismaModule,
    AuthModule,
    WebsiteModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
