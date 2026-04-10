import { randomBytes } from 'crypto';

export function generateApiKey(): string {
  return `ak_${randomBytes(24).toString('hex')}`;
}
