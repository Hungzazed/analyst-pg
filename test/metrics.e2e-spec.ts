/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventType, Prisma } from '@prisma/client';
import request from 'supertest';
import { MetricsController } from '../src/modules/metrics/metrics.controller';
import { MetricsKafkaConsumer } from '../src/modules/metrics/kafka/metrics-kafka.consumer';
import { MetricsKafkaProducer } from '../src/modules/metrics/kafka/metrics-kafka.producer';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import {
  HttpExceptionFilter,
  ResponseInterceptor,
} from '../src/common';
import { KafkaService, PrismaService } from '../src/infrastructure';

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

type KafkaMessageRecord = {
  topic: string;
  messages: Array<{
    key?: string;
    value: string;
  }>;
};

class FakeKafkaConsumer {
  subscribe = jest.fn().mockResolvedValue(undefined);
  run = jest.fn(async (config: { eachMessage: (payload: any) => Promise<void> }) => {
    this.eachMessage = config.eachMessage;
  });
  disconnect = jest.fn().mockResolvedValue(undefined);

  eachMessage?: (payload: { message: { value: Buffer | null } }) => Promise<void>;
}

class FakeKafkaService {
  readonly sentMessages: KafkaMessageRecord[] = [];
  readonly consumers: FakeKafkaConsumer[] = [];

  send = jest.fn(async (params: KafkaMessageRecord) => {
    this.sentMessages.push(params);
  });

  createConsumer = jest.fn(async () => {
    const consumer = new FakeKafkaConsumer();
    this.consumers.push(consumer);
    return consumer;
  });

  releaseConsumer = jest.fn(async (consumer: FakeKafkaConsumer) => {
    await consumer.disconnect();
  });

  reset(): void {
    this.sentMessages.length = 0;
    this.send.mockClear();
  }
}

class InMemoryPrismaService {
  readonly apiKeys = new Map<string, ApiKeyRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly events = new Map<string, StoredEvent>();
  readonly eventDailies = new Map<string, StoredEventDaily>();
  private counter = 0;

  readonly apiKey = {
    findFirst: jest.fn(async (query: { where: { key: string; revoked: boolean } }) => {
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
    }),
  };

  readonly event = {
    findFirst: jest.fn(async (query: { where: { websiteId: string; eventId: string } }) => {
      return this.events.get(this.eventKey(query.where.websiteId, query.where.eventId)) ?? null;
    }),
    create: jest.fn(async (input: { data: Omit<StoredEvent, 'id' | 'createdAt'> }) => {
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
    }),
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
    create: jest.fn(async (input: { data: Omit<StoredSession, 'id' | 'createdAt' | 'lastSeenAt'> }) => {
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
    }),
    update: jest.fn(async (input: { where: { id: string }; data: Partial<StoredSession> }) => {
      const session = this.sessions.get(input.where.id);

      if (!session) {
        throw new Error('Session not found');
      }

      Object.assign(session, input.data, {
        lastSeenAt: new Date('2026-04-26T00:00:00.000Z'),
      });

      return { id: session.id };
    }),
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

  readonly $transaction = jest.fn(async <T>(callback: (tx: any) => Promise<T>) => {
    return callback({
      event: this.event,
      session: this.session,
      eventDaily: this.eventDaily,
    });
  });

  registerApiKey(input: { key: string; websiteId: string; domain: string; revoked?: boolean }): void {
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
  let kafka: FakeKafkaService;
  let metricsKafkaConsumer: MetricsKafkaConsumer;

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
    country: 'VN',
    device: 'desktop',
    browser: 'Chrome',
    os: 'Windows',
    metadata: { plan: 'pro' },
    ...overrides,
  });

  const getKafkaConsumer = () => {
    const consumer = kafka.consumers[0];

    if (!consumer || !consumer.eachMessage) {
      throw new Error('Kafka consumer was not initialized');
    }

    return consumer;
  };

  const publishToConsumer = async (message: Record<string, unknown> | string) => {
    const consumer = getKafkaConsumer();
    const value = typeof message === 'string' ? message : JSON.stringify(message);
    const eachMessage = consumer.eachMessage;

    if (!eachMessage) {
      throw new Error('Kafka consumer callback was not initialized');
    }

    await eachMessage({
      message: {
        value: Buffer.from(value),
      },
    });
  };

