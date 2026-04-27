import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    example: '2026-04-01T00:00:00.000Z',
    description: 'Start time in ISO-8601 format',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-04-24T23:59:59.999Z',
    description: 'End time in ISO-8601 format',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    description: 'Maximum items returned',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: 50,
    description: 'Session limit for behavior or funnel calculations',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  sessionLimit?: number;
}
