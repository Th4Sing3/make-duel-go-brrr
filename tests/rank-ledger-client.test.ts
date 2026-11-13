import assert from 'node:assert/strict';
import test from 'node:test';

import { LedgerRequestError } from '../src/server/errors.js';
import { RankLedgerClient } from '../src/server/rank-ledger-client.js';

test('turns a network failure into a deliberate upstream error', async () => {
  const client = new RankLedgerClient({
    baseUrl: 'https://ledger.example.test',
    apiKey: 'test-key',
    fetchImplementation: async () => {
      throw new Error('socket failed');
    },
  });

  await assert.rejects(
    client.getLeaderboard('daily-demo', 10),
    (error: unknown) => error instanceof LedgerRequestError
      && error.statusCode === 0
      && error.message === 'Could not reach Rank Ledger.',
  );
});

test('turns an elapsed request timeout into a distinct upstream timeout', async () => {
  const client = new RankLedgerClient({
    baseUrl: 'https://ledger.example.test',
    apiKey: 'test-key',
    requestTimeoutMs: 1,
    fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const watchdog = setTimeout(() => {
        reject(new Error('Expected the request timeout to abort the fetch.'));
      }, 200);
      const onAbort = () => {
        clearTimeout(watchdog);
        reject(init?.signal?.reason);
      };

      if (init?.signal?.aborted) {
        onAbort();
      } else {
        init?.signal?.addEventListener('abort', onAbort, { once: true });
      }
    }),
  });

  await assert.rejects(
    client.getLeaderboard('daily-demo', 10),
    (error: unknown) => error instanceof LedgerRequestError
      && error.statusCode === 0
      && error.failureKind === 'timeout'
      && error.message === 'Rank Ledger did not respond before the request timeout.',
  );
});
