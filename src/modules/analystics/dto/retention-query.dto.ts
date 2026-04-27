import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsQueryDto } from './analytics-query.dto';

export class RetentionQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    example: 'day',
    enum: ['day', 'week'],
    description: 'Retention granularity',
  })
  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week';

  @ApiPropertyOptional({
    example: 7,
    minimum: 1,
    maximum: 12,
    description: 'Number of retention periods to return',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periods?: number;
}
