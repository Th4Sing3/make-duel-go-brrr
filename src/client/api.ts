import type {
  DeliveryEvent,
  LeaderboardEntry,
  LeaderboardSnapshot,
  MatchResult,
  MatchSubmission,
} from './types';

const apiBase = '/api';

export class GatewayRequestError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body.message === 'string'
      ? body.message
      : 'The score did not make it through. Try again with the same match ID.';
    const upstreamStatus = typeof body.upstream_status === 'number' ? body.upstream_status : undefined;
    throw new GatewayRequestError(message, response.status, upstreamStatus);
  }

  return body as T;
}

function normalizeEntry(entry: Record<string, unknown>, index: number): LeaderboardEntry {
  return {
    eventCount: Number(entry.event_count ?? entry.eventCount ?? 0),
    lastEventAt: String(entry.last_event_at ?? entry.lastEventAt ?? ''),
    participantId: String(entry.participant_id ?? entry.participantId ?? 'unknown'),
    rank: Number(entry.rank ?? index + 1),
    score: Number(entry.score ?? 0),
  };
}

export async function getLeaderboard(leaderboardId: string): Promise<LeaderboardSnapshot> {
  const payload = await request<{
    entries?: Record<string, unknown>[];
    leaderboard?: { id?: string };
  }>(`/leaderboards/${encodeURIComponent(leaderboardId)}?limit=10`);

  return {
    entries: (payload.entries ?? []).map(normalizeEntry),
    id: payload.leaderboard?.id ?? leaderboardId,
    refreshedAt: new Date().toISOString(),
  };
}

export function submitMatch(match: MatchSubmission): Promise<MatchResult> {
  return request<MatchResult>('/matches', {
    body: JSON.stringify(match),
    method: 'POST',
  });
}

export function listenForDeliveries(
  onDelivery: (delivery: DeliveryEvent) => void,
  onError: () => void,
): () => void {
  const stream = new EventSource(`${apiBase}/stream`);

  const consume = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as {
        scoreEvent?: {
          data?: { participant_id?: string; score?: number };
          id?: string;
          type?: string;
        };
      } & DeliveryEvent;
      const scoreEvent = payload.scoreEvent;

      onDelivery({
        eventId: scoreEvent?.id ?? payload.eventId,
        participantId: scoreEvent?.data?.participant_id ?? payload.participantId,
        score: scoreEvent?.data?.score ?? payload.score,
        type: scoreEvent?.type ?? payload.type,
      });
    } catch {
      // An SSE reconnect can race with a process restart. Ignore malformed old frames.
    }
  };

  stream.addEventListener('delivery', consume as EventListener);
  stream.addEventListener('score-recorded', consume as EventListener);
  stream.onmessage = consume;
  stream.onerror = onError;

  return () => stream.close();
}
