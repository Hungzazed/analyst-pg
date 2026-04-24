import { Type } from 'class-transformer';
import { EventType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class IngestMetricDto {
  @ApiProperty({
    example: 'evt_01HZXN9FZQ2X71G8A2M4D7KQ9E',
    maxLength: 128,
    description: 'Unique idempotency key of the event',
  })
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ApiProperty({
    enum: EventType,
    enumName: 'EventType',
    example: EventType.PAGEVIEW,
    description: 'Event type',
  })
  @IsEnum(EventType)
  type!: EventType;

  @ApiProperty({
    example: 1713945600000,
    minimum: 0,
    description: 'Event timestamp in milliseconds',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timestamp!: number;

  @ApiPropertyOptional({
    example: 'sess_01HZXNB8G66RMVQ6W6D1E4VQ93',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  @ApiPropertyOptional({
    example: 'user_123',
    maxLength: 255,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  userId?: string | null;

  @ApiPropertyOptional({
    example: 'https://example.com/pricing',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\/.+/i, {
    message: 'url must be a valid absolute URL',
  })
  url?: string;

  @ApiPropertyOptional({
    example: 'Pricing',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    example: 'https://google.com',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\/.+/i, {
    message: 'referrer must be a valid absolute URL',
  })
  referrer?: string;

  @ApiPropertyOptional({
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;

  @ApiPropertyOptional({
    example: 'VN',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;

  @ApiPropertyOptional({
    example: '203.113.131.1',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @ApiPropertyOptional({
    example: 'desktop',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  device?: string;

  @ApiPropertyOptional({
    example: 'Chrome',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  browser?: string;

  @ApiPropertyOptional({
    example: 'Windows',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  os?: string;

  @ApiPropertyOptional({
    example: { buttonId: 'start-trial', plan: 'pro' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
