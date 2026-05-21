/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventType, Prisma } from '@prisma/client';
import request from 'supertest';
import { MetricsController } from '../src/modules/metrics/metrics.controller';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { HttpExceptionFilter, ResponseInterceptor } from '../src/common';
import { PrismaService } from '../src/infrastructure';

type ApiKeyRecord = {
  websiteId: string;
  domain: string;
  revoked: boolean;
};

type StoredSession = {
  id: string;
  websiteId: string;
  externalSessionId?: string | null;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  device?: string | null;
  browser?: string | null;
  os?: string | null;
  createdAt: Date;
  lastSeenAt: Date;
};

type StoredEvent = {
  id: string;
  websiteId: string;
  sessionId?: string | null;
  eventId: string;
  userId?: string | null;
  type: EventType;
  title?: string | null;
  url?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  country?: string | null;
  device?: string | null;
  browser?: string | null;
  os?: string | null;
  metadata?: Prisma.InputJsonValue;
  occurredAt: Date;
  createdAt: Date;
};

type StoredEventDaily = {
  websiteId: string;
  date: Date;
  pageviews: number;
  visits: number;
  uniques: number;
};

class InMemoryPrismaService {
  readonly apiKeys = new Map<string, ApiKeyRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly events = new Map<string, StoredEvent>();
  readonly eventDailies = new Map<string, StoredEventDaily>();
  private counter = 0;

  readonly apiKey = {
    findFirst: jest.fn(
      async (query: { where: { key: string; revoked: boolean } }) => {
        await Promise.resolve();
        const record = this.apiKeys.get(query.where.key);

        if (!record || record.revoked !== query.where.revoked) {
          return null;
        }

        return {
          websiteId: record.websiteId,
          website: {
            domain: record.domain,
          },
        };
      },
    ),
  };

  readonly event = {
    findFirst: jest.fn(
      async (query: { where: { websiteId: string; eventId: string } }) => {
        await Promise.resolve();
        return (
          this.events.get(
            this.eventKey(query.where.websiteId, query.where.eventId),
          ) ?? null
        );
      },
    ),
    create: jest.fn(
      async (input: { data: Omit<StoredEvent, 'id' | 'createdAt'> }) => {
        await Promise.resolve();
        const id = this.nextId('event');
        const createdAt = new Date('2026-04-26T00:00:00.000Z');
        const event: StoredEvent = {
          id,
          createdAt,
          ...input.data,
        };

        this.events.set(this.eventKey(event.websiteId, event.eventId), event);
        return {
          id,
          eventId: event.eventId,
          createdAt,
        };
      },
    ),
  };

  readonly session = {
    findFirst: jest.fn(
      async (query: {
        where: {
          websiteId: string;
          externalSessionId?: string | null;
          ip?: string | null;
          createdAt?: { gte: Date; lt: Date };
        };
      }) => {
        await Promise.resolve();
        const { websiteId, externalSessionId, ip, createdAt } = query.where;

        for (const session of this.sessions.values()) {
          if (session.websiteId !== websiteId) {
            continue;
          }

          if (externalSessionId !== undefined) {
            if (session.externalSessionId === externalSessionId) {
              return { id: session.id };
            }

            continue;
          }

          if (ip && createdAt) {
            const occurred = session.createdAt.getTime();
            if (
              session.ip === ip &&
              occurred >= createdAt.gte.getTime() &&
              occurred < createdAt.lt.getTime()
            ) {
              return { id: session.id };
            }
          }
        }

        return null;
      },
    ),
    create: jest.fn(
      async (input: {
        data: Omit<StoredSession, 'id' | 'createdAt' | 'lastSeenAt'>;
      }) => {
        await Promise.resolve();
        const id = this.nextId('session');
        const createdAt = new Date('2026-04-26T00:00:00.000Z');
        const session: StoredSession = {
          id,
          createdAt,
          lastSeenAt: createdAt,
          ...input.data,
        };

        this.sessions.set(id, session);
        return { id };
      },
    ),
    update: jest.fn(
      async (input: {
        where: { id: string };
        data: Partial<StoredSession>;
      }) => {
        await Promise.resolve();
        const session = this.sessions.get(input.where.id);

        if (!session) {
          throw new Error('Session not found');
        }

        Object.assign(session, input.data, {
          lastSeenAt: new Date('2026-04-26T00:00:00.000Z'),
        });

        return { id: session.id };
      },
    ),
  };

