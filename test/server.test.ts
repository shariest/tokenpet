import type { TestContext } from 'node:test';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallToolResult, TextContent } from '@modelcontextprotocol/client';
import type { Configuration } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startServer } from '../dist/src/server.js';
import { Game } from '../dist/src/game.js';
import { credential, configuration, saveConnection } from '../dist/src/config.js';
import { installCodexPet } from '../dist/src/codex-pet.js';
import { shellQuote } from '../dist/src/shell-install.js';

const run = promisify(execFile);
// TokenPet tools always answer with a single text block.
type TextToolResult = CallToolResult & { content: TextContent[] };

async function fixture(t: TestContext) {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-http-'));
  const config = { dataDir, host: '127.0.0.1', port: 0, watch: false, roots: {}, publicUrl: null, codexPetDir: join(dataDir, 'codex-pet') } as Configuration;
  const game = await Game.open(join(dataDir, 'game.sqlite'), { random: () => 0 });
  const app = await startServer(config, { port: 0, game }); const token = credential(config);
  t.after(async () => { await app.close(); await game.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const call = (path: string, data?: unknown, extra: Record<string, string> = {}) => fetch(app.url + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-API-Key': token, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { app, config, token, call };
}
test('care refreshes the installed Codex image without installing or replacing another pet', async t => {
  const { config, call } = await fixture(t);
  const state = await (await call('/api/state')).json();
  assert.equal(existsSync(config.codexPetDir), false);
  installCodexPet(state, config.codexPetDir);
  const path = join(config.codexPetDir, 'pet.json');
  const before = JSON.parse(readFileSync(path, 'utf8'));
  const result = await (await call('/api/care', { action: 'feed' })).json();
  assert.equal(Math.round(result.state.active.hunger), 100);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.notEqual(after.spritesheetPath, before.spritesheetPath);
  assert.match(after.description, /포만감 100\/100/);
  assert.notDeepEqual(readFileSync(join(config.codexPetDir, after.spritesheetPath)), readFileSync(join(config.codexPetDir, before.spritesheetPath)));
  saveConnection(config.dataDir, { server: 'https://remote.example.test', key: 'test-remote-key-'.repeat(3) });
  writeFileSync(path, JSON.stringify({ ...after, description: 'remote pet' }));
  await call('/api/state');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).description, 'remote pet', 'an old local server must not replace the remote pet image');
  saveConnection(config.dataDir, {});
  writeFileSync(path, '{"id":"another-pet"}\n');
  assert.equal((await call('/api/state')).status, 200);
  assert.equal(readFileSync(path, 'utf8'), '{"id":"another-pet"}\n');
});
test('HTTP auth, origin protection, session cookies and public-data boundary', async t => {
  const { app, call } = await fixture(t);
  assert.equal((await fetch(app.url + '/api/state')).status, 401);
  assert.equal((await call('/api/care', { action: 'feed' }, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call('/api/session', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const login = await fetch(app.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!; assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('SameSite=Strict'));
  const state = await fetch(app.url + '/api/state', { headers: { Cookie: cookie.split(';')[0] } }); assert.equal(state.status, 200);
  assert.equal((await call('/api/gacha', { count: -1 })).status, 400);
  const share = await (await call('/api/share', { enabled: true })).json();
  const publicData = await (await fetch(app.url + '/api' + share.path)).json();
  assert.equal(publicData.player, undefined); assert.equal(publicData.tokens, undefined);
  await call('/api/share', { enabled: false }); assert.equal((await fetch(app.url + '/api' + share.path)).status, 404);
  assert.equal((await fetch(app.url + '/api-key')).status, 404);
});
test('personal mode keeps local play and the catalog while disabling member features', async t => {
  const { app, call } = await fixture(t);
  const identity = await (await fetch(app.url + '/api/me')).json();
  assert.equal(identity.local, true);
  assert.equal(identity.authenticated, false);
  for (const path of ['/api/signup', '/api/login', '/api/rankings', '/api/tokens', '/api/tokens/' + randomUUID()]) {
    assert.equal((await fetch(app.url + path)).status, 404);
    assert.equal((await call(path, {})).status, 404);
  }
  assert.equal((await app.game.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n, 0);
  const login = await fetch(app.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const state = await (await fetch(app.url + '/api/state', { headers: { Cookie: cookie } })).json();
  assert.equal(state.player.coins, 300);
  assert.equal((await fetch(app.url + '/api/catalog')).status, 200);
  assert.equal((await call('/api/care', { action: 'feed' })).status, 200);
});
test('server serves compiled browser modules and keeps source files private', async t => {
  const { app } = await fixture(t);
  const page = await fetch(app.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src="\/app\.js"/);
  for (const path of ['/app.js', '/pet-art.js']) {
    const script = await fetch(app.url + path);
    assert.equal(script.status, 200); assert.match(script.headers.get('content-type')!, /javascript/);
    assert.doesNotMatch(await script.text(), /import type|from ['"]node:/);
  }
  for (const path of ['/app.ts', '/pet-art.ts', '/src/types.ts', '/tsconfig.json'])
    assert.equal((await fetch(app.url + path)).status, 404);
});
test('parallel duplicate gacha HTTP requests debit once', async t => {
  const { call } = await fixture(t); const id = randomUUID();
  const responses = await Promise.all(Array.from({ length: 5 }, () => call('/api/gacha', { count: 3 }, { 'Idempotency-Key': id })));
  assert.ok(responses.every(r => r.ok));
  const state = await (await call('/api/state')).json(); assert.equal(state.player.coins, 0); assert.equal(state.player.pulls, 3);
});
test('competing gacha batches either complete in full or leave the remaining coins untouched', async t => {
  const { call } = await fixture(t);
  const responses = await Promise.all([call('/api/gacha', { count: 2 }), call('/api/gacha', { count: 2 })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const state = await (await call('/api/state')).json();
  assert.equal(state.player.coins, 100); assert.equal(state.player.pulls, 2);
  assert.equal(state.active.copies, 3); assert.equal(state.player.pity, 2);
});
test('attendance authenticates, ignores client dates, and pays once across parallel session keys', async t => {
  const { app, call } = await fixture(t);
  assert.equal((await fetch(app.url + '/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await call('/api/checkin', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call('/api/checkin', {}, { 'Idempotency-Key': '' })).status, 400);
  const responses = await Promise.all(Array.from({ length: 8 }, () => call('/api/checkin', { date: '2099-01-01', coins: 999999 })));
  assert.ok(responses.every(r => r.ok));
  const results = await Promise.all(responses.map(r => r.json()));
  assert.equal(results.filter(r => r.awarded).length, 1);
  assert.equal(results.reduce((sum, r) => sum + r.creditedCoins, 0), 100);
  const state = await (await call('/api/state')).json();
  assert.equal(state.player.coins, 400);
  assert.notEqual(state.attendance.date, '2099-01-01');
  assert.equal(state.attendance.streak, 1); assert.equal(state.attendance.nextCoins, 120);
});
test('native MCP stdio handshake, schemas, actions and CLI share one backend', async t => {
  const { app, config, call } = await fixture(t);
  const env = { ...process.env, TOKENPET_DATA_DIR: config.dataDir, TOKENPET_SERVER: app.url, TOKENPET_API_KEY: credential(config),
    TOKENPET_WATCH: '0', CODEX_HOME: join(config.dataDir, 'codex'), CLAUDE_CONFIG_DIR: join(config.dataDir, 'claude') };
  const client = new Client({ name: 'tokenpet-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('bin/tokenpet.mjs'), 'mcp'], env, stderr: 'pipe' });
  await client.connect(transport); t.after(() => client.close());
  const tools = await client.listTools(); assert.equal(tools.tools.length, 9);
  const names = new Set(tools.tools.map(tool => tool.name));
  const skill = readFileSync('integrations/pet/SKILL.md', 'utf8');
  for (const [, name] of skill.matchAll(/`(pet_\w+)/g)) assert.ok(names.has(name), `missing skill tool: ${name}`);
  const invoke = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<TextToolResult>;
  const status = (await invoke('pet_status')).content[0].text;
  assert.ok(status.includes('포만감')); assert.ok(status.includes('/100')); assert.ok(status.includes('360'));
  assert.doesNotMatch(status, /[▀▄█■]/);
  assert.ok(status.length < 300);
  assert.ok(status.includes('출석 완료 · 연속 1일 · 오늘 +100 C · 내일 +120 C'));
  const detail = (await invoke('pet_status', { detail: true })).content[0].text;
  assert.match(detail, /[▀▄█]/); assert.match(detail, /[■·]{10}/);
  const checkin = (await invoke('pet_checkin')).content[0].text;
  assert.match(checkin, /이미 받았어요.*잔액 400 C/);
  assert.ok(checkin.length < 80);
  const rules = (await invoke('pet_status', { view: 'rules' })).content[0].text;
  assert.ok(rules.includes('포만감 +25')); assert.ok(rules.includes('legendary')); assert.ok(rules.includes('50번째'));
  const log = (await invoke('pet_status', { view: 'activity' })).content[0].text;
  assert.ok(log.includes('claude')); assert.ok(log.includes('codex')); assert.ok(log.includes('읽기 오류'));
  const catalog = (await invoke('pet_dex', { all: true, tier: 'rare', page: 2 })).content[0].text;
  assert.ok(catalog.includes('전체 목록 108종')); assert.ok(catalog.includes('2/11페이지'));
  assert.equal(catalog.split('\n').filter(line => /^\d{3} /.test(line)).length, 10);
  assert.doesNotMatch(catalog, /[▀▄█]/);
  assert.ok((await invoke('pet_dex', { all: true, query: '미오' })).content[0].text.includes('celestial-cat'));
  assert.equal((await invoke('pet_dex', { page: 0 })).isError, true);
  assert.equal((await invoke('pet_dex', { page: 2 })).isError, true);
  assert.equal((await invoke('pet_gacha', { count: 0 })).isError, true);
  assert.equal((await (await call('/api/state')).json()).player.coins, 400, 'startup claims once; read-only and invalid commands leave the wallet unchanged');
  const feed = await invoke('pet_care', { action: 'feed' });
  assert.equal(feed.isError, undefined);
  assert.match(feed.content[0].text, /포만감 85→100 \(\+15\)/);
  assert.ok(feed.content[0].text.includes('경험치 +10')); assert.ok(feed.content[0].text.includes('5 C 사용'));
  assert.ok(feed.content[0].text.includes('잔액 395 C')); assert.ok(feed.content[0].text.length < 120);
  assert.equal((await invoke('pet_care', { action: 'feed' })).isError, true);
  const after = await (await call('/api/state')).json();
  assert.equal(after.player.coins, 395); assert.equal(after.active.xp, 10);
  assert.equal((await invoke('pet_name', { name: '터미널 작업실' })).isError, undefined);
  assert.ok((await invoke('pet_status')).content[0].text.includes('터미널 작업실'));
  assert.equal((await invoke('pet_name', { name: 'bad\nname' })).isError, true);
  assert.ok((await invoke('pet_share')).content[0].text.includes('공유 꺼짐'));
  assert.equal((await (await call('/api/state')).json()).player.share, null);
  const share = await invoke('pet_share', { enabled: true });
  assert.ok(share.content[0].text.includes(app.url + '/share/'));
  assert.ok((await invoke('pet_share')).content[0].text.includes('공유 켜짐'));
  assert.equal((await invoke('pet_share', { enabled: false })).isError, undefined);
  const path = join(config.dataDir, 'collection.html');
  assert.equal((await invoke('pet_export', { path })).isError, undefined);
  const html = readFileSync(path, 'utf8');
  assert.ok(html.includes('터미널 작업실')); assert.ok(html.includes('숲속 모스'));
  assert.equal((await invoke('pet_export', { path })).isError, true);
  assert.equal(readFileSync(path, 'utf8'), html, 'export must not overwrite an existing file');
  assert.equal((await invoke('pet_export', { path: './relative.html' })).isError, true);
  assert.equal((await invoke('pet_export', { path: join(config.dataDir, 'config.json') })).isError, true);
  assert.equal((await (await call('/api/state')).json()).player.share, null, 'export must not enable sharing');
  const { stdout: output } = await run(process.execPath, ['bin/tokenpet.mjs', 'status'], { env });
  assert.ok(output.includes('395 C')); assert.ok(output.includes('█'));
  const { stdout: cliCheckin } = await run(process.execPath, ['bin/tokenpet.mjs', 'checkin'], { env });
  assert.ok(cliCheckin.includes('이미 받았어요')); assert.ok(cliCheckin.includes('395 C'));
  await assert.rejects(run(process.execPath, ['bin/tokenpet.mjs', 'checkin', 'extra'], { env }), { code: 1 });
});
test('CLI and MCP accept custom gacha counts and never shrink unaffordable requests', async t => {
  const { app, config, token } = await fixture(t);
  await app.game.db.exec('UPDATE player SET coins=1100 WHERE id=1');
  const env = { ...process.env, TOKENPET_DATA_DIR: config.dataDir, TOKENPET_SERVER: app.url, TOKENPET_API_KEY: token,
    TOKENPET_WATCH: '0', CODEX_HOME: join(config.dataDir, 'codex'), CLAUDE_CONFIG_DIR: join(config.dataDir, 'claude') };
  const client = new Client({ name: 'custom-gacha-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('bin/tokenpet.mjs'), 'mcp'], env, stderr: 'pipe' }));
  t.after(() => client.close());
  const cli = (...args: string[]) => run(process.execPath, ['bin/tokenpet.mjs', 'gacha', ...args], { env });
  const output = (await cli('3')).stdout;
  assert.equal(output.split('\n').filter(line => line.includes('[common]')).length, 3);
  const result = await client.callTool({ name: 'pet_gacha', arguments: { count: 7 } }) as TextToolResult;
  assert.ok(!result.isError);
  assert.match(result.content[0].text, /뽑기 7회 · 신규 0종 · 중복 7회/);
  assert.match(result.content[0].text, /\[common\] ×7 · sprout/);
  assert.equal((await app.game.player())!.coins, 200); assert.equal((await app.game.player())!.pulls, 10);
  const snapshot = async () => ({ player: await app.game.player(), pets: await app.game.db.prepare('SELECT * FROM pets').all(),
    ledger: await app.game.db.prepare('SELECT * FROM ledger').all(), requests: await app.game.db.prepare('SELECT * FROM requests').all() });
  const before = await snapshot();
  await assert.rejects(cli('3'), (error: { code: number; stderr: string }) => error.code === 1 && error.stderr.includes('한 번도 뽑지 않았어요'));
  const denied = await client.callTool({ name: 'pet_gacha', arguments: { count: 3 } }) as TextToolResult;
  assert.equal(denied.isError, true); assert.ok(denied.content[0].text.includes('한 번도 뽑지 않았어요'));
  for (const args of [['0'], ['-1'], ['1.5'], ['9007199254740992'], ['1', 'extra']])
    await assert.rejects(cli(...args), { code: 1 });
  for (const count of [0, -1, 1.5, 9007199254740992])
    assert.equal((await client.callTool({ name: 'pet_gacha', arguments: { count } })).isError, true);
  assert.deepEqual((await snapshot()), before, 'failed requests must not spend the two remaining affordable draws');
  await app.game.db.exec('UPDATE player SET coins=14000 WHERE id=1');
  const large = await client.callTool({ name: 'pet_gacha', arguments: { count: 140 } }) as TextToolResult;
  assert.ok(!large.isError); assert.ok(large.content[0].text.length < 450);
  assert.match(large.content[0].text, /뽑기 140회/);
  assert.match(large.content[0].text, /14000 C 사용 · 잔액 0 C/);
  assert.equal((await app.game.player())!.pulls, 150); assert.equal((await app.game.player())!.coins, 0);
  const log = await client.callTool({ name: 'pet_status', arguments: { view: 'activity' } }) as TextToolResult;
  assert.ok(log.content[0].text.length < 1200); assert.match(log.content[0].text, /… · -14000 C/);
  const fullLog = await client.callTool({ name: 'pet_status', arguments: { view: 'activity', detail: true } }) as TextToolResult;
  assert.ok(fullLog.content[0].text.length > 2000);
});
test('CLI list and dex match MCP pet lists and preserve sleeping pets across selection', async t => {
  const { app, config, token, call } = await fixture(t);
  const catalog = (await (await call('/api/state')).json()).catalog;
  for (const pet of catalog.slice(1, 25)) await app.game.db.prepare('INSERT INTO pets(species,updated) VALUES(?,?)').run(pet.id, Date.now());
  assert.equal((await call('/api/care', { action: 'sleep' })).status, 200);
  assert.equal((await call('/api/equip', { id: 'forest-cat' })).status, 200);
  const before = await app.game.db.prepare('SELECT * FROM pets').all();
  const env = { ...process.env, TOKENPET_DATA_DIR: config.dataDir, TOKENPET_SERVER: app.url, TOKENPET_API_KEY: token,
    TOKENPET_WATCH: '0', CODEX_HOME: join(config.dataDir, 'codex'), CLAUDE_CONFIG_DIR: join(config.dataDir, 'claude') };
  const cli = (...args: string[]) => run(process.execPath, ['bin/tokenpet.mjs', ...args], { env });
  for (const command of ['list', 'dex']) {
    const { stdout } = await cli(command);
    assert.match(stdout, /보유 목록 25종 · 1\/2페이지/);
    assert.match(stdout, /sprout · 대기 · 자는 중/);
    assert.match(stdout, /forest-cat · 함께하는 중 · 깨어 있음/);
    assert.match(stdout, /포만감 \d+\/100\n[^]*기분 \d+\/100\n[^]*에너지 \d+\/100\n[^]*청결 \d+\/100/);
    assert.match(stdout, /[▀▄█]/);
    assert.ok(stdout.includes(`${app.url}/#dex`));
  }
  const { stdout: second } = await cli('list', 'common', '2');
  assert.match(second, /2\/2페이지/);
  assert.equal(second.split('\n').filter(line => /^\d{3} /.test(line)).length, 1);
  assert.ok(second.includes(catalog[24].id));
  assert.match((await cli('list', 'rare')).stdout, /조건에 맞는 친구가 없어요/);
  for (const args of [['0'], ['bogus'], ['1', 'extra']]) await assert.rejects(cli('list', ...args), { code: 1 });
  const client = new Client({ name: 'tokenpet-list-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('bin/tokenpet.mjs'), 'mcp'], env, stderr: 'pipe' }));
  t.after(() => client.close());
  const roster = await client.callTool({ name: 'pet_dex', arguments: {} }) as TextToolResult;
  assert.ok(!roster.isError);
  assert.match(roster.content[0].text, /sprout · 대기 · 자는 중/);
  assert.match(roster.content[0].text, /forest-cat · 함께하는 중 · 깨어 있음/);
  assert.doesNotMatch(roster.content[0].text, /[▀▄█]/);
  assert.match(roster.content[0].text, /1\/3페이지/);
  assert.equal(roster.content[0].text.split('\n').filter(line => /^\d{3} /.test(line)).length, 10);
  assert.ok(roster.content[0].text.includes(`${app.url}/#dex`));
  const details = (await client.callTool({ name: 'pet_dex', arguments: { detail: true } }) as TextToolResult).content[0].text;
  assert.match(details, /[▀▄█]/); assert.match(details, /포만감 \d+\/100/);
  assert.deepEqual(details.split('\n').filter(line => /^\d{3} /.test(line)), roster.content[0].text.split('\n').filter(line => /^\d{3} /.test(line)));
  assert.deepEqual((await app.game.db.prepare('SELECT * FROM pets').all()), before, 'list queries must not change any pet');
  const equipped = await client.callTool({ name: 'pet_equip', arguments: { id: 'sprout' } }) as TextToolResult;
  assert.doesNotMatch(equipped.content[0].text, /[▀▄█■]/);
  assert.match(equipped.content[0].text, /자는 중/);
  assert.equal((await app.game.state()).active.sleeping, true, 'the compact equip receipt must not wake the pet');
  await client.callTool({ name: 'pet_equip', arguments: { id: 'forest-cat' } });
  assert.equal((await app.game.player())!.equipped, 'forest-cat');
  assert.equal((await app.game.player())!.coins, 400, 'the MCP session claims attendance without modifying any pet');
});
test('interactive launchers and concurrent MCP sessions share one automatic daily reward', async t => {
  const { app, config, token } = await fixture(t);
  const env = { ...process.env, TOKENPET_DATA_DIR: config.dataDir, TOKENPET_SERVER: app.url, TOKENPET_API_KEY: token,
    TOKENPET_WATCH: '0', CODEX_HOME: join(config.dataDir, 'codex'), CLAUDE_CONFIG_DIR: join(config.dataDir, 'claude'),
    TOKENPET_ORIGINAL_CLAUDE: process.execPath, TOKENPET_ORIGINAL_CODEX: process.execPath, TERM_PROGRAM: 'test' };
  const script = `import { launchCLI } from './dist/src/launcher.js';
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    await launchCLI(process.argv[1], process.argv.slice(2));`;
  const launch = (cli: string, args: string[]) => run(process.execPath, ['--input-type=module', '-e', script, cli, ...args], { env });
  await launch('claude', ['--version']);
  assert.equal((await app.game.player())!.coins, 300, 'a version query must not count as attendance');
  const results = await Promise.all(['claude', 'codex'].map(cli => launch(cli, ['-e', 'console.log("CLI started")'])));
  assert.ok(results.every(r => r.stdout.includes('CLI started')));
  assert.equal(results.filter(r => r.stderr.includes('+100 C')).length, 1);
  assert.equal((await app.game.player())!.coins, 400);
  const clients = [0, 1].map(i => new Client({ name: `attendance-${i}`, version: '1.0.0' }));
  for (const client of clients) t.after(() => client.close());
  await Promise.all(clients.map(client => client.connect(new StdioClientTransport({ command: process.execPath,
    args: [resolve('bin/tokenpet.mjs'), 'mcp'], env, stderr: 'pipe' }))));
  assert.equal((await app.game.player())!.coins, 400, 'new MCP connections cannot award an already claimed day');
  assert.equal((await app.game.db.prepare('SELECT COUNT(*) AS n FROM checkins').get() as { n: number }).n, 1);
});

test('TTY launchers distinguish headless commands from prompts and option values while preserving terminal and process behavior', async t => {
  const { app, config, token } = await fixture(t);
  const executable = join(config.dataDir, 'mock-cli.mjs');
  const graphic = '\x1b_Ga=T,t=d,f=100,i=49374,m=0;UE5H\x1b\\';
  writeFileSync(executable, `import { readFileSync } from 'node:fs';
    console.log(JSON.stringify({ args: process.argv.slice(2), term: process.env.TERM, program: process.env.TERM_PROGRAM,
    hint: process.env.ORCA_IMAGE_PROTOCOL, original: process.env.TOKENPET_ORIGINAL_CODEX || process.env.TOKENPET_ORIGINAL_CLAUDE,
    input: readFileSync(0, 'utf8') }));
    process.stdout.write(${JSON.stringify(graphic + '\n')}); process.stderr.write('native stderr\\n'); process.exitCode = 17;`);
  const requests: (string | undefined)[] = [];
  app.server.on('request', req => { requests.push(req.url); });
  const cases: { name: string; program?: string; hint?: string; cli?: string; args?: string[]; flag?: string;
    rewrite?: boolean; headless?: boolean; invalidKey?: boolean; stdin?: boolean; stdout?: boolean }[] = [
    { name: 'Orca Kitty', rewrite: true },
    { name: 'Orca without hint', hint: undefined, rewrite: true },
    { name: 'Orca without hint and failed attendance', hint: undefined, rewrite: true, invalidKey: true },
    { name: 'Orca explicitly disabled', hint: 'none' },
    { name: 'Orca explicitly empty hint', hint: '' },
    { name: 'Orca Sixel', hint: 'sixel' },
    { name: 'unknown terminal', program: 'OtherTerminal' },
    { name: 'absent terminal program', program: undefined },
    { name: 'Claude in Orca', cli: 'claude' },
    { name: 'piped stdin', stdin: false },
    { name: 'piped stdout', stdout: false },
    ...['--version', '-V', '--help', '-h'].map(flag => ({ name: flag, flag })),
    { name: 'Orca with failed attendance', rewrite: true, invalidKey: true },
    { name: 'Warp', program: 'WarpTerminal', rewrite: true },
    { name: 'Warp with failed attendance', program: 'WarpTerminal', rewrite: true, invalidKey: true },
    ...['exec', 'e', 'review'].flatMap(command => [
      { name: `Codex ${command}`, args: [command, 'prompt with spaces'], headless: true },
      { name: `Codex ${command} after global options`, args: ['--model', 'exec', '-c', 'key=value', command, 'prompt'], headless: true },
      { name: `Codex model named ${command}`, args: ['--model', command], rewrite: true },
      { name: `Codex ${command} after delimiter`, args: ['--', command], headless: true },
    ]),
    { name: 'Warp headless exec', program: 'WarpTerminal', args: ['exec', 'prompt'], headless: true },
    { name: 'Codex implicit prompt', args: ['explain exec and review'], rewrite: true },
    { name: 'Codex resume named exec', args: ['resume', 'exec'], rewrite: true },
    { name: 'Codex resume session after delimiter', args: ['resume', '--', 'exec'], rewrite: true },
    { name: 'Codex fork named review', args: ['fork', 'review'], rewrite: true },
    { name: 'Codex attached model', args: ['-mexec', '--config=features.test=true'], rewrite: true },
    { name: 'Codex attached model before exec', args: ['-mexec', 'exec', 'prompt'], headless: true },
    { name: 'Codex profile named e', args: ['-p', 'e', 'resume'], rewrite: true },
    { name: 'Codex help after missing option value', args: ['--config', '--help'], headless: true },
    { name: 'Codex literal help prompt', args: ['--', '--help'], rewrite: true },
    { name: 'Codex variadic image values resembling commands', args: ['--image', 'one.png', 'exec', 'review'], rewrite: true },
    { name: 'Codex exec after image option terminator', args: ['--image', 'one.png', '--model', 'exec', 'exec'], headless: true },
    { name: 'Codex exec after image with equals', args: ['--image=one.png', 'exec'], headless: true },
    { name: 'Codex exec after attached image', args: ['-ione.png', 'exec'], headless: true },
    ...['-p', '--print', '-cp'].map(flag => ({ name: `Claude ${flag}`, cli: 'claude', args: [flag, 'prompt'], headless: true })),
    { name: 'Claude print after prompt', cli: 'claude', args: ['prompt', '--print'], headless: true },
    { name: 'Claude print after optional resume', cli: 'claude', args: ['--resume', '-p'], headless: true },
    { name: 'Claude system prompt resembling print', cli: 'claude', args: ['--system-prompt', '-p', 'prompt'] },
    { name: 'Claude appended prompt resembling print', cli: 'claude', args: ['--append-system-prompt', '--print', 'prompt'] },
    { name: 'Claude attached system prompt', cli: 'claude', args: ['--system-prompt=-p', 'prompt'] },
    { name: 'Claude attached name', cli: 'claude', args: ['-n-p', 'prompt'] },
    { name: 'Claude literal print prompt', cli: 'claude', args: ['--', '-p'] },
    { name: 'Claude version', cli: 'claude', flag: '-v' },
  ];
  for (const example of cases) await t.test(example.name, async () => {
    const program = Object.hasOwn(example, 'program') ? example.program : 'Orca';
    const hint = Object.hasOwn(example, 'hint') ? example.hint : 'kitty';
    const env = { ...process.env, TOKENPET_DATA_DIR: config.dataDir, TOKENPET_SERVER: app.url,
      TOKENPET_API_KEY: example.invalidKey ? 'invalid-test-key-'.repeat(3) : token, TOKENPET_WATCH: '0',
      CODEX_HOME: join(config.dataDir, randomUUID()), CLAUDE_CONFIG_DIR: join(config.dataDir, 'claude'),
      TOKENPET_ORIGINAL_CODEX: executable, TOKENPET_ORIGINAL_CLAUDE: executable,
      TERM: 'xterm-256color', TERM_PROGRAM: program, ORCA_IMAGE_PROTOCOL: hint };
    const script = `import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const before = { ...process.env }, rawModes = [], wrappers = [];
      const nativeSpawn = childProcess.spawn;
      childProcess.spawn = (command, args, options) => {
        if (command === '/usr/bin/script') {
          wrappers.push({ command, args, stdio: options.stdio });
          return nativeSpawn(process.execPath, [before.TOKENPET_ORIGINAL_CODEX, ...process.argv.slice(2)], options);
        }
        return nativeSpawn(command, args, options);
      };
      syncBuiltinESMExports();
      const { launchCLI } = await import('./dist/src/launcher.js');
      Object.defineProperty(process.stdin, 'isTTY', { value: ${example.stdin !== false} });
      Object.defineProperty(process.stdout, 'isTTY', { value: ${example.stdout !== false} });
      process.stdin.setRawMode = raw => { rawModes.push(raw); return process.stdin; };
      await launchCLI(process.argv[1], process.argv.slice(2));
      assert.deepEqual({ ...process.env }, before);
      console.log(JSON.stringify({ rawModes, wrappers }));`;
    const args = example.args || (example.flag ? [example.flag] : ['resume', 'session with spaces', "quote'and\"", '$(must-not-run)', '$pet status']);
    const beforeRequests = requests.length;
    const execution = run(process.execPath, ['--input-type=module', '-e', script, example.cli || 'codex', ...args], { env });
    execution.child.stdin!.end('stdin preserved\n');
    const result = await execution.catch(error => { assert.equal(error.code, 17); return error; });
    assert.equal(result.code, 17, 'the native CLI exit status must be preserved');
    assert.match(result.stderr, /native stderr/);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(JSON.parse(lines[0]), { args, term: example.rewrite ? 'xterm-kitty' : env.TERM, input: 'stdin preserved\n',
      ...(example.rewrite || program ? { program: example.rewrite ? 'kitty' : program } : {}), ...(hint !== undefined ? { hint } : {}) });
    const interactive = example.stdin !== false && example.stdout !== false && !example.flag && !example.headless;
    const warpFilter = interactive && program === 'WarpTerminal' && ['darwin', 'linux'].includes(process.platform) && existsSync('/usr/bin/script');
    const parent = JSON.parse(lines.at(-1));
    assert.deepEqual(parent.rawModes, warpFilter ? [true, false] : []);
    assert.deepEqual(parent.wrappers, warpFilter ? [{ command: '/usr/bin/script', args: process.platform === 'darwin'
      ? ['-q', '/dev/null', '/bin/sh', '-c', '/usr/bin/tty >&3; exec 3>&-; exec "$@"', 'tokenpet-codex', process.execPath, executable, ...args]
      : ['-qefc', [process.execPath, executable, ...args].map(shellQuote).join(' '), '/dev/null'],
      stdio: process.platform === 'darwin' ? ['inherit', 'pipe', 'inherit', 'pipe'] : ['inherit', 'pipe', 'inherit'] }] : []);
    if (warpFilter) assert.match(lines[1], /\x1b_G[^;]*i=(?!49374[,;])\d+,m=0;UE5H\x1b\\/);
    else assert.equal(lines[1], graphic, 'Orca and other terminals must receive unfiltered native graphics');
    assert.deepEqual(requests.slice(beforeRequests), interactive ? ['/api/health', '/api/checkin'] : []);
    assert.equal(existsSync(join(env.CODEX_HOME, 'pets', 'tokenpet', 'pet.json')),
      interactive && (example.cli || 'codex') === 'codex' && !example.invalidKey);
    if (example.invalidKey) assert.match(result.stderr, /서버 접근 키가 맞지 않아요.*CLI는 계속 실행합니다/);
    else assert.doesNotMatch(result.stderr, /CLI는 계속 실행합니다/);
  });
});

test('remote clients require HTTPS and invalid config is rejected', () => {
  assert.throws(() => configuration({ TOKENPET_SERVER: 'http://example.com' }), /HTTPS/);
  assert.throws(() => configuration({ TOKENPET_HOST: '0.0.0.0' }), /HTTPS/);
  assert.throws(() => configuration({ TOKENPET_PORT: 'not-a-port' }), /TOKENPET_PORT/);
  assert.throws(() => configuration({ TOKENPET_PUBLIC_URL: 'http://example.com' }), /HTTPS/);
});
test('remote serving never auto-logs in and requires the game key with secure cookies', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-remote-'));
  const config = { dataDir, host: '127.0.0.1', port: 0, watch: false, roots: {}, publicUrl: 'https://pets.example.test' } as Configuration;
  const app = await startServer(config, { port: 0 });
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const headers = { Host: 'pets.example.test', 'Content-Type': 'application/json', Origin: config.publicUrl! };
  const raw = (path: string, data: unknown, values: OutgoingHttpHeaders = headers) => new Promise<{ status: number | undefined; headers: IncomingHttpHeaders }>((resolveResponse, reject) => {
    const req = httpRequest(url + path, { method: data ? 'POST' : 'GET', headers: values }, res => {
      res.resume(); res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
  const login = (body: unknown) => raw('/api/session', body);
  assert.equal((await login({})).status, 401);
  const ok = await login({ key: credential(config) });
  assert.equal(ok.status, 200); assert.ok(ok.headers['set-cookie']![0].includes('Secure'));
  assert.equal((await raw('/api/health', null, { Host: 'attacker.test' })).status, 403);
});

test('only the local CLI key can stop a personal server', async t => {
  const { app, call } = await fixture(t);
  const session = await fetch(app.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: '{}' });
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const browser = await fetch(app.url + '/api/shutdown', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: app.url }, body: '{}' });
  assert.equal(browser.status, 404, 'a browser session cannot stop the server');
  assert.equal((await call('/api/shutdown', {})).status, 202);
  await app.close();
  await assert.rejects(fetch(app.url + '/api/health'));
});

test('a standalone server reports its process and finishes its shutdown hook after closing', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tokenpet-shutdown-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let finished: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  const app = await startServer({ dataDir, host: '127.0.0.1', port: 0, watch: false, roots: {}, publicUrl: null, codexPetDir: join(dataDir, 'codex-pet') } as Configuration, { port: 0, onShutdown: () => finished() });
  t.after(() => app.close());
  const response = await fetch(app.url + '/api/shutdown', { method: 'POST', headers: { 'X-API-Key': credential({ dataDir } as Configuration), 'Content-Type': 'application/json' }, body: '{}' });
  assert.deepEqual(await response.json(), { ok: true, pid: process.pid });
  await done;
  await assert.rejects(fetch(app.url + '/api/health'));
});
