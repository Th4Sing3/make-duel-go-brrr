# Contributing

This repository is intentionally small. Keep changes tied to a demonstrated
operator need and preserve the boundary between this Node/Vue application and
Rank Ledger.

Before opening a pull request, run:

```bash
npm ci
npm run check
npm test
npm run build
```

Do not commit `.env`, API keys, webhook secrets, local Rank Ledger credentials,
or generated `dist/` output. Add a test whenever a change alters the match
submission, retry, webhook, or leaderboard behaviour.
