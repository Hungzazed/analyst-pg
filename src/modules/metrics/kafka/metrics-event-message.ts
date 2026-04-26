import { EventType } from '@prisma/client';

export interface MetricsEventMessage {
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
