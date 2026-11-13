import type { MatchReceipt, MatchSubmission, RankLedgerGateway, ScoreEventRequest } from './contracts.js';
import { InputError, LedgerRequestError } from './errors.js';

const WINNER_POINTS = 25;
const LOSER_POINTS = -10;
const MAX_IDENTIFIER_LENGTH = 96;

/**
 * A match is two independent ledger events. After a transient failure, stable
 * receipt data lets Rank Ledger finish only the missing side on retry.
 */
export class MatchService {
  public constructor(private readonly ledger: RankLedgerGateway) {}

  public async submit(input: MatchSubmission): Promise<MatchReceipt> {
    this.assertValid(input);
    const occurredAt = input.occurredAt;
    this.assertIsoDate(occurredAt);
    const events = this.scoreEventsFor(input, occurredAt);
    const scoreEvents: MatchReceipt['scoreEvents'] = [];

    for (const event of events) {
      try {
        const receipt = await this.ledger.recordScore(event);
        scoreEvents.push({
          eventId: event.eventId,
          participantId: event.participantId,
          points: event.points,
          replayed: receipt.replayed,
        });
      } catch (error) {
        if (scoreEvents.length === 0) {
          throw error;
        }

        const retryable = this.isRetryable(error);

        return {
          matchId: input.matchId,
          acceptedAt: occurredAt,
          status: 'partial',
          scoreEvents,
          retryable,
          message: retryable
            ? 'One score event was accepted. Retry this exact match ID to finish safely.'
            : 'One score event was accepted, but the remaining event was rejected. Correct the input and use a new match ID.',
        };
      }
    }

    return {
      matchId: input.matchId,
      acceptedAt: occurredAt,
      status: scoreEvents.every((event) => event.replayed) ? 'replayed' : 'accepted',
      scoreEvents,
    };
  }

  private scoreEventsFor(input: MatchSubmission, occurredAt: string): ScoreEventRequest[] {
    return [
      this.scoreEvent(input, occurredAt, 'winner', input.winnerId, WINNER_POINTS),
      this.scoreEvent(input, occurredAt, 'loser', input.loserId, LOSER_POINTS),
    ];
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof LedgerRequestError)) {
      return true;
    }

    return error.failureKind === 'network'
      || error.failureKind === 'timeout'
      || error.statusCode === 408
      || error.statusCode === 429
      || error.statusCode >= 500;
  }

  private scoreEvent(
    input: MatchSubmission,
    occurredAt: string,
    outcome: 'winner' | 'loser',
    participantId: string,
    points: number,
  ): ScoreEventRequest {
    return {
      leaderboardId: input.leaderboardId,
      eventId: `${input.matchId}:${outcome}`,
      participantId,
      points,
      occurredAt,
      idempotencyKey: `match:${input.matchId}:${outcome}`,
      metadata: { source: 'make-duel-go-brrr', match_id: input.matchId, outcome },
    };
  }

  private assertValid(input: MatchSubmission): void {
    if (input === null || typeof input !== 'object') {
      throw new InputError('Match input must be a JSON object.');
    }

    const identifiers = [input.matchId, input.leaderboardId, input.winnerId, input.loserId];
    if (identifiers.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
      throw new InputError('match_id, leaderboard_id, winner_id, and loser_id are required.');
    }
    if (input.winnerId === input.loserId) {
      throw new InputError('A duel needs two different participants.');
    }
    if (identifiers.some((value) => value.length > MAX_IDENTIFIER_LENGTH)) {
      throw new InputError(`Match identifiers must be at most ${MAX_IDENTIFIER_LENGTH} characters.`);
    }
    if (!identifiers.every((value) => /^[A-Za-z0-9._:-]+$/.test(value))) {
      throw new InputError('Match identifiers may contain only letters, numbers, dots, underscores, colons, and hyphens.');
    }
    if (typeof input.occurredAt !== 'string') {
      throw new InputError('occurredAt is required.');
    }
  }

  private assertIsoDate(value: string): void {
    const parsed = new Date(value);
    const isCanonicalUtcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && !Number.isNaN(parsed.getTime())
      && parsed.toISOString() === value;

    if (!isCanonicalUtcTimestamp) {
      throw new InputError('occurredAt must be a canonical UTC ISO-8601 timestamp.');
    }
  }
}
