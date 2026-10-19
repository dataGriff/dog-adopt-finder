import { Hono } from 'hono';
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
    const expected = c.env.FINDER_RUN_TOKEN;
    const auth = c.req.header('Authorization') ?? '';
    if (!expected || auth !== `Bearer ${expected}`) {
      return c.json({ type: 'about:blank', title: 'Unauthorized', status: 401, errorCode: 'unauthorized' }, 401);
    }
    const adapter = getAdapter(c.req.param('adapter'));
    if (!adapter) return c.json({ type: 'about:blank', title: 'Not Found', status: 404, errorCode: 'not_found', detail: 'no such adapter' }, 404);
    const mode = (c.req.query('mode') ?? 'fixture') as CaptureMode;
    if (mode !== 'fixture' && mode !== 'live') {
      return c.json({ type: 'about:blank', title: 'Bad Request', status: 400, errorCode: 'validation_failed', detail: 'mode must be fixture or live' }, 400);
    }
    const outcome = await runAdapter(adapter, mode, c.env, deps.run);
    if (outcome.ok) return c.json({ ok: true, eventId: outcome.event.id, adapter: adapter.name, rescueId: adapter.rescueId, mode, dogCount: outcome.dogCount });
    return c.json({ ok: false, eventId: outcome.event.id, adapter: adapter.name, rescueId: adapter.rescueId, mode, error: outcome.error }, 502);
  });

  return app;
}
