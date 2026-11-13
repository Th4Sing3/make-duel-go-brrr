# Delivery analysis

## Objective

Build a compact operator-facing product slice that proves a leaderboard service
can be used safely by a human, rather than merely called from a curl command.

The project demonstrates pragmatic senior-backend judgment across Node.js, Vue,
HTTP integration, webhook verification, Docker, and a real PHP/Laravel backend.
It should feel like a response to a minimal brief: deliver a useful workflow
quickly, keep the boundaries explicit, and leave evidence behind.

## Product question

> How does an operator record a one-on-one result, see the ladder change, and
> trust that a retry did not manufacture an additional win?

Rank Ledger already answers the persistence and delivery half of that question.
Make Duel Go Brrr answers the operating experience: submit a result, receive a
verified receipt, and make the ranking change visible.

## Included scope

- Vue dashboard with a ranked leaderboard, match form, delivery activity, and
  clear retry feedback;
- Node.js gateway that owns Rank Ledger credentials and exposes a small
  same-origin API to the browser;
- deterministic mapping from a match ID to winner and loser score events;
- HTTP integration with Rank Ledger's authenticated leaderboard and event APIs;
- HMAC verification of raw webhook bodies before notifying the UI;
- SSE for a simple live receipt stream;
- Docker support, automated tests, CI, and an integration overlay;
- documentation that explains the design choices and known boundaries.

## Explicit exclusions

- real-money activity, wallets, currencies, payments, wagering, odds, or rewards;
- player registration, account recovery, roles, moderation, or social features;
- tournament brackets, matchmaking, game rules, chat, or a real game client;
- direct reads or writes to the Rank Ledger database;
- speculative event brokers, CQRS infrastructure, Kubernetes, or microservices;
- a durable local match store solely to duplicate Rank Ledger's audit trail.

These exclusions prevent a demonstration project from turning into a fictional
platform. They also keep the integration boundary easy to inspect.

## Success criteria

1. A valid match creates deterministic winner and loser score submissions.
2. Retrying a match with the same match ID cannot change either score twice.
3. The browser never receives Rank Ledger secrets.
4. A webhook is accepted only after timestamp and HMAC verification against the
   raw body.
5. The UI shows a verified receipt and refreshed ranking without direct database
   access.
6. A partially completed two-event submission is explicit, preserves its receipt
   across a refresh, and recommends a retry only when the failure is transient.
7. The code and docs distinguish the demo's local constraints from production
   requirements.

## Risks and decisions

| Risk | Decision |
| --- | --- |
| A double click or network retry inflates a score | Derive stable event IDs and idempotency keys from match_id and outcome; preserve the receipt timestamp on retry. |
| Browser code leaks a service credential | Keep Rank Ledger calls in the Node gateway only. |
| A forged webhook changes the visible result | Verify timestamp, HMAC, and comparison timing before broadcasting. |
| One event succeeds and the second fails | Return a partial state; retry the same stable receipt only for transient failures, otherwise lock the receipt for manual resolution. |
| The project grows into a fake game platform | Maintain the exclusions above and one narrow operating workflow. |
| A local in-memory SSE broker is mistaken for production infrastructure | Document it as a single-instance demo seam, not a scalable event system. |

## Acceptance evidence

| Deliverable | Evidence |
| --- | --- |
| Product UI | src/client/ |
| Node gateway and integration boundary | src/server/ |
| Unit and HTTP tests | tests/ |
| Runtime and Compose overlay | Dockerfile, compose.yaml, compose.integration.yml |
| CI | .github/workflows/ci.yml |
| Security and design reasoning | docs/ |

## Non-affiliation

The project name deliberately references wording from a job brief, but it is an
independent technical exercise. It must not use company code, internal data,
trademarks, protected visuals, or claims of endorsement.
