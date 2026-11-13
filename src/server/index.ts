import { fileURLToPath } from 'node:url';

import { readConfig } from './config.js';
import { createAppServer } from './http-server.js';
import { LiveUpdateBroker } from './live-update-broker.js';
import { MatchService } from './match-service.js';
import { RankLedgerClient } from './rank-ledger-client.js';
import { WebhookVerifier } from './webhook-verifier.js';

const config = readConfig();
const ledger = new RankLedgerClient({
  baseUrl: config.rankLedgerBaseUrl,
  apiKey: config.rankLedgerApiKey,
  requestTimeoutMs: config.rankLedgerRequestTimeoutMs,
});
const server = createAppServer({
  ledger,
  matchService: new MatchService(ledger),
  webhookVerifier: new WebhookVerifier({
    secret: config.rankLedgerWebhookSecret,
    toleranceSeconds: config.rankLedgerWebhookToleranceSeconds,
  }),
  updates: new LiveUpdateBroker(),
}, {
  staticDirectory: fileURLToPath(new URL('../../client/', import.meta.url)),
});

server.listen(config.port, config.host, () => {
  console.info(`Make Duel Go Brrr is listening on http://${config.host}:${config.port}`);
});
