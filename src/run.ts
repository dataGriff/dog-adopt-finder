// Runs one adapter end to end: fetch (fixture or live), parse, validate
// against the contract, wrap as a CloudEvent, send to the queue.
import { adapterFailedEvent, makeEvent, rescueSnapshotSchema, snapshotCapturedEvent, EVENT_SOURCES, EVENT_TYPES } from '@dogadopt/contracts';
import type { AdapterFailedEvent, SnapshotCapturedEvent } from '@dogadopt/contracts';
import type { Adapter, CaptureMode } from './adapters/types.js';
import type { Env } from './env.js';
import { FixtureFetcher } from './fetch/fixture.js';
import { createLiveFetcher, type LiveFetcherDeps } from './fetch/live.js';
import type { Fetcher } from './fetch/types.js';

export interface RunDeps {
  now?: () => Date;
  live?: LiveFetcherDeps;
  /** Overrides fetcher selection entirely (tests). */
  fetcher?: Fetcher;
}

export type RunOutcome =
  | { ok: true; event: SnapshotCapturedEvent; dogCount: number }
  | { ok: false; event: AdapterFailedEvent; error: string };

export async function runAdapter(adapter: Adapter, mode: CaptureMode, env: Env, deps: RunDeps = {}): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  try {
    const fetcher = deps.fetcher ?? (mode === 'live' ? createLiveFetcher(env, adapter.name, deps.live) : new FixtureFetcher(adapter.fixtures));
    const capturedAt = now();
    const listingHtml = await fetcher.fetchText(adapter.listingUrl);
    const discovered = adapter.discover(listingHtml);
    const pages = new Map<string, string>();
    for (const dog of discovered) pages.set(dog.url, await fetcher.fetchText(dog.url));
    const snapshot = rescueSnapshotSchema.parse(adapter.parse(listingHtml, pages, { capturedAt, mode }));
    const event = snapshotCapturedEvent.parse(
      makeEvent(EVENT_TYPES.finderSnapshotCaptured, EVENT_SOURCES.finder, adapter.rescueId, { rescueId: adapter.rescueId, snapshot }, crypto.randomUUID(), now()),
    );
    await env.SNAPSHOTS.send(event, { contentType: 'json' });
    return { ok: true, event, dogCount: snapshot.dogs.length };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const event = adapterFailedEvent.parse(
      makeEvent(EVENT_TYPES.finderAdapterFailed, EVENT_SOURCES.finder, adapter.rescueId, { rescueId: adapter.rescueId, adapter: adapter.name, mode, url: adapter.listingUrl, message }, crypto.randomUUID(), now()),
    );
    await env.SNAPSHOTS.send(event, { contentType: 'json' });
    return { ok: false, event, error: message };
  }
}
