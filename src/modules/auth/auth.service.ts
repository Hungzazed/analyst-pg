import {
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infrastructure';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtStrategy } from './strategies/jwt.strategy';

interface AuthUserProfile {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterResponse {
  user: AuthUserProfile;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUserProfile;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface LoginResult extends AuthResponse {
  refreshToken: string;
}

export interface RefreshResult extends RefreshResponse {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly passwordSaltRounds = 10;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtStrategy: JwtStrategy,
  ) {}

  async register(registerDto: RegisterDto): Promise<RegisterResponse> {
    const existedUser = await this.prismaService.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existedUser) {
      throw new ConflictException('Email already exists');
    }

    const password = await bcrypt.hash(
      registerDto.password,
      this.passwordSaltRounds,
    );

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

    return {
      user,
    };
  }

  async login(loginDto: LoginDto): Promise<LoginResult> {
    const user = await this.prismaService.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const isPasswordMatched = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordMatched) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const tokens = await this.jwtStrategy.issueTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const payload = await this.jwtStrategy.verifyRefreshToken(refreshToken);

    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    const refreshSessions = await this.prismaService.refreshToken.findMany({
      where: {
        userId: user.id,
        expiresAt: {
          gt: now,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    let matchedSessionId: string | null = null;
    for (const session of refreshSessions) {
      const isMatch = await bcrypt.compare(refreshToken, session.token);
      if (isMatch) {
        matchedSessionId = session.id;
        break;
      }
    }

    if (!matchedSessionId) {
      throw new ForbiddenException('Invalid refresh token');
    }

    const newTokens = await this.jwtStrategy.issueTokens(user);

    await this.prismaService.$transaction([
      this.prismaService.refreshToken.delete({
        where: { id: matchedSessionId },
      }),
      this.prismaService.refreshToken.create({
        data: {
          token: await bcrypt.hash(
            newTokens.refreshToken,
            this.passwordSaltRounds,
          ),
          userId: user.id,
          expiresAt: this.jwtStrategy.getRefreshTokenExpiryDate(),
        },
      }),
    ]);

    return {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    };
  }

  async logout(userId: string, refreshToken?: string) {
    if (!refreshToken) {
      await this.prismaService.refreshToken.deleteMany({ where: { userId } });
      return { message: 'Logged out successfully' };
    }

    const refreshSessions = await this.prismaService.refreshToken.findMany({
      where: {
        userId,
      },
      select: {
        id: true,
        token: true,
      },
    });

    let matchedSessionId: string | null = null;
    for (const session of refreshSessions) {
      const isMatch = await bcrypt.compare(refreshToken, session.token);
      if (isMatch) {
        matchedSessionId = session.id;
        break;
      }
    }

    if (!matchedSessionId) {
      throw new ForbiddenException('Invalid refresh token');
    }

    await this.prismaService.refreshToken.delete({
      where: { id: matchedSessionId },
    });

    return { message: 'Logged out successfully' };
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

  private async storeRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    await this.prismaService.refreshToken.create({
      data: {
        token: await bcrypt.hash(refreshToken, this.passwordSaltRounds),
        userId,
        expiresAt: this.jwtStrategy.getRefreshTokenExpiryDate(),
      },
    });
  }
}
