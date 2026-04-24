import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWebsiteDto {
  @ApiProperty({
    example: 'My Product Site',
    maxLength: 100,
    description: 'Display name of the website',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'example.com',
    maxLength: 255,
    description: 'Domain without protocol (e.g. example.com)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^(?!https?:\/\/)(?!www\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i, {
    message:
      'Domain must be a valid domain without protocol (e.g. example.com)',
  })
  domain!: string;
}
