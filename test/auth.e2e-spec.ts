/// <reference types="jest" />

import { CanActivate, ExecutionContext, ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { HttpExceptionFilter, ResponseInterceptor, RolesGuard } from '../src/common';
import { PrismaService } from '../src/infrastructure';

type MockUserRecord = {
	id: string;
	email: string;
	password: string;
	role: Role;
	createdAt: Date;
	updatedAt: Date;
};

type JestMock = jest.Mock<any, any>;

type PrismaMock = {
	user: {
		findUnique: JestMock;
		create: JestMock;
	};
	refreshToken: {
		findMany: JestMock;
		create: JestMock;
		delete: JestMock;
		deleteMany: JestMock;
	};
	$transaction: JestMock;
};

class MockJwtStrategy {
	issueTokens = jest.fn();
	verifyRefreshToken = jest.fn();
	getRefreshTokenExpiryDate = jest.fn();
}

class MockJwtAuthGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<{
			headers: Record<string, string | string[] | undefined>;
			user?: { id: string; email: string; role: Role };
		}>();

		const authorization = request.headers.authorization;
		const bearerToken = Array.isArray(authorization) ? authorization[0] : authorization;

		if (!bearerToken) {
			throw new UnauthorizedException('Invalid or missing access token');
		}

		if (bearerToken === 'Bearer valid-user-access-token') {
			request.user = {
				id: 'user-1',
				email: 'user@example.com',
				role: Role.USER,
			};
			return true;
		}

		if (bearerToken === 'Bearer valid-admin-access-token') {
			request.user = {
				id: 'admin-1',
				email: 'admin@example.com',
				role: Role.ADMIN,
			};
			return true;
		}

		throw new UnauthorizedException('Invalid or missing access token');
	}
}

