import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventType } from '@prisma/client';
import { PrismaService } from '../../infrastructure';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';

type EventPoint = {
  sessionId: string | null;
  type: EventType;
  url: string | null;
  referrer: string | null;
  metadata: unknown;
  occurredAt: Date;
};

type SessionPoint = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getOverview(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    const website = await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);

    const [dailyRows, sessions, pageviewCount, uniqueUrls] = await Promise.all([
      this.prismaService.eventDaily.findMany({
        where: {
          websiteId,
          date: {
            gte: range.from,
            lt: range.to,
          },
        },
        select: {
          date: true,
          pageviews: true,
          visits: true,
          uniques: true,
        },
        orderBy: { date: 'asc' },
      }),
      this.prismaService.session.findMany({
        where: {
          websiteId,
          createdAt: {
            gte: range.from,
            lt: range.to,
          },
        },
        select: {
          createdAt: true,
          lastSeenAt: true,
        },
      }),
      this.prismaService.event.count({
        where: {
          websiteId,
          type: EventType.PAGEVIEW,
          occurredAt: {
            gte: range.from,
            lt: range.to,
          },
        },
      }),
      this.prismaService.event.findMany({
        where: {
          websiteId,
          type: EventType.PAGEVIEW,
          occurredAt: {
            gte: range.from,
            lt: range.to,
          },
        },
        select: {
          url: true,
        },
        distinct: ['url'],
      }),
    ]);

    const summary = dailyRows.reduce(
      (accumulator, row) => {
        accumulator.pageviews += row.pageviews;
        accumulator.sessions += row.visits;
        accumulator.uniqueVisitors += row.uniques;
        return accumulator;
      },
      {
        pageviews: 0,
        sessions: 0,
        uniqueVisitors: 0,
      },
    );

    const averageSessionDurationMs = this.calculateAverageSessionDuration(sessions);

    return {
      website,
      range,
      summary: {
        ...summary,
        averageSessionDurationMs,
        averageSessionDurationSeconds: Math.round(averageSessionDurationMs / 1000),
        pageviewCount,
        uniquePages: uniqueUrls.length,
      },
      daily: dailyRows.map((row) => ({
        date: row.date,
        pageviews: row.pageviews,
        sessions: row.visits,
        uniqueVisitors: row.uniques,
      })),
    };
  }

  async getTopPages(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const limit = query.limit ?? 10;

    const events = await this.fetchPageviewEvents(websiteId, range);
    const counts = new Map<string, number>();

    for (const event of events) {
      const path = this.normalizePagePath(event.url);
      if (!path) {
        continue;
      }

      counts.set(path, (counts.get(path) ?? 0) + 1);
    }

    const total = Array.from(counts.values()).reduce(
      (accumulator, value) => accumulator + value,
      0,
    );
    const rows = this.toSortedRows(counts).slice(0, limit);

    return {
      range,
      total,
      pages: rows.map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
    };
  }

  async getTrafficSources(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    const website = await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const limit = query.limit ?? 10;
    const events = await this.fetchPageviewEvents(websiteId, range);

    const counts = new Map<string, number>();

    for (const event of events) {
      const source = this.normalizeTrafficSource(
        event.referrer,
        event.metadata,
        website.domain,
      );
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    const total = Array.from(counts.values()).reduce(
      (accumulator, value) => accumulator + value,
      0,
    );
    const rows = this.toSortedRows(counts).slice(0, limit);

    return {
      range,
      total,
      sources: rows.map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
    };
  }

  async getBehavior(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const sessionLimit = query.sessionLimit ?? 10;

    const [events, sessions] = await Promise.all([
      this.fetchEvents(websiteId, range),
      this.fetchSessions(websiteId, range),
    ]);

    const sessionMap = new Map<
      string,
      {
        id: string;
        createdAt: Date;
        lastSeenAt: Date;
        pages: string[];
        pageviews: number;
      }
    >();

    for (const session of sessions) {
      sessionMap.set(session.id, {
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        pages: [],
        pageviews: 0,
      });
    }

    for (const event of events) {
      if (event.type !== EventType.PAGEVIEW || !event.sessionId) {
        continue;
      }

      const session = sessionMap.get(event.sessionId);
      if (!session) {
        continue;
      }

      const pagePath = this.normalizePagePath(event.url);
      if (!pagePath) {
        continue;
      }

      session.pages.push(pagePath);
      session.pageviews += 1;
    }

    const journeys = Array.from(sessionMap.values())
      .map((session) => ({
        sessionId: session.id,
        entryPage: session.pages[0] ?? null,
        exitPage: session.pages[session.pages.length - 1] ?? null,
        pages: session.pages,
        pageviews: session.pageviews,
        durationMs: Math.max(
          0,
          session.lastSeenAt.getTime() - session.createdAt.getTime(),
        ),
      }))
      .filter((session) => session.pages.length > 0)
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, sessionLimit);

    const transitionCounts = new Map<string, number>();

    for (const session of journeys) {
      for (let index = 0; index < session.pages.length - 1; index += 1) {
        const transition = `${session.pages[index]} -> ${session.pages[index + 1]}`;
        transitionCounts.set(transition, (transitionCounts.get(transition) ?? 0) + 1);
      }
    }

    return {
      range,
      journeys,
      transitions: this.toSortedRows(transitionCounts).slice(0, 20),
      averageSessionDurationMs: this.calculateAverageSessionDuration(sessions),
    };
  }

  async getDeviceAnalytics(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const sessions = await this.fetchSessions(websiteId, range);

    const deviceCounts = new Map<string, number>();
    const browserCounts = new Map<string, number>();

    for (const session of sessions) {
      const device = this.normalizeDevice(session.device);
      deviceCounts.set(device, (deviceCounts.get(device) ?? 0) + 1);

      const browser = this.normalizeLabel(session.browser);
      browserCounts.set(browser, (browserCounts.get(browser) ?? 0) + 1);
    }

    const total = sessions.length;

    return {
      range,
      totalSessions: total,
      deviceShare: this.toSortedRows(deviceCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      browserUsage: this.toSortedRows(browserCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      mobileVsDesktop: this.buildMobileVsDesktop(deviceCounts, total),
    };
  }

  async getGeoAnalytics(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const sessions = await this.fetchSessions(websiteId, range);

    const countryCounts = new Map<string, number>();

    for (const session of sessions) {
      const country = this.normalizeLabel(session.country);
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    const total = sessions.length;

    return {
      range,
      totalSessions: total,
      countries: this.toSortedRows(countryCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
    };
  }

  async getFunnel(userId: string, websiteId: string, query: FunnelQueryDto) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const sessionRows = await this.prismaService.session.findMany({
      where: {
        websiteId,
        createdAt: {
          gte: range.from,
          lt: range.to,
        },
      },
      select: {
        id: true,
      },
      orderBy: { createdAt: 'asc' },
      take: query.maxSessions,
    });

    const events = await this.prismaService.event.findMany({
      where: {
        websiteId,
        sessionId: {
          in: sessionRows.map((session) => session.id),
        },
        occurredAt: {
          gte: range.from,
          lt: range.to,
        },
      },
      select: {
        sessionId: true,
        type: true,
        url: true,
        referrer: true,
        metadata: true,
        occurredAt: true,
      },
      orderBy: [
        {
          sessionId: 'asc',
        },
        {
          occurredAt: 'asc',
        },
      ],
    });

    const sessions = new Map<string, EventPoint[]>();

    for (const event of events) {
      if (!event.sessionId) {
        continue;
      }

      const bucket = sessions.get(event.sessionId) ?? [];
      bucket.push(event);
      sessions.set(event.sessionId, bucket);
    }

    const landingTarget = this.normalizePagePath(query.landingUrl);
    const nextTarget = this.normalizePagePath(query.nextUrl);
    const conversionTarget = this.normalizePagePath(query.conversionUrl);

    let landingCount = 0;
    let nextCount = 0;
    let conversionCount = 0;

    for (const eventsInSession of sessions.values()) {
      const pageviews = eventsInSession
        .filter((event) => event.type === EventType.PAGEVIEW)
        .map((event) => this.normalizePagePath(event.url))
        .filter((value): value is string => Boolean(value));

      if (pageviews.length === 0) {
        continue;
      }

      const landingIndex = landingTarget
        ? pageviews.findIndex((page) => page === landingTarget)
        : 0;

      if (landingIndex < 0) {
        continue;
      }

      landingCount += 1;

      const nextIndex = nextTarget
        ? pageviews.findIndex((page, index) => index > landingIndex && page === nextTarget)
        : landingIndex + 1;

      if (nextIndex < 0 || nextIndex >= pageviews.length) {
        continue;
      }

      nextCount += 1;

      const conversionReached = conversionTarget
        ? pageviews.some(
            (page, index) => index > nextIndex && page === conversionTarget,
          )
        : eventsInSession.some(
            (event) =>
              event.type === EventType.CUSTOM &&
              this.readBooleanMetadata(event.metadata, [
                'conversion',
                'converted',
                'isConversion',
              ]),
          );

      if (conversionReached) {
        conversionCount += 1;
      }
    }

    const steps = [
      {
        name: 'Landing page',
        target: landingTarget ?? 'first pageview',
        count: landingCount,
      },
      {
        name: 'Next page',
        target: nextTarget ?? 'second pageview',
        count: nextCount,
      },
      {
        name: 'Conversion',
        target: conversionTarget ?? 'custom conversion event',
        count: conversionCount,
      },
    ];

    return {
      range,
      steps,
      dropoff: this.buildDropoff(steps),
    };
  }

  private async assertWebsiteOwnership(userId: string, websiteId: string) {
    const website = await this.prismaService.website.findUnique({
      where: { id: websiteId },
      select: {
        id: true,
        name: true,
        domain: true,
        userId: true,
      },
    });

    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (website.userId !== userId) {
      throw new ForbiddenException('You do not have permission to access this website');
    }

    return website;
  }

  private async fetchPageviewEvents(websiteId: string, range: { from: Date; to: Date }) {
    return this.prismaService.event.findMany({
      where: {
        websiteId,
        type: EventType.PAGEVIEW,
        occurredAt: {
          gte: range.from,
          lt: range.to,
        },
      },
      select: {
        url: true,
        referrer: true,
        metadata: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'asc' },
    });
  }

  private async fetchEvents(websiteId: string, range: { from: Date; to: Date }) {
    return this.prismaService.event.findMany({
      where: {
        websiteId,
        occurredAt: {
          gte: range.from,
          lt: range.to,
        },
      },
      select: {
        sessionId: true,
        type: true,
        url: true,
        referrer: true,
        metadata: true,
        occurredAt: true,
      },
      orderBy: [
        {
          sessionId: 'asc',
        },
        {
          occurredAt: 'asc',
        },
      ],
    });
  }

  private async fetchSessions(websiteId: string, range: { from: Date; to: Date }) {
    return this.prismaService.session.findMany({
      where: {
        websiteId,
        createdAt: {
          gte: range.from,
          lt: range.to,
        },
      },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        country: true,
        device: true,
        browser: true,
        os: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private resolveRange(query: AnalyticsQueryDto): { from: Date; to: Date } {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;

    if (Number.isNaN(to.getTime())) {
      throw new BadRequestException('to must be a valid ISO date');
    }

    const defaultFrom = new Date(to.getTime());
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);

    const from = query.from ? new Date(query.from) : defaultFrom;

    if (Number.isNaN(from.getTime())) {
      throw new BadRequestException('from must be a valid ISO date');
    }

    if (from >= to) {
      throw new BadRequestException('from must be earlier than to');
    }

    return { from, to };
  }

  private calculateAverageSessionDuration(
    sessions: Array<Pick<SessionPoint, 'createdAt' | 'lastSeenAt'>>,
  ) {
    if (sessions.length === 0) {
      return 0;
    }

    const totalDuration = sessions.reduce(
      (accumulator, session) =>
        accumulator + Math.max(0, session.lastSeenAt.getTime() - session.createdAt.getTime()),
      0,
    );

    return Math.round(totalDuration / sessions.length);
  }

  private normalizePagePath(value?: string | null) {
    if (!value) {
      return undefined;
    }

    try {
      const url = new URL(value);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      return pathname.startsWith('/') ? pathname : `/${pathname}`;
    } catch {
      const [path] = value.split(/[?#]/);
      const normalized = path?.replace(/\/+$/, '') || '/';
      return normalized.startsWith('/') ? normalized : `/${normalized}`;
    }
  }

  private normalizeTrafficSource(
    referrer: string | null,
    metadata: unknown,
    websiteDomain: string,
  ) {
    const utmSource = this.readMetadataString(metadata, ['utm_source', 'source']);
    if (utmSource) {
      return utmSource;
    }

    if (!referrer) {
      return 'direct';
    }

    try {
      const host = new URL(referrer).hostname.replace(/^www\./i, '').toLowerCase();
      const normalizedWebsiteDomain = websiteDomain.replace(/^www\./i, '').toLowerCase();

      if (host === normalizedWebsiteDomain) {
        return 'internal';
      }

      return host;
    } catch {
      return 'direct';
    }
  }

  private normalizeDevice(device: string | null) {
    const label = this.normalizeLabel(device).toLowerCase();

    if (label.includes('mobile') || label.includes('phone') || label.includes('tablet')) {
      return 'mobile';
    }

    if (
      label.includes('desktop') ||
      label.includes('laptop') ||
      label.includes('mac') ||
      label.includes('windows')
    ) {
      return 'desktop';
    }

    return this.normalizeLabel(device);
  }

  private normalizeLabel(value: string | null | undefined) {
    const label = value?.trim();
    return label && label.length > 0 ? label : 'unknown';
  }

  private readMetadataString(metadata: unknown, keys: string[]) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    const record = metadata as Record<string, unknown>;

    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
  }

  private readBooleanMetadata(metadata: unknown, keys: string[]) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return false;
    }

    const record = metadata as Record<string, unknown>;

    for (const key of keys) {
      const value = record[key];
      if (value === true) {
        return true;
      }

      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
          return true;
        }
      }
    }

    return false;
  }

  private toSortedRows(counts: Map<string, number>) {
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  }

  private buildMobileVsDesktop(counts: Map<string, number>, total: number) {
    const mobile = counts.get('mobile') ?? 0;
    const desktop = counts.get('desktop') ?? 0;
    const other = Math.max(0, total - mobile - desktop);

    return [
      {
        value: 'mobile',
        count: mobile,
        share: total > 0 ? mobile / total : 0,
      },
      {
        value: 'desktop',
        count: desktop,
        share: total > 0 ? desktop / total : 0,
      },
      {
        value: 'other',
        count: other,
        share: total > 0 ? other / total : 0,
      },
    ];
  }

  private buildDropoff(steps: Array<{ count: number }>) {
    return steps.map((step, index) => {
      const previous = index === 0 ? step.count : steps[index - 1].count;
      const dropoff = previous > 0 ? (previous - step.count) / previous : 0;
      return {
        step: index + 1,
        dropoff,
      };
    });
  }
}