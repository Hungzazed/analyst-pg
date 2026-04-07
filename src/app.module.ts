import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  ClickHouseModule,
  KafkaModule,
  RedisModule,
  PostgresModule,
} from './infrastructure';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ClickHouseModule,
    KafkaModule,
    RedisModule,
    PostgresModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
