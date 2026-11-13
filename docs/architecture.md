# Architecture

## Component responsibilities

    ┌─────────────────┐    same-origin HTTP / SSE    ┌────────────────────┐
    │ Vue dashboard   │ ───────────────────────────► │ Node match gateway │
    │ operator view   │ ◄─────────────────────────── │ credential boundary│
    └─────────────────┘                              └─────────┬──────────┘
                                                                │ HTTPS
                                                                ▼
                                                      ┌────────────────────┐
                                                      │ Rank Ledger        │
                                                      │ Laravel / MySQL    │
                                                      └─────────┬──────────┘
                                                                │ signed POST
                                                                ▼
                                                      ┌────────────────────┐
                                                      │ webhook verifier   │
                                                      │ + SSE broker       │
                                                      └────────────────────┘

### Vue dashboard

The browser renders the leaderboard, submits a match request to the local Node
gateway, and subscribes to the gateway's SSE endpoint. It has no Rank Ledger API
key, webhook secret, or direct database connection.

### Node match gateway

The gateway owns the integration concerns:

- validates a compact match payload;
- creates deterministic event_id and Idempotency-Key values;
- calls Rank Ledger over HTTP;
- translates only the necessary leaderboard fields to the UI;
- verifies the raw webhook signature;
- publishes verified receipts to connected SSE clients.

It does not become a second ranking engine. Rank Ledger remains authoritative.

### Rank Ledger

Rank Ledger owns score-event storage, the materialised leaderboard, idempotency,
the transactional outbox, retries, and signed delivery. This project treats it as
an external service even when both run locally in Docker.

## Match submission flow

For match_42, the gateway derives two business event IDs:

    match_42:winner  → +25 points
    match_42:loser   → -10 points

It also derives one idempotency key per outcome. The UI assigns an `occurredAt`
timestamp once per match receipt and preserves it on retry, so submitting the same
match again produces exactly the same calls. Rank Ledger therefore
replays completed calls and refuses changed event data rather than double-counting
the result.

There is no cross-service transaction. If the winner call succeeds and the loser
call fails, the gateway reports that partial state. For a network, timeout, or
retryable upstream failure, retrying the same stable receipt replays the completed
winner event and completes the missing loser event. A conflicting 4xx result is
not retried blindly; the dashboard locks that receipt for manual resolution and
does not create a new receipt automatically. That is more honest than pretending
a distributed transaction exists.

The dashboard stores an unresolved receipt in browser session storage before the
network call. A refresh can therefore recover the exact `matchId` and
`occurredAt` needed for an idempotent retry without introducing a second database.

## Webhook and live update flow

1. Rank Ledger commits an event and writes an outbox record.
2. Its worker POSTs a raw JSON payload to the gateway.
3. The gateway checks the signature header format, timestamp tolerance, and
   HMAC over timestamp + "." + rawBody using a timing-safe comparison.
4. Only a verified payload is exposed to SSE clients.
5. The Vue client refreshes the relevant leaderboard snapshot.

An in-memory SSE broker is intentional for this demonstration. A multi-instance
production deployment would need a shared fan-out or durable event-streaming
mechanism; it is not hidden behind a premature abstraction here.

## Docker integration

The standalone Node/Vue service can run against an existing local Rank Ledger
stack. The Compose overlay joins the Rank Ledger network and configures the seeded
demo client to send webhooks to the Node service. The integration remains
HTTP-only; neither service mounts or shares the other's database volume.

## Failure behavior

| Situation | Gateway behavior |
| --- | --- |
| Invalid match input | Return 422 before contacting Rank Ledger. |
| Rank Ledger rejects an event | Return a clear integration error with no fabricated local success. |
| One of the two events succeeds | Mark a transient failure as retryable with the same stable receipt; lock a 4xx conflict for manual resolution. |
| Webhook HMAC invalid or stale | Return 401; do not publish SSE. |
| Leaderboard read fails | Preserve the last rendered snapshot and surface a retryable error. |

## Deferred seams

These are deliberately not implemented until a real product needs them:

- operator authentication and authorization;
- durable match-command tracking;
- persistent SSE fan-out;
- audit UI beyond Rank Ledger's source-of-truth audit trail;
- configurable scoring policies;
- an event broker or message queue owned by the gateway.
