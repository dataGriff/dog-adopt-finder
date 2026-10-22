import type { RescueSnapshot } from '@dogadopt/contracts';

export type CaptureMode = 'live' | 'fixture';

/** A dog found on the listing page, before its own page has been read. */
export interface DiscoveredDog {
  /** Stable id within the rescue; by convention the profile URL slug. */
  externalId: string;
  /** Absolute URL of the dog's own page. */
  url: string;
  /** Name as shown on the listing, used as a fallback. */
  name?: string;
}

export interface ParseOptions {
  capturedAt: Date;
  mode: CaptureMode;
}

/**
 * One adapter per rescue website. Adding a rescue means adding one of these
 * and registering it in registry.ts; its fixture test is the only test it
 * needs to ship.
 */
export interface Adapter {
  /** kebab-case, matches SnapshotSource.adapter */
  name: string;
  /** Version of the parsing rules, matches SnapshotSource.adapterVersion */
  adapterVersion: string;
  /** The rescue this adapter captures; must exist in the contracts seed. */
  rescueId: string;
  /** The listing page of dogs available for rehoming. */
  listingUrl: string;
  /** Finds every dog page linked from the listing. */
  discover(listingHtml: string): DiscoveredDog[];
  /** Turns the listing and each dog page into a RescueSnapshot. Must only take factual data. */
  parse(listingHtml: string, pageHtmlByUrl: Map<string, string>, options: ParseOptions): RescueSnapshot;
  /** Saved HTML keyed by absolute URL, served by FixtureFetcher. */
  fixtures: Record<string, string>;
}
