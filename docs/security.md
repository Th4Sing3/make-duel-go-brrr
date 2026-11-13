# Security notes

## Secrets are server-side only

RANK_LEDGER_API_KEY and RANK_LEDGER_WEBHOOK_SECRET are server credentials. They
belong in a local .env, deployment secret store, or CI secret mechanism; never in
Vue source, browser responses, logs, screenshots, examples, or Git.

The repository includes placeholders only. .env remains ignored.

## Webhook verification

The webhook endpoint treats every incoming request as untrusted until it has:

1. retained the raw body;
2. parsed the versioned t=...,v1=... signature header;
3. rejected timestamps older than the configured tolerance;
4. calculated the expected HMAC over the exact raw bytes;
5. compared signatures with timingSafeEqual only after checking equal length;
6. parsed the JSON only after authentication succeeds.

Webhook payloads are not logged. Logs should include a delivery ID, event ID,
status, and safe error class—not the body or secrets.

## Browser boundary

The browser calls only same-origin gateway endpoints. The gateway has a narrow
route allowlist; it does not implement an open proxy to RANK_LEDGER_BASE_URL.
This prevents a dashboard request from turning a server-held API key into a
general-purpose credential relay.

In a real deployment, add operator authentication, CSRF posture appropriate to
the chosen session model, a restrictive Content Security Policy, HTTPS, and
explicit CORS origins. They are intentionally outside the local demo scope.
The Node process and Vite bind to localhost by default. The supplied Compose
files bind host port 3000 to `127.0.0.1` while allowing the container itself to
accept traffic from the Docker network. This service must not be exposed to a
shared network until an operator access model exists.

## Input and retry safety

The gateway validates stable match IDs, participant identifiers, and the
operator-assigned receipt timestamp before making network calls. Score values are
fixed by the demo policy rather than supplied by the browser. Deriving event IDs
from match_id makes retries safe only when the timestamp is preserved too, so a
correction must be modeled as a new command—not a changed retry.

An unresolved receipt is stored only in browser session storage before the
network call. It contains operational identifiers and a timestamp, never a Rank
Ledger credential or webhook secret, and is cleared once the receipt is resolved
or explicitly replaced.

## Dependencies and containers

- Lock JavaScript dependencies and run CI from the lockfile.
- Build a minimal runtime image as the unprivileged Node user; do not copy local
  .env files into it.
- Run containers without source-mounted secrets in non-development environments.
- Review dependency updates and use an image scanner in a real delivery pipeline.

## Boundaries this demo does not claim to solve

This repository is not a production security program. It does not provide
identity management, secret rotation, rate limiting, DDoS protection, audit
retention policy, monitoring, backups, or an operational incident process.
Those omissions are documented so a small example is not mistaken for a complete
production system.
