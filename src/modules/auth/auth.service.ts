import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infrastructure';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  user: {
    id: string;
    email: string;
    role: Role;
    createdAt: Date;
    updatedAt: Date;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const existedUser = await this.prismaService.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existedUser) {
      throw new ConflictException('Email already exists');
    }

    const password = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prismaService.user.create({
      data: {
        email: registerDto.email,
        password,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const accessToken = await this.signToken(user.id, user.email, user.role);

    return {
      accessToken,
      tokenType: 'Bearer',
      user,
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.prismaService.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const isPasswordMatched = await bcrypt.compare(loginDto.password, user.password);

    if (!isPasswordMatched) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const accessToken = await this.signToken(user.id, user.email, user.role);

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  async getProfile(userId: string) {
    return this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async validateUserById(userId: string) {
    return this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  private async signToken(id: string, email: string, role: Role): Promise<string> {
    const payload: JwtPayload = {
      sub: id,
      email,
      role,
    };

    return this.jwtService.signAsync(payload);
  }
}
