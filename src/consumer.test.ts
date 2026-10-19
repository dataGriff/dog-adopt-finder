// Scenarios: The queue consumer posts the snapshot with the envelope id as Idempotency-Key / retries only what can succeed later
import { describe, expect, it, vi } from 'vitest';
import { EVENT_SOURCES, EVENT_TYPES, makeEvent, snapshotCapturedEvent } from '@dogadopt/contracts';
import type { FinderEvent } from '@dogadopt/contracts';
import { cardiffDogsHome, CARDIFF_LISTING_URL } from './adapters/cardiff-dogs-home/index.js';
import { dispositionFor, handleBatch, handleMessage } from './consumer.js';
import type { Env } from './env.js';

const rescueId = cardiffDogsHome.rescueId;
const snapshot = cardiffDogsHome.parse(cardiffDogsHome.fixtures[CARDIFF_LISTING_URL]!, new Map(Object.entries(cardiffDogsHome.fixtures)), { capturedAt: new Date('2026-10-19T08:00:00Z'), mode: 'fixture' });
const message = snapshotCapturedEvent.parse(makeEvent(EVENT_TYPES.finderSnapshotCaptured, EVENT_SOURCES.finder, rescueId, { rescueId, snapshot }));
const env: Env = { API_BASE_URL: 'http://api.test', FINDER_SERVICE_TOKEN: 'svc-token', SNAPSHOTS: {} as Queue };
const result = { snapshotId: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a', rescueId, capturedAt: snapshot.capturedAt, processedAt: snapshot.capturedAt, counts: { received: 3, created: 3, updated: 0, unchanged: 0, withdrawn: 0, rejected: 0 }, rejected: [] };

describe('Scenario: The queue consumer posts the snapshot with the envelope id as Idempotency-Key', () => {
  it('calls ingestRescueSnapshot for data.rescueId with the bearer token and acks on 200', async () => {
    const fetchMock = vi.fn<(input: Request) => Promise<Response>>(async () => new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } }));
    const disposition = await handleMessage(message, env, { fetch: fetchMock as unknown as typeof fetch, log: () => {} });
    expect(disposition).toBe('ack');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`http://api.test/v1/ingest/rescues/${rescueId}/snapshots`);
    expect(request.headers.get('Idempotency-Key')).toBe(message.id);
    expect(request.headers.get('Authorization')).toBe('Bearer svc-token');
    expect(await request.json()).toEqual(snapshot);
  });
});

describe('Scenario Outline: The consumer retries only what can succeed later', () => {
  it.each([[200, 'ack'], [400, 'ack'], [401, 'ack'], [404, 'ack'], [409, 'ack'], [429, 'retry'], [503, 'retry']] as const)('API answers %i -> %s', async (status, outcome) => {
    const fetchMock = vi.fn(async () => new Response(status === 200 ? JSON.stringify(result) : JSON.stringify({ type: 'about:blank', title: 'x', status, errorCode: 'internal_error' }), { status, headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' } }));
    expect(await handleMessage(message, env, { fetch: fetchMock as unknown as typeof fetch, log: () => {} })).toBe(outcome);
    expect(dispositionFor(status)).toBe(outcome);
  });
  it('a network error is retried', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await handleMessage(message, env, { fetch: fetchMock as unknown as typeof fetch, log: () => {} })).toBe('retry');
    expect(dispositionFor(null)).toBe('retry');
  });
  it('a missing service token is retried rather than posted unauthenticated', async () => {
    const fetchMock = vi.fn();
    expect(await handleMessage(message, { ...env, FINDER_SERVICE_TOKEN: undefined }, { fetch: fetchMock as unknown as typeof fetch, log: () => {} })).toBe('retry');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('other messages', () => {
  it('AdapterFailed messages are logged and acked without calling the API', async () => {
    const failed = makeEvent(EVENT_TYPES.finderAdapterFailed, EVENT_SOURCES.finder, rescueId, { rescueId, adapter: 'cardiff-dogs-home', mode: 'fixture' as const, message: 'boom' });
    const fetchMock = vi.fn();
    const log = vi.fn();
    expect(await handleMessage(failed, env, { fetch: fetchMock as unknown as typeof fetch, log })).toBe('ack');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('adapter failed', expect.objectContaining({ adapter: 'cardiff-dogs-home' }));
  });
  it('malformed messages are dropped (acked)', async () => {
    expect(await handleMessage({ nonsense: true }, env, { log: () => {} })).toBe('ack');
  });
  it('handleBatch acks and retries per message', async () => {
    const calls: string[] = [];
    const mk = (body: unknown, name: string) => ({ body, ack: () => calls.push(`ack:${name}`), retry: () => calls.push(`retry:${name}`) });
    const batch = { messages: [mk(message, 'ok'), mk(message, 'down')] } as unknown as MessageBatch<FinderEvent>;
    let n = 0;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(n++ === 0 ? result : {}), { status: n === 1 ? 200 : 503, headers: { 'content-type': 'application/json' } }));
    await handleBatch(batch, env, { fetch: fetchMock as unknown as typeof fetch, log: () => {} });
    expect(calls).toEqual(['ack:ok', 'retry:down']);
  });
});
