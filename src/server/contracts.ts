export type JsonObject = Record<string, unknown>;

export type LeaderboardEntry = {
  rank: number;
  participant_id: string;
  score: number;
  event_count: number;
  last_event_at: string;
};

export type LeaderboardSnapshot = {
  leaderboard: { id: string };
  entries: LeaderboardEntry[];
};

export type ScoreEventRequest = {
  leaderboardId: string;
  eventId: string;
  participantId: string;
  points: number;
  occurredAt: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
};

export type ScoreEventReceipt = {
  statusCode: number;
  replayed: boolean;
  body: JsonObject;
};

export interface RankLedgerGateway {
  getLeaderboard(leaderboardId: string, limit: number): Promise<LeaderboardSnapshot>;
  recordScore(event: ScoreEventRequest): Promise<ScoreEventReceipt>;
}

export type MatchSubmission = {
  matchId: string;
  leaderboardId: string;
  winnerId: string;
  loserId: string;
  occurredAt: string;
};

export type MatchReceipt = {
  matchId: string;
  acceptedAt: string;
  status: 'accepted' | 'partial' | 'replayed';
  scoreEvents: Array<{
    eventId: string;
    participantId: string;
    points: number;
    replayed: boolean;
  }>;
  retryable?: boolean;
  message?: string;
};

export type RankLedgerWebhook = {
  id: string;
  type: 'leaderboard.score_recorded';
  occurred_at: string;
  data: {
    leaderboard_id: string;
    participant_id: string;
    points: number;
    score: number;
  };
};

export type LiveUpdate = {
  event: 'score-recorded';
  deliveryId: string;
  scoreEvent: RankLedgerWebhook;
};
