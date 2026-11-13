import assert from 'node:assert/strict';
import test from 'node:test';

import { readConfig } from '../src/server/config.js';
import { InputError } from '../src/server/errors.js';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PORT: '3000',
    RANK_LEDGER_API_KEY: 'test-api-key',
    RANK_LEDGER_BASE_URL: 'http://ledger.test',
    RANK_LEDGER_WEBHOOK_SECRET: 'test-webhook-secret',
    ...overrides,
  };
}

test('uses a bounded default timeout for Rank Ledger requests', () => {
  const config = readConfig(environment());

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.rankLedgerRequestTimeoutMs, 5_000);
});

test('rejects an unsafe Rank Ledger request timeout', () => {
  assert.throws(
    () => readConfig(environment({ RANK_LEDGER_REQUEST_TIMEOUT_MS: '99' })),
    InputError,
  );
});
