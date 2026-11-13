import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebhookVerificationError } from './errors.js';

export type HeaderValue = string | string[] | undefined;
export type IncomingHeaders = Record<string, HeaderValue>;

export type WebhookVerifierOptions = {
  secret: string;
  toleranceSeconds?: number;
  now?: () => Date;
};

export class WebhookVerifier {
  private readonly toleranceSeconds: number;

  private readonly now: () => Date;

  public constructor(private readonly options: WebhookVerifierOptions) {
    this.toleranceSeconds = options.toleranceSeconds ?? 300;
    this.now = options.now ?? (() => new Date());
  }

  public assertValid(headers: IncomingHeaders, rawBody: Buffer): void {
    const { timestamp, signature } = this.parseSignature(this.header(headers, 'x-rank-ledger-signature'));
    const currentTimestamp = Math.floor(this.now().getTime() / 1_000);

    if (Math.abs(currentTimestamp - timestamp) > this.toleranceSeconds) {
      throw new WebhookVerificationError('Webhook timestamp is outside the accepted tolerance.');
    }

    const expectedBytes = createHmac('sha256', this.options.secret)
      .update(`${timestamp}.`, 'utf8')
      .update(rawBody)
      .digest();
    const receivedBytes = Buffer.from(signature, 'hex');

    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
      throw new WebhookVerificationError('Webhook signature is invalid.');
    }
  }

  private header(headers: IncomingHeaders, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];

    return Array.isArray(value) ? value[0] : value;
  }

  private parseSignature(value: string | undefined): { timestamp: number; signature: string } {
    if (value === undefined) {
      throw new WebhookVerificationError('Webhook signature is missing.');
    }

    const parts = new Map(value.split(',').map((part) => {
      const [key, candidate] = part.trim().split('=', 2);

      return [key, candidate];
    }));
    const timestamp = Number(parts.get('t'));
    const signature = parts.get('v1');

    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || signature === undefined || !/^[a-f\d]{64}$/i.test(signature)) {
      throw new WebhookVerificationError('Webhook signature header is malformed.');
    }

    return { timestamp, signature };
  }
}
