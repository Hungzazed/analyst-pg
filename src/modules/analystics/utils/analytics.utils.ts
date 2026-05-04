import { EventType } from '@prisma/client';
import {
  DAYS_PER_WEEK,
  MILLIS_PER_DAY,
  RATE_PRECISION_FACTOR,
  TOP_METADATA_BREAKDOWN_LIMIT,
} from '../constant/analytics.constants';
import type {
  EventPointLike,
  SessionPointLike,
  SessionWithOptionalIdentity,
} from '../types/analytics.types';

export function groupCustomEvents<TEvent extends EventPointLike>(
  customEvents: TEvent[],
  resolveCustomEventName: (event: TEvent) => string,
  extractMetadataPairs: (metadata: unknown) => Array<[string, string]>,
) {
  const groups = new Map<
    string,
    {
      type: EventType;
      count: number;
      metadata: Map<string, number>;
    }
  >();

  for (const event of customEvents) {
    const name = resolveCustomEventName(event);
    const group = groups.get(name) ?? {
      type: event.type,
      count: 0,
      metadata: new Map<string, number>(),
    };

    group.count += 1;

    for (const [key, value] of extractMetadataPairs(event.metadata)) {
      const breakdownKey = `${key}:${value}`;
      group.metadata.set(breakdownKey, (group.metadata.get(breakdownKey) ?? 0) + 1);
    }

    groups.set(name, group);
  }

  return groups;
}

export function mapCustomEventRows(
  rows: Array<{ value: string; count: number }>,
  groups: Map<
    string,
    {
      type: EventType;
      count: number;
      metadata: Map<string, number>;
    }
  >,
  total: number,
  toSortedRows: (counts: Map<string, number>) => Array<{ value: string; count: number }>,
) {
  return rows.map((row) => {
    const group = groups.get(row.value);
    const metadataBreakdown = group
      ? toSortedRows(group.metadata)
          .slice(0, TOP_METADATA_BREAKDOWN_LIMIT)
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
      metadataBreakdownLimit: TOP_METADATA_BREAKDOWN_LIMIT,
      metadataBreakdown,
    };
  });
}

export function buildTopPageMetrics<TSession extends SessionPointLike, TEvent extends EventPointLike>(
  sessions: TSession[],
  events: TEvent[],
  groupEventsBySession: (items: TEvent[]) => Map<string, TEvent[]>,
  normalizePagePath: (value?: string | null) => string | undefined,
) {
  const sessionEvents = groupEventsBySession(events);
  const pageCounts = new Map<string, number>();
  const durationTotals = new Map<string, number>();
  const entryCounts = new Map<string, number>();
  const exitCounts = new Map<string, number>();
  const bounceCounts = new Map<string, number>();

  for (const session of sessions) {
    const eventsForSession = sessionEvents.get(session.id) ?? [];
    const pageviews = eventsForSession.filter((event) => event.type === EventType.PAGEVIEW);
    const pagePaths = pageviews
      .map((event) => normalizePagePath(event.url))
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

      const path = normalizePagePath(event.url);
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

  return {
    pageCounts,
    durationTotals,
    entryCounts,
    exitCounts,
    bounceCounts,
  };
}

export function buildBehaviorMetrics<TSession extends SessionPointLike, TEvent extends EventPointLike>(
  sessions: TSession[],
  events: TEvent[],
  groupEventsBySession: (items: TEvent[]) => Map<string, TEvent[]>,
  normalizePagePath: (value?: string | null) => string | undefined,
) {
  const sessionEvents = groupEventsBySession(events);
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
      .map((event) => normalizePagePath(event.url))
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

  return {
    sessionMap,
    entryCounts,
    exitCounts,
    transitionCounts,
    totalTransitions,
    totalPages,
  };
}

export function resolvePreviousRange(range: { from: Date; to: Date }) {
  const duration = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime());
  const from = new Date(to.getTime() - duration);
  return { from, to };
}

export function calculatePercentChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function calculateAverageSessionDuration(
  sessions: Array<Pick<SessionPointLike, 'createdAt' | 'lastSeenAt'>>,
) {
  if (sessions.length === 0) {
    return 0;
  }

  const totalDuration = sessions.reduce(
    (accumulator, session) =>
      accumulator +
      Math.max(0, session.lastSeenAt.getTime() - session.createdAt.getTime()),
    0,
  );

  return Math.round(totalDuration / sessions.length);
}

