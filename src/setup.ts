import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { configuration } from './config.js';
import { ensureServer } from './runtime.js';
import { request } from './client.js';
import { installCodexPet, selectCodexPet } from './codex-pet.js';
import { cliExecutable, cliInvocation, installLaunchers } from './cli-install.js';
import { shellQuote } from './shell-install.js';
import { commandConflicts, installCommands } from './command-install.js';
import { windowsStatusline, isWindowsStatusline } from './windows.js';

export { shellQuote } from './shell-install.js';
export const isManagedStatusline = (command = '') => /tokenpet\.mjs['"]?\s+statusline/.test(command) || isWindowsStatusline(command);
const pathsFile = (dataDir: string) => join(dataDir, 'install-paths.json');
export function installPaths(dataDir: string): { claude: string[]; codex: string[] } {
  try { const saved = JSON.parse(readFileSync(pathsFile(dataDir), 'utf8')); return { claude: saved.claude || [], codex: saved.codex || [] }; }
  catch { return { claude: [], codex: [] }; }
}

// Ask before replacing someone else's file. Without a terminal only TOKENPET_OVERWRITE=1 allows it.
async function allowOverwrite(question: string) {
  if (process.env.TOKENPET_OVERWRITE === '1') return true;
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try { return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim()); }
  finally { prompt.close(); }
}

export async function setup() {
  const config = configuration();
  const bin = fileURLToPath(new URL('../bin/tokenpet.mjs', import.meta.url));
  const backupDir = join(config.dataDir, 'backups', Date.now().toString());
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const codexRoot = process.env.CODEX_HOME || join(homedir(), '.codex');
  // Uninstall cleans these folders even when its shell points elsewhere.
  const saved = installPaths(config.dataDir);
  writeFileSync(pathsFile(config.dataDir), JSON.stringify({ claude: [...new Set([...saved.claude, claudeRoot])], codex: [...new Set([...saved.codex, codexRoot])] }, null, 2) + '\n', { mode: 0o600 });
  const files = [join(codexRoot, 'config.toml'), join(homedir(), '.claude.json'), join(claudeRoot, 'settings.json')];
  files.forEach((path, i) => { if (existsSync(path)) writeFileSync(join(backupDir, `${i}-${basename(path)}`), readFileSync(path), { mode: 0o600 }); });
  const messages = [];
  const conflicts = commandConflicts({ claudeRoot, codexRoot });
  if (!conflicts.length || await allowOverwrite(`같은 이름의 명령 파일이 이미 있어요.\n${conflicts.join('\n')}\n백업한 뒤 TokenPet 명령으로 덮어쓸까요?`))
    installCommands({ claudeRoot, codexRoot, backupDir, overwrite: true });
  else messages.push(`전용 명령 /pet · $pet 설치를 건너뛰었습니다. 덮어쓰려면 TOKENPET_OVERWRITE=1 tokenpet setup을 실행하세요: ${conflicts.join(', ')}`);
  const variables: Record<string, string> = { TOKENPET_DATA_DIR: config.dataDir };
  for (const name of ['TOKENPET_SERVER', 'TOKENPET_PORT', 'NODE_EXTRA_CA_CERTS']) if (process.env[name]) variables[name] = process.env[name]!;
  const environment = Object.entries(variables).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
  for (const cli of ['claude', 'codex']) {
    let executable;
    try { executable = cliExecutable(cli); }
    catch { messages.push(`${cli}: 공식 CLI가 설치되지 않아 MCP 등록을 건너뛰었습니다.`); continue; }
    let previous;
    try { previous = execFileSync(...cliInvocation(executable, ['mcp', 'get', 'tokenpet']), { encoding: 'utf8', stdio: 'pipe', timeout: 10000, windowsHide: true }); } catch {}
    if (previous && !previous.includes('tokenpet.mjs') && !await allowOverwrite(`${cli}: tokenpet이라는 이름의 다른 MCP가 이미 있어요. TokenPet 연결로 바꿀까요?`)) {
      messages.push(`${cli}: 같은 이름의 다른 MCP가 있어 MCP 등록을 건너뛰었습니다.`); continue;
    }
    if (previous) {
      try { execFileSync(...cliInvocation(executable, ['mcp', 'remove', ...(cli === 'claude' ? ['--scope', 'user'] : []), 'tokenpet']), { stdio: 'pipe', timeout: 10000, windowsHide: true }); }
      catch { throw new Error(`${cli}: 이전 tokenpet 연결을 갱신하지 못했어요. 설정 백업: ${backupDir}`); }
    }
    const args = cli === 'claude' ? ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'tokenpet', ...environment, '--', process.execPath, bin, 'mcp']
      : ['mcp', 'add', 'tokenpet', ...environment, '--', process.execPath, bin, 'mcp'];
    try { execFileSync(...cliInvocation(executable, args), { stdio: 'pipe', timeout: 15000, windowsHide: true }); messages.push(`${cli}: MCP 연결을 등록했습니다.`); }
    catch { throw new Error(`${cli}: MCP 등록에 실패했어요. 설정 백업: ${backupDir}`); }
  }
  const settingsPath = join(claudeRoot, 'settings.json');
  mkdirSync(claudeRoot, { recursive: true });
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  const prefix = Object.entries(variables).map(([name, value]) => `${name}=${shellQuote(value)} `).join('');
  const command = process.platform === 'win32' ? windowsStatusline(process.execPath, bin, variables)
    : `${prefix}${shellQuote(process.execPath)} ${shellQuote(bin)} statusline`;
  const previousPath = join(config.dataDir, 'previous-statusline.json');
  const managed = isManagedStatusline(settings.statusLine?.command);
  const previous = settings.statusLine && !managed ? settings.statusLine : existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : undefined;
  const refreshInterval = Math.max(previous ? 5 : 2, Number(previous?.refreshInterval) || 0, Number(settings.statusLine?.refreshInterval) || 0);
  const statusLine = { ...previous, ...settings.statusLine, type: 'command', command, refreshInterval };
  if (JSON.stringify(settings.statusLine) !== JSON.stringify(statusLine)) {
    if (settings.statusLine && !managed) writeFileSync(previousPath, JSON.stringify(settings.statusLine), { mode: 0o600 });
    settings.statusLine = statusLine;
    const temporary = `${settingsPath}.tokenpet-${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, settingsPath);
  }
  installLaunchers({ config, bin, backupDir });
  await ensureServer(config);
  installCodexPet(await request('/api/state'));
  let codex;
  try { codex = cliExecutable('codex'); } catch {}
  if (codex) await selectCodexPet(codex);
  messages.push(`Claude 내부 상태줄에 펫을 추가했습니다. ${refreshInterval}초마다 갱신하며 기존 상태줄은 함께 표시됩니다.`);
  messages.push('전용 명령: Claude /pet · Codex $pet (예: help, list, feed, gacha 1).');
  messages.push(`설정 백업: ${backupDir}`);
  messages.push('설치 완료. 지금 터미널에서 평소처럼 codex 또는 claude를 실행하세요. 펫과 서버가 자동으로 연결됩니다.');
  return messages.join('\n');
}
