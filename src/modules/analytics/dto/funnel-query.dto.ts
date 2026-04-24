import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsQueryDto } from './analytics-query.dto';

export class FunnelQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    example: 'https://example.com/pricing',
    maxLength: 2048,
    description: 'Landing page URL filter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  landingUrl?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/checkout',
    maxLength: 2048,
    description: 'Second step URL filter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  nextUrl?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/success',
    maxLength: 2048,
    description: 'Conversion page URL filter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  conversionUrl?: string;

  @ApiPropertyOptional({
    example: 500,
    minimum: 1,
    maximum: 10000,
    description: 'Maximum sessions sampled for funnel analysis',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxSessions?: number;
}
