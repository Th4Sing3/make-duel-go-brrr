# Make Duel Go Brrr

> Results in. Ladder moves. No fake wins.

Make Duel Go Brrr is a deliberately small match-operations console that consumes
[Rank Ledger](https://github.com/Th4Sing3/rank-ledger). An operator records a head-to-head result; the
Node.js backend turns it into idempotent score events, and the Vue dashboard shows
the ranking and delivery activity as Rank Ledger confirms the change.

It is an independent technical exercise prepared for a backend-engineering
application. It is not affiliated with, endorsed by, or built from the systems,
code, data, trademarks, or operational practices of Duel.

## Why this exists

Rank Ledger demonstrates the difficult part of leaderboard ingestion: duplicate
requests, durable score history, transactional delivery, and safe retries. This
project provides the thin product layer around it:

- record a duel result instead of asking an operator to craft raw score events;
- show the current ladder in a focused operator interface;
- consume a signed webhook as a receipt that the score change committed;
- make a retry visible and prove that it cannot create an extra win.

The scope is intentionally narrow. This is not a tournament platform, a game
client, a payment system, a betting product, or a social network.

## Demo flow

1. Enter a match ID, winner, and loser.
2. The Node backend submits two deterministic score events to Rank Ledger:
   +25 for the winner and -10 for the loser.
3. Rank Ledger commits each event once and publishes a signed webhook after the
   transaction.
4. The dashboard receives the verified event over Server-Sent Events (SSE),
   refreshes the ladder, and shows a delivery receipt.
5. Submit the same match ID again. Rank Ledger replays the accepted events; the
   score does not move twice.

## Architecture

    Vue dashboard
         │  same-origin HTTP + SSE
         ▼
    Node match gateway
         │  X-API-Key + Idempotency-Key
         ▼
    Rank Ledger (Laravel / MySQL / Redis)
         │  HMAC-signed webhook
         ▼
    Node webhook verifier ───► SSE clients

The browser never sees the Rank Ledger API key or webhook secret. The Node
gateway is the only component that talks to Rank Ledger directly. See
[the architecture notes](docs/architecture.md) and
[the integration contract](docs/integration.md) for the exact boundaries.

## Local development

### Prerequisites

- Node.js 22 or newer;
- a running Rank Ledger instance;
- its demo API key and matching webhook secret;
- Docker Desktop only when using the optional integration Compose overlay.

### Start the dashboard locally

    Copy-Item .env.example .env   # PowerShell
    # or: cp .env.example .env
    npm install
    npm run dev

Set the values in .env from a local Rank Ledger environment. Do not commit that
file. The gateway and Vite development server bind to localhost by default; the
dashboard is available at the URL printed by Vite.

### Run the checks

    npm test
    npm run check
    npm run build

### Run with Rank Ledger via Docker

From the Rank Ledger repository root, use the supplied integration overlay:

    docker compose \
      -f compose.yaml \
      -f make-duel-go-brrr/compose.integration.yml \
      up --build

The overlay sets the demo webhook target to the Node gateway. It is meant for a
fresh local demo database; it does not alter a production Rank Ledger deployment.
Both Compose files bind the dashboard only to `127.0.0.1`; do not expose this
unauthenticated operator demo to a shared network.

## API surface

The browser only uses the local gateway:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /api/health | Report that the configured gateway process is ready. |
| GET | /api/leaderboards/:id | Read a sanitized leaderboard snapshot. |
| POST | /api/matches | Submit one deterministic winner/loser result. |
| POST | /api/webhooks/rank-ledger | Receive and verify a Rank Ledger delivery. |
| GET | /api/stream | Stream verified webhook receipts over SSE. |

The detailed request, replay, and signature rules live in
[docs/integration.md](docs/integration.md).

## Intentional limits

- No account system: this is a local operator demo, not an access-control model.
- No direct database access: Rank Ledger remains the source of truth.
- No own match database: stable match IDs and Rank Ledger idempotency are enough
  for the demonstration.
- No WebSocket broker or message bus: SSE is enough for one operator dashboard.
- No automatic compensation when one of two score events fails: the UI identifies
  whether a transient failure can safely retry the same receipt or whether the
  operator needs to correct the input and start a new receipt.

Those choices are deliberate applications of KISS and YAGNI, not missing
features. See [docs/principles.md](docs/principles.md).

## Documentation

- [Delivery analysis](docs/analysis.md)
- [Architecture](docs/architecture.md)
- [Rank Ledger integration contract](docs/integration.md)
- [Security notes](docs/security.md)
- [Engineering principles](docs/principles.md)
- [Work log](docs/worklog.md)

## License

MIT. The project does not grant rights to the Duel name, logo, or any third-party
brand.
