import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { request } from './client.js';
import { statusText, statusSummary, gachaSummary, rulesText, activityText, dexText } from './terminal.js';
import { ensureServer } from './runtime.js';
import { configuration } from './config.js';
import { startRemoteSync } from './remote.js';
import { collectionHTML } from '../public/pet-art.js';

export async function startMcp() {
  try {
    await ensureServer();
    const result = await request('/api/checkin', {});
    if (result.awarded) console.error(`TokenPet: ${result.message}`);
  } catch (error) { console.error(`TokenPet: ${error instanceof Error ? error.message : String(error)}`); }
  const server = new McpServer({ name: 'tokenpet', version: '1.0.1' });
  let sync: ReturnType<typeof startRemoteSync>;
  const register = <S extends z.ZodRawShape>(name: string, description: string, schema: S, readOnly: boolean, fn: (args: z.output<z.ZodObject<S>>) => Promise<string>) => server.registerTool(name, {
    description, inputSchema: z.object(schema), annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
  }, async args => {
    try {
      const result = await fn(args);
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
  });
  register('pet_status', 'Read pet summary, rules, or activity (5 short entries). detail adds art/full status or 20 full entries.',
    { view: z.enum(['status', 'rules', 'activity']).default('status'), detail: z.boolean().default(false) }, true,
    async ({ view, detail }) => {
      const state = await request('/api/state');
      if (sync?.status) state.collector = { ...sync.status, enabled: configuration().watch };
      if (view === 'rules') return rulesText(state);
      if (view === 'activity') return activityText(state, !detail);
      return detail ? statusText(state) : statusSummary(state);
    });
  register('pet_care', 'Requested care only. Feed: 5 C; clean: 3 C; others free. Returns changes and balance.',
    { action: z.enum(['feed', 'play', 'clean', 'sleep', 'wake']) }, false, async args => { const r = await request('/api/care', args); return `${r.message} · 잔액 ${r.state.player.coins} C`; });
  register('pet_checkin', 'Explicit checkin only; startup auto-claims once daily (Asia/Seoul). Free.',
    {}, false, async () => { const r = await request('/api/checkin', {}); return `${r.message} · 잔액 ${r.state.player.coins} C`; });
  register('pet_gacha', 'Requested draws only, 100 C each, duplicates possible. Submit the whole count once; never split, reduce or retry. Unaffordable: no draws/charge. Returns totals and up to 10 species.',
    { count: z.number().int().min(1).default(1) }, false, async args => gachaSummary(await request('/api/gacha', args)));
  register('pet_dex', 'Read owned pets or all species, filtered by tier/name/ID. 10 per page; detail adds thumbnails and care values.',
    { tier: z.enum(['common', 'rare', 'epic', 'unique', 'legendary']).optional(), all: z.boolean().default(false), query: z.string().trim().min(1).max(100).optional(), page: z.number().int().min(1).default(1), detail: z.boolean().default(false) }, true,
    async args => dexText(await request('/api/state'), { ...args, pageSize: 10 }) + `\n웹 미리보기: ${configuration().baseUrl}/#dex`);
  register('pet_equip', 'Select a requested owned pet. Free; preserves every pet\'s sleep state, never wakes them.', { id: z.string().min(1).max(80) }, false, async args => statusSummary((await request('/api/equip', args)).state));
  register('pet_name', 'Rename workshop on request. Free.',
    { name: z.string().trim().min(1).max(30).regex(/^[^\x00-\x1f\x7f]+$/) }, false,
    async args => `작업실 이름: ${(await request('/api/profile', args)).state.player.name}`);
  register('pet_share', 'Omit enabled to inspect. Enable/revoke public collection sharing only on explicit request.',
    { enabled: z.boolean().optional() }, false, async args => {
      const state = args.enabled === undefined ? await request('/api/state') : (await request('/api/share', args)).state;
      if (!state.player.share) return '도감 공유 꺼짐 · share on으로 켤 수 있어요.';
      const config = configuration();
      const url = new URL(`/share/${state.player.share}`, config.publicUrl || config.baseUrl);
      return `도감 공유 켜짐 · ${url}\n공개 항목: 작업실 이름·펫·레벨·보유 수량\nshare off로 링크 폐기` +
        (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? '\n로컬 주소는 이 컴퓨터에서만 열립니다. 파일로 전달하려면 export를 사용하세요.' : '');
    });
  register('pet_export', 'Export HTML to a requested absolute .html path. Never overwrite, enable sharing or open a browser.',
    { path: z.string().min(1).max(4096).regex(/^[^\x00-\x1f\x7f]+\.html$/i).refine(isAbsolute, 'HTML 파일의 절대 경로가 필요합니다.') }, false, async ({ path }) => {
      const state = await request('/api/state');
      writeFileSync(path, collectionHTML({ name: state.player.name, pets: state.pets, catalog: state.catalog, tiers: state.tiers }), { flag: 'wx', mode: 0o600 });
      return `도감을 저장했습니다: ${path}`;
    });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  sync = startRemoteSync(configuration());
  const close = transport.onclose;
  transport.onclose = () => { sync?.stop(); close?.(); };
}
