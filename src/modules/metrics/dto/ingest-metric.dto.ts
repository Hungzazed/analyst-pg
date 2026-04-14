import { Type } from 'class-transformer';
import { EventType } from '@prisma/client';
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
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @IsEnum(EventType)
  type!: EventType;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  timestamp!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  userId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\/.+/i, {
    message: 'url must be a valid absolute URL',
  })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\/.+/i, {
    message: 'referrer must be a valid absolute URL',
  })
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  browser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  os?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
