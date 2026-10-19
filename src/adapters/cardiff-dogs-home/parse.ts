// Parsing rules for cardiffdogshome.co.uk, ported from the previous
// implementation's collect-cardiff-dogs.js. Only factual, non-copyrightable
// fields are read: name, age category, gender, size, compatibility flags,
// breed words and a link to the rescue's own image. Descriptions are never
// read. Anything the page does not state is null.
import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { FoundDog } from '@dogadopt/contracts';
import type { DiscoveredDog } from '../types.js';

export const CARDIFF_ORIGIN = 'https://www.cardiffdogshome.co.uk';

/** Each dog on the listing is a grid item whose title links to the dog's page. */
export function discoverDogs(listingHtml: string): DiscoveredDog[] {
  const $ = load(listingHtml);
  const found: DiscoveredDog[] = [];
  const seen = new Set<string>();
  $('.vc_gitem-post-data-source-post_title a').each((_, el) => {
    const href = $(el).attr('href');
    const name = $(el).text().trim();
    if (!href) return;
    const url = new URL(href, CARDIFF_ORIGIN).toString();
    const externalId = externalIdFromUrl(url);
    if (!externalId || seen.has(url)) return;
    seen.add(url);
    found.push({ externalId, url, name: name || undefined });
  });
  return found;
}

/** The stable id is the last path segment of the dog's page, e.g. /dog/bella-2/ -> bella-2 */
export function externalIdFromUrl(url: string): string | null {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  const slug = segments[segments.length - 1];
  return slug ? slug.toLowerCase() : null;
}

