import type { Fetcher } from './types.js';

export const USER_AGENT = 'DogAdoptFinder/1.0 (+https://github.com/dataGriff/dog-adopt-finder)';
export const MIN_GAP_MS = 1000;

export class LiveFetchDisabledError extends Error {
  constructor(adapter: string) {
    super(`live fetching is disabled: set FINDER_LIVE_FETCH=${adapter} to enable it for this adapter`);
    this.name = 'LiveFetchDisabledError';
  }
}

export interface LiveFetcherDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Fetches rescue websites politely: one identifying User-Agent and at
 * least MIN_GAP_MS between requests to the same host. Only
 * `createLiveFetcher` can build one, and only when FINDER_LIVE_FETCH names
 * the adapter asking.
 */
export class LiveFetcher implements Fetcher {
  private readonly lastRequestByHost = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** @internal use createLiveFetcher */
  constructor(deps: LiveFetcherDeps = {}) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async fetchText(url: string): Promise<string> {
    const host = new URL(url).host;
    const last = this.lastRequestByHost.get(host);
    if (last !== undefined) {
      const wait = last + MIN_GAP_MS - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestByHost.set(host, this.now());
    const response = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}`);
    return response.text();
  }
}

/** The one gate on live fetching. */
export function createLiveFetcher(env: { FINDER_LIVE_FETCH?: string }, adapterName: string, deps: LiveFetcherDeps = {}): LiveFetcher {
  if (!env.FINDER_LIVE_FETCH || env.FINDER_LIVE_FETCH.trim() !== adapterName) throw new LiveFetchDisabledError(adapterName);
  return new LiveFetcher(deps);
}