  readonly eventDaily = {
    upsert: jest.fn(
      async (input: {
        where: { websiteId_date: { websiteId: string; date: Date } };
        update: {
          pageviews: { increment: number };
          visits: { increment: number };
          uniques: { increment: number };
        };
        create: StoredEventDaily;
      }) => {
        await Promise.resolve();
        const key = this.dailyKey(
          input.where.websiteId_date.websiteId,
          input.where.websiteId_date.date,
        );

        const existing = this.eventDailies.get(key);

        if (!existing) {
          const created = { ...input.create };
          this.eventDailies.set(key, created);
          return created;
        }

        existing.pageviews += input.update.pageviews.increment;
        existing.visits += input.update.visits.increment;
        existing.uniques += input.update.uniques.increment;
        return existing;
      },
    ),
  };

  readonly $transaction = jest.fn(
    async <T>(callback: (tx: any) => Promise<T>) => {
      return callback({
        event: this.event,
        session: this.session,
        eventDaily: this.eventDaily,
      });
    },
  );

  registerApiKey(input: {
    key: string;
    websiteId: string;
    domain: string;
    revoked?: boolean;
  }): void {
    this.apiKeys.set(input.key, {
      websiteId: input.websiteId,
      domain: input.domain,
      revoked: input.revoked ?? false,
    });
  }

  reset(): void {
    this.apiKeys.clear();
    this.sessions.clear();
    this.events.clear();
    this.eventDailies.clear();
    this.counter = 0;
    this.apiKey.findFirst.mockClear();
    this.event.findFirst.mockClear();
    this.event.create.mockClear();
    this.session.findFirst.mockClear();
    this.session.create.mockClear();
    this.session.update.mockClear();
    this.eventDaily.upsert.mockClear();
    this.$transaction.mockClear();
  }

  private eventKey(websiteId: string, eventId: string): string {
    return `${websiteId}:${eventId}`;
  }

  private dailyKey(websiteId: string, date: Date): string {
    return `${websiteId}:${date.toISOString()}`;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }
}

