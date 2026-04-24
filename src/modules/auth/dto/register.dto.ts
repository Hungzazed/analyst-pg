import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'new-user@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'strong-password',
    minLength: 8,
    description: 'User password',
  })
  @IsString()
  @MinLength(8)
  password!: string;
}
