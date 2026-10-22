// Cardiff Dogs Home adapter.
//
// IMPORTANT: the fixtures under ./fixtures are SYNTHETIC. They were written
// by hand to match the selectors the previous implementation parsed
// (.vc_gitem-post-data-source-post_title a on the listing; h1, .divTableCell
// and .entry-content p on a dog page). No page was fetched from the live
// site to build them. Before live fetching is ever enabled for this adapter,
// save real pages, replace the fixtures, and re-verify every parsing rule.
import type { RescueSnapshot } from '@dogadopt/contracts';
import type { Adapter, DiscoveredDog, ParseOptions } from '../types.js';
import { discoverDogs, parseDogPage, CARDIFF_ORIGIN } from './parse.js';
import { fixtures } from './fixtures.generated.js';

export const CARDIFF_LISTING_URL = `${CARDIFF_ORIGIN}/give-a-dog-a-home/dogs-available-for-rehoming/`;

/** Cardiff Dogs Home in @dogadopt/contracts/seed/rescues.json */
export const CARDIFF_RESCUE_ID = 'e430965e-07ae-57e7-a9f6-f080d1728782';

export const cardiffDogsHome: Adapter = {
  name: 'cardiff-dogs-home',
  adapterVersion: '1.0.0',
  rescueId: CARDIFF_RESCUE_ID,
  listingUrl: CARDIFF_LISTING_URL,
  discover: discoverDogs,
  parse(listingHtml: string, pageHtmlByUrl: Map<string, string>, options: ParseOptions): RescueSnapshot {
    const discovered: DiscoveredDog[] = discoverDogs(listingHtml);
    if (discovered.length === 0) throw new Error('listing page has no dog links; the page layout may have changed');
    const dogs = discovered.map((d) => {
      const html = pageHtmlByUrl.get(d.url);
      if (html === undefined) throw new Error(`no page for ${d.url}`);
      return parseDogPage(html, d);
    });
    return {
      capturedAt: options.capturedAt.toISOString(),
      source: { adapter: this.name, url: this.listingUrl, mode: options.mode, adapterVersion: this.adapterVersion },
      complete: true,
      dogs,
    };
  },
  fixtures: {
    [CARDIFF_LISTING_URL]: fixtures['listing.html']!,
    [`${CARDIFF_ORIGIN}/dog/bella-2/`]: fixtures['dog-bella-2.html']!,
    [`${CARDIFF_ORIGIN}/dog/max/`]: fixtures['dog-max.html']!,
    [`${CARDIFF_ORIGIN}/dog/tiny-tim/`]: fixtures['dog-tiny-tim.html']!,
  },
};

/** Listing fixture with no dog links, for the adapter-failure scenario. */
export const cardiffBrokenListing = fixtures['broken.html']!;
