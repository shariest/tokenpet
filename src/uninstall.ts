import type { Configuration } from './types.js';

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration } from './config.js';
import { request } from './client.js';
import { cliExecutable, cliInvocation, removeLaunchers } from './cli-install.js';
import { removeCommands } from './command-install.js';
import { clearCodexPet, removeCodexPet } from './codex-pet.js';
import { installPaths, isManagedStatusline } from './setup.js';
import { powershell, powershellQuote, powershellTimeout } from './windows.js';

export async function uninstall({ purge = false } = {}) {
  if (process.env.TOKENPET_PUBLIC_URL) throw new Error('회원 서버에서는 uninstall을 쓸 수 없어요. Docker 서버는 docker compose down으로 정리하세요.');
  const config = configuration();
  const claudeDefault = join(homedir(), '.claude'), codexDefault = join(homedir(), '.codex');
  const saved = installPaths(config.dataDir);
  // Setup may have run with another CLAUDE_CONFIG_DIR/CODEX_HOME than this shell, so clean every recorded folder.
  const claudeRoots = [...new Set([...saved.claude, process.env.CLAUDE_CONFIG_DIR || claudeDefault].map(path => resolve(path)))];
  const codexRoots = [...new Set([...saved.codex, process.env.CODEX_HOME || codexDefault].map(path => resolve(path)))];
  const messages: string[] = [];
  const codexEnv = (root: string) => ({ ...process.env, CODEX_HOME: root === codexDefault ? undefined : root });
  // `claude mcp get` health-checks by starting the MCP, which starts the server again, so unregister before stopping it.
  for (const root of claudeRoots)
    if (removeMcp('claude', { ...process.env, CLAUDE_CONFIG_DIR: root === claudeDefault ? undefined : root })) messages.push(`claude: MCP 연결을 해제했습니다. ${root}`);
  for (const root of codexRoots) if (removeMcp('codex', codexEnv(root))) messages.push(`codex: MCP 연결을 해제했습니다. ${root}`);
  if (!config.remote && await stopServer(config)) messages.push('로컬 서버를 종료했습니다.');
  for (const { cli, path } of removeLaunchers(config)) messages.push(`${cli}: 원래 실행 파일로 되돌렸습니다. ${path}`);
  for (const root of claudeRoots) {
    if (restoreStatusline(root, config.dataDir)) messages.push(`Claude 상태줄을 설치 전으로 되돌렸습니다. ${root}`);
    for (const path of removeCommands({ claudeRoot: root })) messages.push(`전용 명령을 삭제했습니다. ${path}`);
  }
  for (const root of codexRoots) {
    const env = codexEnv(root);
    for (const path of removeCommands({ codexRoot: root })) messages.push(`전용 명령을 삭제했습니다. ${path}`);
    if (codexPetSelected(root)) {
      try { await clearCodexPet(cliExecutable('codex'), env); messages.push(`Codex 펫 선택을 해제했습니다. ${root}`); }
      catch { messages.push(`Codex 펫 선택을 해제하지 못했어요. ${join(root, 'config.toml')}의 tui.pet을 지워 주세요.`); }
    }
    if (removeCodexPet(root)) messages.push(`Codex 펫 파일을 삭제했습니다. ${root}`);
  }
  messages.push(removeProgram());
  messages.push(purge ? removeData(config.dataDir) : `게임 데이터는 남겨 두었습니다: ${config.dataDir} (다시 설치하면 이어서 키울 수 있어요)`);
  messages.push('삭제 완료. 실행 중인 Claude·Codex는 다시 시작해 주세요.');
  return messages.join('\n');
}

async function stopServer(config: Configuration) {
  let pid;
  try { ({ pid } = await request('/api/shutdown', {}, { config, timeout: 2000 })); } catch { return false; }
  for (let i = 0; i < 50; i++) {
    // Wait for the process itself when it is known: Windows cannot delete files a closing server still holds.
    if (pid) { try { process.kill(pid, 0); } catch { return true; } }
    else { try { await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return true; } }
    await delay(100);
  }
  return true;
}

function removeMcp(cli: string, env: NodeJS.ProcessEnv) {
  let executable;
  try { executable = cliExecutable(cli); } catch { return false; }
  const run = (args: string[]) => execFileSync(...cliInvocation(executable, args), { env, encoding: 'utf8', stdio: 'pipe', timeout: 10000, windowsHide: true });
  try { if (!run(['mcp', 'get', 'tokenpet']).includes('tokenpet.mjs')) return false; } catch { return false; }
  run(['mcp', 'remove', ...(cli === 'claude' ? ['--scope', 'user'] : []), 'tokenpet']);
  return true;
}

