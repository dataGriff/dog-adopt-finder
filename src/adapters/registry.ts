import type { Adapter } from './types.js';
import { cardiffDogsHome } from './cardiff-dogs-home/index.js';

/** Every adapter, by name. Each maps to exactly one rescue id. */
export const adapters: ReadonlyMap<string, Adapter> = new Map([cardiffDogsHome].map((a) => [a.name, a]));

export function getAdapter(name: string): Adapter | undefined {
  return adapters.get(name);
}

export function listAdapters() {
  return [...adapters.values()].map(({ name, adapterVersion, rescueId, listingUrl, fixtures }) => ({
    name,
    adapterVersion,
    rescueId,
    listingUrl,
    fixturePages: Object.keys(fixtures).length,
  }));
}