describe('Auth API', () => {
	let app: INestApplication;
	let prismaMock: PrismaMock;
	let jwtStrategyMock: MockJwtStrategy;

	const baseTime = new Date('2026-04-25T00:00:00.000Z');

	const profileUser = (overrides: Partial<MockUserRecord> = {}): MockUserRecord => ({
		id: 'user-1',
		email: 'user@example.com',
		password: '$2b$10$hashed-password',
		role: Role.USER,
		createdAt: baseTime,
		updatedAt: baseTime,
		...overrides,
	});

	beforeAll(async () => {
		prismaMock = {
			user: {
				findUnique: jest.fn(),
				create: jest.fn(),
			},
			refreshToken: {
				findMany: jest.fn(),
				create: jest.fn(),
				delete: jest.fn(),
				deleteMany: jest.fn(),
			},
			$transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
		};

		jwtStrategyMock = new MockJwtStrategy();

		const moduleRef = await Test.createTestingModule({
			controllers: [AuthController],
			providers: [
				AuthService,
				RolesGuard,
				Reflector,
				{
					provide: PrismaService,
					useValue: prismaMock,
				},
				{
					provide: JwtStrategy,
					useValue: jwtStrategyMock,
				},
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useClass(MockJwtAuthGuard)
			.compile();

		app = moduleRef.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			}),
		);
		app.useGlobalFilters(new HttpExceptionFilter());
		app.useGlobalInterceptors(new ResponseInterceptor());

		await app.init();
	});

	beforeEach(() => {
		jest.clearAllMocks();

		prismaMock.user.findUnique.mockReset();
		prismaMock.user.create.mockReset();
		prismaMock.refreshToken.findMany.mockReset();
		prismaMock.refreshToken.create.mockReset();
		prismaMock.refreshToken.delete.mockReset();
		prismaMock.refreshToken.deleteMany.mockReset();
		prismaMock.$transaction.mockReset();

		prismaMock.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));

		jwtStrategyMock.issueTokens.mockResolvedValue({
			accessToken: 'new-access-token',
			refreshToken: 'new-refresh-token',
		});
		jwtStrategyMock.verifyRefreshToken.mockResolvedValue({
			sub: 'user-1',
			email: 'user@example.com',
			role: Role.USER,
			tokenType: 'refresh',
		});
		jwtStrategyMock.getRefreshTokenExpiryDate.mockReturnValue(new Date('2026-05-02T00:00:00.000Z'));

		prismaMock.user.findUnique.mockResolvedValue(profileUser());
		prismaMock.refreshToken.findMany.mockResolvedValue([]);
		prismaMock.refreshToken.create.mockResolvedValue({ id: 'refresh-session' });
		prismaMock.refreshToken.delete.mockResolvedValue({ id: 'refresh-session' });
		prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
	});

	afterAll(async () => {
		await app.close();
	});

	it('registers a user and never returns password', async () => {
		const rawPassword = 'Password123';
		const email = 'new-user@example.com';
		const createdUser = profileUser({
			id: 'user-new',
			email,
			password: '$2b$10$hashed-password',
		});

		prismaMock.user.findUnique.mockResolvedValueOnce(null);
		prismaMock.user.create.mockResolvedValueOnce({
			id: createdUser.id,
			email: createdUser.email,
			role: createdUser.role,
			createdAt: createdUser.createdAt,
			updatedAt: createdUser.updatedAt,
		});

		const response = await request(app.getHttpServer())
			.post('/auth/register')
			.send({
				email,
				password: rawPassword,
			})
			.expect(201);

		expect(response.body.success).toBe(true);
		expect(response.body.data.user).toMatchObject({
			id: createdUser.id,
			email,
			role: Role.USER,
		});
		expect(response.body.data.user.password).toBeUndefined();

		const createCall = prismaMock.user.create.mock.calls[0][0];
		expect(createCall.data.email).toBe(email);
		expect(createCall.data.password).not.toBe(rawPassword);
		expect(await bcrypt.compare(rawPassword, createCall.data.password)).toBe(true);
	});

	it('rejects register payload with invalid email', async () => {
		const response = await request(app.getHttpServer())
			.post('/auth/register')
			.send({
				email: 'invalid-email',
				password: 'Password123',
			})
			.expect(400);

		expect(response.body.success).toBe(false);
		expect(response.body.error).toBe('Bad Request');
		expect(Array.isArray(response.body.message)).toBe(true);
	});

	it('rejects register payload with short password', async () => {
		const response = await request(app.getHttpServer())
			.post('/auth/register')
			.send({
				email: 'short-password@example.com',
				password: 'short',
			})
			.expect(400);

		expect(response.body.success).toBe(false);
		expect(response.body.error).toBe('Bad Request');
		expect(Array.isArray(response.body.message)).toBe(true);
	});

	it('returns 409 when registering with existing email', async () => {
		prismaMock.user.findUnique.mockResolvedValueOnce(profileUser());

		const response = await request(app.getHttpServer())
			.post('/auth/register')
			.send({
				email: 'user@example.com',
				password: 'Password123',
			})
			.expect(409);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Email already exists');
	});

	it('logs in successfully and stores a hashed refresh token', async () => {
		const rawPassword = 'Password123';
		const storedPassword = await bcrypt.hash(rawPassword, 10);
		const refreshToken = 'refresh-token-login-12345';
		const user = profileUser({ password: storedPassword });

		prismaMock.user.findUnique.mockResolvedValueOnce(user);
		jwtStrategyMock.issueTokens.mockResolvedValueOnce({
			accessToken: 'access-token-login',
			refreshToken,
		});
		prismaMock.refreshToken.create.mockResolvedValueOnce({ id: 'refresh-session-login' });

		const response = await request(app.getHttpServer())
			.post('/auth/login')
			.send({
				email: user.email,
				password: rawPassword,
			})
			.expect(201);

		expect(response.body.success).toBe(true);
		expect(response.body.data).toMatchObject({
			accessToken: 'access-token-login',
			refreshToken,
			tokenType: 'Bearer',
			user: {
				id: user.id,
				email: user.email,
				role: user.role,
			},
		});
		expect(response.body.data.user.password).toBeUndefined();

		const createCall = prismaMock.refreshToken.create.mock.calls[0][0];
		expect(createCall.data.userId).toBe(user.id);
		expect(createCall.data.token).not.toBe(refreshToken);
		expect(await bcrypt.compare(refreshToken, createCall.data.token)).toBe(true);
		expect(createCall.data).not.toHaveProperty('accessToken');
	});

	it('rejects login with unknown email', async () => {
		prismaMock.user.findUnique.mockResolvedValueOnce(null);

		const response = await request(app.getHttpServer())
			.post('/auth/login')
			.send({
				email: 'missing@example.com',
				password: 'Password123',
			})
			.expect(401);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Email or password is incorrect');
	});

	it('rejects login with wrong password', async () => {
		prismaMock.user.findUnique.mockResolvedValueOnce(
			profileUser({
				password: await bcrypt.hash('CorrectPassword123', 10),
			}),
		);

		const response = await request(app.getHttpServer())
			.post('/auth/login')
			.send({
				email: 'user@example.com',
				password: 'WrongPassword123',
			})
			.expect(401);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Email or password is incorrect');
	});

	it('refreshes access token when refresh token is valid', async () => {
		const rawRefreshToken = 'refresh-token-valid-12345';
		const hashedRefreshToken = await bcrypt.hash(rawRefreshToken, 10);

		jwtStrategyMock.verifyRefreshToken.mockResolvedValueOnce({
			sub: 'user-1',
			email: 'user@example.com',
			role: Role.USER,
			tokenType: 'refresh',
		});
		prismaMock.user.findUnique.mockResolvedValueOnce(
			profileUser({
				id: 'user-1',
				email: 'user@example.com',
				role: Role.USER,
			}),
		);
		prismaMock.refreshToken.findMany.mockResolvedValueOnce([
			{
				id: 'session-old',
				token: hashedRefreshToken,
				userId: 'user-1',
				expiresAt: new Date('2026-05-01T00:00:00.000Z'),
			},
		]);
		jwtStrategyMock.issueTokens.mockResolvedValueOnce({
			accessToken: 'access-token-refreshed',
			refreshToken: 'refresh-token-rotated',
		});
		prismaMock.refreshToken.delete.mockResolvedValueOnce({ id: 'session-old' });
		prismaMock.refreshToken.create.mockResolvedValueOnce({ id: 'session-new' });

		const response = await request(app.getHttpServer())
			.post('/auth/refresh')
			.send({ refreshToken: rawRefreshToken })
			.expect(201);

		expect(response.body.success).toBe(true);
		expect(response.body.data).toMatchObject({
			accessToken: 'access-token-refreshed',
			refreshToken: 'refresh-token-rotated',
			tokenType: 'Bearer',
		});
		expect(prismaMock.refreshToken.delete).toHaveBeenCalledWith({
			where: { id: 'session-old' },
		});
		expect(prismaMock.refreshToken.create).toHaveBeenCalled();
		const createCall = prismaMock.refreshToken.create.mock.calls[0][0];
		expect(await bcrypt.compare('refresh-token-rotated', createCall.data.token)).toBe(true);
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
	});

	it('rejects refresh when token verification fails', async () => {
		jwtStrategyMock.verifyRefreshToken.mockRejectedValueOnce(
			new ForbiddenException('Invalid refresh token'),
		);

		const response = await request(app.getHttpServer())
			.post('/auth/refresh')
			.send({ refreshToken: 'invalid-refresh-token' })
			.expect(403);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Invalid refresh token');
	});

	it('rejects refresh when user is not found', async () => {
		jwtStrategyMock.verifyRefreshToken.mockResolvedValueOnce({
			sub: 'missing-user',
			email: 'missing@example.com',
			role: Role.USER,
			tokenType: 'refresh',
		});
		prismaMock.user.findUnique.mockResolvedValueOnce(null);

		const response = await request(app.getHttpServer())
			.post('/auth/refresh')
			.send({ refreshToken: 'refresh-token-12345' })
			.expect(404);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('User not found');
	});

	it('rejects refresh when token is not found in DB', async () => {
		jwtStrategyMock.verifyRefreshToken.mockResolvedValueOnce({
			sub: 'user-1',
			email: 'user@example.com',
			role: Role.USER,
			tokenType: 'refresh',
		});
		prismaMock.user.findUnique.mockResolvedValueOnce(profileUser());
		prismaMock.refreshToken.findMany.mockResolvedValueOnce([]);

		const response = await request(app.getHttpServer())
			.post('/auth/refresh')
			.send({ refreshToken: 'refresh-token-12345' })
			.expect(403);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Invalid refresh token');
	});

	it('logs out a single refresh session when refresh token is provided', async () => {
		const rawRefreshToken = 'refresh-token-logout-12345';
		const hashedRefreshToken = await bcrypt.hash(rawRefreshToken, 10);

		prismaMock.refreshToken.findMany.mockResolvedValueOnce([
			{
				id: 'session-logout',
				token: hashedRefreshToken,
				userId: 'user-1',
			},
		]);
		prismaMock.refreshToken.delete.mockResolvedValueOnce({ id: 'session-logout' });

		const response = await request(app.getHttpServer())
			.post('/auth/logout')
			.set('Authorization', 'Bearer valid-user-access-token')
			.send({ refreshToken: rawRefreshToken })
			.expect(201);

		expect(response.body.success).toBe(true);
		expect(response.body.data.message).toBe('Logged out successfully');
		expect(prismaMock.refreshToken.delete).toHaveBeenCalledWith({
			where: { id: 'session-logout' },
		});
	});

	it('logs out all refresh sessions when refresh token is omitted', async () => {
		const response = await request(app.getHttpServer())
			.post('/auth/logout')
			.set('Authorization', 'Bearer valid-user-access-token')
			.send({})
			.expect(201);

		expect(response.body.success).toBe(true);
		expect(response.body.data.message).toBe('Logged out successfully');
		expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
			where: { userId: 'user-1' },
		});
	});

	it('rejects logout when refresh token does not match stored session', async () => {
		prismaMock.refreshToken.findMany.mockResolvedValueOnce([]);

		const response = await request(app.getHttpServer())
			.post('/auth/logout')
			.set('Authorization', 'Bearer valid-user-access-token')
			.send({ refreshToken: 'invalid-refresh-token' })
			.expect(403);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Invalid refresh token');
	});

	it('returns current profile when access token is valid', async () => {
		prismaMock.user.findUnique.mockResolvedValueOnce({
			id: 'user-1',
			email: 'user@example.com',
			role: Role.USER,
			createdAt: baseTime,
			updatedAt: baseTime,
		});

		const response = await request(app.getHttpServer())
			.get('/auth/me')
			.set('Authorization', 'Bearer valid-user-access-token')
			.expect(200);

		expect(response.body.success).toBe(true);
		expect(response.body.data).toMatchObject({
			id: 'user-1',
			email: 'user@example.com',
			role: Role.USER,
		});
		expect(response.body.data.password).toBeUndefined();
	});

	it('rejects profile request without access token', async () => {
		const response = await request(app.getHttpServer())
			.get('/auth/me')
			.expect(401);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Invalid or missing access token');
	});

	it('allows admin route for ADMIN role', async () => {
		const response = await request(app.getHttpServer())
			.get('/auth/admin')
			.set('Authorization', 'Bearer valid-admin-access-token')
			.expect(200);

		expect(response.body.success).toBe(true);
		expect(response.body.data.message).toBe('Admin access granted');
		expect(response.body.data.user).toMatchObject({
			id: 'admin-1',
			email: 'admin@example.com',
			role: Role.ADMIN,
		});
	});

	it('rejects admin route for USER role', async () => {
		const response = await request(app.getHttpServer())
			.get('/auth/admin')
			.set('Authorization', 'Bearer valid-user-access-token')
			.expect(403);

		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Insufficient role');
	});
});
