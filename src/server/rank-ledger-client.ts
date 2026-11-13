import type {
  JsonObject,
  LeaderboardSnapshot,
  RankLedgerGateway,
  ScoreEventReceipt,
  ScoreEventRequest,
} from './contracts.js';
import { LedgerRequestError } from './errors.js';

export type RankLedgerClientOptions = {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
};

/**
 * Thin HTTP boundary around Rank Ledger. This service owns no ranking state;
 * MySQL behind Rank Ledger remains the source of truth.
 */
export class RankLedgerClient implements RankLedgerGateway {
  private readonly baseUrl: URL;

  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: RankLedgerClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  public async getLeaderboard(leaderboardId: string, limit: number): Promise<LeaderboardSnapshot> {
    const url = this.urlFor(`api/v1/leaderboards/${encodeURIComponent(leaderboardId)}`);
    url.searchParams.set('limit', String(limit));
    const response = await this.fetchRankLedger(url, { headers: this.headers() });

    return this.parseJsonResponse<LeaderboardSnapshot>(response, 'Could not load the leaderboard.');
  }

  public async recordScore(event: ScoreEventRequest): Promise<ScoreEventReceipt> {
    const response = await this.fetchRankLedger(
      this.urlFor(`api/v1/leaderboards/${encodeURIComponent(event.leaderboardId)}/events`),
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
          'Idempotency-Key': event.idempotencyKey,
        },
        body: JSON.stringify({
          event_id: event.eventId,
          participant_id: event.participantId,
          points: event.points,
          occurred_at: event.occurredAt,
          metadata: event.metadata,
        }),
      },
    );
    const body = await this.parseJsonResponse<JsonObject>(response, 'Could not record the score event.');

    return {
      statusCode: response.status,
      replayed: response.headers.get('Idempotent-Replay') === 'true',
      body,
    };
  }

  private headers(): HeadersInit {
    return { Accept: 'application/json', 'X-API-Key': this.options.apiKey };
  }

  private async fetchRankLedger(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(this.options.requestTimeoutMs ?? 5_000);
    const signal = init.signal == null
      ? timeoutSignal
      : AbortSignal.any([init.signal, timeoutSignal]);

    try {
      return await this.fetchImplementation(input, { ...init, signal });
    } catch {
      if (timeoutSignal.aborted) {
        throw new LedgerRequestError('Rank Ledger did not respond before the request timeout.', 0, null, 'timeout');
      }

      // Network failures have no HTTP response but should still be presented as an upstream failure.
      throw new LedgerRequestError('Could not reach Rank Ledger.', 0, null, 'network');
    }
  }

  private urlFor(pathname: string): URL {
    return new URL(pathname, this.baseUrl);
  }

  private async parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new LedgerRequestError(this.errorMessage(body) ?? fallbackMessage, response.status, body);
    }
    if (body === null || typeof body !== 'object') {
      throw new LedgerRequestError('Rank Ledger returned an unexpected response body.', response.status, body);
    }

    return body as T;
  }

  private errorMessage(body: unknown): string | null {
    if (body !== null && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      return body.message;
    }

    return null;
  }
}
