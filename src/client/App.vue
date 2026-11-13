<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { GatewayRequestError, getLeaderboard, listenForDeliveries, submitMatch } from './api';
import type { ActivityItem, LeaderboardSnapshot, MatchSubmission } from './types';

const leaderboardId = 'daily-demo';
const pendingReceiptStorageKey = 'make-duel-go-brrr.pending-receipt';

type ReceiptResolution = 'manual' | 'retry';

type PendingReceipt = {
  resolution: ReceiptResolution;
  submission: MatchSubmission;
};

function createMatchReceipt(): MatchSubmission {
  return {
    leaderboardId,
    loserId: 'player_bob',
    matchId: `duel_${crypto.randomUUID().slice(0, 8)}`,
    occurredAt: new Date().toISOString(),
    winnerId: 'player_ada',
  };
}

function isMatchReceipt(value: unknown): value is MatchSubmission {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const receipt = value as Record<string, unknown>;
  return receipt.leaderboardId === leaderboardId
    && typeof receipt.loserId === 'string'
    && typeof receipt.matchId === 'string'
    && typeof receipt.occurredAt === 'string'
    && typeof receipt.winnerId === 'string';
}

function isPendingReceipt(value: unknown): value is PendingReceipt {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const receipt = value as Record<string, unknown>;
  return (receipt.resolution === 'manual' || receipt.resolution === 'retry')
    && isMatchReceipt(receipt.submission);
}

function readPendingReceipt(): PendingReceipt | null {
  try {
    const raw = sessionStorage.getItem(pendingReceiptStorageKey);
    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (isPendingReceipt(parsed)) {
      return parsed;
    }

    // Receipts stored by an earlier dashboard version did not record whether
    // they were safe to retry, so restore them with the conservative lock.
    return isMatchReceipt(parsed) ? { resolution: 'manual', submission: parsed } : null;
  } catch {
    return null;
  }
}

function savePendingReceipt(receipt: PendingReceipt): void {
  try {
    sessionStorage.setItem(pendingReceiptStorageKey, JSON.stringify(receipt));
  } catch {
    // Private browsing or restrictive browser settings can disable session storage.
  }
}

function clearPendingReceipt(): void {
  try {
    sessionStorage.removeItem(pendingReceiptStorageKey);
  } catch {
    // The in-memory form still retains the receipt for this browser session.
  }
}

function releasePendingReceipt(): void {
  pendingReceipt.value = null;
  clearPendingReceipt();
}

function isPermanentRejection(error: unknown): boolean {
  if (!(error instanceof GatewayRequestError)) {
    return false;
  }

  const upstreamStatus = error.upstreamStatus;
  return error.statusCode === 422
    || (upstreamStatus !== undefined
      && upstreamStatus >= 400
      && upstreamStatus < 500
      && upstreamStatus !== 408
      && upstreamStatus !== 429);
}

const restoredReceipt = readPendingReceipt();
const snapshot = ref<LeaderboardSnapshot>({ entries: [], id: leaderboardId, refreshedAt: '' });
const isLoading = ref(true);
const isSubmitting = ref(false);
const isLive = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const pendingReceipt = ref<PendingReceipt | null>(restoredReceipt);
const form = ref<MatchSubmission>(restoredReceipt?.submission ?? createMatchReceipt());
const activity = ref<ActivityItem[]>([
  {
    detail: 'Listening for signed Rank Ledger deliveries.',
    id: 'waiting-for-sse',
    kind: 'notice',
    occurredAt: new Date().toISOString(),
    title: 'Live receipt channel armed',
  },
]);

const topScore = computed(() => snapshot.value.entries[0]?.score ?? 0);
const currentLeader = computed(() => snapshot.value.entries[0]?.participantId ?? 'Waiting for first score');
const totalEvents = computed(() => snapshot.value.entries.reduce((total, entry) => total + entry.eventCount, 0));
const isRetryLocked = computed(() => pendingReceipt.value !== null);
const requiresManualResolution = computed(() => pendingReceipt.value?.resolution === 'manual');
const deliveredEventIds = new Set<string>();
const deliveredEventOrder: string[] = [];

function formatScore(score: number): string {
  return new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' }).format(score);
}

