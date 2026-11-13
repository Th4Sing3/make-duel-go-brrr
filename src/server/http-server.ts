import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import type { LiveUpdate, MatchSubmission, RankLedgerGateway, RankLedgerWebhook } from './contracts.js';
import { InputError, LedgerRequestError, WebhookVerificationError } from './errors.js';
import { LiveUpdateBroker } from './live-update-broker.js';
import { MatchService } from './match-service.js';
import { WebhookVerifier } from './webhook-verifier.js';

const MAX_BODY_BYTES = 64 * 1024;

export type AppServerDependencies = {
  ledger: RankLedgerGateway;
  matchService: MatchService;
  webhookVerifier: WebhookVerifier;
  updates: LiveUpdateBroker;
};

export type AppServerOptions = {
  staticDirectory?: string;
};

export type AppRequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createAppHandler(
  dependencies: AppServerDependencies,
  options: AppServerOptions = {},
): AppRequestHandler {
  return async (request, response) => {
    try {
      await route(request, response, dependencies, options);
    } catch (error) {
      sendError(response, error);
    }
  };
}

export function createAppServer(dependencies: AppServerDependencies, options: AppServerOptions = {}): Server {
  return createServer(createAppHandler(dependencies, options));
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: AppServerDependencies,
  options: AppServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ready' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/stream') {
    dependencies.updates.subscribe(response);
    return;
  }

  const leaderboardMatch = url.pathname.match(/^\/api\/leaderboards\/([^/]+)$/);
  if (request.method === 'GET' && leaderboardMatch !== null) {
    const snapshot = await dependencies.ledger.getLeaderboard(
      decodeURIComponent(leaderboardMatch[1]),
      parseLimit(url.searchParams.get('limit')),
    );
    sendJson(response, 200, snapshot);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/matches') {
    const receipt = await dependencies.matchService.submit(await readJson<MatchSubmission>(request));
    sendJson(response, 202, receipt);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/webhooks/rank-ledger') {
    const rawBody = await readBody(request);
    dependencies.webhookVerifier.assertValid(request.headers, rawBody);
    const scoreEvent = parseWebhook(rawBody);
    dependencies.updates.publish({
      event: 'score-recorded',
      deliveryId: firstHeader(request, 'x-rank-ledger-delivery'),
      scoreEvent,
    } satisfies LiveUpdate);
    response.writeHead(204).end();
    return;
  }

  if (
    request.method === 'GET'
    && !url.pathname.startsWith('/api/')
    && options.staticDirectory !== undefined
    && await serveStatic(response, url.pathname, options.staticDirectory)
  ) {
    return;
  }

  sendJson(response, 404, { message: 'Route not found.' });
}

function parseLimit(value: string | null): number {
  if (value === null) {
    return 10;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InputError('limit must be an integer between 1 and 100.');
  }

  return parsed;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const rawBody = await readBody(request);

  try {
    return JSON.parse(rawBody.toString('utf8')) as T;
  } catch {
    throw new InputError('Request body must be valid JSON.');
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new InputError('Request body exceeds 64 KB.');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function parseWebhook(rawBody: Buffer): RankLedgerWebhook {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new InputError('Webhook body must be valid JSON.');
  }

  if (!isScoreRecordedWebhook(payload)) {
    throw new InputError('Webhook payload does not match leaderboard.score_recorded.');
  }

  return payload;
}

function isScoreRecordedWebhook(value: unknown): value is RankLedgerWebhook {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const data = payload.data;
  return typeof payload.id === 'string'
    && payload.type === 'leaderboard.score_recorded'
    && typeof payload.occurred_at === 'string'
    && data !== null
    && typeof data === 'object'
    && typeof (data as Record<string, unknown>).leaderboard_id === 'string'
    && typeof (data as Record<string, unknown>).participant_id === 'string'
    && typeof (data as Record<string, unknown>).points === 'number'
    && typeof (data as Record<string, unknown>).score === 'number';
}

function firstHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value[0] !== undefined) {
    return value[0];
  }

  throw new InputError(`${name} header is required.`);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function serveStatic(response: ServerResponse, pathname: string, staticDirectory: string): Promise<boolean> {
  const root = resolve(staticDirectory);
  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = resolve(root, requestedPath);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    sendJson(response, 400, { message: 'Invalid asset path.' });
    return true;
  }

  try {
    const details = await stat(filePath);
    if (!details.isFile()) {
      return false;
    }

    const contents = await readFile(filePath);
    response.writeHead(200, {
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Type': contentType(filePath),
    });
    response.end(contents);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (extname(requestedPath) === '') {
    const indexPath = resolve(root, 'index.html');
    try {
      const index = await readFile(indexPath);
      response.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' });
      response.end(index);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return false;
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function sendError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  if (error instanceof InputError || error instanceof WebhookVerificationError) {
    sendJson(response, error.statusCode, { message: error.message });
    return;
  }
  if (error instanceof LedgerRequestError) {
    const body: { message: string; upstream_status?: number } = {
      message: 'Rank Ledger rejected or could not process the score event.',
    };
    if (error.failureKind === 'upstream' && error.statusCode > 0) {
      body.upstream_status = error.statusCode;
    }
    sendJson(response, error.failureKind === 'timeout' ? 504 : 502, body);
    return;
  }

  sendJson(response, 500, { message: 'Unexpected server error.' });
}
