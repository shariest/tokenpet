import type { Configuration } from './types.js';

interface LaunchEntry { cli: string; path: string; original: string }
interface Registry { bin: string; node: string; env: Record<string, string>; entries: LaunchEntry[] }

import { accessSync, constants, existsSync, openSync, readSync, closeSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, rmSync, copyFileSync, lstatSync, statSync, readlinkSync, symlinkSync } from 'node:fs';
import { delimiter, dirname, basename, join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configuration } from './config.js';
import { shellQuote } from './shell-install.js';

const marker = '# >>> tokenpet >>>';
const header = `#!/bin/sh\n${marker}\n# tokenpet-original: `;
const registryPath = (config: Configuration) => join(config.dataDir, 'cli-launchers.json');

function original(path: string) {
  const fd = openSync(path, 'r');
  let text;
  try { const bytes = Buffer.alloc(8192); text = bytes.subarray(0, readSync(fd, bytes)).toString(); }
  finally { closeSync(fd); }
  if (!text.startsWith(header)) return null;
  const executable = JSON.parse(text.slice(header.length).split('\n')[0]);
  if (typeof executable !== 'string' || !isAbsolute(executable) || executable === resolve(path)) throw new Error(`CLI 연결이 손상됐어요: ${path}`);
  if (existsSync(executable)) {
    const launcher = statSync(path), source = statSync(executable);
    if (launcher.dev === source.dev && launcher.ino === source.ino) throw new Error(`CLI 연결이 손상됐어요: ${path}`);
  }
  return executable;
}

function entries(cli: string, shimDir: string, path: string, platform = process.platform) {
  if (!['codex', 'claude'].includes(cli)) throw new Error('지원하지 않는 CLI예요.');
  const extensions = platform === 'win32' ? ['.exe', '.cmd'] : [''];
  return [...new Set(path.split(platform === 'win32' ? ';' : delimiter).flatMap(directory => extensions.map(extension => resolve(directory || '.', cli + extension))))].filter(candidate => {
    if (candidate === join(shimDir, cli)) return false;
    try { accessSync(candidate, constants.X_OK); return statSync(candidate).isFile(); } catch { return false; }
  });
}

