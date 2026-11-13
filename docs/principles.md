# Engineering principles

## DRY — one integration mapping

The code has one place that turns a match outcome into a Rank Ledger score-event
request. It is reused for both winner and loser outcomes instead of duplicating
HTTP shapes, headers, and error handling across routes.

DRY does not mean forcing unrelated UI and server concepts through a generic
event framework. Shared code exists only where the behavior is genuinely the same.

## KISS — a thin gateway

The browser talks to one Node gateway. The gateway talks to Rank Ledger by HTTP.
The dashboard gets live confirmation through SSE. That is enough for a single
operator demo and keeps credentials out of the browser.

There is no custom message bus, GraphQL gateway, local ranking algorithm, or
second database because none improves the core demonstration.

## YAGNI — explicit omissions

Authentication, multi-operator collaboration, bracket management, game rules,
durable command orchestration, and configurable scoring are deferred. Their
absence is documented rather than hidden behind empty abstractions.

## SOLID — useful boundaries, not ceremony

The server separates four concerns:

| Concern | Boundary |
| --- | --- |
| Rank Ledger HTTP calls | ledger client |
| Match-to-event decision | match submission service |
| HMAC verification | webhook verifier |
| Browser fan-out | SSE broker |

This gives each piece one reason to change and permits focused tests. It does not
create interfaces for primitives or abstract every framework call. If a second
ledger implementation, broker, or scoring policy becomes a real requirement, the
existing seams make that change local.

## Product judgment

The most important choice is keeping Rank Ledger authoritative. The dashboard
does not duplicate ranking state or invent its own notion of a successful match.
When an external operation is only partially complete, the UI states that fact
and distinguishes a retryable transport failure from an input conflict that
requires manual resolution. Clear truthfulness beats a superficially smoother
demo.
