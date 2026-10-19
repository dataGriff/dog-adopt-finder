// Feature: Capturing a rescue snapshot (adapter scenarios)
import { describe, expect, it } from 'vitest';
import { rescueSnapshotSchema } from '@dogadopt/contracts';
import { cardiffBrokenListing, cardiffDogsHome, CARDIFF_LISTING_URL } from './index.js';
import { cleanBreedNames, externalIdFromUrl, parseAge, parseCats, parseDogs, parseGender, parseKids, parseSize } from './parse.js';

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
  it('leaves compatibility flags null where the site does not say', () => {
    expect(bella).toMatchObject({ goodWithKids: true, goodWithCats: false, goodWithDogs: true });
    expect(max).toMatchObject({ goodWithKids: true, goodWithCats: true, goodWithDogs: false });
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
    expect(parseCats('I may be able to live with cats')).toBe(true);
    expect(parseCats('')).toBeNull();
    expect(parseDogs("I can't live with other dogs")).toBe(false);
    expect(parseDogs('I am able to live with other dogs')).toBe(true);
    expect(parseDogs('unknown')).toBeNull();
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
