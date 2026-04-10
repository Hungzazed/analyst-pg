import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateWebsiteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^(?!https?:\/\/)(?!www\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i, {
    message: 'Domain must be a valid domain without protocol (e.g. example.com)',
  })
  domain?: string;
}
