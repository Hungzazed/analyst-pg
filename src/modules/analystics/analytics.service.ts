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
import {
  DAYS_PER_WEEK,
  DEFAULT_DAILY_RANGE_DAYS,
  DEFAULT_LIMIT,
  DEFAULT_REALTIME_REFRESH_SECONDS,
  DEFAULT_REALTIME_SESSION_LIMIT,
  DEFAULT_REALTIME_WINDOW_MINUTES,
  DEFAULT_RETENTION_PERIODS,
  MILLIS_PER_DAY,
  MILLIS_PER_SECOND,
  RATE_PRECISION_FACTOR,
  TOP_PAGES_LIMIT,
  TOP_TRANSITIONS_LIMIT,
} from './constant/analytics.constants';
import {
  buildBehaviorMetrics,
  buildDailyBounceRates,
  buildFunnelDropoff,
  buildMobileVsDesktop,
  buildTopPageMetrics,
  bucketDate,
  calculateAverageSessionDuration,
  calculateBounceRate,
  calculatePercentChange,
  calculatePeriodIndex,
  extractMetadataPairs,
  getCohortEnd,
  groupCustomEvents,
  groupEventsBySession,
  mapCustomEventRows,
  normalizeDevice,
  normalizeLabel,
  normalizePagePath,
  readBooleanMetadata,
  readMetadataString,
  resolveCurrentPage,
  resolveGeoCity,
  resolveGeoCountry,
  resolvePreviousRange,
  resolveRetentionIdentity,
  resolveTrafficSource,
  toSortedRows,
} from './utils/analytics.utils';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { RealtimeQueryDto } from './dto/realtime-query.dto';
import { RetentionQueryDto } from './dto/retention-query.dto';
import type {
  EventPoint,
  Range,
  RangeSnapshot,
  SessionPoint,
} from './types/analytics.types';

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
    const previousRange = resolvePreviousRange(range);

    const [currentSnapshot, previousSnapshot] = await Promise.all([
      this.collectRangeSnapshot(websiteId, range),
      this.collectRangeSnapshot(websiteId, previousRange),
    ]);

    const currentSummary = this.buildOverviewSnapshot(currentSnapshot);
    const previousSummary = this.buildOverviewSnapshot(previousSnapshot);
    const dailyBounceRates = buildDailyBounceRates(
      currentSnapshot.sessions,
      currentSnapshot.events,
    );

    return {
      website,
      range,
      previousRange,
      summary: {
        pageviews: currentSummary.pageviews,
        pageviewsChange: calculatePercentChange(
          currentSummary.pageviews,
          previousSummary.pageviews,
        ),
        sessions: currentSummary.sessions,
        sessionsChange: calculatePercentChange(
          currentSummary.sessions,
          previousSummary.sessions,
        ),
        uniqueVisitors: currentSummary.uniqueVisitors,
        uniqueVisitorsChange: calculatePercentChange(
          currentSummary.uniqueVisitors,
          previousSummary.uniqueVisitors,
        ),
        bounceRate: currentSummary.bounceRate,
        bounceRateChange: calculatePercentChange(
          currentSummary.bounceRate,
          previousSummary.bounceRate,
        ),
        averageSessionDurationMs: currentSummary.averageSessionDurationMs,
        averageSessionDurationMsChange: calculatePercentChange(
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
    const limit = query.limit ?? DEFAULT_LIMIT;
    const events = await this.fetchEvents(websiteId, range);
    const customEvents = events.filter(
      (event) => event.type !== EventType.PAGEVIEW,
    );
    const groups = groupCustomEvents(
      customEvents,
      (event) => this.resolveCustomEventName(event),
      (metadata) => extractMetadataPairs(metadata),
    );
    const total = customEvents.length;
    const rows = toSortedRows(
      new Map(
        Array.from(groups.entries()).map(([name, group]) => [
          name,
          group.count,
        ]),
      ),
    ).slice(0, limit);

    return {
      range,
      total,
      events: mapCustomEventRows(rows, groups, total, (counts) =>
        toSortedRows(counts),
      ),
    };
  }

  async getTopPages(
    userId: string,
    websiteId: string,
    query: AnalyticsQueryDto,
  ) {
    const website = await this.assertWebsiteOwnership(userId, websiteId);
    const range = this.resolveRange(query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [sessions, events] = await Promise.all([
      this.fetchSessions(websiteId, range),
      this.fetchEvents(websiteId, range),
    ]);

    const metrics = buildTopPageMetrics<SessionPoint, EventPoint>(
      sessions,
      events as EventPoint[],
      (items) => groupEventsBySession(items),
      (value) => normalizePagePath(value),
    );

    const total = Array.from(metrics.pageCounts.values()).reduce(
      (accumulator, value) => accumulator + value,
      0,
    );
    const rows = toSortedRows(metrics.pageCounts).slice(0, limit);

    return {
      website,
      range,
      total,
      pages: rows.map((row) => {
        const entryCount = metrics.entryCounts.get(row.value) ?? 0;
        const exitCount = metrics.exitCounts.get(row.value) ?? 0;
        const bounceCount = metrics.bounceCounts.get(row.value) ?? 0;

        return {
          value: row.value,
          count: row.count,
          share: total > 0 ? row.count / total : 0,
          avgTimeOnPageMs: Math.round(
            (metrics.durationTotals.get(row.value) ?? 0) /
              Math.max(row.count, 1),
          ),
          bounceRate:
            entryCount > 0
              ? Math.round((bounceCount / entryCount) * RATE_PRECISION_FACTOR) /
                RATE_PRECISION_FACTOR
              : 0,
          exitRate:
            row.count > 0
              ? Math.round((exitCount / row.count) * RATE_PRECISION_FACTOR) /
                RATE_PRECISION_FACTOR
              : 0,
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
      {
        source: string;
        medium: string | null;
        campaign: string | null;
        count: number;
      }
    >();

    for (const event of events) {
      const source = resolveTrafficSource(
        event.referrer,
        event.metadata,
        website.domain,
      );
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
      .sort(
        (left, right) =>
          right.count - left.count || left.source.localeCompare(right.source),
      )
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
    const sessionLimit = query.sessionLimit ?? DEFAULT_LIMIT;

    const [events, sessions] = await Promise.all([
      this.fetchEvents(websiteId, range),
      this.fetchSessions(websiteId, range),
    ]);

    const behavior = buildBehaviorMetrics<SessionPoint, EventPoint>(
      sessions,
      events as EventPoint[],
      (items) => groupEventsBySession(items),
      (value) => normalizePagePath(value),
    );

    const journeys = Array.from(behavior.sessionMap.values())
      .filter((session) => session.pages.length > 0)
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
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, sessionLimit);

    return {
      range,
      journeysTotal: sessions.length,
      journeysLimit: sessionLimit,
      journeys,
      topEntryPages: toSortedRows(behavior.entryCounts).slice(
        0,
        TOP_PAGES_LIMIT,
      ),
      topExitPages: toSortedRows(behavior.exitCounts).slice(0, TOP_PAGES_LIMIT),
      avgPagesPerSession:
        sessions.length > 0
          ? Math.round(
              (behavior.totalPages / sessions.length) * RATE_PRECISION_FACTOR,
            ) / RATE_PRECISION_FACTOR
          : 0,
      transitions: {
        total: behavior.totalTransitions,
        items: toSortedRows(behavior.transitionCounts).slice(
          0,
          TOP_TRANSITIONS_LIMIT,
        ),
      },
      averageSessionDurationMs: calculateAverageSessionDuration(sessions),
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
      const device = normalizeDevice(session.device);
      const browser = normalizeLabel(session.browser);
      const os = normalizeLabel(session.os);

      deviceCounts.set(device, (deviceCounts.get(device) ?? 0) + 1);
      browserCounts.set(browser, (browserCounts.get(browser) ?? 0) + 1);
      osCounts.set(os, (osCounts.get(os) ?? 0) + 1);
    }

    const total = sessions.length;

    return {
      range,
      totalSessions: total,
      deviceShare: toSortedRows(deviceCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      browserUsage: toSortedRows(browserCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      osUsage: toSortedRows(osCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      mobileVsDesktop: buildMobileVsDesktop(deviceCounts, total),
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

    const sessionEvents = groupEventsBySession(events);
    const countryCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();

    for (const session of sessions) {
      const eventsForSession = sessionEvents.get(session.id) ?? [];
      const country = resolveGeoCountry(
        session.country,
        eventsForSession.map((event) => event.country),
      );
      const city = resolveGeoCity(
        eventsForSession.map((event) => event.metadata),
        country,
      );
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      cityCounts.set(city.value, (cityCounts.get(city.value) ?? 0) + 1);
    }

    const total = sessions.length;

    return {
      range,
      totalSessions: total,
      countries: toSortedRows(countryCounts).map((row) => ({
        ...row,
        share: total > 0 ? row.count / total : 0,
      })),
      cities: toSortedRows(cityCounts).map((row) => {
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
    const windowMinutes =
      query.windowMinutes ?? DEFAULT_REALTIME_WINDOW_MINUTES;
    const activeSessionsLimit =
      query.sessionLimit ?? query.limit ?? DEFAULT_REALTIME_SESSION_LIMIT;
    const now = new Date();
    const from = new Date(
      now.getTime() - windowMinutes * 60 * MILLIS_PER_SECOND,
    );
    const range = { from, to: now };

    const [sessions, events] = await Promise.all([
      this.fetchActiveSessions(websiteId, range),
      this.fetchEvents(websiteId, range),
    ]);

    const sessionEvents = groupEventsBySession(events);
    const currentPageCounts = new Map<string, number>();

    const activeSessions = sessions
      .map((session) => {
        const currentPage = resolveCurrentPage(
          sessionEvents.get(session.id) ?? [],
        );

        if (currentPage) {
          currentPageCounts.set(
            currentPage,
            (currentPageCounts.get(currentPage) ?? 0) + 1,
          );
        }

        return {
          sessionId: session.id,
          currentPage,
          lastSeenAt: session.lastSeenAt,
          country: normalizeLabel(session.country),
          device: normalizeDevice(session.device),
          browser: normalizeLabel(session.browser),
          os: normalizeLabel(session.os),
        };
      })
      .sort(
        (left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime(),
      )
      .slice(0, activeSessionsLimit);

    return {
      range,
      windowMinutes,
      onlineUsers: sessions.length,
      activeSessionsLimit,
      activeSessions,
      currentPages: toSortedRows(currentPageCounts).slice(
        0,
        activeSessionsLimit,
      ),
      totalActivePages: currentPageCounts.size,
    };
  }

  streamRealtime(
    userId: string,
    websiteId: string,
    query: RealtimeQueryDto,
  ): Observable<MessageEvent> {
    const refreshSeconds =
      query.refreshSeconds ?? DEFAULT_REALTIME_REFRESH_SECONDS;

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
    const periods = query.periods ?? DEFAULT_RETENTION_PERIODS;
    const retentionRange = this.extendRangeForRetention(
      range,
      granularity,
      periods,
    );

    const sessions = await this.fetchSessions(websiteId, retentionRange);
    const identityGroups = new Map<string, SessionPoint[]>();

    for (const session of sessions) {
      const identity = resolveRetentionIdentity(session);
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
        (session) =>
          session.createdAt >= range.from && session.createdAt < range.to,
      );

      if (!cohortSession) {
        continue;
      }

      const cohortStart = bucketDate(cohortSession.createdAt, granularity);
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

        const periodIndex = calculatePeriodIndex(
          cohortStart,
          session.createdAt,
          granularity,
        );

        if (periodIndex <= 0 || periodIndex >= periods) {
          continue;
        }

        const periodBucket =
          cohort.retention.get(periodIndex) ?? new Set<string>();
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
        .sort(
          (left, right) =>
            left.cohortStart.getTime() - right.cohortStart.getTime(),
        )
        .map((cohort) => {
          const users = cohort.users.size;

          return {
            cohortStart: cohort.cohortStart,
            cohortEnd: getCohortEnd(cohort.cohortStart, granularity),
            users,
            retention: Array.from({ length: periods }, (_, period) => {
              const count =
                period === 0
                  ? users
                  : (cohort.retention.get(period)?.size ?? 0);
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

    const landingTarget = normalizePagePath(query.landingUrl);
    const nextTarget = normalizePagePath(query.nextUrl);
    const conversionTarget = normalizePagePath(query.conversionUrl);

    let landingCount = 0;
    let nextCount = 0;
    let conversionCount = 0;

    for (const eventsInSession of sessions.values()) {
      const pageviews = eventsInSession
        .filter((event) => event.type === EventType.PAGEVIEW)
        .map((event) => normalizePagePath(event.url))
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
              readBooleanMetadata(event.metadata, [
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
        landingCount > 0
          ? Math.round(
              (conversionCount / landingCount) * RATE_PRECISION_FACTOR,
            ) / RATE_PRECISION_FACTOR
          : 0,
      dropoff: buildFunnelDropoff(steps),
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
      throw new ForbiddenException(
        'You do not have permission to access this website',
      );
    }

    return website;
  }

  private async collectRangeSnapshot(
    websiteId: string,
    range: Range,
  ): Promise<RangeSnapshot> {
    const [dailyRows, sessions, events, pageviewCount, uniqueUrls] =
      await Promise.all([
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
      bounceRate: calculateBounceRate(snapshot.sessions, snapshot.events),
      averageSessionDurationMs: calculateAverageSessionDuration(
        snapshot.sessions,
      ),
      pageviewCount: snapshot.pageviewCount,
      uniquePages: snapshot.uniquePages,
    };
  }

  private async fetchPageviewEvents(websiteId: string, range: Range) {
    return await this.prismaService.event.findMany({
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
    return await this.prismaService.event.findMany({
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
    return await this.prismaService.session.findMany({
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

  private async fetchActiveSessions(websiteId: string, range: Range) {
    return await this.prismaService.session.findMany({
      where: {
        websiteId,
        lastSeenAt: {
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
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  private resolveRange(query: AnalyticsQueryDto | RetentionQueryDto): Range {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;

    if (Number.isNaN(to.getTime())) {
      throw new BadRequestException('to must be a valid ISO date');
    }

    const defaultFrom = new Date(to.getTime());
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - DEFAULT_DAILY_RANGE_DAYS);

    const from = query.from ? new Date(query.from) : defaultFrom;

    if (Number.isNaN(from.getTime())) {
      throw new BadRequestException('from must be a valid ISO date');
    }

    if (from >= to) {
      throw new BadRequestException('from must be earlier than to');
    }

    return { from, to };
  }

  private resolveCustomEventName(event: EventPoint) {
    const fromMetadata = readMetadataString(event.metadata, [
      'eventName',
      'name',
      'action',
      'label',
      'event',
      'type',
    ]);

    return fromMetadata ?? event.type.toLowerCase();
  }

  private extendRangeForRetention(
    range: Range,
    granularity: 'day' | 'week',
    periods: number,
  ) {
    const unitMs =
      granularity === 'week' ? DAYS_PER_WEEK * MILLIS_PER_DAY : MILLIS_PER_DAY;
    return {
      from: range.from,
      to: new Date(range.to.getTime() + unitMs * periods),
    };
  }
}
