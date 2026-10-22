// Scenarios: A captured snapshot is queued as a CloudEvent / Live fetching is off / adapter failure
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, EVENT_SOURCES, EVENT_TYPES, snapshotCapturedEvent, adapterFailedEvent } from '@dogadopt/contracts';
import { cardiffBrokenListing, cardiffDogsHome, CARDIFF_LISTING_URL } from './adapters/cardiff-dogs-home/index.js';
import type { Env } from './env.js';
import { FixtureFetcher } from './fetch/fixture.js';
import { runAdapter } from './run.js';

function fakeEnv(overrides: Partial<Env> = {}): Env & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    API_BASE_URL: 'http://api.test',
    SNAPSHOTS: { send: async (body: unknown) => { sent.push(body); }, sendBatch: async () => {} } as unknown as Queue,
    sent,
    ...overrides,
  };
}

describe('Scenario: A captured snapshot is queued as a CloudEvent', () => {
  it(`sends a SnapshotCaptured message on ${CHANNELS.finderSnapshotCaptured} with the rescue id as subject`, async () => {
    const env = fakeEnv();
    const outcome = await runAdapter(cardiffDogsHome, 'fixture', env, { now: () => new Date('2026-10-19T08:00:00Z') });
    expect(outcome.ok).toBe(true);
    expect(env.sent).toHaveLength(1);
    const event = snapshotCapturedEvent.parse(env.sent[0]);
    expect(event).toMatchObject({ specversion: '1.0', source: EVENT_SOURCES.finder, type: EVENT_TYPES.finderSnapshotCaptured, subject: cardiffDogsHome.rescueId, datacontenttype: 'application/json' });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.data.rescueId).toBe(cardiffDogsHome.rescueId);
    expect(event.data.snapshot.dogs).toHaveLength(3);
    expect(event.data.snapshot.source.mode).toBe('fixture');
    if (outcome.ok) expect(outcome.dogCount).toBe(3);
  });
  it('two runs get unique envelope ids', async () => {
    const env = fakeEnv();
    await runAdapter(cardiffDogsHome, 'fixture', env);
    await runAdapter(cardiffDogsHome, 'fixture', env);
    const [a, b] = env.sent as { id: string }[];
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('Scenario: Live fetching is off unless explicitly enabled (run)', () => {
  it('makes no HTTP request and reports an AdapterFailed with the disabled message', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const env = fakeEnv();
    const outcome = await runAdapter(cardiffDogsHome, 'live', env);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/live fetching is disabled/);
    const event = adapterFailedEvent.parse(env.sent[0]);
    expect(event.data).toMatchObject({ adapter: 'cardiff-dogs-home', mode: 'live', rescueId: cardiffDogsHome.rescueId });
  });
  it('with FINDER_LIVE_FETCH naming the adapter, fetches via the injected fetch and marks the snapshot live', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => new Response(cardiffDogsHome.fixtures[String(url)] ?? '', { status: cardiffDogsHome.fixtures[String(url)] ? 200 : 404 }));
    const env = fakeEnv({ FINDER_LIVE_FETCH: 'cardiff-dogs-home' });
    const outcome = await runAdapter(cardiffDogsHome, 'live', env, { live: { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} } });
    expect(outcome.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4); // listing + 3 dogs
    expect(String(fetchMock.mock.calls[0]![0])).toBe(CARDIFF_LISTING_URL);
    const event = snapshotCapturedEvent.parse(env.sent[0]);
    expect(event.data.snapshot.source.mode).toBe('live');
  });
});

describe('Scenario: Live fetching can be enabled for one adapter at a time (never leaves the rescue host)', () => {
  it('ignores third-party and non-dog links on a live listing so no other host is fetched', async () => {
    const tampered = cardiffDogsHome.fixtures[CARDIFF_LISTING_URL]!.replace(
      '</body>',
      `<div class="vc_gitem-post-data-source-post_title"><a href="https://evil.example/track">Sponsor</a></div>
       <div class="vc_gitem-post-data-source-post_title"><a href="/news/">News</a></div></body>`,
    );
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const key = String(url);
      const html = key === CARDIFF_LISTING_URL ? tampered : cardiffDogsHome.fixtures[key];
      return new Response(html ?? '', { status: html ? 200 : 404 });
    });
    const env = fakeEnv({ FINDER_LIVE_FETCH: 'cardiff-dogs-home' });
    const outcome = await runAdapter(cardiffDogsHome, 'live', env, { live: { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} } });
    expect(outcome.ok).toBe(true);
    const hosts = new Set(fetchMock.mock.calls.map((c) => new URL(String(c[0])).host));
    expect([...hosts]).toEqual(['www.cardiffdogshome.co.uk']);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('https://evil.example/track');
    expect(fetchMock).toHaveBeenCalledTimes(4); // listing + 3 dogs, nothing else
  });
});

describe('Scenario: An adapter failure is reported, not swallowed', () => {
  it('sends AdapterFailed with rescueId, adapter, mode and message, and no SnapshotCaptured', async () => {
    const env = fakeEnv();
    const fetcher = new FixtureFetcher({ [CARDIFF_LISTING_URL]: cardiffBrokenListing });
    const outcome = await runAdapter(cardiffDogsHome, 'fixture', env, { fetcher });
    expect(outcome.ok).toBe(false);
    expect(env.sent).toHaveLength(1);
    const event = adapterFailedEvent.parse(env.sent[0]);
    expect(event.type).toBe(EVENT_TYPES.finderAdapterFailed);
    expect(event.data).toMatchObject({ rescueId: cardiffDogsHome.rescueId, adapter: 'cardiff-dogs-home', mode: 'fixture', url: CARDIFF_LISTING_URL });
    expect(event.data.message).toMatch(/no dog links/);
  });
});
