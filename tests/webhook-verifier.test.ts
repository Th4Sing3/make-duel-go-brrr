import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { WebhookVerificationError } from '../src/server/errors.js';
import { WebhookVerifier } from '../src/server/webhook-verifier.js';

const secret = 'receiver-secret';
const rawBody = Buffer.from('{"id":"match_001:winner"}', 'utf8');
const timestamp = 1_794_500_000;

function signatureHeader(body = rawBody, value = timestamp): string {
  const signature = createHmac('sha256', secret)
    .update(`${value}.`, 'utf8')
    .update(body)
    .digest('hex');

  return `t=${value},v1=${signature}`;
}

test('accepts an HMAC generated from the exact raw webhook body', () => {
  const verifier = new WebhookVerifier({ secret, now: () => new Date(timestamp * 1_000) });

  assert.doesNotThrow(() => verifier.assertValid({ 'x-rank-ledger-signature': signatureHeader() }, rawBody));
});

test('rejects a body changed after it was signed', () => {
  const verifier = new WebhookVerifier({ secret, now: () => new Date(timestamp * 1_000) });

  assert.throws(
    () => verifier.assertValid({ 'x-rank-ledger-signature': signatureHeader() }, Buffer.from('{"id":"match_001:loser"}', 'utf8')),
    WebhookVerificationError,
  );
});

test('rejects a stale webhook before comparing the signature', () => {
  const verifier = new WebhookVerifier({
    secret,
    toleranceSeconds: 300,
    now: () => new Date((timestamp + 301) * 1_000),
  });

  assert.throws(
    () => verifier.assertValid({ 'x-rank-ledger-signature': signatureHeader() }, rawBody),
    WebhookVerificationError,
  );
});
