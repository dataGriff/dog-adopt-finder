// Scenario: Adding a rescue means adding one adapter
import { describe, expect, it } from 'vitest';
import rescues from '@dogadopt/contracts/seed/rescues.json' with { type: 'json' };
import { adapters, listAdapters } from './registry.js';

describe('Scenario: Adding a rescue means adding one adapter', () => {
  it('every adapter implements the same interface', () => {
    for (const adapter of adapters.values()) {
      expect(adapter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(typeof adapter.discover).toBe('function');
      expect(typeof adapter.parse).toBe('function');
      expect(adapter.fixtures[adapter.listingUrl]).toBeTypeOf('string');
    }
  });
  it('the registry maps each adapter name to exactly one rescue id that exists in the contracts seed', () => {
    const ids = new Set((rescues as { id: string }[]).map((r) => r.id));
    const seenRescues = new Set<string>();
    for (const [name, adapter] of adapters) {
      expect(adapter.name).toBe(name);
      expect(ids.has(adapter.rescueId), `${name} rescueId not in seed`).toBe(true);
      expect(seenRescues.has(adapter.rescueId)).toBe(false);
      seenRescues.add(adapter.rescueId);
    }
    expect(listAdapters()[0]).toMatchObject({ name: 'cardiff-dogs-home', rescueId: 'e430965e-07ae-57e7-a9f6-f080d1728782' });
  });
});
