import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { lookup } from 'geoip-lite';
import UAParser from 'ua-parser-js';

export interface ClientContext {
  ip?: string;
  userAgent?: string;
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
}

interface ResolveClientContextInput {
  ip?: string;
  userAgent?: string;
  countryHint?: string;
}

interface AssertRequestDomainInput {
  websiteDomain: string;
  origin?: string;
  referer?: string;
}

export function normalizeString(
  value?: string | null,
  maxLen = 255,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLen);
}

export function parseUnixTimestamp(timestamp: number): Date {
  const millis = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(millis);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('timestamp must be a valid Unix timestamp');
  }

  return date;
}

export function getUtcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function resolveClientContext(
  input: ResolveClientContextInput,
): ClientContext {
  const ip = normalizeIp(input.ip);
  const userAgent = normalizeString(input.userAgent, 512);
  const parsedUserAgent = new UAParser(userAgent).getResult();
  const browser = normalizeString(parsedUserAgent.browser.name, 128);
  const os = normalizeString(parsedUserAgent.os.name, 128);
  const deviceType = parsedUserAgent.device.type;
  const device =
    deviceType === 'mobile' || deviceType === 'tablet' ? deviceType : 'desktop';

  return {
    ip,
    userAgent,
    country: resolveCountry(ip, input.countryHint),
    device,
    browser: browser ?? 'Unknown',
    os: os ?? 'Unknown',
  };
}

export function assertRequestDomain(input: AssertRequestDomainInput): void {
  const websiteHost = normalizeHost(input.websiteDomain);
  if (!websiteHost) {
    throw new ForbiddenException('Website domain is misconfigured');
  }

  const originHost = extractHost(input.origin);
  const refererHost = extractHost(input.referer);
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

function resolveCountry(ip?: string, countryHint?: string): string | undefined {
  const normalizedHint = normalizeCountryCode(countryHint);
  if (normalizedHint) {
    return normalizedHint;
  }

  if (!ip || isPrivateIp(ip)) {
    return undefined;
  }

  const geo = lookup(ip);
  return normalizeCountryCode(geo?.country);
}

function normalizeCountryCode(value?: string | null): string | undefined {
  const normalized = normalizeString(value, 8)?.toUpperCase();
  if (!normalized || normalized === 'XX' || normalized === 'T1') {
    return undefined;
  }

  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeIp(rawIp?: string | null): string | undefined {
  const normalized = normalizeString(rawIp, 128);
  if (!normalized) {
    return undefined;
  }

  if (normalized === '::1') {
    return '127.0.0.1';
  }

  const ipv6MappedIpv4Prefix = '::ffff:';
  if (normalized.toLowerCase().startsWith(ipv6MappedIpv4Prefix)) {
    return normalized.slice(ipv6MappedIpv4Prefix.length);
  }

  return normalized;
}

function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.')
  ) {
    return true;
  }

  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) {
    return true;
  }

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function extractHost(rawUrl?: string): string | undefined {
  const normalized = normalizeString(rawUrl, 2048);
  if (!normalized) {
    return undefined;
  }

  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeHost(domain: string): string | undefined {
  const normalized = normalizeString(domain, 255);
  if (!normalized) {
    return undefined;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return extractHost(normalized);
  }

  return normalized.toLowerCase();
}
