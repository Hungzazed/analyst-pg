import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { StringValue } from 'ms';
import ms from 'ms';
import { PrismaService } from '../../../infrastructure';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

export interface JwtTokenPayload extends JwtPayload {
  tokenType: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly refreshTokenSecret: string;
  private readonly refreshTokenExpiresIn: StringValue;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_ACCESS_SECRET',
        configService.get<string>('JWT_SECRET', 'dev-secret'),
      ),
    });

    this.refreshTokenSecret = this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      this.configService.get<string>('JWT_SECRET', 'dev-secret'),
    );
    this.refreshTokenExpiresIn = this.configService.get<StringValue>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
  }

  async validate(payload: JwtPayload) {
    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    return user;
  }

  async issueTokens(user: { id: string; email: string; role: Role }) {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(user.id, user.email, user.role),
      this.signRefreshToken(user.id, user.email, user.role),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async verifyRefreshToken(refreshToken: string): Promise<JwtTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtTokenPayload>(
        refreshToken,
        {
          secret: this.refreshTokenSecret,
        },
      );

      if (payload.tokenType !== 'refresh') {
        throw new ForbiddenException('Invalid refresh token');
      }

      return payload;
    } catch {
      throw new ForbiddenException('Invalid refresh token');
    }
  }

  getRefreshTokenExpiryDate(): Date {
    const ttlInMilliseconds = ms(this.refreshTokenExpiresIn);
    const fallbackInMilliseconds = 7 * 24 * 60 * 60 * 1000;

    return new Date(Date.now() + (ttlInMilliseconds ?? fallbackInMilliseconds));
  }

  private async signAccessToken(
    id: string,
    email: string,
    role: Role,
  ): Promise<string> {
    const payload: JwtTokenPayload = {
      sub: id,
      email,
      role,
      tokenType: 'access',
    };

    return this.jwtService.signAsync(payload);
  }

  private async signRefreshToken(
    id: string,
    email: string,
    role: Role,
  ): Promise<string> {
    const payload: JwtTokenPayload = {
      sub: id,
      email,
      role,
      tokenType: 'refresh',
    };

    return this.jwtService.signAsync(payload, {
      secret: this.refreshTokenSecret,
      expiresIn: this.refreshTokenExpiresIn,
    });
  }
}
