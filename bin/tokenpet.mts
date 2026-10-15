#!/usr/bin/env node
import { execFileSync, execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '../src/config.js';
import { request } from '../src/client.js';
import { statusText, terminalUI, petStatusLine, dexText } from '../src/terminal.js';
import { collectionHTML } from '../public/pet-art.js';
import { cliExecutable, cliInvocation } from '../src/cli-install.js';
import { windowsStatuslineShell } from '../src/windows.js';

const [command = 'status', argument] = process.argv.slice(2);
try {
  if (['ui', 'codex-pet', 'sync', 'watch', 'open', 'status', 'checkin', 'feed', 'play', 'clean', 'sleep', 'wake', 'gacha', 'list', 'dex', 'equip', 'name', 'share', 'export', 'doctor'].includes(command))
    await (await import('../src/runtime.js')).ensureServer();
  if (command === 'server') {
    const { startServer } = await import('../src/server.js');
    const app = await startServer(configuration(process.env, { server: true }), { onShutdown: () => process.exit(0) });
    console.log(`TokenPet · ${app.url}\ncodex / claude에서 함께 키우는 펫\n종료: Ctrl+C`);
    let closing = false;
    const stop = async () => { if (!closing) { closing = true; await app.close(); } };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } else if (command === 'mcp') {
    await (await import('../src/mcp.js')).startMcp();
  } else if (command === 'ui') {
    const result = await request('/api/checkin', {});
    if (result.awarded) console.error(`TokenPet: ${result.message}`);
    await terminalUI();
  } else if (command === 'launch' || command === 'codex') {
    await (await import('../src/launcher.js')).launchCLI(command === 'codex' ? 'codex' : argument, process.argv.slice(command === 'codex' ? 3 : 4));
  } else if (command === 'codex-pet') {
    const directory = (await import('../src/codex-pet.js')).installCodexPet(await request('/api/state'));
    console.log(`Codex 펫 등록: ${directory}\nCodex에서 /pets tokenpet으로 선택하세요.`);
  } else if (command === 'setup' || command === 'install') {
    console.log(await (await import('../src/setup.js')).setup());
  } else if (command === 'connect') {
    await (await import('../src/connect.js')).connect(argument);
    console.log(await (await import('../src/setup.js')).setup());
  } else if (command === 'statusline') {
    const input = readFileSync(0, 'utf8');
    const previous = join(configuration().dataDir, 'previous-statusline.json');
    if (existsSync(previous)) {
      const value = JSON.parse(readFileSync(previous, 'utf8'));
      if (value.type === 'command' && typeof value.command === 'string') {
        try {
          const shell = process.platform === 'win32' ? windowsStatuslineShell() : undefined;
          const output = execSync(value.command, { input, shell, windowsHide: true, timeout: 2500, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trimEnd();
          if (output) console.log(output);
        } catch {}
      }
    }
    try {
      console.log(petStatusLine(await request('/api/state', undefined, { timeout: 500 }), { blink: Math.floor(Date.now() / 2000) % 6 === 5 }));
    } catch { console.log('(•ᴥ•) TokenPet · 작업실 쉬는 중'); }
  } else if (command === 'sync' || command === 'watch') {
    const config = configuration(); const state = await request('/api/state');
    const { Collector } = await import('../src/collector.js');
    const collector = new Collector({ roots: config.roots, since: state.player.created, send: records => request('/api/usage', { records }) });
    if (argument && !['claude', 'codex'].includes(argument)) throw new Error('sync/watch 대상은 claude 또는 codex입니다.');
    // A member server gets one uploader per computer, shared with the Claude/Codex sessions and their saved cursors.
    const { uploadUsage } = await import('../src/remote.js');
    const scan = async () => config.remote
      ? await uploadUsage(config, collector, state.player.id, argument) ?? { skipped: '이 컴퓨터의 다른 세션이 사용량을 보내는 중이에요.' }
      : await collector.scan(argument);
    console.log(JSON.stringify(await scan()));
    if (command === 'watch') setInterval(async () => { await scan(); }, 10000);
  } else if (command === 'open') {
    if ((argument && argument !== 'dex') || process.argv.length > 4) throw new Error('사용법: tokenpet open [dex]');
    const url = configuration().baseUrl + (argument === 'dex' ? '/#dex' : '');
    const openCommand = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const child = spawn(openCommand, [url], { stdio: 'ignore' });
    child.on('error', () => console.log(url));
  } else if (command === 'status') {
    console.log(statusText(await request('/api/state')));
  } else if (command === 'checkin') {
    if (process.argv.length > 3) throw new Error('사용법: tokenpet checkin');
    const result = await request('/api/checkin', {});
    console.log(`${result.message}\n${statusText(result.state)}`);
  } else if (['feed', 'play', 'clean', 'sleep', 'wake'].includes(command)) {
    const result = await request('/api/care', { action: command });
    console.log(result.message + '\n' + statusText(result.state));
  } else if (command === 'gacha') {
    const count = argument === undefined ? 1 : Number(argument);
    if (process.argv.length > 4 || !Number.isSafeInteger(count) || count < 1) throw new Error('사용법: tokenpet gacha [1 이상의 정수]');
    const result = await request('/api/gacha', { count });
    for (const p of result.results) console.log(`${p.isNew ? 'NEW' : '중복 +25 XP'} · ${p.name} [${p.tier}]`);
    console.log(`잔액 ${result.state.player.coins} C`);
  } else if (command === 'list' || command === 'dex') {
    const state = await request('/api/state');
    const args = process.argv.slice(3);
    const tier = state.tiers.find(t => t.id === args[0])?.id;
    if (tier) args.shift();
    if (args.length > 1) throw new Error('사용법: tokenpet list [등급] [페이지] (dex 별칭)');
    console.log(dexText(state, { tier, page: args[0] === undefined ? 1 : Number(args[0]), color: process.stdout.isTTY && !process.env.NO_COLOR }));
    console.log(`웹 미리보기: ${configuration().baseUrl}/#dex`);
  } else if (command === 'equip') {
    console.log(statusText((await request('/api/equip', { id: argument })).state));
  } else if (command === 'name') {
    console.log((await request('/api/profile', { name: process.argv.slice(3).join(' ') })).state.player.name);
  } else if (command === 'share') {
    const result = await request('/api/share', { enabled: argument !== 'off' });
    console.log(result.path ? `${configuration().publicUrl || configuration().baseUrl}${result.path}` : '공유 링크를 비활성화했습니다.');
  } else if (command === 'export') {
    if (!argument) throw new Error('저장할 HTML 파일 경로를 지정해 주세요.');
    const s = await request('/api/state');
    writeFileSync(argument, collectionHTML({ name: s.player.name, pets: s.pets, catalog: s.catalog, tiers: s.tiers }), { flag: 'wx' });
    console.log(`도감을 저장했습니다: ${argument}`);
  } else if (command === 'doctor') {
    const s = await request('/api/state');
    for (const cli of ['claude', 'codex']) {
      try { console.log(execFileSync(...cliInvocation(cliExecutable(cli), ['--version']), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()); }
      catch { console.log(`${cli}: 찾을 수 없음`); }
    }
    console.log(`연결: ${configuration().baseUrl} · ${configuration().remote ? '서버 모드' : '로컬 모드'}`);
    console.log(`서버 정상 · ${s.catalog.length}종 · 수집 파일 ${s.collector.files}개 · 읽기 오류 ${s.collector.errors}개`);
  } else if (command === 'uninstall') {
    if ((argument && argument !== '--purge') || process.argv.length > 4) throw new Error('사용법: tokenpet uninstall [--purge]');
    console.log(await (await import('../src/uninstall.js')).uninstall({ purge: argument === '--purge' }));
  } else if (['help', '--help', '-h'].includes(command)) {
    console.log(`TokenPet\n\n설치 후 평소처럼 codex 또는 claude를 실행하세요. 서버와 펫이 자동 연결됩니다.\nCLI 안의 전용 명령: Claude /pet · Codex $pet (예: help, list, feed, gacha 1)\n\n  server          백엔드 + 웹 + 토큰 자동 수집 (수동 실행)\n  codex-pet       현재 펫을 Codex 내장 /pets에 등록\n  ui              독립 터미널 펫 화면\n  status          현재 펫·출석 현황\n  checkin         오늘 출석 보상 받기 (CLI 시작 시 자동)\n  feed/play/clean/sleep/wake\n  gacha [횟수]    1 이상의 정수 · 전체 비용 부족 시 중지 (기본 1회)\n  list [등급] [페이지]  보유 펫 썸네일·수면·돌봄 상태 (dex 별칭)\n  equip <id>      함께할 펫 선택 (무료 · 수면 상태 유지)\n  name <이름>     작업실 이름\n  share [off]     도감 공유 켜기/끄기\n  export <file>   공유용 독립 HTML 저장\n  connect [local|주소]  로컬 / 서버 연결 선택\n  setup           자동 연결 재설치/복구 (install 별칭)\n  uninstall [--purge]  연결 해제·프로그램 삭제 (--purge: 게임 데이터까지)\n  sync [claude|codex]  사용량 동기화\n  watch           원격 서버용 로컬 사용량 수집기\n  open [dex]      웹 작업실 / 캐릭터 미리보기\n  doctor          연결 진단\n\n서로 다른 CLI 사용량은 각각 보상합니다. 게임 자체는 모델 API를 호출하지 않습니다.`);
  } else throw new Error('알 수 없는 명령입니다. tokenpet help를 확인해 주세요.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (command !== 'statusline') process.exitCode = 1;
}
