import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { EventType } from '@prisma/client';
import { Observable, from, interval } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';
import { PrismaService } from '../../infrastructure';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { RealtimeQueryDto } from './dto/realtime-query.dto';
import { RetentionQueryDto } from './dto/retention-query.dto';

type EventPoint = {
  sessionId: string | null;
  type: EventType;
  url: string | null;
  referrer: string | null;
  metadata: unknown;
  occurredAt: Date;
  title: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
};

type SessionPoint = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  userId: string | null;
  externalSessionId: string | null;
  ip: string | null;
};

type Range = {
  from: Date;
  to: Date;
};

type RangeSnapshot = {
  dailyRows: Array<{
    date: Date;
    pageviews: number;
    visits: number;
    uniques: number;
  }>;
  sessions: SessionPoint[];
  events: EventPoint[];
  pageviewCount: number;
  uniquePages: number;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getOverview(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    const website = await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const previousRange = this.resolvePreviousRange(range);

    const [currentSnapshot, previousSnapshot] = await Promise.all([
      this.collectRangeSnapshot(websiteId, range),
      this.collectRangeSnapshot(websiteId, previousRange),
    ]);

    const currentSummary = this.buildOverviewSnapshot(currentSnapshot);
    const previousSummary = this.buildOverviewSnapshot(previousSnapshot);
    const dailyBounceRates = this.buildDailyBounceRates(
      currentSnapshot.sessions,
      currentSnapshot.events,
    );

    return {
      website,
      range,
      previousRange,
      summary: {
        pageviews: currentSummary.pageviews,
        pageviewsChange: this.calculatePercentChange(
          currentSummary.pageviews,
          previousSummary.pageviews,
        ),
        sessions: currentSummary.sessions,
        sessionsChange: this.calculatePercentChange(
          currentSummary.sessions,
          previousSummary.sessions,
        ),
        uniqueVisitors: currentSummary.uniqueVisitors,
        uniqueVisitorsChange: this.calculatePercentChange(
          currentSummary.uniqueVisitors,
          previousSummary.uniqueVisitors,
        ),
        bounceRate: currentSummary.bounceRate,
        bounceRateChange: this.calculatePercentChange(
          currentSummary.bounceRate,
          previousSummary.bounceRate,
        ),
        averageSessionDurationMs: currentSummary.averageSessionDurationMs,
        averageSessionDurationMsChange: this.calculatePercentChange(
          currentSummary.averageSessionDurationMs,
          previousSummary.averageSessionDurationMs,
        ),
        averageSessionDurationSeconds: Math.round(
          currentSummary.averageSessionDurationMs / 1000,
        ),
        uniquePages: currentSummary.uniquePages,
      },
      daily: currentSnapshot.dailyRows.map((row) => ({
        date: row.date,
        pageviews: row.pageviews,
        sessions: row.visits,
        uniqueVisitors: row.uniques,
        bounceRate: dailyBounceRates.get(row.date.toISOString()) ?? 0,
      })),
    };
  }

  async getEvents(userId: string, websiteId: string, query: AnalyticsQueryDto) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const limit = query.limit ?? 10;
    const events = await this.fetchEvents(websiteId, range);
    const customEvents = events.filter((event) => event.type !== EventType.PAGEVIEW);

    const groups = new Map<
      string,
      {
        type: EventType;
        count: number;
        metadata: Map<string, number>;
      }
    >();

    for (const event of customEvents) {
      const name = this.resolveCustomEventName(event);
      const group = groups.get(name) ?? {
        type: event.type,
        count: 0,
        metadata: new Map<string, number>(),
      };

      group.count += 1;

      for (const [key, value] of this.extractMetadataPairs(event.metadata)) {
        const breakdownKey = `${key}:${value}`;
        group.metadata.set(breakdownKey, (group.metadata.get(breakdownKey) ?? 0) + 1);
      }

      groups.set(name, group);
    }

    const total = customEvents.length;
    const rows = this.toSortedRows(
      new Map(Array.from(groups.entries()).map(([name, group]) => [name, group.count])),
    ).slice(0, limit);

    return {
      range,
      total,
      events: rows.map((row) => {
        const group = groups.get(row.value);
        const metadataBreakdownLimit = 5;
        const metadataBreakdown = group
          ? this.toSortedRows(group.metadata)
              .slice(0, metadataBreakdownLimit)
              .map((metadataRow) => {
                const [key, value] = metadataRow.value.split(':', 2);
                return {
                  key,
                  value,
                  count: metadataRow.count,
                  share: group.count > 0 ? metadataRow.count / group.count : 0,
                };
              })
          : [];

        return {
          value: row.value,
          type: group?.type ?? EventType.CUSTOM,
          count: row.count,
          share: total > 0 ? row.count / total : 0,
          metadataBreakdownTotal: group?.count ?? 0,
          metadataBreakdownLimit,
          metadataBreakdown,
        };
      }),
    };
  }

  async getTopPages(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    const website = await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const limit = query.limit ?? 10;
    const [sessions, events] = await Promise.all([
      this.fetchSessions(websiteId, range),
      this.fetchEvents(websiteId, range),
    ]);

    const sessionEvents = this.groupEventsBySession(events);
    const pageCounts = new Map<string, number>();
    const durationTotals = new Map<string, number>();
    const entryCounts = new Map<string, number>();
    const exitCounts = new Map<string, number>();
    const bounceCounts = new Map<string, number>();

    for (const session of sessions) {
      const eventsForSession = sessionEvents.get(session.id) ?? [];
      const pageviews = eventsForSession.filter((event) => event.type === EventType.PAGEVIEW);
      const pagePaths = pageviews
        .map((event) => this.normalizePagePath(event.url))
        .filter((value): value is string => Boolean(value));

      if (pagePaths.length === 0) {
        continue;
      }

      const entryPage = pagePaths[0];
      const exitPage = pagePaths[pagePaths.length - 1];
      entryCounts.set(entryPage, (entryCounts.get(entryPage) ?? 0) + 1);
      exitCounts.set(exitPage, (exitCounts.get(exitPage) ?? 0) + 1);

      if (pagePaths.length === 1) {
        bounceCounts.set(entryPage, (bounceCounts.get(entryPage) ?? 0) + 1);
      }

      for (let index = 0; index < eventsForSession.length; index += 1) {
        const event = eventsForSession[index];

        if (event.type !== EventType.PAGEVIEW) {
          continue;
        }

        const path = this.normalizePagePath(event.url);
        if (!path) {
          continue;
        }

        const nextEvent = eventsForSession[index + 1];
        const endTime = nextEvent?.occurredAt ?? session.lastSeenAt;
        const duration = Math.max(0, endTime.getTime() - event.occurredAt.getTime());

        pageCounts.set(path, (pageCounts.get(path) ?? 0) + 1);
        durationTotals.set(path, (durationTotals.get(path) ?? 0) + duration);
      }
    }

    const total = Array.from(pageCounts.values()).reduce(
      (accumulator, value) => accumulator + value,
      0,
    );
    const rows = this.toSortedRows(pageCounts).slice(0, limit);

    return {
      website,
      range,
      total,
      pages: rows.map((row) => {
        const entryCount = entryCounts.get(row.value) ?? 0;
        const exitCount = exitCounts.get(row.value) ?? 0;
        const bounceCount = bounceCounts.get(row.value) ?? 0;

        return {
          value: row.value,
          count: row.count,
          share: total > 0 ? row.count / total : 0,
          avgTimeOnPageMs: Math.round(
            (durationTotals.get(row.value) ?? 0) / Math.max(row.count, 1),
          ),
          bounceRate: entryCount > 0 ? Math.round((bounceCount / entryCount) * 1000) / 1000 : 0,
          exitRate: row.count > 0 ? Math.round((exitCount / row.count) * 1000) / 1000 : 0,
        };
      }),
    };
  }

  async getTrafficSources(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    const website = await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const limit = query.limit ?? 10;
    const events = await this.fetchPageviewEvents(websiteId, range);

    const groups = new Map<
      string,
      { source: string; medium: string | null; campaign: string | null; count: number }
    >();

    for (const event of events) {
      const source = this.resolveTrafficSource(event.referrer, event.metadata, website.domain);
      const key = `${source.source}|${source.medium ?? ''}|${source.campaign ?? ''}`;
      const current = groups.get(key) ?? {
        source: source.source,
        medium: source.medium,
        campaign: source.campaign,
        count: 0,
      };

      current.count += 1;
      groups.set(key, current);
    }

    const total = Array.from(groups.values()).reduce(
      (accumulator, value) => accumulator + value.count,
      0,
    );

    const rows = Array.from(groups.values())
      .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source))
      .slice(0, limit);

    return {
      range,
      total,
      sources: rows.map((row) => ({
        value: row.source,
        source: row.source,
        medium: row.medium,
        campaign: row.campaign,
        count: row.count,
        share: total > 0 ? row.count / total : 0,
      })),
    };
  }

  async getBehavior(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const sessionLimit = query.sessionLimit ?? 10;

    const [events, sessions] = await Promise.all([
      this.fetchEvents(websiteId, range),
      this.fetchSessions(websiteId, range),
    ]);

    const sessionEvents = this.groupEventsBySession(events);
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
    const entryCounts = new Map<string, number>();
    const exitCounts = new Map<string, number>();
    const transitionCounts = new Map<string, number>();
    let totalTransitions = 0;
    let totalPages = 0;

    for (const session of sessions) {
      const eventsForSession = sessionEvents.get(session.id) ?? [];
      const pages = eventsForSession
        .filter((event) => event.type === EventType.PAGEVIEW)
        .map((event) => this.normalizePagePath(event.url))
        .filter((value): value is string => Boolean(value));

      sessionMap.set(session.id, {
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        pages,
        pageviews: pages.length,
      });

      if (pages.length === 0) {
        continue;
      }

      totalPages += pages.length;
      entryCounts.set(pages[0], (entryCounts.get(pages[0]) ?? 0) + 1);
      exitCounts.set(pages[pages.length - 1], (exitCounts.get(pages[pages.length - 1]) ?? 0) + 1);

      for (let index = 0; index < pages.length - 1; index += 1) {
        const transition = `${pages[index]} -> ${pages[index + 1]}`;
        transitionCounts.set(transition, (transitionCounts.get(transition) ?? 0) + 1);
        totalTransitions += 1;
      }
    }

    const journeys = Array.from(sessionMap.values())
      .filter((session) => session.pages.length > 0)
      .map((session) => ({
        sessionId: session.id,
        entryPage: session.pages[0] ?? null,
        exitPage: session.pages[session.pages.length - 1] ?? null,
        pages: session.pages,
        pageviews: session.pageviews,
        durationMs: Math.max(0, session.lastSeenAt.getTime() - session.createdAt.getTime()),
      }))
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, sessionLimit);

    return {
      range,
      journeysTotal: sessions.length,
      journeysLimit: sessionLimit,
      journeys,
      topEntryPages: this.toSortedRows(entryCounts).slice(0, 10),
      topExitPages: this.toSortedRows(exitCounts).slice(0, 10),
      avgPagesPerSession:
        sessions.length > 0 ? Math.round((totalPages / sessions.length) * 1000) / 1000 : 0,
      transitions: {
        total: totalTransitions,
        items: this.toSortedRows(transitionCounts).slice(0, 20),
      },
      averageSessionDurationMs: this.calculateAverageSessionDuration(sessions),
    };
  }

  async getDeviceAnalytics(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const sessions = await this.fetchSessions(websiteId, range);

    const deviceCounts = new Map<string, number>();
    const browserCounts = new Map<string, number>();
    const osCounts = new Map<string, number>();

    for (const session of sessions) {
      const device = this.normalizeDevice(session.device);
      const browser = this.normalizeLabel(session.browser);
      const os = this.normalizeLabel(session.os);

      deviceCounts.set(device, (deviceCounts.get(device) ?? 0) + 1);
      browserCounts.set(browser, (browserCounts.get(browser) ?? 0) + 1);
      osCounts.set(os, (osCounts.get(os) ?? 0) + 1);
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
      osUsage: this.toSortedRows(osCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      mobileVsDesktop: this.buildMobileVsDesktop(deviceCounts, total),
    };
  }

  async getGeoAnalytics(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);

    const [sessions, events] = await Promise.all([
      this.fetchSessions(websiteId, range),
      this.fetchEvents(websiteId, range),
    ]);

    const sessionEvents = this.groupEventsBySession(events);
    const countryCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();

    for (const session of sessions) {
      const eventsForSession = sessionEvents.get(session.id) ?? [];
      const country = this.resolveGeoCountry(session, eventsForSession);
      const city = this.resolveGeoCity(eventsForSession, country);
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      cityCounts.set(city.value, (cityCounts.get(city.value) ?? 0) + 1);
    }

    const total = sessions.length;

    return {
      range,
      totalSessions: total,
      countries: this.toSortedRows(countryCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      cities: this.toSortedRows(cityCounts).map((row) => {
        const [city, country] = row.value.split('|', 2);
        const countryTotal = countryCounts.get(country) ?? 0;
        const shareOfTotal = total > 0 ? row.count / total : 0;
        return {
          value: city,
          country,
          count: row.count,
          share: shareOfTotal,
          shareOfTotal,
          shareOfCountry: countryTotal > 0 ? row.count / countryTotal : 0,
        };
      }),
    };
  }

  async getRealtime(
    userId: string,
    websiteId: string,
    query: RealtimeQueryDto,
  ) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const windowMinutes = query.windowMinutes ?? 5;
    const activeSessionsLimit = query.sessionLimit ?? query.limit ?? 50;
    const now = new Date();
    const from = new Date(now.getTime() - windowMinutes * 60 * 1000);
    const range = { from, to: now };

    const [sessions, events] = await Promise.all([
      this.fetchSessions(websiteId, range),
      this.fetchEvents(websiteId, range),
    ]);

    const sessionEvents = this.groupEventsBySession(events);
    const currentPageCounts = new Map<string, number>();

    const activeSessions = sessions
      .map((session) => {
        const currentPage = this.resolveCurrentPage(sessionEvents.get(session.id) ?? []);

        if (currentPage) {
          currentPageCounts.set(currentPage, (currentPageCounts.get(currentPage) ?? 0) + 1);
        }

        return {
          sessionId: session.id,
          currentPage,
          lastSeenAt: session.lastSeenAt,
          country: this.normalizeLabel(session.country),
          device: this.normalizeDevice(session.device),
          browser: this.normalizeLabel(session.browser),
          os: this.normalizeLabel(session.os),
        };
      })
      .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
      .slice(0, activeSessionsLimit);

    return {
      range,
      windowMinutes,
      onlineUsers: sessions.length,
      activeSessionsLimit,
      activeSessions,
      currentPages: this.toSortedRows(currentPageCounts).slice(0, activeSessionsLimit),
      totalActivePages: currentPageCounts.size,
    };
  }

  streamRealtime(
    userId: string,
    websiteId: string,
    query: RealtimeQueryDto,
  ): Observable<MessageEvent> {
    const refreshSeconds = query.refreshSeconds ?? 5;

    return interval(refreshSeconds * 1000).pipe(
      startWith(0),
      switchMap(() => from(this.getRealtime(userId, websiteId, query))),
      map(
        (snapshot): MessageEvent => ({
          type: 'snapshot',
          data: snapshot,
          retry: refreshSeconds * 1000,
        }),
      ),
    );
  }

  async getRetention(
    userId: string,
    websiteId: string,
    query: RetentionQueryDto,
  ) {
    await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const granularity = query.granularity ?? 'day';
    const periods = query.periods ?? 7;
    const retentionRange = this.extendRangeForRetention(range, granularity, periods);

    const sessions = await this.fetchSessions(websiteId, retentionRange);
    const identityGroups = new Map<string, SessionPoint[]>();

    for (const session of sessions) {
      const identity = this.resolveRetentionIdentity(session);
      const bucket = identityGroups.get(identity) ?? [];
      bucket.push(session);
      identityGroups.set(identity, bucket);
    }

    const cohorts = new Map<
      string,
      {
        cohortStart: Date;
        users: Set<string>;
        retention: Map<number, Set<string>>;
      }
    >();

    for (const [identity, groupSessions] of identityGroups.entries()) {
      const sortedSessions = groupSessions.sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );

      const cohortSession = sortedSessions.find(
        (session) => session.createdAt >= range.from && session.createdAt < range.to,
      );

      if (!cohortSession) {
        continue;
      }

      const cohortStart = this.bucketDate(cohortSession.createdAt, granularity);
      const cohortKey = cohortStart.toISOString();
      const cohort = cohorts.get(cohortKey) ?? {
        cohortStart,
        users: new Set<string>(),
        retention: new Map<number, Set<string>>(),
      };

      cohort.users.add(identity);

      for (const session of sortedSessions) {
        if (session.createdAt <= cohortSession.createdAt) {
          continue;
        }

        const periodIndex = this.calculatePeriodIndex(
          cohortStart,
          session.createdAt,
          granularity,
        );

        if (periodIndex <= 0 || periodIndex >= periods) {
          continue;
        }

        const periodBucket = cohort.retention.get(periodIndex) ?? new Set<string>();
        periodBucket.add(identity);
        cohort.retention.set(periodIndex, periodBucket);
      }

      cohorts.set(cohortKey, cohort);
    }

    return {
      range,
      granularity,
      periods,
      cohorts: Array.from(cohorts.values())
        .sort((left, right) => left.cohortStart.getTime() - right.cohortStart.getTime())
        .map((cohort) => {
          const users = cohort.users.size;

          return {
            cohortStart: cohort.cohortStart,
            cohortEnd: this.getCohortEnd(cohort.cohortStart, granularity),
            users,
            retention: Array.from({ length: periods }, (_, period) => {
              const count = period === 0 ? users : cohort.retention.get(period)?.size ?? 0;
              return {
                period,
                count,
                rate: users > 0 ? Math.round((count / users) * 1000) / 1000 : 0,
              };
            }),
          };
        }),
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
        title: true,
        country: true,
        device: true,
        browser: true,
        os: true,
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
        ? pageviews.findIndex(
            (page, index) => index > landingIndex && page === nextTarget,
          )
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
      totalConversionRate:
        landingCount > 0 ? Math.round((conversionCount / landingCount) * 1000) / 1000 : 0,
      dropoff: this.buildFunnelDropoff(steps),
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

  private async collectRangeSnapshot(websiteId: string, range: Range): Promise<RangeSnapshot> {
    const [dailyRows, sessions, events, pageviewCount, uniqueUrls] = await Promise.all([
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
      this.fetchSessions(websiteId, range),
      this.fetchEvents(websiteId, range),
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

    return {
      dailyRows,
      sessions,
      events,
      pageviewCount,
      uniquePages: uniqueUrls.length,
    };
  }

  private buildOverviewSnapshot(snapshot: RangeSnapshot) {
    const summary = snapshot.dailyRows.reduce(
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

    return {
      ...summary,
      bounceRate: this.calculateBounceRate(snapshot.sessions, snapshot.events),
      averageSessionDurationMs: this.calculateAverageSessionDuration(snapshot.sessions),
      pageviewCount: snapshot.pageviewCount,
      uniquePages: snapshot.uniquePages,
    };
  }

  private async fetchPageviewEvents(websiteId: string, range: Range) {
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
        sessionId: true,
        type: true,
        url: true,
        referrer: true,
        metadata: true,
        occurredAt: true,
        title: true,
        country: true,
        device: true,
        browser: true,
        os: true,
      },
      orderBy: { occurredAt: 'asc' },
    });
  }

  private async fetchEvents(websiteId: string, range: Range) {
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
        title: true,
        country: true,
        device: true,
        browser: true,
        os: true,
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

  private async fetchSessions(websiteId: string, range: Range) {
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
        userId: true,
        externalSessionId: true,
        ip: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private resolveRange(query: AnalyticsQueryDto | RetentionQueryDto): Range {
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

  private resolvePreviousRange(range: Range): Range {
    const duration = range.to.getTime() - range.from.getTime();
    const to = new Date(range.from.getTime());
    const from = new Date(to.getTime() - duration);
    return { from, to };
  }

  private calculatePercentChange(current: number, previous: number) {
    if (previous === 0) {
      return current === 0 ? 0 : 100;
    }

    return Math.round(((current - previous) / previous) * 1000) / 10;
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

  private calculateBounceRate(sessions: SessionPoint[], events: EventPoint[]) {
    if (sessions.length === 0) {
      return 0;
    }

    const groupedEvents = this.groupEventsBySession(events);
    let bouncedSessions = 0;

    for (const session of sessions) {
      const pageviews = (groupedEvents.get(session.id) ?? []).filter(
        (event) => event.type === EventType.PAGEVIEW,
      );

      if (pageviews.length === 1) {
        bouncedSessions += 1;
      }
    }

    return Math.round((bouncedSessions / sessions.length) * 1000) / 1000;
  }

  private buildDailyBounceRates(sessions: SessionPoint[], events: EventPoint[]) {
    const groupedEvents = this.groupEventsBySession(events);
    const daySessions = new Map<string, number>();
    const dayBouncedSessions = new Map<string, number>();

    for (const session of sessions) {
      const key = this.getUtcDayStart(session.createdAt).toISOString();
      daySessions.set(key, (daySessions.get(key) ?? 0) + 1);

      const pageviews = (groupedEvents.get(session.id) ?? []).filter(
        (event) => event.type === EventType.PAGEVIEW,
      );

      if (pageviews.length === 1) {
        dayBouncedSessions.set(key, (dayBouncedSessions.get(key) ?? 0) + 1);
      }
    }

    const result = new Map<string, number>();

    for (const [key, totalSessions] of daySessions.entries()) {
      const bounced = dayBouncedSessions.get(key) ?? 0;
      result.set(
        key,
        totalSessions > 0 ? Math.round((bounced / totalSessions) * 1000) / 1000 : 0,
      );
    }

    return result;
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

  private resolveTrafficSource(
    referrer: string | null,
    metadata: unknown,
    websiteDomain: string,
  ) {
    const utmSource = this.readMetadataString(metadata, ['utm_source', 'source']);
    const utmMedium = this.readMetadataString(metadata, ['utm_medium', 'medium']);
    const utmCampaign = this.readMetadataString(metadata, ['utm_campaign', 'campaign']);

    if (utmSource) {
      return {
        source: utmSource,
        medium: utmMedium ?? null,
        campaign: utmCampaign ?? null,
      };
    }

    if (!referrer) {
      return {
        source: 'direct',
        medium: null,
        campaign: null,
      };
    }

    try {
      const host = new URL(referrer).hostname.replace(/^www\./i, '').toLowerCase();
      const normalizedWebsiteDomain = websiteDomain.replace(/^www\./i, '').toLowerCase();

      if (host === normalizedWebsiteDomain) {
        return {
          source: 'internal',
          medium: 'internal',
          campaign: null,
        };
      }

      return {
        source: host,
        medium: utmMedium ?? 'referral',
        campaign: utmCampaign ?? null,
      };
    } catch {
      return {
        source: 'direct',
        medium: null,
        campaign: null,
      };
    }
  }

  private resolveCustomEventName(event: EventPoint) {
    const fromMetadata = this.readMetadataString(event.metadata, [
      'eventName',
      'name',
      'action',
      'label',
      'event',
      'type',
    ]);

    return fromMetadata ?? event.type.toLowerCase();
  }

  private extractMetadataPairs(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return [] as Array<[string, string]>;
    }

    const record = metadata as Record<string, unknown>;
    const keys = [
      'eventName',
      'name',
      'action',
      'category',
      'label',
      'value',
      'variant',
      'page',
      'button',
      'form',
      'source',
      'medium',
      'campaign',
    ];
    const result: Array<[string, string]> = [];

    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        result.push([key, value.trim()]);
      }
    }

    return result;
  }

  private groupEventsBySession(events: EventPoint[]) {
    const grouped = new Map<string, EventPoint[]>();

    for (const event of events) {
      if (!event.sessionId) {
        continue;
      }

      const bucket = grouped.get(event.sessionId) ?? [];
      bucket.push(event);
      grouped.set(event.sessionId, bucket);
    }

    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    }

    return grouped;
  }

  private resolveCurrentPage(events: EventPoint[]) {
    const pageviews = events
      .filter((event) => event.type === EventType.PAGEVIEW)
      .map((event) => this.normalizePagePath(event.url))
      .filter((value): value is string => Boolean(value));

    if (pageviews.length === 0) {
      return null;
    }

    return pageviews[pageviews.length - 1];
  }

  private resolveGeoCountry(session: SessionPoint, events: EventPoint[]) {
    const eventCountry = events.find(
      (event) => this.normalizeLabel(event.country) !== 'unknown',
    )?.country;

    return this.normalizeLabel(session.country ?? eventCountry);
  }

  private resolveGeoCity(events: EventPoint[], country: string) {
    for (const event of events) {
      const city = this.readMetadataString(event.metadata, [
        'city',
        'geo_city',
        'location_city',
        'town',
      ]);

      if (city) {
        return {
          value: `${city}|${country}`,
        };
      }
    }

    return {
      value: `unknown|${country}`,
    };
  }

  private resolveRetentionIdentity(session: SessionPoint) {
    return session.userId ?? session.externalSessionId ?? session.ip ?? session.id;
  }

  private extendRangeForRetention(range: Range, granularity: 'day' | 'week', periods: number) {
    const unitMs = granularity === 'week' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return {
      from: range.from,
      to: new Date(range.to.getTime() + unitMs * periods),
    };
  }

  private bucketDate(date: Date, granularity: 'day' | 'week') {
    const current = new Date(date.getTime());

    if (granularity === 'week') {
      const day = current.getUTCDay();
      const offset = day === 0 ? -6 : 1 - day;
      current.setUTCDate(current.getUTCDate() + offset);
    }

    return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  }

  private calculatePeriodIndex(
    cohortStart: Date,
    date: Date,
    granularity: 'day' | 'week',
  ) {
    const unitMs = granularity === 'week' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return Math.floor((this.bucketDate(date, granularity).getTime() - cohortStart.getTime()) / unitMs);
  }

  private getCohortEnd(cohortStart: Date, granularity: 'day' | 'week') {
    const days = granularity === 'week' ? 7 : 1;
    const end = new Date(cohortStart.getTime());
    end.setUTCDate(end.getUTCDate() + days);
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
    return end;
  }

  private getUtcDayStart(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private buildFunnelDropoff(steps: Array<{ count: number }>) {
    return steps.map((step, index) => {
      const previous = index === 0 ? step.count : steps[index - 1].count;

      return {
        step: index + 1,
        dropoff:
          index === 0 || previous <= 0
            ? null
            : Math.round(((previous - step.count) / previous) * 1000) / 1000,
        conversionRate:
          index === 0 || previous <= 0
            ? null
            : Math.round((step.count / previous) * 1000) / 1000,
      };
    });
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

  private normalizeLabel(value: string | null | undefined) {
    const label = value?.trim();
    return label && label.length > 0 ? label : 'unknown';
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
}
