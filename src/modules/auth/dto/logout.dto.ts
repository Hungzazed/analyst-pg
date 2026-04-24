import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Optional refresh token to revoke only one session',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  refreshToken?: string;
}
