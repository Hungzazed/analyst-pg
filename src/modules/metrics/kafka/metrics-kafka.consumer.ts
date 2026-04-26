import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { EventType, Prisma } from '@prisma/client';
import { PrismaService, KafkaService } from '../../../infrastructure';
import { MetricsEventMessage } from './metrics-event-message';

const METRICS_EVENTS_TOPIC = 'metrics.events';

@Injectable()
export class MetricsKafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsKafkaConsumer.name);
  private consumer?: Consumer;

  constructor(
    private readonly kafkaService: KafkaService,
    private readonly prismaService: PrismaService,
  ) {}

  async onModuleInit() {
    const groupId =
      process.env.KAFKA_METRICS_GROUP_ID || 'analyst-group-metrics-events';

    this.consumer = await this.kafkaService.createConsumer(groupId);
    await this.consumer.subscribe({
      topic: METRICS_EVENTS_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.run({
      eachMessage: async (payload) => {
        await this.consumeMessage(payload);
      },
    });

    this.logger.log(
      `Metrics consumer is running on topic ${METRICS_EVENTS_TOPIC}`,
    );
  }

  async onModuleDestroy() {
    if (!this.consumer) {
      return;
    }

    await this.kafkaService.releaseConsumer(this.consumer);
    this.consumer = undefined;
  }

  private async consumeMessage(payload: EachMessagePayload): Promise<void> {
    const rawValue = payload.message.value?.toString();

    if (!rawValue) {
      this.logger.warn('Skipping empty metrics message');
      return;
    }

    let message: MetricsEventMessage;
    try {
      message = JSON.parse(rawValue) as MetricsEventMessage;
    } catch {
      this.logger.warn('Skipping invalid metrics JSON message');
      return;
    }

    try {
      await this.persistEvent(message);
    } catch (error) {
      if (this.isDuplicateEventError(error)) {
        this.logger.debug(`Duplicate event ignored: ${message.eventId}`);
        return;
      }

      throw error;
    }
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
      throw new Error('Invalid event timestamp in Kafka message');
    }

    return date;
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
}