function restoreStatusline(claudeRoot: string, dataDir: string) {
  const path = join(claudeRoot, 'settings.json');
  let settings;
  try { settings = JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
  if (!isManagedStatusline(settings.statusLine?.command)) return false;
  const previous = join(dataDir, 'previous-statusline.json');
  if (existsSync(previous)) settings.statusLine = JSON.parse(readFileSync(previous, 'utf8'));
  else delete settings.statusLine;
  const temporary = `${path}.tokenpet-${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
  return true;
}

function codexPetSelected(codexRoot: string) {
  try { return /^\s*pet\s*=\s*"custom:tokenpet"\s*$/m.test(readFileSync(join(codexRoot, 'config.toml'), 'utf8')); } catch { return false; }
}

const keepProgram = 'npm이나 소스 폴더에서 실행 중이라 프로그램 파일은 그대로 두었습니다. npm으로 설치했다면 npm rm -g tokenpet을 실행하세요.';

function removeProgram() {
  const release = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  if (process.platform === 'win32') {
    // install.ps1 layout: <root>\releases\<32 hex>
    if (!/^[0-9a-f]{32}$/.test(basename(release)) || basename(dirname(release)) !== 'releases') return keepProgram;
    const root = dirname(dirname(release));
    try { scheduleWindowsCleanup(root); } catch { return `프로그램 폴더를 자동으로 지우지 못했어요. 터미널을 닫은 뒤 직접 삭제해 주세요: ${root}`; }
    return `프로그램 폴더는 이 명령이 끝나면 삭제됩니다: ${root} (남아 있으면 %TEMP%\\tokenpet-uninstall.log를 확인하세요)`;
  }
  // install.sh layout: <root>/releases/install.XXXXXX/installed
  const root = dirname(dirname(dirname(release)));
  if (basename(release) !== 'installed' || !/^install\.\w{6}$/.test(basename(dirname(release))) || basename(dirname(dirname(release))) !== 'releases' || !existsSync(join(root, 'current')))
    return keepProgram;
  const directories = new Set([...(process.env.PATH || '').split(delimiter), join(homedir(), '.local', 'bin'), process.env.TOKENPET_BIN_DIR || '']);
  for (const directory of directories) {
    const command = join(directory, 'tokenpet');
    try { if (directory && readFileSync(command, 'utf8').includes('# TokenPet launcher')) rmSync(command); } catch {}
  }
  rmSync(root, { recursive: true, force: true });
  return `프로그램을 삭제했습니다: ${root}`;
}

function scheduleWindowsCleanup(root: string) {
  // Windows keeps a running program locked, so a separate PowerShell removes it after this process exits.
  // PATH entries are dropped only when TokenPet's launcher was the last thing in them.
  const script = `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$root = ${powershellQuote(root)}
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @(if ($path) { $path -split ';' | Where-Object { $_ } })
$owned = @($entries | Where-Object { $file = Join-Path $_ 'tokenpet.cmd'; (Test-Path -LiteralPath $file) -and ((Get-Content -LiteralPath $file -Raw) -match 'rem TokenPet launcher') })
foreach ($dir in $owned) { Remove-Item -LiteralPath (Join-Path $dir 'tokenpet.cmd') -Force -ErrorAction SilentlyContinue }
for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath $root); $i++) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue -ErrorVariable failure; Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath $root) { Add-Content -LiteralPath (Join-Path ([IO.Path]::GetTempPath()) 'tokenpet-uninstall.log') -Value "$(Get-Date -Format o) $root $($failure | Select-Object -First 3)" }
$gone = @($owned | Where-Object { -not (Test-Path -LiteralPath $_) -or -not (Get-ChildItem -LiteralPath $_ -Force | Select-Object -First 1) })
foreach ($dir in $gone) { if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue } }
if ($gone.Count) { [Environment]::SetEnvironmentVariable('Path', (($entries | Where-Object { $gone -notcontains $_ }) -join ';'), 'User') }`;
  // A detached PowerShell has no console and quits before running, so a short-lived one starts it with Start-Process.
  // Node only ends its own children on exit, not processes they start.
  const [command, args] = powershell(script);
  execFileSync(...powershell(`Start-Process -WindowStyle Hidden -FilePath ${powershellQuote(command)} -ArgumentList ${args.map(powershellQuote).join(',')}`), { stdio: 'ignore', timeout: powershellTimeout, windowsHide: true });
}

function removeData(dataDir: string) {
  const directory = resolve(dataDir);
  const ours = ['game.sqlite', 'api-key', 'connection.json', 'install-paths.json'].some(name => existsSync(join(directory, name)));
  if (!ours || directory === resolve(homedir()) || dirname(directory) === directory) return `게임 데이터 폴더로 확인되지 않아 남겨 두었습니다: ${directory}`;
  // Windows reports EPERM while a just-stopped server or a virus scan still holds a file; retry before giving up.
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (error) { return `게임 데이터를 지우지 못했어요: ${directory} (${error instanceof Error ? error.message : String(error)}). 사용 중인 Claude·Codex를 닫고 다시 실행해 주세요.`; }
  return `게임 데이터를 삭제했습니다: ${directory}`;
}