describe('Metrics flow e2e', () => {
  let app: INestApplication;
  let prisma: InMemoryPrismaService;

  const baseTimestampMs = Date.parse('2026-04-26T12:00:00.000Z');

  const buildPayload = (overrides: Partial<Record<string, unknown>> = {}) => ({
    eventId: 'evt_01J8M3Y3B3T5X7C2D4E6F8G9H0',
    type: EventType.PAGEVIEW,
    timestamp: baseTimestampMs,
    sessionId: 'sess_01J8M3Y3B3T5X7C2D4E6F8G9H0',
    url: 'https://shop.example.com/pricing',
    referrer: 'https://google.com',
    title: 'Pricing',
    userId: 'user_1',
    metadata: { plan: 'pro' },
    ...overrides,
  });

  beforeAll(async () => {
    prisma = new InMemoryPrismaService();

    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

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
    prisma.reset();
    prisma.registerApiKey({
      key: 'valid-key',
      websiteId: 'website_1',
      domain: 'shop.example.com',
    });
    prisma.registerApiKey({
      key: 'revoked-key',
      websiteId: 'website_1',
      domain: 'shop.example.com',
      revoked: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('ingests a pageview event and persists it directly', async () => {
    const response = await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .set('x-forwarded-for', '203.113.10.20, 10.0.0.1')
      .set('user-agent', 'Mozilla/5.0 (Macintosh)')
      .send(buildPayload())
      .expect(201);

    expect(response.body.data).toMatchObject({
      accepted: true,
      queued: false,
      externalEventId: 'evt_01J8M3Y3B3T5X7C2D4E6F8G9H0',
      websiteId: 'website_1',
    });

    expect(prisma.sessions.size).toBe(1);
    expect(prisma.events.size).toBe(1);
    expect(prisma.eventDailies.size).toBe(1);

    const daily = Array.from(prisma.eventDailies.values())[0];
    expect(daily).toMatchObject({
      websiteId: 'website_1',
      pageviews: 1,
      visits: 1,
      uniques: 1,
    });
  });

  it('trims and normalizes request fields before persist', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', '   valid-key   ')
      .set('origin', 'https://shop.example.com')
      .set('user-agent', 'Header UA')
      .send(
        buildPayload({
          eventId: '  evt_trimmed  ',
          sessionId: '  sess_trimmed  ',
          userId: '  user_trimmed  ',
          title: '  Pricing page  ',
        }),
      )
      .expect(201);

    expect(prisma.events.size).toBe(1);
    const event = prisma.events.get('website_1:evt_trimmed');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      eventId: 'evt_trimmed',
      userId: 'user_trimmed',
      title: 'Pricing page',
    });
  });

  it('uses referer when origin is missing', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('referer', 'https://shop.example.com/pricing')
      .send(buildPayload())
      .expect(201);

    expect(prisma.events.size).toBe(1);
  });

  it('accepts subdomain origins for the same website', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://app.shop.example.com')
      .send(buildPayload())
      .expect(201);

    expect(prisma.events.size).toBe(1);
  });

  it('rejects missing api key header', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('origin', 'https://shop.example.com')
      .send(buildPayload())
      .expect(400);

    expect(prisma.events.size).toBe(0);
  });

  it('rejects invalid pageview payload when url is missing', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .send(
        buildPayload({
          url: undefined,
        }),
      )
      .expect(400);

    expect(prisma.events.size).toBe(0);
  });

  it('rejects validation errors from malformed payloads', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .send({
        ...buildPayload(),
        type: 'NOT_A_REAL_EVENT',
      })
      .expect(400);
  });

  it('rejects invalid api keys and revoked keys', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'missing-key')
      .set('origin', 'https://shop.example.com')
      .send(buildPayload())
      .expect(401);

    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'revoked-key')
      .set('origin', 'https://shop.example.com')
      .send(buildPayload())
      .expect(401);

    expect(prisma.events.size).toBe(0);
  });

  it('rejects mismatched domains', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://evil.example.net')
      .send(buildPayload())
      .expect(403);

    expect(prisma.events.size).toBe(0);
  });

  it('rejects requests without origin or referer headers', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .send(buildPayload())
      .expect(403);

    expect(prisma.events.size).toBe(0);
  });

  it('converts unix seconds timestamps before persist', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .send(
        buildPayload({
          timestamp: 1713945600,
        }),
      )
      .expect(201);

    const event = prisma.events.get('website_1:evt_01J8M3Y3B3T5X7C2D4E6F8G9H0');
    expect(event).toBeDefined();
    expect(event!.occurredAt.getTime()).toBe(1713945600000);
  });

  it('persists existing session events without duplicating the session', async () => {
    const firstPayload = buildPayload();
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .send(firstPayload)
      .expect(201);

    expect(prisma.sessions.size).toBe(1);
    expect(prisma.eventDailies.size).toBe(1);

    const secondPayload = {
      ...firstPayload,
      eventId: 'evt_duplicated_2',
    };

    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .send(secondPayload)
      .expect(201);

    expect(prisma.sessions.size).toBe(1);
    expect(prisma.events.size).toBe(2);
    expect(prisma.eventDailies.size).toBe(1);
  });
});
