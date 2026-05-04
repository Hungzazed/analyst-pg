import { EventType } from '@prisma/client';

export type EventPoint = {
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

export type SessionPoint = {
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

export type Range = {
  from: Date;
  to: Date;
};

export type RangeSnapshot = {
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

export type EventPointLike = {
  sessionId: string | null;
  type: EventType;
  url: string | null;
  metadata: unknown;
  occurredAt: Date;
};

export type SessionPointLike = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
};

export type SessionWithOptionalIdentity = SessionPointLike & {
  userId: string | null;
  externalSessionId: string | null;
  ip: string | null;
};
