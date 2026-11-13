export interface LeaderboardEntry {
  eventCount: number;
  lastEventAt: string;
  participantId: string;
  rank: number;
  score: number;
}

export interface LeaderboardSnapshot {
  entries: LeaderboardEntry[];
  id: string;
  refreshedAt: string;
}

export interface MatchSubmission {
  leaderboardId: string;
  loserId: string;
  matchId: string;
  occurredAt: string;
  winnerId: string;
}

export interface MatchResult {
  acceptedAt: string;
  matchId: string;
  scoreEvents: Array<{
    eventId: string;
    participantId: string;
    points: number;
    replayed: boolean;
  }>;
  status: 'accepted' | 'partial' | 'replayed';
  retryable?: boolean;
  message?: string;
}

export interface ActivityItem {
  detail: string;
  id: string;
  kind: 'accepted' | 'delivery' | 'notice' | 'replayed' | 'rejected';
  occurredAt: string;
  title: string;
}

export interface DeliveryEvent {
  eventId: string;
  participantId: string;
  score: number;
  type: string;
}
