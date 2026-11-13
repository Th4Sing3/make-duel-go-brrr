export class InputError extends Error {
  public readonly statusCode = 422;
}

export type LedgerFailureKind = 'network' | 'timeout' | 'upstream';

export class LedgerRequestError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
    public readonly failureKind: LedgerFailureKind = 'upstream',
  ) {
    super(message);
    this.name = 'LedgerRequestError';
  }
}

export class WebhookVerificationError extends Error {
  public readonly statusCode = 401;
}
