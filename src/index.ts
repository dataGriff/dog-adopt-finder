import type { FinderEvent } from '@dogadopt/contracts';
import { createApp } from './app.js';
import { adapters } from './adapters/registry.js';
import { handleBatch } from './consumer.js';
import type { Env } from './env.js';
import { runAdapter } from './run.js';

const app = createApp();

export default {
  fetch: app.fetch,

  // No cron is configured in wrangler.jsonc, so this never fires today.
  // When a schedule is added it runs every adapter in fixture mode, except
  // the one adapter FINDER_LIVE_FETCH names, which runs live.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const adapter of adapters.values()) {
      const mode = env.FINDER_LIVE_FETCH?.trim() === adapter.name ? 'live' : 'fixture';
      ctx.waitUntil(runAdapter(adapter, mode, env).then((o) => console.log(`scheduled ${adapter.name} ${mode}: ${o.ok ? `${o.dogCount} dogs` : o.error}`)));
    }
  },

  async queue(batch: MessageBatch<FinderEvent>, env: Env): Promise<void> {
    await handleBatch(batch, env);
  },
} satisfies ExportedHandler<Env, FinderEvent>;