  beforeAll(async () => {
    prisma = new InMemoryPrismaService();
    kafka = new FakeKafkaService();

    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        MetricsKafkaProducer,
        MetricsKafkaConsumer,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: KafkaService,
          useValue: kafka,
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

    metricsKafkaConsumer = moduleRef.get(MetricsKafkaConsumer);
    await metricsKafkaConsumer.onModuleInit();
  });

  beforeEach(() => {
    prisma.reset();
    kafka.reset();
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

  it('boots the metrics consumer and subscribes to the Kafka topic', () => {
    expect(kafka.createConsumer).toHaveBeenCalledWith(
      expect.stringContaining('metrics-events'),
    );
    expect(kafka.consumers[0]?.subscribe).toHaveBeenCalledWith({
      topic: 'metrics.events',
      fromBeginning: false,
    });
  });

  it('ingests a pageview event, queues it, and allows the consumer to persist it', async () => {
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
      queued: true,
      externalEventId: 'evt_01J8M3Y3B3T5X7C2D4E6F8G9H0',
      websiteId: 'website_1',
    });

    expect(kafka.send).toHaveBeenCalledTimes(1);
    expect(kafka.sentMessages[0]).toMatchObject({
      topic: 'metrics.events',
      messages: [
        {
          key: 'website_1',
        },
      ],
    });

    const queuedMessage = JSON.parse(kafka.sentMessages[0].messages[0].value) as {
      eventId: string;
      websiteId: string;
      timestamp: number;
      ip?: string;
      userAgent?: string;
      externalSessionId?: string;
    };

    expect(queuedMessage).toMatchObject({
      eventId: 'evt_01J8M3Y3B3T5X7C2D4E6F8G9H0',
      websiteId: 'website_1',
      timestamp: baseTimestampMs,
      ip: '203.113.10.20',
      userAgent: 'Mozilla/5.0 (Macintosh)',
      externalSessionId: 'sess_01J8M3Y3B3T5X7C2D4E6F8G9H0',
    });

    await publishToConsumer(queuedMessage);

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

  it('trims and normalizes request fields before enqueue', async () => {
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

    const queuedMessage = JSON.parse(kafka.sentMessages[0].messages[0].value) as {
      eventId: string;
      externalSessionId?: string;
      userId?: string;
      title?: string;
    };

    expect(queuedMessage).toMatchObject({
      eventId: 'evt_trimmed',
      externalSessionId: 'sess_trimmed',
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

    expect(kafka.send).toHaveBeenCalledTimes(1);
  });

  it('accepts subdomain origins for the same website', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://app.shop.example.com')
      .send(buildPayload())
      .expect(201);

    expect(kafka.send).toHaveBeenCalledTimes(1);
  });

  it('rejects missing api key header', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('origin', 'https://shop.example.com')
      .send(buildPayload())
      .expect(400);

    expect(kafka.send).not.toHaveBeenCalled();
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

    expect(kafka.send).not.toHaveBeenCalled();
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

    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('rejects mismatched domains', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://evil.example.net')
      .send(buildPayload())
      .expect(403);

    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('rejects requests without origin or referer headers', async () => {
    await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .send(buildPayload())
      .expect(403);

    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('converts unix seconds timestamps before enqueue', async () => {
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

    const queuedMessage = JSON.parse(kafka.sentMessages[0].messages[0].value) as {
      timestamp: number;
    };

    expect(queuedMessage.timestamp).toBe(1713945600000);
  });

  it('persists existing session events without duplicating the session', async () => {
    const firstPayload = buildPayload();
    const firstResponse = await request(app.getHttpServer())
      .post('/metrics/events')
      .set('x-api-key', 'valid-key')
      .set('origin', 'https://shop.example.com')
      .send(firstPayload)
      .expect(201);

    await publishToConsumer(JSON.parse(kafka.sentMessages[0].messages[0].value));

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

    await publishToConsumer(JSON.parse(kafka.sentMessages[1].messages[0].value));

    expect(prisma.sessions.size).toBe(1);
    expect(prisma.events.size).toBe(2);
    expect(prisma.eventDailies.size).toBe(1);

    const responseData = firstResponse.body.data as { accepted: boolean; queued: boolean };
    expect(responseData.accepted).toBe(true);
    expect(responseData.queued).toBe(true);
  });

  it('consumer creates a new session for first pageview and updates counters', async () => {
    await publishToConsumer({
      eventId: 'evt_consumer_1',
      websiteId: 'website_1',
      externalSessionId: 'sess_consumer_1',
      type: EventType.PAGEVIEW,
      timestamp: baseTimestampMs,
      url: 'https://shop.example.com/home',
      referrer: 'https://google.com',
      ip: '198.51.100.10',
      userAgent: 'Mozilla/5.0',
      metadata: { source: 'e2e' },
    });

    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
    expect(prisma.eventDaily.upsert).toHaveBeenCalledTimes(1);

    const daily = Array.from(prisma.eventDailies.values())[0];
    expect(daily).toMatchObject({
      pageviews: 1,
      visits: 1,
      uniques: 1,
    });
  });

  it('consumer reuses an existing session for the same external session id', async () => {
    await publishToConsumer({
      eventId: 'evt_consumer_2',
      websiteId: 'website_1',
      externalSessionId: 'sess_shared',
      type: EventType.PAGEVIEW,
      timestamp: baseTimestampMs,
      url: 'https://shop.example.com/home',
      referrer: 'https://google.com',
      ip: '198.51.100.10',
      userAgent: 'Mozilla/5.0',
      metadata: {},
    });

    await publishToConsumer({
      eventId: 'evt_consumer_3',
      websiteId: 'website_1',
      externalSessionId: 'sess_shared',
      type: EventType.PAGEVIEW,
      timestamp: baseTimestampMs + 1000,
      url: 'https://shop.example.com/about',
      referrer: 'https://shop.example.com/home',
      ip: '198.51.100.10',
      userAgent: 'Mozilla/5.0',
      metadata: {},
    });

    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(prisma.session.update).toHaveBeenCalled();

    const daily = Array.from(prisma.eventDailies.values())[0];
    expect(daily).toMatchObject({
      pageviews: 2,
      visits: 1,
      uniques: 1,
    });
  });

  it('consumer counts unique visitor by ip when session id is missing', async () => {
    await publishToConsumer({
      eventId: 'evt_consumer_4',
      websiteId: 'website_1',
      type: EventType.PAGEVIEW,
      timestamp: baseTimestampMs,
      url: 'https://shop.example.com/home',
      referrer: 'https://google.com',
      ip: '198.51.100.11',
      userAgent: 'Mozilla/5.0',
    });

    const daily = Array.from(prisma.eventDailies.values())[0];
    expect(daily).toMatchObject({
      uniques: 1,
    });
  });

  it('consumer does not increment daily counters for non-pageview events in an existing session', async () => {
    prisma.sessions.set('session_existing', {
      id: 'session_existing',
      websiteId: 'website_1',
      externalSessionId: 'sess_click',
      userId: null,
      ip: '198.51.100.12',
      userAgent: 'Mozilla/5.0',
      country: null,
      device: null,
      browser: null,
      os: null,
      createdAt: new Date(baseTimestampMs),
      lastSeenAt: new Date(baseTimestampMs),
    });
    prisma.session.findFirst.mockResolvedValueOnce({ id: 'session_existing' });

    await publishToConsumer({
      eventId: 'evt_consumer_5',
      websiteId: 'website_1',
      externalSessionId: 'sess_click',
      type: EventType.CLICK,
      timestamp: baseTimestampMs,
      url: 'https://shop.example.com/home',
      referrer: 'https://shop.example.com/home',
      ip: '198.51.100.12',
      userAgent: 'Mozilla/5.0',
      metadata: { buttonId: 'cta' },
    });

    expect(prisma.eventDaily.upsert).not.toHaveBeenCalled();
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
  });

  it('consumer ignores duplicate events when the same event id is delivered twice', async () => {
    const payload = {
      eventId: 'evt_consumer_dup',
      websiteId: 'website_1',
      externalSessionId: 'sess_dup',
      type: EventType.PAGEVIEW,
      timestamp: baseTimestampMs,
      url: 'https://shop.example.com/home',
      referrer: 'https://google.com',
      ip: '198.51.100.13',
      userAgent: 'Mozilla/5.0',
      metadata: {},
    };

    await publishToConsumer(payload);
    await publishToConsumer(payload);

    expect(prisma.event.create).toHaveBeenCalledTimes(1);
    expect(prisma.eventDaily.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.events.size).toBe(1);
  });

  it('consumer ignores malformed kafka json payloads', async () => {
    await publishToConsumer('{');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('consumer rejects invalid timestamps', async () => {
    await expect(
      publishToConsumer({
        eventId: 'evt_bad_timestamp',
        websiteId: 'website_1',
        type: EventType.PAGEVIEW,
        timestamp: Number.NaN,
      }),
    ).rejects.toThrow('Invalid event timestamp in Kafka message');
  });
});