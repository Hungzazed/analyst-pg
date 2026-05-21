import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure';
import { IngestMetricDto } from './dto/ingest-metric.dto';
import {
  assertRequestDomain,
  getUtcDayStart,
  normalizeString,
  parseUnixTimestamp,
  resolveClientContext,
} from './utils/metrics.utils';

const MAX_LEN = {
  EVENT_ID: 128,
  SESSION_ID: 128,
  USER_ID: 255,
  URL: 2048,
  TITLE: 255,
  REFERRER: 2048,
  IP: 64,
  USER_AGENT: 512,
  COUNTRY: 64,
  DEVICE: 128,
  BROWSER: 128,
  OS: 128,
  DOMAIN: 255,
} as const;

interface IngestEventInput {
  apiKey: string;
  dto: IngestMetricDto;
  origin?: string;
  referer?: string;
  countryHint?: string;
  ip?: string;
  userAgent?: string;
}

interface MetricsEventMessage {
  eventId: string;
  websiteId: string;
  externalSessionId?: string;
  type: EventType;
  timestamp: number;
  url?: string;
  title?: string;
  referrer?: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
  metadata?: Record<string, unknown>;
}

interface SessionResolution {
  sessionId: string;
  isNewSession: boolean;
  isUniqueVisitor: boolean;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prismaService: PrismaService) {}

  async ingestEvent(input: IngestEventInput) {
    const apiKey = normalizeString(input.apiKey);

    if (!apiKey) {
      throw new BadRequestException('x-api-key header is required');
    }

    if (input.dto.type === EventType.PAGEVIEW && !input.dto.url) {
      throw new BadRequestException('url is required for PAGEVIEW events');
    }

    const websiteApiKey = await this.prismaService.apiKey.findFirst({
      where: {
        key: apiKey,
        revoked: false,
      },
      select: {
        websiteId: true,
        website: {
          select: {
            domain: true,
          },
        },
      },
    });

    if (!websiteApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    assertRequestDomain({
      websiteDomain: websiteApiKey.website.domain,
      origin: input.origin,
      referer: input.referer,
    });

    const externalEventId = normalizeString(
      input.dto.eventId,
      MAX_LEN.EVENT_ID,
    );
    if (!externalEventId) {
      throw new BadRequestException('eventId is required');
    }

    const occurredAt = parseUnixTimestamp(input.dto.timestamp);
    const externalSessionId = normalizeString(
      input.dto.sessionId,
      MAX_LEN.SESSION_ID,
    );
    const clientContext = resolveClientContext({
      ip: input.ip,
      userAgent: input.userAgent,
      countryHint: input.countryHint,
    });

    const message: MetricsEventMessage = {
      eventId: externalEventId,
      websiteId: websiteApiKey.websiteId,
      externalSessionId,
      type: input.dto.type,
      timestamp: occurredAt.getTime(),
      url: normalizeString(input.dto.url, MAX_LEN.URL),
      title: normalizeString(input.dto.title, MAX_LEN.TITLE),
      referrer: normalizeString(input.dto.referrer, MAX_LEN.REFERRER),
      ip: clientContext.ip,
      userAgent: clientContext.userAgent,
      userId: normalizeString(input.dto.userId ?? undefined, MAX_LEN.USER_ID),
      country: clientContext.country,
      device: clientContext.device,
      browser: clientContext.browser,
      os: clientContext.os,
      metadata: input.dto.metadata,
    };

    await this.persistEvent(message);

    return {
      accepted: true,
      queued: false,
      externalEventId,
      websiteId: websiteApiKey.websiteId,
      occurredAt,
    };
  }

  private async persistEvent(message: MetricsEventMessage): Promise<void> {
    const occurredAt = parseUnixTimestamp(message.timestamp);
    const dayStart = getUtcDayStart(occurredAt);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const fields = {
      ip: normalizeString(message.ip, MAX_LEN.IP),
      userAgent: normalizeString(message.userAgent, MAX_LEN.USER_AGENT),
      country: normalizeString(message.country, MAX_LEN.COUNTRY),
      device: normalizeString(message.device, MAX_LEN.DEVICE),
      browser: normalizeString(message.browser, MAX_LEN.BROWSER),
      os: normalizeString(message.os, MAX_LEN.OS),
      url: normalizeString(message.url, MAX_LEN.URL),
      referrer: normalizeString(message.referrer, MAX_LEN.REFERRER),
      title: normalizeString(message.title, MAX_LEN.TITLE),
      externalSessionId: normalizeString(
        message.externalSessionId,
        MAX_LEN.SESSION_ID,
      ),
      userId: normalizeString(message.userId, MAX_LEN.USER_ID),
      metadata: message.metadata
        ? (message.metadata as Prisma.InputJsonValue)
        : undefined,
    };

    await this.prismaService.$transaction(async (tx) => {
      const existingEvent = await tx.event.findFirst({
        where: {
          websiteId: message.websiteId,
          eventId: message.eventId,
        },
        select: {
          id: true,
        },
      });

      if (existingEvent) {
        return;
      }

      const { sessionId, isNewSession, isUniqueVisitor } =
        await this.resolveOrCreateSession(tx, {
          websiteId: message.websiteId,
          externalSessionId: fields.externalSessionId,
          userId: fields.userId,
          ip: fields.ip,
          userAgent: fields.userAgent,
          country: fields.country,
          device: fields.device,
          browser: fields.browser,
          os: fields.os,
          dayStart,
          dayEnd,
        });

      await this.createEvent(tx, {
        message,
        sessionId,
        occurredAt,
        fields,
      });

      await this.updateDailyStats(tx, {
        websiteId: message.websiteId,
        eventType: message.type,
        dayStart,
        isNewSession,
        isUniqueVisitor,
      });
    });
  }

  private async resolveOrCreateSession(
    tx: Prisma.TransactionClient,
    input: {
      websiteId: string;
      externalSessionId?: string;
      userId?: string;
      ip?: string;
      userAgent?: string;
      country?: string;
      device?: string;
      browser?: string;
      os?: string;
      dayStart: Date;
      dayEnd: Date;
    },
  ): Promise<SessionResolution> {
    if (input.externalSessionId) {
      const existingSession = await tx.session.findFirst({
        where: {
          websiteId: input.websiteId,
          externalSessionId: input.externalSessionId,
        },
        select: {
          id: true,
        },
      });

      if (existingSession) {
        await tx.session.update({
          where: { id: existingSession.id },
          data: {
            userId: input.userId,
            ip: input.ip,
            userAgent: input.userAgent,
            country: input.country,
            device: input.device,
            browser: input.browser,
            os: input.os,
          },
        });

        return {
          sessionId: existingSession.id,
          isNewSession: false,
          isUniqueVisitor: false,
        };
      }
    }

    const isUniqueVisitor = await this.determineUniqueVisitor(tx, {
      websiteId: input.websiteId,
      externalSessionId: input.externalSessionId,
      ip: input.ip,
      dayStart: input.dayStart,
      dayEnd: input.dayEnd,
    });

    const createdSession = await tx.session.create({
      data: {
        websiteId: input.websiteId,
        externalSessionId: input.externalSessionId,
        userId: input.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        country: input.country,
        device: input.device,
        browser: input.browser,
        os: input.os,
      },
      select: {
        id: true,
      },
    });

    return {
      sessionId: createdSession.id,
      isNewSession: true,
      isUniqueVisitor,
    };
  }

  private async determineUniqueVisitor(
    tx: Prisma.TransactionClient,
    input: {
      websiteId: string;
      externalSessionId?: string;
      ip?: string;
      dayStart: Date;
      dayEnd: Date;
    },
  ): Promise<boolean> {
    if (input.externalSessionId) {
      return true;
    }

    if (input.ip) {
      const seenToday = await tx.session.findFirst({
        where: {
          websiteId: input.websiteId,
          ip: input.ip,
          createdAt: {
            gte: input.dayStart,
            lt: input.dayEnd,
          },
        },
        select: {
          id: true,
        },
      });

      return !seenToday;
    }

    return true;
  }

  private async createEvent(
    tx: Prisma.TransactionClient,
    input: {
      message: MetricsEventMessage;
      sessionId: string;
      occurredAt: Date;
      fields: {
        ip?: string;
        userAgent?: string;
        country?: string;
        device?: string;
        browser?: string;
        os?: string;
        url?: string;
        referrer?: string;
        title?: string;
        userId?: string;
        metadata?: Prisma.InputJsonValue;
      };
    },
  ): Promise<void> {
    await tx.event.create({
      data: {
        websiteId: input.message.websiteId,
        sessionId: input.sessionId,
        eventId: input.message.eventId,
        userId: input.fields.userId,
        type: input.message.type,
        title: input.fields.title,
        url: input.fields.url,
        referrer: input.fields.referrer,
        userAgent: input.fields.userAgent,
        ip: input.fields.ip,
        country: input.fields.country,
        device: input.fields.device,
        browser: input.fields.browser,
        os: input.fields.os,
        metadata: input.fields.metadata,
        occurredAt: input.occurredAt,
      },
    });
  }

  private async updateDailyStats(
    tx: Prisma.TransactionClient,
    input: {
      websiteId: string;
      eventType: EventType;
      dayStart: Date;
      isNewSession: boolean;
      isUniqueVisitor: boolean;
    },
  ): Promise<void> {
    const pageviewsIncrement = input.eventType === EventType.PAGEVIEW ? 1 : 0;
    const visitsIncrement = input.isNewSession ? 1 : 0;
    const uniquesIncrement = input.isUniqueVisitor ? 1 : 0;

    if (
      pageviewsIncrement === 0 &&
      visitsIncrement === 0 &&
      uniquesIncrement === 0
    ) {
      return;
    }

    await tx.eventDaily.upsert({
      where: {
        websiteId_date: {
          websiteId: input.websiteId,
          date: input.dayStart,
        },
      },
      update: {
        pageviews: {
          increment: pageviewsIncrement,
        },
        visits: {
          increment: visitsIncrement,
        },
        uniques: {
          increment: uniquesIncrement,
        },
      },
      create: {
        websiteId: input.websiteId,
        date: input.dayStart,
        pageviews: pageviewsIncrement,
        visits: visitsIncrement,
        uniques: uniquesIncrement,
      },
    });
  }
}
