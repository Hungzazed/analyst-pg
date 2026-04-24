import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWebsiteDto {
  @ApiPropertyOptional({
    example: 'My Product Site',
    maxLength: 100,
    description: 'Display name of the website',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'example.com',
    maxLength: 255,
    description: 'Domain without protocol (e.g. example.com)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^(?!https?:\/\/)(?!www\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i, {
    message: 'Domain must be a valid domain without protocol (e.g. example.com)',
  })
  domain?: string;
}
