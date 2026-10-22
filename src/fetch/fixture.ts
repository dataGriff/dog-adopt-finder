import type { Fetcher } from './types.js';

/** Serves saved HTML keyed by absolute URL. Never touches the network. */
export class FixtureFetcher implements Fetcher {
  constructor(private readonly fixtures: Record<string, string>) {}

  async fetchText(url: string): Promise<string> {
    const html = this.fixtures[url];
    if (html === undefined) throw new Error(`no fixture for ${url}`);
    return html;
  }
}
