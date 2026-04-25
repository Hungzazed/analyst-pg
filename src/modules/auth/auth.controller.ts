import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import {
  AuthResponse,
  AuthService,
  RefreshResponse,
} from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  clearRefreshTokenCookie,
  extractRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from './utils/refresh-token-cookie.util';
import { Roles, RolesGuard } from '../../common';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiOkResponse({ description: 'Registration successful' })
  @ApiConflictResponse({ description: 'Email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login and receive access token, set refresh cookie' })
  @ApiOkResponse({ description: 'Login successful' })
  @ApiUnauthorizedResponse({ description: 'Email or password is incorrect' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const { refreshToken, ...result } = await this.authService.login(loginDto);
    setRefreshTokenCookie(response, refreshToken);

    return result;
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  @ApiOkResponse({ description: 'Tokens refreshed successfully' })
  @ApiForbiddenResponse({ description: 'Refresh token is invalid or expired' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RefreshResponse> {
    const refreshToken = extractRefreshTokenFromCookie(request);
    if (!refreshToken) {
      throw new ForbiddenException('Invalid refresh token');
    }

    const refreshed = await this.authService.refresh(refreshToken);
    setRefreshTokenCookie(response, refreshed.refreshToken);

    return {
      accessToken: refreshed.accessToken,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout current user and revoke refresh session(s)',
  })
  @ApiOkResponse({ description: 'Logout successful' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing access token' })
  @ApiForbiddenResponse({ description: 'Refresh token is invalid' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = extractRefreshTokenFromCookie(request);
    const result = await this.authService.logout(user.id, refreshToken);
    clearRefreshTokenCookie(response);

    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ description: 'Profile fetched successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing token' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user.id);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin-only endpoint' })
  @ApiOkResponse({ description: 'Admin access granted' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing token' })
  admin(@CurrentUser() user: AuthUser) {
    return {
      message: 'Admin access granted',
      user,
    };
  }
}
