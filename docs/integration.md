# Rank Ledger integration contract

## Configuration

The gateway reads these server-side values from its environment:

| Variable | Purpose | Browser exposure |
| --- | --- | --- |
| HOST | Bind address; defaults to 127.0.0.1 outside the container | Not applicable |
| RANK_LEDGER_BASE_URL | Rank Ledger API origin | Never exposed |
| RANK_LEDGER_API_KEY | Trusted client credential | Never exposed |
| RANK_LEDGER_REQUEST_TIMEOUT_MS | Per-request upstream timeout (100–60000 ms) | Never exposed |
| RANK_LEDGER_WEBHOOK_SECRET | HMAC verification secret | Never exposed |
| RANK_LEDGER_WEBHOOK_TOLERANCE_SECONDS | Maximum acceptable webhook age | Safe behavior only; not needed by UI |

The local Rank Ledger demo uses the leaderboard external ID daily-demo.

## Read a leaderboard

    GET /api/v1/leaderboards/{externalId}?limit=1..100
    X-API-Key: <server-held API key>

The gateway exposes a deliberately smaller same-origin response to the browser.
It does not proxy arbitrary Rank Ledger paths or headers.

## Submit a score event

    POST /api/v1/leaderboards/daily-demo/events
    X-API-Key: <server-held API key>
    Idempotency-Key: match:<match-id>:<outcome>
    Content-Type: application/json

Example winner event:

    {
      "event_id": "match_123:winner",
      "participant_id": "player_ada",
      "points": 25,
      "occurred_at": "2026-11-13T00:20:00Z",
      "metadata": {
        "source": "make-duel-go-brrr",
        "match_id": "match_123",
        "outcome": "winner"
      }
    }

The loser event uses the same shape with event_id match_123:loser and points -10.
Rank Ledger accepts signed, non-zero integer points within its documented bounds.

## Submit a match command to the gateway

The browser sends the gateway one compact command:

```json
{
  "matchId": "match_123",
  "leaderboardId": "daily-demo",
  "winnerId": "player_ada",
  "loserId": "player_turing",
  "occurredAt": "2026-11-13T00:20:00.000Z"
}
```

`occurredAt` is intentionally assigned once when the operator creates the match
receipt. It is then kept unchanged when that receipt is retried. Rank Ledger
includes the event timestamp in its idempotency fingerprint, so generating a new
timestamp for the same `matchId` would correctly be treated as conflicting input.
The dashboard retains an unresolved receipt in session storage before sending it,
so a browser refresh does not discard the timestamp required for a safe retry.
It locks an ambiguous receipt until it is resolved; operators cannot silently
replace a network-uncertain submission with a new idempotency key. A known local
validation failure or upstream 4xx rejection before any score event is accepted
unlocks the form for correction.

### Retry rule

The `matchId` and `occurredAt` must be stable. A retry sends the same event IDs,
idempotency keys, points, participants, timestamp, and metadata. Changing one of
those fields while reusing a match ID is a conflict, not a correction. A
correction after a partial result is a manual operation outside the dashboard,
not an automatic retry path.

When only one of the two score events is accepted, the gateway labels the result
`partial`. Network failures, timeouts, 408s, 429s, and 5xx responses are
retryable with the same stable receipt. A 4xx validation or conflict response
after one score event was accepted requires manual resolution. The dashboard
keeps the receipt locked, blocks resubmission, and never creates a new match ID.
Any correction or compensating score must be handled explicitly outside the
dashboard after checking the ledger.

## Receive a webhook

Rank Ledger posts to:

    POST /api/webhooks/rank-ledger
    Content-Type: application/json
    X-Rank-Ledger-Event: <business event id>
    X-Rank-Ledger-Delivery: <delivery UUID>
    X-Rank-Ledger-Signature: t=<unix timestamp>,v1=<hmac sha256>

The gateway computes:

    HMAC-SHA256(timestamp + "." + rawRequestBody, RANK_LEDGER_WEBHOOK_SECRET)

It rejects malformed headers, stale timestamps, mismatched signatures, and
payloads that cannot be parsed as JSON. It must retain the exact raw request body
until verification completes: reserializing JSON before the comparison changes
the signed bytes.

On success, it returns 204 No Content and publishes a sanitized receipt to SSE
clients. Rank Ledger delivery is at-least-once, so UI effects are keyed by the
stable business event ID rather than the delivery attempt ID.

## Compose overlay contract

The integration overlay sets the seeded Rank Ledger client to:

    DEMO_WEBHOOK_URL=http://make-duel-go-brrr:3000/api/webhooks/rank-ledger
    DEMO_WEBHOOK_SECRET=<same value used by the Node gateway>

It runs on the same Docker network but does not share a database, source folder,
or credentials beyond the intentionally configured API key and webhook secret.
