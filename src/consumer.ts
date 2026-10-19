// Queue consumer: posts each captured snapshot to the Dogs API with the
// envelope id as the Idempotency-Key, so a redelivery cannot double-apply.
// Ack/retry follows the table in capture-snapshot.feature.
import { createDogsApiClient, snapshotCapturedEvent, adapterFailedEvent, EVENT_TYPES } from '@dogadopt/contracts';
import type { FinderEvent } from '@dogadopt/contracts';
import type { Env } from './env.js';

export type Disposition = 'ack' | 'retry';

/** 2xx and every 4xx except 429 are final; 429, 5xx and network errors can succeed later. */
export function dispositionFor(status: number | null): Disposition {
  if (status === null) return 'retry';
  if (status >= 200 && status < 300) return 'ack';
  if (status === 429) return 'retry';
  if (status >= 400 && status < 500) return 'ack';
  return 'retry';
}

export interface ConsumerDeps {
  fetch?: typeof fetch;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export async function handleMessage(body: unknown, env: Env, deps: ConsumerDeps = {}): Promise<Disposition> {
  const log = deps.log ?? ((m, extra) => console.log(m, extra ?? ''));
  const type = typeof body === 'object' && body !== null ? (body as { type?: string }).type : undefined;

  if (type === EVENT_TYPES.finderAdapterFailed) {
    const failed = adapterFailedEvent.safeParse(body);
    log('adapter failed', failed.success ? failed.data.data : { malformed: true });
    return 'ack';
  }

  const parsed = snapshotCapturedEvent.safeParse(body);
  if (!parsed.success) {
    log('malformed message dropped', { issues: parsed.error.issues.length });
    return 'ack';
  }
  const event = parsed.data;
  if (!env.FINDER_SERVICE_TOKEN) {
    log('FINDER_SERVICE_TOKEN is not set; cannot post snapshot', { id: event.id });
    return 'retry';
  }

  const client = createDogsApiClient({ baseUrl: env.API_BASE_URL, serviceToken: env.FINDER_SERVICE_TOKEN, fetch: deps.fetch });
  try {
    const { response, data, error } = await client.POST('/v1/ingest/rescues/{rescueId}/snapshots', {
      params: { path: { rescueId: event.data.rescueId }, header: { 'Idempotency-Key': event.id } },
      body: event.data.snapshot,
    });
    const disposition = dispositionFor(response.status);
    log(`ingest ${response.status} -> ${disposition}`, { id: event.id, rescueId: event.data.rescueId, counts: data?.counts, problem: error });
    return disposition;
  } catch (err) {
    log('ingest network error -> retry', { id: event.id, error: err instanceof Error ? err.message : String(err) });
    return 'retry';
  }
}

export async function handleBatch(batch: MessageBatch<FinderEvent>, env: Env, deps: ConsumerDeps = {}): Promise<void> {
  for (const message of batch.messages) {
    const disposition = await handleMessage(message.body, env, deps);
    if (disposition === 'ack') message.ack();
    else message.retry();
  }
}
