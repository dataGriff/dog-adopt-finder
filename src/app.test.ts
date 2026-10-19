// Scenario: The schedule ships disabled (a capture can be started by hand through the run endpoint)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Env } from './env.js';

function env(): Env & { sent: unknown[] } {
  const sent: unknown[] = [];
  return { API_BASE_URL: 'http://api.test', FINDER_RUN_TOKEN: 'run-token', SNAPSHOTS: { send: async (b: unknown) => { sent.push(b); } } as unknown as Queue, sent };
}

describe('Scenario: The schedule ships disabled', () => {
  it('the worker configuration has no enabled cron trigger', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const stripped = config.replace(/\/\/.*$/gm, '');
    expect(stripped).toMatch(/"triggers"\s*:\s*\{\s*"crons"\s*:\s*\[\s*\]\s*\}/);
    expect(stripped).not.toMatch(/FINDER_LIVE_FETCH/);
  });
  it('a capture can be started by hand through the run endpoint', async () => {
    const e = env();
    const res = await createApp().request('/run/cardiff-dogs-home?mode=fixture', { method: 'POST', headers: { Authorization: 'Bearer run-token' } }, e);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; dogCount: number; eventId: string };
    expect(body.ok).toBe(true);
    expect(body.dogCount).toBe(3);
    expect(e.sent).toHaveLength(1);
  });
  it('the run endpoint needs the run token', async () => {
    const e = env();
    expect((await createApp().request('/run/cardiff-dogs-home', { method: 'POST' }, e)).status).toBe(401);
    expect((await createApp().request('/run/cardiff-dogs-home', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }, e)).status).toBe(401);
    expect((await createApp().request('/run/cardiff-dogs-home', { method: 'POST', headers: { Authorization: 'Bearer run-token' } }, { ...e, FINDER_RUN_TOKEN: undefined })).status).toBe(401);
    expect(e.sent).toHaveLength(0);
  });
  it('unknown adapters and modes are rejected', async () => {
    const e = env();
    expect((await createApp().request('/run/nope', { method: 'POST', headers: { Authorization: 'Bearer run-token' } }, e)).status).toBe(404);
    expect((await createApp().request('/run/cardiff-dogs-home?mode=scrape', { method: 'POST', headers: { Authorization: 'Bearer run-token' } }, e)).status).toBe(400);
  });
  it('live mode through the endpoint fails closed and reports it', async () => {
    const e = env();
    const res = await createApp().request('/run/cardiff-dogs-home?mode=live', { method: 'POST', headers: { Authorization: 'Bearer run-token' } }, e);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/live fetching is disabled/);
  });
  it('lists adapters and health', async () => {
    const e = env();
    const adapters = await (await createApp().request('/adapters', {}, e)).json() as { items: { name: string }[]; liveFetch: null };
    expect(adapters.items.map((a) => a.name)).toEqual(['cardiff-dogs-home']);
    expect(adapters.liveFetch).toBeNull();
    expect((await createApp().request('/health', {}, e)).status).toBe(200);
  });
});
