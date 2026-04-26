import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventType } from '@prisma/client';
import { PrismaService } from '../../infrastructure';
import { IngestMetricDto } from './dto/ingest-metric.dto';
import { MetricsKafkaProducer } from './kafka/metrics-kafka.producer';

interface IngestEventInput {
  apiKey: string;
  dto: IngestMetricDto;
  origin?: string;
  referer?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly metricsKafkaProducer: MetricsKafkaProducer,
  ) {}

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

    await this.metricsKafkaProducer.enqueue({
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
    });

    return {
      accepted: true,
      queued: true,
      externalEventId,
      websiteId: websiteApiKey.websiteId,
      occurredAt,
    };
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
