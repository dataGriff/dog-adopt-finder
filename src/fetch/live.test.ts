// Scenarios: Live fetching is off unless explicitly enabled / can be enabled for one adapter at a time
import { describe, expect, it, vi } from 'vitest';
import { createLiveFetcher, LiveFetchDisabledError, MIN_GAP_MS, USER_AGENT } from './live.js';

describe('Scenario: Live fetching is off unless explicitly enabled', () => {
  it.each([{}, { FINDER_LIVE_FETCH: '' }, { FINDER_LIVE_FETCH: 'some-other-rescue' }])('refuses to construct with env %o', (env) => {
    expect(() => createLiveFetcher(env, 'cardiff-dogs-home')).toThrow(LiveFetchDisabledError);
    expect(() => createLiveFetcher(env, 'cardiff-dogs-home')).toThrow(/live fetching is disabled/);
  });
});

describe('Scenario: Live fetching can be enabled for one adapter at a time', () => {
  it('fetches with the finder User-Agent and keeps requests to one host at least 1 second apart', async () => {
    let clock = 1_000_000;
    const sleeps: number[] = [];
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => new Response(`<html>${url}</html>`, { status: 200 }));
    const fetcher = createLiveFetcher({ FINDER_LIVE_FETCH: 'cardiff-dogs-home' }, 'cardiff-dogs-home', {
      fetch: fetchMock as unknown as typeof fetch,
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    });

    await fetcher.fetchText('https://www.cardiffdogshome.co.uk/a/');
    clock += 200;
    await fetcher.fetchText('https://www.cardiffdogshome.co.uk/b/');
    await fetcher.fetchText('https://other.example/c/');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const init = fetchMock.mock.calls[0]![1];
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    expect(sleeps).toEqual([MIN_GAP_MS - 200]);
  });
  it('throws on a non-2xx response', async () => {
    const fetcher = createLiveFetcher({ FINDER_LIVE_FETCH: 'x' }, 'x', { fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch });
    await expect(fetcher.fetchText('https://example.org/')).rejects.toThrow(/503/);
  });
});