export function parseDogPage(html: string, discovered: DiscoveredDog): FoundDog {
  const $ = load(html);

  const titleText = $('h1').first().text().trim();
  const nameMatch = titleText.match(/Hello,?\s+I['’]m\s+(.+)/i);
  const name = (nameMatch ? nameMatch[1]!.trim() : titleText || discovered.name || discovered.externalId).slice(0, 100);

  const cells: string[] = [];
  $('.divTableCell').each((_, el) => {
    cells.push($(el).text().trim());
  });
  const identityText = cells[0] ?? '';

  return {
    externalId: discovered.externalId,
    name,
    status: 'available',
    age: parseAge(identityText),
    size: parseSize(cells[1] ?? ''),
    gender: parseGender(identityText),
    breeds: parseBreeds($, name),
    goodWithKids: parseKids(cells[2] ?? ''),
    goodWithCats: parseCats(cells[3] ?? ''),
    goodWithDogs: parseDogs(cells[4] ?? ''),
    profileUrl: discovered.url,
    imageUrl: parseImageUrl($),
    birthYear: null,
    birthMonth: null,
    birthDay: null,
    rescueSinceDate: null,
  };
}

export function parseGender(text: string): FoundDog['gender'] {
  const lower = text.toLowerCase();
  if (/\b(girl|female|she)\b/.test(lower)) return 'Female';
  return 'Male';
}

export function parseAge(text: string): FoundDog['age'] {
  const lower = text.toLowerCase();
  if (lower.includes('puppy')) return 'Puppy';
  if (lower.includes('young adult')) return 'Adult'; // Cardiff's "young adult" is an adult
  if (lower.includes('young')) return 'Young';
  if (lower.includes('senior') || lower.includes('older')) return 'Senior';
  return 'Adult';
}

export function parseSize(text: string): FoundDog['size'] {
  const lower = text.toLowerCase();
  if (lower.includes('small')) return 'Small';
  if (lower.includes('large')) return 'Large';
  return 'Medium';
}

// Compatibility: the contract wants null when the site does not say, so
// unlike the old script nothing defaults to false.
export function parseKids(text: string): boolean | null {
  const lower = text.toLowerCase();
  if (lower.includes('adults only') || lower.includes("can't live with children") || lower.includes('cannot live with children')) return false;
  if (lower.includes('suitable to live with children') || lower.includes('suitable to live with older children')) return true;
  return null;
}

export function parseCats(text: string): boolean | null {
  const lower = text.toLowerCase();
  if (lower.includes("can't live with cats") || lower.includes('cannot live with cats')) return false;
  if (lower.includes('able to live with cats')) return true;
  return null;
}

export function parseDogs(text: string): boolean | null {
  const lower = text.toLowerCase();
  if (lower.includes("can't live with") || lower.includes('cannot live with')) return false;
  if (lower.includes('able to live with other dogs')) return true;
  return null;
}

/** A link to the rescue's own image, never downloaded. */
export function parseImageUrl($: CheerioAPI): string | null {
  const og = $('meta[property="og:image"]').attr('content');
  const img = $('.entry-content img').first().attr('src');
  const candidate = og || img;
  if (!candidate) return null;
  try {
    return new URL(candidate, CARDIFF_ORIGIN).toString();
  } catch {
    return null;
  }
}

const FILLER = /\b(small|medium|large|sized|male|female|boy|girl|puppy|young|adult|senior|beautiful|gorgeous|lovely|sweet|friendly|handsome)\b/gi;

/**
 * Breed words as the site writes them. Cardiff puts the breed in prose, so
 * several patterns are tried in order; the result is the raw breed text
 * split on / and , for the API to resolve. Empty when nothing identifiable.
 */
export function parseBreeds($: CheerioAPI, dogName: string): string[] {
  const firstParagraph = $('.entry-content p').first().text().trim();

  // "Name – 3 Year Old <Breed> Girl"
  const dash = firstParagraph.match(/[–—-]\s*\d+\s*(?:Year|Month)s?\s+Old\s+(.+?)(?:\s+(?:Girl|Boy|Male|Female))/i);
  if (dash) {
    const result = cleanBreedNames(dash[1]!);
    if (result.length) return result;
  }

  // "is a [size] <breed> [cross] who/and/that/looking ..."
  const isA = firstParagraph.match(/is\s+(?:a|an)\s+(?:small|medium|large)?\s*(.+?)(?:\s+(?:and|who|that|aged|around|looking|,))/i);
  if (isA) {
    const text = isA[1]!.replace(FILLER, '').trim();
    if (text.length > 2) {
      const result = cleanBreedNames(text);
      if (result.length) return result;
    }
  }

  // "<Name> is a <breed>" anywhere
  const allText = $('.entry-content').text().trim();
  if (dogName) {
    const escaped = dogName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}\\s+is\\s+(?:a|an)\\s+(?:\\d+\\s*(?:year|month)s?\\s*old\\s+)?(.+?)(?:\\.|,|\\s+(?:who|that|and|looking|she|he))`, 'i');
    const match = allText.match(pattern);
    if (match) {
      const text = match[1]!.replace(FILLER, '').trim();
      if (text.length > 2) {
        const result = cleanBreedNames(text);
        if (result.length) return result;
      }
    }
  }

  // "<Breed> cross|mix|type"
  const crossMix = allText.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:cross|mix|type)\b/i);
  if (crossMix) {
    const result = cleanBreedNames(crossMix[1]!);
    if (result.length) return result;
  }

  // "(Lurcher)"
  const bracket = allText.match(/\(([A-Z][a-z]+(?:\s+[A-Za-z]+)*)\)/);
  if (bracket) {
    const inner = bracket[1]!.replace(/\b(cross|mix|type)\b/gi, '').trim();
    if (inner.length > 2) {
      const result = cleanBreedNames(inner);
      if (result.length) return result;
    }
  }

  return [];
}

const GENERIC = new Set(['dog', 'dogs', 'cross', 'crossbreed', 'mix', 'type', 'breed', 'gentle', 'senior', 'bundle']);

export function cleanBreedNames(raw: string): string[] {
  if (/^\s*cross\s*breed\s*$/i.test(raw)) return ['Crossbreed'];
  const cleaned = raw
    .replace(/\btype\b/gi, '')
    .replace(/\bmix\b/gi, '')
    .replace(/\bcross\s*breed\b/gi, '')
    .replace(/\bcross\b/gi, '')
    .replace(/\bbred\b/gi, '')
    .trim();
  return cleaned
    .split(/[/,]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 1 && !GENERIC.has(s.toLowerCase()))
    .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
    .slice(0, 5);
}
