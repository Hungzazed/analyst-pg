import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure';
import { IngestMetricDto } from './dto/ingest-metric.dto';

interface IngestEventInput {
  apiKey: string;
  dto: IngestMetricDto;
  origin?: string;
  referer?: string;
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

@Injectable()
export class MetricsService {
  constructor(private readonly prismaService: PrismaService) {}

  async ingestEvent(input: IngestEventInput) {
    const apiKey = this.normalize(input.apiKey);

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

    this.assertRequestDomain({
      websiteDomain: websiteApiKey.website.domain,
      origin: input.origin,
      referer: input.referer,
    });

    const externalEventId = this.normalize(input.dto.eventId, 128);
    if (!externalEventId) {
      throw new BadRequestException('eventId is required');
    }

    const occurredAt = this.parseUnixTimestamp(input.dto.timestamp);
    const externalSessionId = this.normalize(input.dto.sessionId, 128);

    const message: MetricsEventMessage = {
      eventId: externalEventId,
      websiteId: websiteApiKey.websiteId,
      externalSessionId,
      type: input.dto.type,
      timestamp: occurredAt.getTime(),
      url: this.normalize(input.dto.url, 2048),
      title: this.normalize(input.dto.title, 255),
      referrer: this.normalize(input.dto.referrer, 2048),
      ip: this.normalize(input.ip, 64),
      userAgent: this.normalize(input.userAgent, 512),
      userId: this.normalize(input.dto.userId ?? undefined, 255),
      country: this.normalize(input.dto.country, 64),
      device: this.normalize(input.dto.device, 128),
      browser: this.normalize(input.dto.browser, 128),
      os: this.normalize(input.dto.os, 128),
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
    const occurredAt = this.parseUnixTimestamp(message.timestamp);
    const dayStart = this.getUtcDayStart(occurredAt);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const ip = this.normalize(message.ip, 64);
    const userAgent = this.normalize(message.userAgent, 512);
    const country = this.normalize(message.country, 64);
    const device = this.normalize(message.device, 128);
    const browser = this.normalize(message.browser, 128);
    const os = this.normalize(message.os, 128);
    const url = this.normalize(message.url, 2048);
    const referrer = this.normalize(message.referrer, 2048);
    const title = this.normalize(message.title, 255);
    const externalSessionId = this.normalize(message.externalSessionId, 128);
    const userId = this.normalize(message.userId, 255);
    const metadata = message.metadata
      ? (message.metadata as Prisma.InputJsonValue)
      : undefined;

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

      let sessionId: string | undefined;
      let isNewSession = false;
      let isUniqueVisitor = false;

      if (externalSessionId) {
        const existingSession = await tx.session.findFirst({
          where: {
            websiteId: message.websiteId,
            externalSessionId,
          },
          select: {
            id: true,
          },
        });

        if (existingSession) {
          sessionId = existingSession.id;
          await tx.session.update({
            where: { id: sessionId },
            data: {
              userId,
              ip,
              userAgent,
              country,
              device,
              browser,
              os,
            },
          });
        }
      }

      if (!sessionId) {
        isNewSession = true;

        if (externalSessionId) {
          isUniqueVisitor = true;
        } else if (ip) {
          const seenToday = await tx.session.findFirst({
            where: {
              websiteId: message.websiteId,
              ip,
              createdAt: {
                gte: dayStart,
                lt: dayEnd,
              },
            },
            select: {
              id: true,
            },
          });

          isUniqueVisitor = !seenToday;
        } else {
          isUniqueVisitor = true;
        }

        const createdSession = await tx.session.create({
          data: {
            websiteId: message.websiteId,
            externalSessionId,
            userId,
            ip,
            userAgent,
            country,
            device,
            browser,
            os,
          },
          select: {
            id: true,
          },
        });

        sessionId = createdSession.id;
      }

      await tx.event.create({
        data: {
          websiteId: message.websiteId,
          sessionId,
          eventId: message.eventId,
          userId,
          type: message.type,
          title,
          url,
          referrer,
          userAgent,
          ip,
          country,
          device,
          browser,
          os,
          metadata,
          occurredAt,
        },
      });

      const pageviewsIncrement = message.type === EventType.PAGEVIEW ? 1 : 0;
      const visitsIncrement = isNewSession ? 1 : 0;
      const uniquesIncrement = isUniqueVisitor ? 1 : 0;

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
            websiteId: message.websiteId,
            date: dayStart,
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
          websiteId: message.websiteId,
          date: dayStart,
          pageviews: pageviewsIncrement,
          visits: visitsIncrement,
          uniques: uniquesIncrement,
        },
      });
    });
  }

  private getUtcDayStart(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private isDuplicateEventError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes('websiteId') &&
      error.meta.target.includes('eventId')
    );
  }

  private normalize(value?: string | null, maxLen = 255): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();

    if (!normalized) {
      return undefined;
    }

    return normalized.slice(0, maxLen);
  }

  private parseUnixTimestamp(timestamp: number): Date {
    const millis = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(millis);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('timestamp must be a valid Unix timestamp');
    }

    return date;
  }

  private assertRequestDomain(input: {
    websiteDomain: string;
    origin?: string;
    referer?: string;
  }): void {
    const websiteHost = this.normalizeHost(input.websiteDomain);

    if (!websiteHost) {
      throw new ForbiddenException('Website domain is misconfigured');
    }

    const originHost = this.extractHost(input.origin);
    const refererHost = this.extractHost(input.referer);
    const requestHost = originHost ?? refererHost;

    if (!requestHost) {
      throw new ForbiddenException('Origin or referer header is required');
    }

    const isMatch =
      requestHost === websiteHost || requestHost.endsWith(`.${websiteHost}`);

    if (!isMatch) {
      throw new ForbiddenException(
        'Request domain does not match website domain',
      );
    }
  }

  private extractHost(rawUrl?: string): string | undefined {
    const normalized = this.normalize(rawUrl, 2048);

    if (!normalized) {
      return undefined;
    }

    try {
      return new URL(normalized).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  private normalizeHost(domain: string): string | undefined {
    const normalized = this.normalize(domain, 255);
    if (!normalized) {
      return undefined;
    }

    if (/^https?:\/\//i.test(normalized)) {
      return this.extractHost(normalized);
    }

    return normalized.toLowerCase();
  }
}
