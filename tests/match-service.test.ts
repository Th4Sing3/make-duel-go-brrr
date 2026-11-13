import assert from 'node:assert/strict';
import test from 'node:test';

import type { RankLedgerGateway, ScoreEventRequest } from '../src/server/contracts.js';
import { InputError, LedgerRequestError } from '../src/server/errors.js';
import { MatchService } from '../src/server/match-service.js';

class RecordingLedger implements RankLedgerGateway {
  public readonly events: ScoreEventRequest[] = [];

  public async getLeaderboard(): Promise<never> {
    throw new Error('Not used by this test.');
  }

  public async recordScore(event: ScoreEventRequest) {
    this.events.push(event);

    return { statusCode: 201, replayed: false, body: {} };
  }
}

test('turns a duel into stable winner and loser ledger events', async () => {
  const ledger = new RecordingLedger();
  const service = new MatchService(ledger);

  const receipt = await service.submit({
    matchId: 'match_001',
    leaderboardId: 'daily-demo',
    winnerId: 'player_ada',
    loserId: 'player_turing',
    occurredAt: '2026-11-13T05:30:00.000Z',
  });

  assert.deepEqual(ledger.events, [
    {
      leaderboardId: 'daily-demo',
      eventId: 'match_001:winner',
      participantId: 'player_ada',
      points: 25,
      occurredAt: '2026-11-13T05:30:00.000Z',
      idempotencyKey: 'match:match_001:winner',
      metadata: { source: 'make-duel-go-brrr', match_id: 'match_001', outcome: 'winner' },
    },
    {
      leaderboardId: 'daily-demo',
      eventId: 'match_001:loser',
      participantId: 'player_turing',
      points: -10,
      occurredAt: '2026-11-13T05:30:00.000Z',
      idempotencyKey: 'match:match_001:loser',
      metadata: { source: 'make-duel-go-brrr', match_id: 'match_001', outcome: 'loser' },
    },
  ]);
  assert.equal(receipt.scoreEvents.length, 2);
});

test('reuses the exact score-event data when an operator retries a receipt', async () => {
  const ledger = new RecordingLedger();
  const service = new MatchService(ledger);
  const submission = {
    matchId: 'match_retry_001',
    leaderboardId: 'daily-demo',
    winnerId: 'player_ada',
    loserId: 'player_turing',
    occurredAt: '2026-11-13T05:30:00.000Z',
  };

  await service.submit(submission);
  await service.submit(submission);

  assert.deepEqual(ledger.events.slice(0, 2), ledger.events.slice(2));
});

test('rejects a duel with the same participant on both sides', async () => {
  const service = new MatchService(new RecordingLedger());

  await assert.rejects(
    service.submit({
      matchId: 'match_001',
      leaderboardId: 'daily-demo',
      winnerId: 'player_ada',
      loserId: 'player_ada',
      occurredAt: '2026-11-13T05:30:00.000Z',
    }),
    InputError,
  );
});

test('requires a canonical UTC timestamp for an idempotent receipt', async () => {
  const service = new MatchService(new RecordingLedger());

  await assert.rejects(
    service.submit({
      matchId: 'match_001',
      leaderboardId: 'daily-demo',
      winnerId: 'player_ada',
      loserId: 'player_turing',
      occurredAt: '1',
    }),
    InputError,
  );
});

test('reports a partial result honestly when the second score cannot be recorded', async () => {
  const ledger = new RecordingLedger();
  ledger.recordScore = async (event: ScoreEventRequest) => {
    ledger.events.push(event);
    if (event.eventId.endsWith(':loser')) {
      throw new LedgerRequestError('The upstream service is unavailable.', 503, {});
    }

    return { statusCode: 201, replayed: false, body: {} };
  };
  const service = new MatchService(ledger);

  const receipt = await service.submit({
    matchId: 'match_002',
    leaderboardId: 'daily-demo',
    winnerId: 'player_ada',
    loserId: 'player_turing',
    occurredAt: '2026-11-13T05:30:00.000Z',
  });

  assert.equal(receipt.status, 'partial');
  assert.equal(receipt.retryable, true);
  assert.equal(receipt.scoreEvents.length, 1);
  assert.match(receipt.message ?? '', /Retry this exact match ID/);
});

test('does not recommend a retry when the remaining score conflicts', async () => {
  const ledger = new RecordingLedger();
  ledger.recordScore = async (event: ScoreEventRequest) => {
    ledger.events.push(event);
    if (event.eventId.endsWith(':loser')) {
      throw new LedgerRequestError('The event data conflicts.', 409, {});
    }

    return { statusCode: 201, replayed: false, body: {} };
  };
  const receipt = await new MatchService(ledger).submit({
    matchId: 'match_003',
    leaderboardId: 'daily-demo',
    winnerId: 'player_ada',
    loserId: 'player_turing',
    occurredAt: '2026-11-13T05:30:00.000Z',
  });

  assert.equal(receipt.status, 'partial');
  assert.equal(receipt.retryable, false);
  assert.match(receipt.message ?? '', /use a new match ID/);
});
