import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure';
import { IngestMetricDto } from './dto/ingest-metric.dto';

interface IngestEventInput {
  apiKey: string;
  dto: IngestMetricDto;
  ip?: string;
  userAgent?: string;
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

    return this.prismaService.$transaction(async (tx) => {
      const websiteApiKey = await tx.apiKey.findFirst({
        where: {
          key: apiKey,
          revoked: false,
        },
        select: {
          websiteId: true,
        },
      });

      if (!websiteApiKey) {
        throw new UnauthorizedException('Invalid API key');
      }

      const externalEventId = this.normalize(input.dto.eventId, 128);
      if (!externalEventId) {
        throw new BadRequestException('eventId is required');
      }

      const occurredAt = this.parseUnixTimestamp(input.dto.timestamp);
      const dayStart = this.getUtcDayStart(occurredAt);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const existingEvent = await tx.event.findFirst({
        where: {
          websiteId: websiteApiKey.websiteId,
          eventId: externalEventId,
        },
        select: {
          id: true,
          eventId: true,
          sessionId: true,
          createdAt: true,
        },
      });

      if (existingEvent) {
        return {
          accepted: true,
          duplicate: true,
          eventId: existingEvent.id,
          externalEventId: existingEvent.eventId,
          sessionId: existingEvent.sessionId,
          websiteId: websiteApiKey.websiteId,
          receivedAt: existingEvent.createdAt,
        };
      }

      const ip = this.normalize(input.dto.ip ?? input.ip, 64);
      const userAgent = this.normalize(
        input.dto.userAgent ?? input.userAgent,
        512,
      );
      const country = this.normalize(input.dto.country, 64);
      const device = this.normalize(input.dto.device, 128);
      const browser = this.normalize(input.dto.browser, 128);
      const os = this.normalize(input.dto.os, 128);
      const url = this.normalize(input.dto.url, 2048);
      const referrer = this.normalize(input.dto.referrer, 2048);
      const title = this.normalize(input.dto.title, 255);
      const externalSessionId = this.normalize(input.dto.sessionId, 128);
      const userId = this.normalize(input.dto.userId ?? undefined, 255);
      const metadata = input.dto.metadata
        ? (input.dto.metadata as Prisma.InputJsonValue)
        : undefined;

      let sessionId: string | undefined;
      let isNewSession = false;
      let isUniqueVisitor = false;

      if (externalSessionId) {
        const existingSession = await tx.session.findFirst({
          where: {
            websiteId: websiteApiKey.websiteId,
            externalSessionId,
          },
          select: {
            id: true,
          },
        });

        if (existingSession) {
          sessionId = existingSession.id;
        }
      }

      if (!sessionId) {
        isNewSession = true;

        if (externalSessionId) {
          isUniqueVisitor = true;
        } else if (ip) {
          const seenToday = await tx.session.findFirst({
            where: {
              websiteId: websiteApiKey.websiteId,
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
            websiteId: websiteApiKey.websiteId,
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
      } else {
        await tx.session.update({
          where: { id: sessionId },
          data: {
            externalSessionId,
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

      const event = await tx.event.create({
        data: {
          websiteId: websiteApiKey.websiteId,
          sessionId,
          eventId: externalEventId,
          userId,
          type: input.dto.type,
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
        select: {
          id: true,
          eventId: true,
          createdAt: true,
        },
      });

      const pageviewsIncrement = input.dto.type === EventType.PAGEVIEW ? 1 : 0;
      const visitsIncrement = isNewSession ? 1 : 0;
      const uniquesIncrement = isUniqueVisitor ? 1 : 0;

      if (
        pageviewsIncrement > 0 ||
        visitsIncrement > 0 ||
        uniquesIncrement > 0
      ) {
        await tx.eventDaily.upsert({
          where: {
            websiteId_date: {
              websiteId: websiteApiKey.websiteId,
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
            websiteId: websiteApiKey.websiteId,
            date: dayStart,
            pageviews: pageviewsIncrement,
            visits: visitsIncrement,
            uniques: uniquesIncrement,
          },
        });
      }

      return {
        accepted: true,
        eventId: event.id,
        externalEventId: event.eventId,
        sessionId,
        websiteId: websiteApiKey.websiteId,
        receivedAt: event.createdAt,
      };
    });
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

  private getUtcDayStart(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
