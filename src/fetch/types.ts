export interface Fetcher {
  /** Returns the body of the page at `url` as text; throws on a non-2xx response or a missing fixture. */
  fetchText(url: string): Promise<string>;
}
