import type { Request, Response, CookieOptions } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const buildCookieOptions = (
  withMaxAge: boolean,
): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/auth',
  ...(withMaxAge ? { maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE } : {}),
});

export const setRefreshTokenCookie = (
  response: Response,
  refreshToken: string,
): void => {
  response.cookie(
    REFRESH_TOKEN_COOKIE_NAME,
    refreshToken,
    buildCookieOptions(true),
  );
};

export const clearRefreshTokenCookie = (response: Response): void => {
  response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, buildCookieOptions(false));
};

export const extractRefreshTokenFromCookie = (
  request: Request,
): string | undefined => request.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