export function cliExecutable(cli: string, shimDir = join(configuration().dataDir, 'bin'), path = process.env.PATH || '', platform = process.platform) {
  for (const entry of entries(cli, shimDir, path, platform)) {
    let executable = original(entry) || entry;
    if (platform === 'win32' && /\.cmd$/i.test(entry)) {
      // Run official npm entrypoints directly; cmd.exe would reinterpret user arguments.
      const directory = join(dirname(entry), 'node_modules', cli === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code');
      try {
        const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        executable = resolve(directory, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[cli]);
      } catch { continue; }
    }
    try { accessSync(executable, constants.X_OK); return executable; } catch {}
  }
  throw new Error(`${cli} CLI를 찾을 수 없어요. 먼저 공식 CLI를 설치해 주세요.`);
}

export function cliInvocation(executable: string, args: string[]): [string, string[]] {
  return /\.[cm]?js$/i.test(executable) ? [process.execPath, [executable, ...args]] : [executable, args];
}

function atomicWrite(path: string, content: string, mode: number) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, content, { mode, flag: 'wx' }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

function script(cli: string, executable: string, registry: Registry) {
  // The current terminal's hint takes precedence, including an explicit empty value.
  const prefix = Object.entries(registry.env).map(([key, value]) => key === 'ORCA_IMAGE_PROTOCOL'
    ? `${key}=\${ORCA_IMAGE_PROTOCOL-${shellQuote(value)}} `
    : `${key}=${shellQuote(value)} `).join('');
  return `${header}${JSON.stringify(executable)}\nif [ -x ${shellQuote(registry.node)} ] && [ -f ${shellQuote(registry.bin)} ]; then\n  ${prefix}TOKENPET_ORIGINAL_${cli.toUpperCase()}=${shellQuote(executable)} exec ${shellQuote(registry.node)} ${shellQuote(registry.bin)} launch ${cli} "$@"\nfi\nexec ${shellQuote(executable)} "$@"\n# <<< tokenpet <<<\n`;
}

function accessible(cli: string, path: string, mode: number, owned = true) {
  let reason;
  try {
    const uid = process.getuid?.();
    if (owned && uid !== undefined && [lstatSync(path), statSync(path)].some(info => info.uid !== uid)) reason = '현재 사용자 소유가 아닙니다';
    else accessSync(path, mode);
  } catch (error) {
    if (!['EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    reason = '읽기 또는 쓰기 권한이 없습니다';
  }
  if (!reason) return true;
  console.warn(`${cli}: 자동 연결을 건너뛰었습니다: ${path} (${reason}). 사용자 소유의 쓰기 가능한 CLI를 PATH에 추가한 뒤 tokenpet setup을 다시 실행하세요.`);
  return false;
}

function installEntry(cli: string, path: string, registry: Registry) {
  if (!accessible(cli, path, constants.R_OK | constants.W_OK) || !accessible(cli, dirname(path), constants.W_OK | constants.X_OK, false)) return null;
  const info = lstatSync(path);
  let executable = original(path);
  let preserve = false;
  if (!executable) {
    if (info.isSymbolicLink()) executable = resolve(dirname(path), readlinkSync(path));
    else {
      executable = join(dirname(path), `.tokenpet-original-${basename(path)}`);
      if (existsSync(executable) && !registry.entries.some(entry => entry.path === path && entry.original === executable)) throw new Error(`기존 파일을 덮어쓸 수 없어요: ${executable}`);
      preserve = true;
    }
  }
  // Keep npm's command symlink inside its own package so CLI updates remain allowed.
  const target = info.isSymbolicLink() ? `${executable}.tokenpet-launcher` : path;
  if ((!preserve || existsSync(executable)) && !accessible(cli, executable, constants.R_OK | constants.W_OK)) return null;
  if (!accessible(cli, dirname(target), constants.W_OK | constants.X_OK, false)) return null;
  const content = script(cli, executable, registry);
  if (existsSync(target) && !accessible(cli, target, constants.R_OK)) return null;
  const managed = existsSync(target) && original(target);
  if (target !== path && existsSync(target) && !managed) throw new Error(`기존 파일을 덮어쓸 수 없어요: ${target}`);
  if (existsSync(target) && !accessible(cli, target, constants.W_OK)) return null;
  accessSync(preserve ? path : executable, constants.X_OK);
  if (preserve) {
    const temporary = `${executable}.${randomUUID()}.tmp`;
    try { copyFileSync(path, temporary, constants.COPYFILE_EXCL); renameSync(temporary, executable); }
    finally { rmSync(temporary, { force: true }); }
  }
  if (!managed || readFileSync(target, 'utf8') !== content) atomicWrite(target, content, statSync(executable).mode & 0o777);
  if (info.isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) !== target) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { symlinkSync(target, temporary); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
  }
  return { cli, path, original: executable };
}

function updateEntry(registry: Registry, entry: LaunchEntry) {
  const index = registry.entries.findIndex(previous => previous.path === entry.path);
  if (index < 0) registry.entries.push(entry); else registry.entries[index] = entry;
}

export function installLaunchers({ config, bin, backupDir, env = process.env }: { config: Configuration; bin: string; backupDir: string; env?: NodeJS.ProcessEnv }) {
  // Windows executables stay intact; the registered MCP starts the server for either CLI.
  if (process.platform === 'win32') return [];
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const file = registryPath(config);
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const registry: Registry = { bin, node: process.execPath, env: { TOKENPET_DATA_DIR: config.dataDir }, entries: previous?.entries || [] };
  for (const key of ['TOKENPET_SERVER', 'TOKENPET_PORT', 'NODE_EXTRA_CA_CERTS']) if (env[key]) registry.env[key] = env[key]!;
  const imageHint = env.ORCA_IMAGE_PROTOCOL ?? previous?.env?.ORCA_IMAGE_PROTOCOL;
  if (imageHint !== undefined) registry.env.ORCA_IMAGE_PROTOCOL = imageHint;
  const shimDir = join(config.dataDir, 'bin');
  const paths = ['codex', 'claude'].flatMap(cli => entries(cli, shimDir, env.PATH || '').map(path => ({ cli, path })));
  for (const { cli, path } of registry.entries) if (existsSync(path) && !paths.some(entry => entry.path === path)) paths.push({ cli, path });
  writeFileSync(join(backupDir, 'cli-entrypoints.json'), JSON.stringify(paths.map(({ cli, path }) => ({ cli, path, link: lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null })), null, 2), { mode: 0o600 });
  const installed = [];
  for (const { cli, path } of paths) {
    const entry = installEntry(cli, path, registry);
    if (!entry) continue;
    updateEntry(registry, entry);
    installed.push({ cli, path });
    atomicWrite(file, JSON.stringify(registry, null, 2) + '\n', 0o600);
  }
  atomicWrite(file, JSON.stringify(registry, null, 2) + '\n', 0o600);
  return installed;
}

export function repairLaunchers(config: Configuration) {
  if (process.platform === 'win32') return;
  const file = registryPath(config);
  if (!existsSync(file)) return;
  const registry = JSON.parse(readFileSync(file, 'utf8')) as Registry;
  if (!existsSync(registry.bin) || !existsSync(registry.node)) return;
  let changed = false;
  for (const { cli, path } of [...registry.entries]) {
    if (!existsSync(path)) continue;
    if (!accessible(cli, path, constants.R_OK | constants.W_OK) || !accessible(cli, dirname(path), constants.W_OK | constants.X_OK, false) || original(path)) continue;
    const entry = installEntry(cli, path, registry);
    if (!entry) continue;
    updateEntry(registry, entry);
    changed = true;
  }
  if (changed) atomicWrite(file, JSON.stringify(registry, null, 2) + '\n', 0o600);
}

export function removeLaunchers(config: Configuration) {
  const file = registryPath(config);
  if (process.platform === 'win32' || !existsSync(file)) return [];
  const registry = JSON.parse(readFileSync(file, 'utf8')) as Registry;
  // Forget the launchers first so a running server's repair loop cannot reinstall them.
  rmSync(file);
  const ours = (path: string) => { try { return original(path); } catch { return null; } };
  const restored = [];
  for (const { cli, path, original: executable } of registry.entries) {
    let info;
    try { info = lstatSync(path); } catch { continue; }
    if (info.isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) === `${executable}.tokenpet-launcher`) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { symlinkSync(executable, temporary); renameSync(temporary, path); }
      finally { rmSync(temporary, { force: true }); }
      restored.push({ cli, path });
    } else if (info.isFile() && ours(path) === executable && existsSync(executable)) {
      renameSync(executable, path);
      restored.push({ cli, path });
    }
    // Launchers left beside earlier versions of the same CLI are ours too.
    let siblings: string[] = [];
    try { siblings = readdirSync(dirname(executable)); } catch {}
    for (const name of siblings) {
      const candidate = join(dirname(executable), name);
      if (name.endsWith('.tokenpet-launcher') && ours(candidate)) rmSync(candidate, { force: true });
    }
  }
  return restored;
}