function formatTime(timestamp: string): string {
  if (!timestamp) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function addActivity(item: ActivityItem): void {
  activity.value = [item, ...activity.value].slice(0, 7);
}

function rememberDelivery(eventId: string): boolean {
  if (deliveredEventIds.has(eventId)) {
    return false;
  }

  deliveredEventIds.add(eventId);
  deliveredEventOrder.push(eventId);
  if (deliveredEventOrder.length > 100) {
    const oldest = deliveredEventOrder.shift();
    if (oldest !== undefined) {
      deliveredEventIds.delete(oldest);
    }
  }

  return true;
}

async function loadLeaderboard(silent = false): Promise<void> {
  if (!silent) {
    isLoading.value = true;
  }

  try {
    snapshot.value = await getLeaderboard(leaderboardId);
    errorMessage.value = '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not load the ladder.';
  } finally {
    isLoading.value = false;
  }
}

function newMatchId(): void {
  if (isRetryLocked.value) {
    return;
  }

  form.value = {
    ...form.value,
    matchId: `duel_${crypto.randomUUID().slice(0, 8)}`,
    occurredAt: new Date().toISOString(),
  };
}

async function recordMatch(): Promise<void> {
  errorMessage.value = '';
  successMessage.value = '';

  if (requiresManualResolution.value) {
    errorMessage.value = 'This partial receipt requires manual resolution. Do not resend it or create a new match ID.';
    return;
  }

  if (form.value.winnerId.trim() === form.value.loserId.trim()) {
    errorMessage.value = 'A player cannot duel themselves.';
    return;
  }

  isSubmitting.value = true;
  const submission = pendingReceipt.value?.submission ?? {
    ...form.value,
    loserId: form.value.loserId.trim(),
    matchId: form.value.matchId.trim(),
    winnerId: form.value.winnerId.trim(),
  };
  form.value = submission;
  // Persist before the network call: a lost response can still represent a committed event.
  const retryReceipt: PendingReceipt = { resolution: 'retry', submission };
  savePendingReceipt(retryReceipt);
  pendingReceipt.value = retryReceipt;

  try {
    const result = await submitMatch(submission);
    if (result.status === 'partial') {
      const retryable = result.retryable === true;
      successMessage.value = result.message ?? (retryable
        ? 'One score was recorded. Retry this exact match ID to finish safely.'
        : 'One score was recorded, but the remaining event was rejected. Manual resolution is required.');
      addActivity({
        detail: retryable
          ? `Match ${form.value.matchId} is only partially recorded. Keep the same receipt ID when retrying.`
          : `Match ${form.value.matchId} is partially recorded and locked for manual resolution.`,
        id: `partial-${form.value.matchId}-${Date.now()}`,
        kind: 'notice',
        occurredAt: new Date().toISOString(),
        title: retryable ? 'Partial score. Retry required.' : 'Partial score. Manual resolution required.',
      });
      if (!retryable) {
        const manualReceipt: PendingReceipt = { resolution: 'manual', submission };
        savePendingReceipt(manualReceipt);
        pendingReceipt.value = manualReceipt;
      }
    } else {
      const replayed = result.status === 'replayed';
      successMessage.value = replayed
        ? 'Already recorded. No double count.'
        : 'Score locked. Ladder moved.';
      addActivity({
        detail: replayed
          ? `Match ${form.value.matchId} replayed safely.`
          : `${form.value.winnerId} +25; ${form.value.loserId} -10.`,
        id: `match-${form.value.matchId}-${Date.now()}`,
        kind: replayed ? 'replayed' : 'accepted',
        occurredAt: new Date().toISOString(),
        title: replayed ? 'Already recorded' : 'Score locked',
      });
      releasePendingReceipt();
      newMatchId();
    }
    await loadLeaderboard(true);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'The result could not be recorded.';
    if (isPermanentRejection(error)) {
      releasePendingReceipt();
    }
    addActivity({
      detail: errorMessage.value,
      id: `failed-${Date.now()}`,
      kind: 'rejected',
      occurredAt: new Date().toISOString(),
      title: 'Score not sent',
    });
  } finally {
    isSubmitting.value = false;
  }
}

let stopListening: (() => void) | undefined;

onMounted(async () => {
  if (pendingReceipt.value !== null) {
    const { resolution, submission } = pendingReceipt.value;
    addActivity({
      detail: resolution === 'manual'
        ? `Recovered receipt ${submission.matchId}. It remains locked for manual resolution.`
        : `Recovered receipt ${submission.matchId}. Retry it unchanged to resolve its previous delivery.`,
      id: `recovered-${submission.matchId}`,
      kind: 'notice',
      occurredAt: new Date().toISOString(),
      title: resolution === 'manual' ? 'Manual resolution required' : 'Unfinished receipt restored',
    });
  }
  await loadLeaderboard();
  stopListening = listenForDeliveries(
    (delivery) => {
      isLive.value = true;
      if (!rememberDelivery(delivery.eventId)) {
        return;
      }
      addActivity({
        detail: `${delivery.participantId} is now on ${formatScore(delivery.score)} points.`,
        id: `delivery-${delivery.eventId}`,
        kind: 'delivery',
        occurredAt: new Date().toISOString(),
        title: 'Receipt received. Signature checks out.',
      });
      void loadLeaderboard(true);
    },
    () => {
      isLive.value = false;
    },
  );
});

onBeforeUnmount(() => stopListening?.());
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <a class="wordmark" href="#top" aria-label="Make Duel Go Brrr home">
        <span class="wordmark-mark" aria-hidden="true">///</span>
        <span>MAKE DUEL<br><strong>GO BRRR</strong></span>
      </a>

      <div class="topbar-meta">
        <span class="connection" :class="{ 'connection--live': isLive }">
          <i aria-hidden="true" />
          {{ isLive ? 'live receipts' : 'receipt channel' }}
        </span>
        <button class="ghost-button" type="button" :disabled="isLoading" @click="loadLeaderboard()">
          {{ isLoading ? 'Syncing…' : 'Sync ladder' }}
        </button>
      </div>
    </header>

    <section id="top" class="hero">
      <p class="eyebrow">MATCH OPERATIONS / RANK LEDGER CLIENT</p>
      <h1>Results in.<br><em>Ranks move.</em></h1>
      <p class="hero-copy">
        A deliberately small surface for recording head-to-head results,
        watching the ladder, and proving retries do not invent wins.
      </p>
    </section>

    <section class="stat-grid" aria-label="Ladder status">
      <article class="stat-card stat-card--hot">
        <span>Current leader</span>
        <strong>{{ currentLeader }}</strong>
        <small>rank #1 / {{ formatScore(topScore) }} points</small>
      </article>
      <article class="stat-card">
        <span>Scored events</span>
        <strong>{{ totalEvents }}</strong>
        <small>from the live projection</small>
      </article>
      <article class="stat-card">
        <span>Ledger</span>
        <strong>{{ snapshot.id }}</strong>
        <small>source of truth</small>
      </article>
    </section>

    <section class="workspace-grid">
      <article class="panel match-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">OPERATOR INPUT</p>
            <h2>Send result</h2>
          </div>
          <span class="panel-index">01</span>
        </div>

        <form class="match-form" @submit.prevent="recordMatch">
          <label class="field field--wide">
            <span>Match receipt ID</span>
            <div class="input-with-action">
              <input v-model="form.matchId" :readonly="isRetryLocked" autocomplete="off" required maxlength="64">
              <button type="button" class="inline-button" :disabled="isRetryLocked" @click="newMatchId()">New</button>
            </div>
            <small v-if="requiresManualResolution">Manual resolution is required. Do not resend this receipt or create a new ID.</small>
            <small v-else-if="isRetryLocked">This unresolved receipt is locked to preserve a safe retry.</small>
            <small v-else>Reuse this exact ID to retry safely.</small>
          </label>

          <div class="duel-fields">
            <label class="field winner-field">
              <span>Winner</span>
              <input v-model="form.winnerId" :readonly="isRetryLocked" autocomplete="off" required maxlength="80" placeholder="player_ada">
              <small class="score-rule">+25 points</small>
            </label>

            <div class="versus" aria-hidden="true"><span>VS</span></div>

            <label class="field loser-field">
              <span>Loser</span>
              <input v-model="form.loserId" :readonly="isRetryLocked" autocomplete="off" required maxlength="80" placeholder="player_bob">
              <small class="score-rule">−10 points</small>
            </label>
          </div>

          <p v-if="errorMessage" class="form-message form-message--error" role="alert">{{ errorMessage }}</p>
          <p v-else-if="successMessage" class="form-message form-message--success" aria-live="polite">{{ successMessage }}</p>

          <button class="send-button" type="submit" :disabled="isSubmitting || requiresManualResolution">
            <span>{{ isSubmitting ? 'Sending to ledger…' : requiresManualResolution ? 'Manual resolution required' : 'Send result' }}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      </article>

      <article class="panel ladder-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">LIVE PROJECTION</p>
            <h2>The ladder</h2>
          </div>
          <span class="panel-index">02</span>
        </div>

        <div v-if="isLoading" class="empty-state">Pulling the ledger…</div>
        <ol v-else-if="snapshot.entries.length" class="ladder-list">
          <li v-for="entry in snapshot.entries" :key="entry.participantId" class="ladder-entry">
            <span class="rank">{{ String(entry.rank).padStart(2, '0') }}</span>
            <div class="participant">
              <strong>{{ entry.participantId }}</strong>
              <small>{{ entry.eventCount }} event{{ entry.eventCount === 1 ? '' : 's' }} · {{ formatTime(entry.lastEventAt) }}</small>
            </div>
            <strong class="score">{{ formatScore(entry.score) }}</strong>
          </li>
        </ol>
        <div v-else class="empty-state">
          No score yet. Send the first result.
        </div>
        <p class="panel-footnote">
          <span class="pulse" aria-hidden="true" /> Updated {{ snapshot.refreshedAt ? formatTime(snapshot.refreshedAt) : 'when available' }}
        </p>
      </article>
    </section>

    <section class="panel activity-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">DELIVERY FEED</p>
          <h2>Receipts, not vibes</h2>
        </div>
        <span class="panel-index">03</span>
      </div>

      <ol class="activity-list">
        <li v-for="item in activity" :key="item.id" class="activity-item">
          <span class="activity-pip" :class="`activity-pip--${item.kind}`" aria-hidden="true" />
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.detail }}</p>
          </div>
          <time :datetime="item.occurredAt">{{ formatTime(item.occurredAt) }}</time>
        </li>
      </ol>
    </section>

    <footer>
      <span>Independent technical demo. Not affiliated with or endorsed by Duel.</span>
      <span>Rank Ledger is the source of truth.</span>
    </footer>
  </main>
</template>
