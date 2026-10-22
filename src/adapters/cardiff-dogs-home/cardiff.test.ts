// Feature: Capturing a rescue snapshot (adapter scenarios)
import { describe, expect, it } from 'vitest';
import { rescueSnapshotSchema } from '@dogadopt/contracts';
import { cardiffBrokenListing, cardiffDogsHome, CARDIFF_LISTING_URL } from './index.js';
import { load } from 'cheerio';
import { cleanBreedNames, discoverDogs, externalIdFromUrl, parseAge, parseBreeds, parseCats, parseCompatibility, parseDogs, parseGender, parseKids, parseSize } from './parse.js';

const capturedAt = new Date('2026-10-19T08:00:00Z');

function pagesFromFixtures() {
  const pages = new Map<string, string>();
  for (const [url, html] of Object.entries(cardiffDogsHome.fixtures)) if (url !== CARDIFF_LISTING_URL) pages.set(url, html);
  return pages;
}

describe('Scenario: An adapter parses fixtures into a valid snapshot', () => {
  const listing = cardiffDogsHome.fixtures[CARDIFF_LISTING_URL]!;
  const snapshot = cardiffDogsHome.parse(listing, pagesFromFixtures(), { capturedAt, mode: 'fixture' });

  it('validates against the ingestRescueSnapshot body schema', () => {
    const result = rescueSnapshotSchema.safeParse(snapshot);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
  it('carries source.adapter cardiff-dogs-home, source.mode fixture and complete true', () => {
    expect(snapshot.source).toEqual({ adapter: 'cardiff-dogs-home', url: CARDIFF_LISTING_URL, mode: 'fixture', adapterVersion: '1.0.0' });
    expect(snapshot.complete).toBe(true);
  });
  it('gives every dog a stable externalId derived from its profile URL, once each', () => {
    expect(snapshot.dogs.map((d) => d.externalId)).toEqual(['bella-2', 'max', 'tiny-tim']);
    expect(snapshot.dogs.map((d) => d.profileUrl)).toEqual([
      'https://www.cardiffdogshome.co.uk/dog/bella-2/',
      'https://www.cardiffdogshome.co.uk/dog/max/',
      'https://www.cardiffdogshome.co.uk/dog/tiny-tim/',
    ]);
  });
  it('never carries a description', () => {
    for (const dog of snapshot.dogs) expect(dog).not.toHaveProperty('description');
    expect(JSON.stringify(snapshot)).not.toContain('bundle of energy');
  });
});

describe('Scenario: Only factual data is captured', () => {
  const listing = cardiffDogsHome.fixtures[CARDIFF_LISTING_URL]!;
  const [bella, max, tim] = cardiffDogsHome.parse(listing, pagesFromFixtures(), { capturedAt, mode: 'fixture' }).dogs;

  it('reads name, age, size, gender and breeds as written on the site', () => {
    expect(bella).toMatchObject({ name: 'Bella', age: 'Adult', size: 'Medium', gender: 'Female', breeds: ['Staffie'], status: 'available' });
    expect(max).toMatchObject({ name: 'Max', age: 'Puppy', size: 'Large', gender: 'Male', breeds: ['Labrador', 'Collie'] });
    expect(tim).toMatchObject({ name: 'Tiny Tim', age: 'Senior', size: 'Small', gender: 'Male', breeds: [] });
  });
  it('leaves compatibility flags null where the site does not say or only hedges', () => {
    expect(bella).toMatchObject({ goodWithKids: true, goodWithCats: false, goodWithDogs: null }); // "may be able" is not a yes
    expect(max).toMatchObject({ goodWithKids: true, goodWithCats: null, goodWithDogs: false });
    expect(tim).toMatchObject({ goodWithKids: false, goodWithCats: null, goodWithDogs: null });
  });
  it('keeps imageUrl as a link to the rescue site and nothing else', () => {
    expect(bella!.imageUrl).toBe('https://www.cardiffdogshome.co.uk/wp-content/uploads/bella.jpg');
    expect(max!.imageUrl).toBe('https://www.cardiffdogshome.co.uk/wp-content/uploads/max.jpg');
    expect(tim!.imageUrl).toBeNull();
  });
  it('never fills birth dates or rescue since date it cannot read', () => {
    expect(bella).toMatchObject({ birthYear: null, birthMonth: null, birthDay: null, rescueSinceDate: null });
  });
});

describe('Scenario: An adapter failure is reported, not swallowed (parse step)', () => {
  it('throws on a listing page with no dog links', () => {
    expect(() => cardiffDogsHome.parse(cardiffBrokenListing, new Map(), { capturedAt, mode: 'fixture' })).toThrow(/no dog links/);
  });
  it('throws when a discovered dog page is missing', () => {
    const listing = cardiffDogsHome.fixtures[CARDIFF_LISTING_URL]!;
    expect(() => cardiffDogsHome.parse(listing, new Map(), { capturedAt, mode: 'fixture' })).toThrow(/no page for/);
  });
});

describe('parsing rules ported from the previous collector', () => {
  it.each([
    ["I'm a young adult girl", 'Adult', 'Female'],
    ["I'm a male puppy", 'Puppy', 'Male'],
    ["I'm a young boy", 'Young', 'Male'],
    ["I'm an older boy", 'Senior', 'Male'],
    ['', 'Adult', 'Male'],
  ])('%s -> age %s, gender %s', (text, age, gender) => {
    expect(parseAge(text)).toBe(age);
    expect(parseGender(text)).toBe(gender);
  });
  it.each([['Small sized', 'Small'], ['Large sized', 'Large'], ['Medium sized', 'Medium'], ['', 'Medium']])('size %s -> %s', (t, s) => expect(parseSize(t)).toBe(s));
  it('compatibility is tri-state', () => {
    expect(parseKids('Adults only')).toBe(false);
    expect(parseKids("I'm suitable to live with children")).toBe(true);
    expect(parseKids('not tested')).toBeNull();
    expect(parseCats("I can't live with cats")).toBe(false);
    expect(parseCats('')).toBeNull();
    expect(parseDogs("I can't live with other dogs")).toBe(false);
    expect(parseDogs('I am able to live with other dogs')).toBe(true);
    expect(parseDogs('unknown')).toBeNull();
  });
});

describe('Scenario: Only factual data is captured (negations win, hedges are unknown)', () => {
  it.each<[string, boolean | null]>([
    ["I'm not suitable to live with children", false],
    ["I'm not able to live with cats", false],
    ['I am not able to live with other dogs', false],
    ['I may be able to live with cats', null],
    ['I can live with children over 10', true],
    ['adults only', false],
    ['', null],
    ['I cannot live with cats', false],
    ['No other dogs please', false],
    ['I would like to be the only dog', false],
    ['Not dog friendly', false],
    ["We haven't tested me with cats yet", null],
    ['To be assessed', null],
    ['I could possibly live with a calm dog', null],
    ['I am good with other dogs', true],
    ["I'm fine with cats", true],
    ['Lorem ipsum', null],
  ])('%j -> %s', (text, expected) => {
    expect(parseCompatibility(text)).toBe(expected);
    expect(parseKids(text)).toBe(expected);
    expect(parseCats(text)).toBe(expected);
    expect(parseDogs(text)).toBe(expected);
  });
});

describe('Scenario: Live fetching can be enabled for one adapter at a time (only the rescue host is ever followed)', () => {
  const listing = `<html><body>
    <div class="vc_gitem-post-data-source-post_title"><a href="https://www.cardiffdogshome.co.uk/dog/bella-2/">Bella</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="https://evil.example/track">Sponsor</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="//evil.example/dog/trick/">Trick</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="/news/open-day/">Open day</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="https://www.cardiffdogshome.co.uk/about/">About</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="/dog/Bella-2/">Bella again</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="/dog/max/">Max</a></div>
    <div class="vc_gitem-post-data-source-post_title"><a href="javascript:alert(1)">Nope</a></div>
  </body></html>`;
  it('discovers only same-origin /dog/ links, once per externalId', () => {
    expect(discoverDogs(listing)).toEqual([
      { externalId: 'bella-2', url: 'https://www.cardiffdogshome.co.uk/dog/bella-2/', name: 'Bella' },
      { externalId: 'max', url: 'https://www.cardiffdogshome.co.uk/dog/max/', name: 'Max' },
    ]);
  });
});

describe('breed heuristics only take capitalised breed words', () => {
  const page = (text: string) => load(`<html><body><h1>Hello, I'm Rufus</h1><div class="entry-content"><p>${text}</p></div></body></html>`);
  it('prose with a lower-case adjective before "cross" yields no breed', () => {
    expect(parseBreeds(page('Rufus is a lovely cross who adores people.'), 'Rufus')).toEqual([]);
    expect(parseBreeds(page('Rufus adores people. He is a gentle cross and loves walks.'), 'Rufus')).toEqual([]);
  });
  it('a capitalised breed before "cross" is still found', () => {
    expect(parseBreeds(page('Rufus came to us last week. Staffie cross, loves everyone.'), 'Rufus')).toEqual(['Staffie']);
    expect(parseBreeds(page('A Border Collie type looking for a job.'), 'Rufus')).toEqual(['Border Collie']);
  });
  it('externalId is the lower-cased last path segment', () => {
    expect(externalIdFromUrl('https://www.cardiffdogshome.co.uk/dog/Bella-2/')).toBe('bella-2');
    expect(externalIdFromUrl('https://www.cardiffdogshome.co.uk/')).toBeNull();
  });
  it('cleanBreedNames splits multi-breed text and drops filler', () => {
    expect(cleanBreedNames('Staffie Cross')).toEqual(['Staffie']);
    expect(cleanBreedNames('labrador / collie')).toEqual(['Labrador', 'Collie']);
    expect(cleanBreedNames('cross breed')).toEqual(['Crossbreed']);
    expect(cleanBreedNames('dog')).toEqual([]);
  });
});
