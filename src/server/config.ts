import { InputError } from './errors.js';

export type AppConfig = {
  host: string;
  port: number;
  rankLedgerBaseUrl: string;
  rankLedgerApiKey: string;
  rankLedgerRequestTimeoutMs: number;
  rankLedgerWebhookSecret: string;
  rankLedgerWebhookToleranceSeconds: number;
};

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = {
    host: environment.HOST ?? '127.0.0.1',
    port: Number(environment.PORT ?? 3000),
    rankLedgerBaseUrl: environment.RANK_LEDGER_BASE_URL,
    rankLedgerApiKey: environment.RANK_LEDGER_API_KEY,
    rankLedgerRequestTimeoutMs: Number(environment.RANK_LEDGER_REQUEST_TIMEOUT_MS ?? 5_000),
    rankLedgerWebhookSecret: environment.RANK_LEDGER_WEBHOOK_SECRET,
    rankLedgerWebhookToleranceSeconds: Number(environment.RANK_LEDGER_WEBHOOK_TOLERANCE_SECONDS ?? 300),
  };

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new InputError('PORT must be an integer between 1 and 65535.');
  }

  if (config.host.trim() === '') {
    throw new InputError('HOST must not be empty.');
  }

  if (!Number.isInteger(config.rankLedgerWebhookToleranceSeconds) || config.rankLedgerWebhookToleranceSeconds < 1) {
    throw new InputError('RANK_LEDGER_WEBHOOK_TOLERANCE_SECONDS must be a positive integer.');
  }

  if (
    !Number.isInteger(config.rankLedgerRequestTimeoutMs)
    || config.rankLedgerRequestTimeoutMs < 100
    || config.rankLedgerRequestTimeoutMs > 60_000
  ) {
    throw new InputError('RANK_LEDGER_REQUEST_TIMEOUT_MS must be an integer between 100 and 60000.');
  }

  for (const [name, value] of Object.entries({
    RANK_LEDGER_BASE_URL: config.rankLedgerBaseUrl,
    RANK_LEDGER_API_KEY: config.rankLedgerApiKey,
    RANK_LEDGER_WEBHOOK_SECRET: config.rankLedgerWebhookSecret,
  })) {
    if (value === undefined || value.trim() === '') {
      throw new InputError(`${name} is required.`);
    }
  }

  return config as AppConfig;
}
