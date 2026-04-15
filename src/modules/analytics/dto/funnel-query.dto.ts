import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AnalyticsQueryDto } from './analytics-query.dto';

export class FunnelQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  landingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  nextUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  conversionUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxSessions?: number;
}