export function normalizePagePath(value?: string | null) {
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

export function readMetadataString(metadata: unknown, keys: string[]) {
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

export function readBooleanMetadata(metadata: unknown, keys: string[]) {
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

export function resolveTrafficSource(
  referrer: string | null,
  metadata: unknown,
  websiteDomain: string,
) {
  const utmSource = readMetadataString(metadata, ['utm_source', 'source']);
  const utmMedium = readMetadataString(metadata, ['utm_medium', 'medium']);
  const utmCampaign = readMetadataString(metadata, ['utm_campaign', 'campaign']);

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

export function extractMetadataPairs(metadata: unknown) {
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

export function groupEventsBySession<TEvent extends EventPointLike>(events: TEvent[]) {
  const grouped = new Map<string, TEvent[]>();
  for (const event of events) {
    if (!event.sessionId) {
      continue;
    }

    const bucket = grouped.get(event.sessionId) ?? [];
    bucket.push(event);
    grouped.set(event.sessionId, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );
  }

  return grouped;
}

export function resolveCurrentPage<TEvent extends EventPointLike>(events: TEvent[]) {
  const pageviews = events
    .filter((event) => event.type === EventType.PAGEVIEW)
    .map((event) => normalizePagePath(event.url))
    .filter((value): value is string => Boolean(value));

  if (pageviews.length === 0) {
    return null;
  }

  return pageviews[pageviews.length - 1];
}

export function resolveGeoCountry(
  sessionCountry: string | null,
  eventCountries: Array<string | null>,
) {
  const eventCountry = eventCountries.find(
    (country) => normalizeLabel(country) !== 'unknown',
  );
  return normalizeLabel(sessionCountry ?? eventCountry);
}

export function resolveGeoCity(eventsMetadata: unknown[], country: string) {
  for (const metadata of eventsMetadata) {
    const city = readMetadataString(metadata, [
      'city',
      'geo_city',
      'location_city',
      'town',
    ]);
    if (city) {
      return { value: `${city}|${country}` };
    }
  }

  return { value: `unknown|${country}` };
}

export function resolveRetentionIdentity(session: SessionWithOptionalIdentity) {
  return session.userId ?? session.externalSessionId ?? session.ip ?? session.id;
}

export function bucketDate(date: Date, granularity: 'day' | 'week') {
  const current = new Date(date.getTime());

  if (granularity === 'week') {
    const day = current.getUTCDay();
    const offset = day === 0 ? -6 : 1 - day;
    current.setUTCDate(current.getUTCDate() + offset);
  }

  return new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()),
  );
}

export function calculatePeriodIndex(
  cohortStart: Date,
  date: Date,
  granularity: 'day' | 'week',
) {
  const unitMs = granularity === 'week' ? DAYS_PER_WEEK * MILLIS_PER_DAY : MILLIS_PER_DAY;
  return Math.floor((bucketDate(date, granularity).getTime() - cohortStart.getTime()) / unitMs);
}

export function getCohortEnd(cohortStart: Date, granularity: 'day' | 'week') {
  const days = granularity === 'week' ? DAYS_PER_WEEK : 1;
  const end = new Date(cohortStart.getTime());
  end.setUTCDate(end.getUTCDate() + days);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return end;
}

export function getUtcDayStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function buildFunnelDropoff(steps: Array<{ count: number }>) {
  return steps.map((step, index) => {
    const previous = index === 0 ? step.count : steps[index - 1].count;
    return {
      step: index + 1,
      dropoff:
        index === 0 || previous <= 0
          ? null
          : Math.round(((previous - step.count) / previous) * RATE_PRECISION_FACTOR) /
            RATE_PRECISION_FACTOR,
      conversionRate:
        index === 0 || previous <= 0
          ? null
          : Math.round((step.count / previous) * RATE_PRECISION_FACTOR) /
            RATE_PRECISION_FACTOR,
    };
  });
}

export function normalizeLabel(value: string | null | undefined) {
  const label = value?.trim();
  return label && label.length > 0 ? label : 'unknown';
}

export function normalizeDevice(device: string | null) {
  const label = normalizeLabel(device).toLowerCase();
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
  return normalizeLabel(device);
}

export function toSortedRows(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.value.localeCompare(right.value),
    );
}

export function buildMobileVsDesktop(counts: Map<string, number>, total: number) {
  const mobile = counts.get('mobile') ?? 0;
  const desktop = counts.get('desktop') ?? 0;
  const other = Math.max(0, total - mobile - desktop);

  return [
    { value: 'mobile', count: mobile, share: total > 0 ? mobile / total : 0 },
    { value: 'desktop', count: desktop, share: total > 0 ? desktop / total : 0 },
    { value: 'other', count: other, share: total > 0 ? other / total : 0 },
  ];
}

export function calculateBounceRate<
  TSession extends { id: string },
  TEvent extends EventPointLike,
>(sessions: TSession[], events: TEvent[]) {
  if (sessions.length === 0) {
    return 0;
  }

  const groupedEvents = groupEventsBySession(events);
  let bouncedSessions = 0;

  for (const session of sessions) {
    const pageviews = (groupedEvents.get(session.id) ?? []).filter(
      (event) => event.type === EventType.PAGEVIEW,
    );
    if (pageviews.length === 1) {
      bouncedSessions += 1;
    }
  }

  return Math.round((bouncedSessions / sessions.length) * RATE_PRECISION_FACTOR) / RATE_PRECISION_FACTOR;
}

export function buildDailyBounceRates<
  TSession extends { id: string; createdAt: Date },
  TEvent extends EventPointLike,
>(sessions: TSession[], events: TEvent[]) {
  const groupedEvents = groupEventsBySession(events);
  const daySessions = new Map<string, number>();
  const dayBouncedSessions = new Map<string, number>();

  for (const session of sessions) {
    const key = getUtcDayStart(session.createdAt).toISOString();
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
      totalSessions > 0
        ? Math.round((bounced / totalSessions) * RATE_PRECISION_FACTOR) /
            RATE_PRECISION_FACTOR
        : 0,
    );
  }

  return result;
}
