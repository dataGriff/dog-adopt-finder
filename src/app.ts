import { Hono } from 'hono';
import { bearerMatches, problemResponse } from '@dogadopt/contracts';
import type { Env } from './env.js';
import { getAdapter, listAdapters } from './adapters/registry.js';
import { runAdapter, type RunDeps } from './run.js';
import type { CaptureMode } from './adapters/types.js';

export interface AppDeps {
  run?: RunDeps;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/health', (c) => c.json({ status: 'ok', liveFetch: c.env.FINDER_LIVE_FETCH ?? null }));

  app.get('/adapters', (c) => c.json({ items: listAdapters(), liveFetch: c.env.FINDER_LIVE_FETCH ?? null }));

  app.post('/run/:adapter', async (c) => {
    // Constant-time compare from the contracts package: this endpoint is the
    // one switch that can trigger a live fetch once FINDER_LIVE_FETCH is set.
    if (!bearerMatches(c.req.header('Authorization'), c.env.FINDER_RUN_TOKEN)) {
      return problemResponse('unauthorized', { instance: c.req.path });
    }
    const adapter = getAdapter(c.req.param('adapter'));
    if (!adapter) return problemResponse('not_found', { detail: 'no such adapter', instance: c.req.path });
    const mode = (c.req.query('mode') ?? 'fixture') as CaptureMode;
    if (mode !== 'fixture' && mode !== 'live') {
      return problemResponse('validation_failed', { detail: 'mode must be fixture or live', errors: [{ path: 'mode', message: 'must be fixture or live' }], instance: c.req.path });
    }
    const outcome = await runAdapter(adapter, mode, c.env, deps.run);
    if (outcome.ok) return c.json({ ok: true, eventId: outcome.event.id, adapter: adapter.name, rescueId: adapter.rescueId, mode, dogCount: outcome.dogCount });
    return c.json({ ok: false, eventId: outcome.event.id, adapter: adapter.name, rescueId: adapter.rescueId, mode, error: outcome.error }, 502);
  });

  return app;
}
