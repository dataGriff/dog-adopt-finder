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

/** Dog pages live under /dog/ on the rescue's own host. Anything else on the listing is never followed. */
export function isDogPageUrl(url: URL): boolean {
  return url.origin === CARDIFF_ORIGIN && url.pathname.startsWith('/dog/');
}

/**
 * Each dog on the listing is a grid item whose title links to the dog's
 * page. Only same-origin /dog/ links are kept, so a sponsor, partner or
 * injected link on the listing can never make the live fetcher leave the
 * rescue's host. Dogs are deduplicated by externalId.
 */
export function discoverDogs(listingHtml: string): DiscoveredDog[] {
  const $ = load(listingHtml);
  const found: DiscoveredDog[] = [];
  const seen = new Set<string>();
  $('.vc_gitem-post-data-source-post_title a').each((_, el) => {
    const href = $(el).attr('href');
    const name = $(el).text().trim();
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, CARDIFF_ORIGIN);
    } catch {
      return;
    }
    if (!isDogPageUrl(url)) return;
    const externalId = externalIdFromUrl(url.toString());
    if (!externalId || seen.has(externalId)) return;
    seen.add(externalId);
    found.push({ externalId, url: url.toString(), name: name || undefined });
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
// nothing defaults to false. Negations win over any positive phrase they
// contain ("not suitable to live with children" must not read as "suitable
// to live with children"), and a hedged statement is unknown, not true.
const NEGATIVE = [
  /\bnot\s+(?:be\s+)?(?:suitable|able|good|happy|fine|ok|okay|allowed)\b/,
  /\b(?:cannot|can't|cant|can\s+not|couldn't|won't|unable\s+to|shouldn't|should\s+not)\b/,
  /\bno\s+(?:children|kids|cats|dogs|other\s+dogs|other\s+pets)\b/,
  /\badults?\s+only\b/,
  /\bonly\s+(?:dog|pet)\b/,
  /\bwithout\s+(?:children|kids|cats|dogs|other\s+dogs)\b/,
  /\b(?:child|cat|dog|pet)[-\s]?free\b/,
  /\bunsuitable\b/,
  /\bnot\s+(?:\w+\s+)?friendly\b/,
  /\b(?:isn't|aren't|doesn't|don't|does\s+not|do\s+not|never)\b/,
];
const HEDGED = [
  /\b(?:may|might|could)\b/,
  /\bpossibl[ey]\b/,
  /\bpotentially\b/,
  /\bto\s+be\s+(?:assessed|tested|confirmed|decided)\b/,
  /\b(?:not\s+yet\s+)?(?:assessed|tested)\b/,
  /\bunknown\b/,
  /\btbc\b/,
  /\btbd\b/,
  /\bdepend(?:s|ing)?\b/,
  /\bask\b/,
];
const POSITIVE = [
  /\b(?:can|able\s+to|suitable\s+to|happy\s+to|ok\s+to|okay\s+to)\s+live\s+with\b/,
  /\b(?:good|fine|happy|great|ok|okay)\s+with\b/,
  /\bsuitable\s+for\b/,
  /\blives?\s+(?:happily\s+)?with\b/,
  /\bgets?\s+on\s+with\b/,
  /\bfriendly\b/,
];

/**
 * Reads one compatibility cell. false when any negation is present, null
 * when the statement is hedged, absent or unrecognised, true only on an
 * unqualified positive.
 */
export function parseCompatibility(text: string): boolean | null {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!lower) return null;
  if (NEGATIVE.some((re) => re.test(lower))) return false;
  if (HEDGED.some((re) => re.test(lower))) return null;
  if (POSITIVE.some((re) => re.test(lower))) return true;
  return null;
}

export function parseKids(text: string): boolean | null {
  return parseCompatibility(text);
}

export function parseCats(text: string): boolean | null {
  return parseCompatibility(text);
}

export function parseDogs(text: string): boolean | null {
  return parseCompatibility(text);
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

  // "<Breed> cross|mix|type": case-sensitive on the breed words so that only
  // capitalised words (breed names) are taken, and filler stripped so a
  // sentence like "a lovely cross who adores people" yields nothing.
  const crossMix = allText.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:cross|mix|type|Cross|Mix|Type)\b/);
  if (crossMix) {
    const text = crossMix[1]!.replace(FILLER, '').trim();
    if (text.length > 2) {
      const result = cleanBreedNames(text);
      if (result.length) return result;
    }
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
