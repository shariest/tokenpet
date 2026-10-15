import type { Configuration } from './types.js';

import { Collector } from './collector.js';
import { request } from './client.js';

export function startRemoteSync(config: Configuration) {
  if (!config.remote) return null;
  let collector: Collector | undefined, stopped = false, running = false;
  const scan = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const state = await request('/api/state', undefined, { config });
      if (stopped || !config.watch) return;
      collector ||= new Collector({ roots: config.roots, since: state.player.created,
        send: records => request('/api/usage', { records }, { config }) });
      await collector.scan();
    } catch (error) { console.error(`TokenPet 사용량 연결: ${error instanceof Error ? error.message : String(error)}`); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void scan(); }, 10000); timer.unref();
  void scan();
  return { scan, get status() { return collector?.status; }, stop() { stopped = true; clearInterval(timer); } };
}
