import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import type { RankLedgerGateway } from '../src/server/contracts.js';
import { LedgerRequestError } from '../src/server/errors.js';
import { createAppHandler } from '../src/server/http-server.js';
import { LiveUpdateBroker } from '../src/server/live-update-broker.js';
import { MatchService } from '../src/server/match-service.js';
import { WebhookVerifier } from '../src/server/webhook-verifier.js';

class NoopLedger implements RankLedgerGateway {
  public async getLeaderboard() {
    return { leaderboard: { id: 'daily-demo' }, entries: [] };
  }

  public async recordScore() {
    return { statusCode: 201, replayed: false, body: {} };
  }
}

class TestResponse {
  public headersSent = false;

  public statusCode = 200;

  public body = '';

  public headers: Record<string, string> = {};

  public writeHead(statusCode: number, headers: Record<string, string> = {}): this {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;

    return this;
  }

  public write(chunk: string): boolean {
    this.body += chunk;

    return true;
  }

  public end(chunk?: string | Buffer): this {
    if (chunk !== undefined) {
      this.body += chunk.toString();
    }

    return this;
  }

  public destroy(): void {
    this.headersSent = true;
  }
}

function request(method: string, url: string): IncomingMessage {
  const readable = Readable.from([]) as unknown as IncomingMessage;
  Object.assign(readable, { headers: {}, method, url });

  return readable;
}

test('serves the health endpoint and dashboard assets from the shared Node handler', async () => {
  const staticDirectory = await mkdtemp(join(tmpdir(), 'make-duel-go-brrr-'));
  const handler = createAppHandler({
    ledger: new NoopLedger(),
    matchService: new MatchService(new NoopLedger()),
    webhookVerifier: new WebhookVerifier({ secret: 'test-secret' }),
    updates: new LiveUpdateBroker(),
  }, { staticDirectory });

  try {
    await writeFile(join(staticDirectory, 'index.html'), '<!doctype html><main id="app">dashboard</main>');
    const health = new TestResponse();
    await handler(request('GET', '/api/health'), health as unknown as ServerResponse);
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { status: 'ready' });

    const dashboard = new TestResponse();
    await handler(request('GET', '/'), dashboard as unknown as ServerResponse);
    assert.equal(dashboard.statusCode, 200);
    assert.match(dashboard.body, /id="app"/);

    const unknownApiRoute = new TestResponse();
    await handler(request('GET', '/api/not-a-route'), unknownApiRoute as unknown as ServerResponse);
    assert.equal(unknownApiRoute.statusCode, 404);
  } finally {
    await rm(staticDirectory, { recursive: true, force: true });
  }
});

test('reports a gateway timeout without pretending Rank Ledger returned a response', async () => {
  const ledger = new NoopLedger();
  ledger.getLeaderboard = async () => {
    throw new LedgerRequestError('Rank Ledger did not respond before the request timeout.', 0, null, 'timeout');
  };
  const handler = createAppHandler({
    ledger,
    matchService: new MatchService(ledger),
    webhookVerifier: new WebhookVerifier({ secret: 'test-secret' }),
    updates: new LiveUpdateBroker(),
  });
  const response = new TestResponse();

  await handler(request('GET', '/api/leaderboards/daily-demo'), response as unknown as ServerResponse);

  assert.equal(response.statusCode, 504);
  assert.deepEqual(JSON.parse(response.body), {
    message: 'Rank Ledger rejected or could not process the score event.',
  });
});
