import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RealtimeQueryDto {
  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 60,
    description: 'Rolling activity window in minutes',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  windowMinutes?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: 200,
    description: 'Deprecated alias for sessionLimit',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 200,
    description: 'Maximum active sessions returned',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  sessionLimit?: number;

  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 30,
    description: 'SSE refresh interval in seconds',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  refreshSeconds?: number;
}
