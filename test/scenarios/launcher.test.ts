import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';

import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../dist/src/server.js';
import { configuration, credential } from '../../dist/src/config.js';
import { repairLaunchers } from '../../dist/src/cli-install.js';

const execute = promisify(execFile);
const unix = process.platform !== 'win32';
const pty = `import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
try:
    while True:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
finally:
    os.close(fd)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "tokenpet scenario's-"));
  const native = join(dir, 'bin'), vendor = join(dir, 'vendor'), readOnly = join(dir, 'read-only');
  for (const path of [native, vendor, readOnly]) mkdirSync(path);
  const log = join(dir, 'mcp.log');
  const mock = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
  process.exit(args[1] === 'get' ? 1 : 0);
} else if (args[0] === 'app-server') {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    const request = JSON.parse(line);
    if (request.id) console.log(JSON.stringify({ id: request.id, result: request.id === 2 ? { status: 'ok' } : {} }));
  });
} else {
  console.log('SCENARIO_NATIVE ' + JSON.stringify({ args, term: process.env.TERM, program: process.env.TERM_PROGRAM,
    hint: process.env.ORCA_IMAGE_PROTOCOL, tty: !!process.stdin.isTTY && !!process.stdout.isTTY }));
  process.exit(17);
}
`;
  for (const cli of ['codex', 'claude']) {
    writeFileSync(join(vendor, `${cli}.mjs`), mock, { mode: 0o700 });
    symlinkSync(join(vendor, `${cli}.mjs`), join(native, cli));
  }
  copyFileSync(join(vendor, 'codex.mjs'), join(readOnly, 'codex'));
  chmodSync(readOnly, 0o555);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, ZDOTDIR: dir, PATH: `${readOnly}:${native}:/usr/bin:/bin`,
    TOKENPET_DATA_DIR: join(dir, 'game'), TOKENPET_WATCH: '0', CODEX_HOME: join(dir, 'codex'),
    CLAUDE_CONFIG_DIR: join(dir, 'claude'), TERM: 'xterm-256color', TERM_PROGRAM: 'Orca', ORCA_IMAGE_PROTOCOL: 'kitty' };
  for (const key of ['TOKENPET_SERVER', 'TOKENPET_API_KEY', 'TOKENPET_API_KEY_FILE', 'TOKENPET_PUBLIC_URL', 'TOKENPET_HOST',
    'TOKENPET_ORIGINAL_CODEX', 'TOKENPET_ORIGINAL_CLAUDE', 'TOKENPET_PORT']) delete env[key];
  const config = configuration(env);
  const app = await startServer(config, { port: 0 });
  env.TOKENPET_PORT = String((app.server.address() as AddressInfo).port);
  env.TOKENPET_SERVER = app.url;
  env.TOKENPET_API_KEY = credential(config);
  t.after(async () => { await app.close(); chmodSync(readOnly, 0o700); rmSync(dir, { recursive: true, force: true }); });
  const launch = async (cli: string, args: string[], tty: boolean, values = env) => {
    const command = join(native, cli);
    let result: { code?: string | number | null; stdout: string; stderr: string };
    const executable = tty ? 'python3' : command;
    const arguments_ = !tty ? args : ['-c', pty, command, ...args];
    try { result = await execute(executable, arguments_, { env: values, timeout: 15000 }); }
    catch (error) { result = error as typeof result; assert.equal(result.code, 17, result.stderr); }
    assert.equal(result.code, 17, 'native exit status must reach the caller');
    const match = /SCENARIO_NATIVE (\{[^\r\n]+\})/.exec(result.stdout);
    assert.ok(match, result.stderr);
    return { child: JSON.parse(match[1]), stderr: result.stderr, output: result.stdout };
  };
  return { dir, native, vendor, readOnly, log, config, app, env, launch };
}

test('full setup skips read-only CLI, registers MCP, then saved Orca hint survives update/repair and PTY launch', { skip: !unix }, async t => {
  const { dir, native, vendor, readOnly, log, config, app, env, launch } = await fixture(t);
  const systemBefore = readFileSync(join(readOnly, 'codex'));
  const previousStatus = { type: 'command', command: 'echo existing HUD', padding: 1, hideVimModeIndicator: true, refreshInterval: 7 };
  const agentStatus = { type: 'command', command: 'echo existing agents' };
  mkdirSync(join(dir, 'claude'));
  writeFileSync(join(dir, 'claude/settings.json'), JSON.stringify({ statusLine: previousStatus, subagentStatusLine: agentStatus }));
  const setup = await execute(process.execPath, [resolve('bin/tokenpet.mjs'), 'setup'], { env, timeout: 20000 });
  assert.match(setup.stdout + setup.stderr, /건너|skip/i, 'setup reports the CLI it cannot change');
  assert.match(setup.stdout, /설치 완료/);
  assert.deepEqual(readFileSync(join(readOnly, 'codex')), systemBefore);
  assert.ok(!existsSync(join(readOnly, '.tokenpet-original-codex')));
  const registry = JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8'));
  assert.equal(registry.env.ORCA_IMAGE_PROTOCOL, 'kitty');
  assert.deepEqual(registry.entries.map((entry: { path: string }) => entry.path).sort(), ['claude', 'codex'].map(cli => join(native, cli)).sort());
  const registrations = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(registrations.filter(args => args[1] === 'add').length, 2);
  assert.equal(JSON.parse(readFileSync(join(dir, 'claude/settings.json'), 'utf8')).statusLine.refreshInterval, 7);
  const settings = JSON.parse(readFileSync(join(dir, 'claude/settings.json'), 'utf8'));
  assert.equal(settings.statusLine.padding, 1);
  assert.equal(settings.statusLine.hideVimModeIndicator, true);
  assert.deepEqual(settings.subagentStatusLine, agentStatus);
  assert.deepEqual(JSON.parse(readFileSync(join(config.dataDir, 'previous-statusline.json'), 'utf8')), previousStatus);
  writeFileSync(join(dir, 'claude/settings.json'), JSON.stringify({ ...settings, statusLine: { type: 'command', command: settings.statusLine.command, refreshInterval: 2 } }));
  const withoutHint = { ...env }; delete withoutHint.ORCA_IMAGE_PROTOCOL;
  await execute(process.execPath, [resolve('bin/tokenpet.mjs'), 'setup'], { env: withoutHint, timeout: 20000 });
  assert.equal(JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8')).env.ORCA_IMAGE_PROTOCOL, 'kitty');
  const restored = JSON.parse(readFileSync(join(dir, 'claude/settings.json'), 'utf8'));
  assert.equal(restored.statusLine.padding, 1);
  assert.equal(restored.statusLine.hideVimModeIndicator, true);
  assert.equal(restored.statusLine.refreshInterval, 7);
  assert.deepEqual(restored.subagentStatusLine, agentStatus);
  assert.deepEqual(JSON.parse(readFileSync(join(config.dataDir, 'previous-statusline.json'), 'utf8')), previousStatus);
  assert.ok(existsSync(join(dir, 'codex/skills/pet/SKILL.md')));
  assert.ok(existsSync(join(dir, 'codex/pets/tokenpet/pet.json')));

  const updated = join(vendor, 'codex-v2.mjs');
  copyFileSync(join(vendor, 'codex.mjs'), updated);
  rmSync(join(native, 'codex')); symlinkSync(updated, join(native, 'codex'));
  repairLaunchers(config);
  assert.equal(readlinkSync(join(native, 'codex')), `${updated}.tokenpet-launcher`);
  const args = ['words with spaces', "quote'and\"", '$(never-execute)'];
  const { child } = await launch('codex', args, true, withoutHint);
  assert.deepEqual(child, { args, term: 'xterm-kitty', program: 'kitty', hint: 'kitty', tty: true });
  assert.equal(env.TERM_PROGRAM, 'Orca');
  assert.equal((await app.game.player())!.coins, 400, 'the installed launcher reached the real fixture attendance API once');
  assert.equal((await app.game.db.prepare('SELECT COUNT(*) AS n FROM checkins').get())!.n, 1);
  assert.deepEqual(readFileSync(join(readOnly, 'codex')), systemBefore);
  for (const hint of ['none', 'sixel', '']) {
    const overridden = await launch('codex', [], true, { ...env, ORCA_IMAGE_PROTOCOL: hint });
    assert.deepEqual(overridden.child, { args: [], term: 'xterm-256color', program: 'Orca', hint, tty: true });
  }
});

test('setup from SSH enables subsequent Orca PTY launches without an image hint', { skip: !unix }, async t => {
  const { env, config, launch } = await fixture(t);
  delete env.ORCA_IMAGE_PROTOCOL;
  const ssh = { ...env }; delete ssh.TERM_PROGRAM;
  await execute(process.execPath, [resolve('bin/tokenpet.mjs'), 'setup'], { env: ssh, timeout: 20000 });
  assert.equal(JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8')).env.ORCA_IMAGE_PROTOCOL, undefined);
  const { child } = await launch('codex', [], true);
  assert.deepEqual(child, { args: [], term: 'xterm-kitty', program: 'kitty', tty: true });
  assert.equal((await launch('codex', ['--version'], true)).child.program, 'Orca');
  assert.equal((await launch('codex', ['exec', 'hello'], true)).child.program, 'Orca');
  assert.equal((await launch('claude', [], true)).child.program, 'Orca');
});

test('installed Orca launcher keeps its existing pet on auth failure and leaves headless/help/Claude terminals unchanged', { skip: !unix }, async t => {
  const { dir, env, app, launch } = await fixture(t);
  await execute(process.execPath, [resolve('bin/tokenpet.mjs'), 'setup'], { env, timeout: 20000 });
  const manifest = join(dir, 'codex/pets/tokenpet/pet.json'), before = readFileSync(manifest);
  const { child, output, stderr } = await launch('codex', [], true, { ...env, TOKENPET_API_KEY: '0'.repeat(64) });
  assert.equal(child.program, 'kitty'); assert.equal(child.term, 'xterm-kitty');
  assert.match(output + stderr, /CLI는 계속 실행/);
  assert.deepEqual(readFileSync(manifest), before);
  assert.equal((await app.game.player())!.coins, 300);
  for (const [cli, args, tty] of [['codex', ['exec', 'hello'], false], ['codex', ['exec', 'hello'], true],
    ['codex', ['e', 'hello'], true], ['codex', ['review', '--uncommitted'], true], ['claude', ['--print', 'hello'], true],
    ['codex', ['--help'], true], ['claude', [], true]] satisfies [string, string[], boolean][]) {
    const { child: result } = await launch(cli, args, tty);
    assert.equal(result.program, 'Orca'); assert.equal(result.term, 'xterm-256color');
    assert.deepEqual(result.args, args);
  }
  assert.equal((await app.game.player())!.coins, 400, 'only interactive Claude claims attendance');
});

test('installed Warp Codex launcher preserves real PTY arguments and status through script', { skip: !unix || !existsSync('/usr/bin/script') }, async t => {
  const { env, app, launch } = await fixture(t);
  await execute(process.execPath, [resolve('bin/tokenpet.mjs'), 'setup'], { env, timeout: 20000 });
  const args = ['resume', 'session with spaces', "quote'and\"", '$(never-execute)'];
  const { child } = await launch('codex', args, true, { ...env, TERM_PROGRAM: 'WarpTerminal' });
  assert.deepEqual(child.args, args);
  assert.equal(child.program, 'kitty'); assert.equal(child.term, 'xterm-kitty'); assert.equal(child.tty, true);
  assert.equal((await app.game.player())!.coins, 400);
});

test('Warp PTY forwards repeated resizes and typing and restores terminal mode', { skip: !unix || !existsSync('/usr/bin/script') }, async t => {
  const { env, vendor, native } = await fixture(t);
  await execute(process.execPath, [resolve('bin/tokenpet.mjs'), 'setup'], { env, timeout: 20000 });
  writeFileSync(join(vendor, 'codex.mjs'), `#!${process.execPath}
process.stdin.setRawMode(true);
const size = () => JSON.stringify([process.stdout.columns, process.stdout.rows]);
process.stdout.on('resize', () => console.log('RESIZE ' + size()));
process.stdin.setEncoding('utf8');
process.stdin.on('data', input => {
  if (input === '\\x03') { process.stdin.pause(); process.exitCode = 17; console.log('EXIT'); }
  else process.stdout.write(input);
});
setTimeout(() => process.exit(99), 12000).unref();
console.log('READY ' + size());
`);
  const check = `import fcntl, os, pty, select, signal, struct, sys, termios, time
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 800, 480))
    os.execv(sys.argv[1], sys.argv[1:])
pending = b''
def wait_for(needle):
    global pending
    deadline = time.monotonic() + 5
    while needle not in pending:
        assert time.monotonic() < deadline, ('missing output', needle, pending)
        if not select.select([fd], [], [], 0.1)[0]:
            continue
        data = os.read(fd, 65536)
        assert data, ('unexpected EOF', needle, pending)
        pending += data
    pending = pending.split(needle, 1)[1]
try:
    wait_for(b'READY [80,24]')
    for index, (columns, rows) in enumerate([(120, 32), (58, 18), (96, 40)]):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, columns * 10, rows * 20))
        wait_for(('RESIZE [%d,%d]' % (columns, rows)).encode())
        text = 'typing-%d 한국어' % index
        os.write(fd, text.encode())
        wait_for(text.encode())
    os.write(fd, b'\\x03')
    wait_for(b'EXIT')
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 17, status
    mode = termios.tcgetattr(fd)
    assert mode[3] & termios.ICANON and mode[3] & termios.ECHO, 'terminal mode was not restored'
    print('PTY resize, input, exit and terminal mode checks passed')
finally:
    os.close(fd)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
`;
  const { stdout } = await execute('python3', ['-c', check, join(native, 'codex')], {
    env: { ...env, TERM_PROGRAM: 'WarpTerminal' }, timeout: 20000,
  });
  assert.match(stdout, /PTY resize, input, exit and terminal mode checks passed/);
});

test('setup asks before replacing commands and uninstall cleans the folders it recorded from another shell', { skip: !unix }, async t => {
  const { dir, native, vendor, log, env } = await fixture(t);
  // CLI mock that remembers MCP entries and the Codex pet per config folder.
  const registry = join(dir, 'registered.json');
  const mock = `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const args = process.argv.slice(2), cli = basename(process.argv[1], '.mjs');
const root = cli === 'claude' ? process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, '.claude') : process.env.CODEX_HOME || join(process.env.HOME, '.codex');
const saved = existsSync(${JSON.stringify(registry)}) ? JSON.parse(readFileSync(${JSON.stringify(registry)}, 'utf8')) : {}, key = cli + ' ' + root;
if (args[0] === 'mcp') {
  appendFileSync(${JSON.stringify(log)}, JSON.stringify([cli, root, ...args]) + '\\n');
  if (args[1] === 'get') {
    if (!saved[key]) process.exit(1);
    console.log(saved[key].join(' '));
    if (cli === 'claude') {
      // Like the real Claude CLI, get health-checks the entry by starting the MCP.
      const [command, ...rest] = saved[key].slice(saved[key].indexOf('--') + 1);
      const variables = Object.fromEntries(saved[key].flatMap((value, i) => saved[key][i - 1] === '--env' ? [value.split(/=(.*)/s).slice(0, 2)] : []));
      const child = spawn(command, rest, { env: { ...process.env, ...variables }, stdio: ['pipe', 'pipe', 'ignore'] });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mock', version: '1' } } }) + '\\n');
      await Promise.race([once(child.stdout, 'data'), once(child, 'close')]); child.kill();
    }
    process.exit(0);
  }
  if (args[1] === 'add') saved[key] = args; else delete saved[key];
  writeFileSync(${JSON.stringify(registry)}, JSON.stringify(saved));
} else if (args[0] === 'app-server') {
  createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (request.method === 'config/value/write') {
      appendFileSync(${JSON.stringify(log)}, JSON.stringify([cli, root, 'pet', request.params.value]) + '\\n');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'config.toml'), request.params.value ? '[tui]\\npet = "' + request.params.value + '"\\n' : '[tui]\\n');
    }
    if (request.id) console.log(JSON.stringify({ id: request.id, result: request.id === 2 ? { status: 'ok' } : {} }));
  });
} else process.exit(17);
`;
  for (const cli of ['codex', 'claude']) writeFileSync(join(vendor, `${cli}.mjs`), mock, { mode: 0o700 });
  // Local mode, so uninstall stops the server and the MCP health check could start it again.
  const values: NodeJS.ProcessEnv = { ...env, PATH: `${native}:/usr/bin:/bin`, TOKENPET_SERVER: undefined };
  const tokenpet = (args: string[], extra = values) => execute(process.execPath, [resolve('bin/tokenpet.mjs'), ...args], { env: extra, timeout: 20000 });
  const command = join(env.CLAUDE_CONFIG_DIR!, 'commands/pet.md');
  mkdirSync(dirname(command), { recursive: true }); writeFileSync(command, 'An older pet command\n');
  const kept = await tokenpet(['setup']);
  assert.match(kept.stdout, /전용 명령 \/pet · \$pet 설치를 건너뛰었습니다/, 'without a terminal setup keeps the file and continues');
  assert.match(kept.stdout, /설치 완료/);
  assert.equal(readFileSync(command, 'utf8'), 'An older pet command\n');
  await tokenpet(['setup'], { ...values, TOKENPET_OVERWRITE: '1' });
  assert.match(readFileSync(command, 'utf8'), /Managed by tokenpet\./);
  // Uninstall from a shell that no longer points at the custom Claude and Codex folders.
  const removed = await tokenpet(['uninstall', '--purge'], { ...values, CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined });
  assert.match(removed.stdout, /로컬 서버를 종료했습니다[\s\S]*삭제 완료/);
  const health = `http://127.0.0.1:${env.TOKENPET_PORT}/api`;
  if (await fetch(`${health}/health`).then(() => true, () => false)) {
    await fetch(`${health}/shutdown`, { method: 'POST', headers: { 'X-API-Key': env.TOKENPET_API_KEY! } }).catch(() => {});
    assert.fail('uninstall left a server running');
  }
  assert.match(removed.stdout, /npm이나 소스 폴더에서 실행 중이라/, 'a source checkout is never deleted');
  assert.ok(!existsSync(command) && !existsSync(join(env.CODEX_HOME!, 'skills/pet')));
  assert.ok(!existsSync(join(env.CODEX_HOME!, 'pets/tokenpet')));
  assert.equal(JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR!, 'settings.json'), 'utf8')).statusLine, undefined);
  assert.deepEqual(JSON.parse(readFileSync(registry, 'utf8')), {}, 'MCP entries are removed in the recorded folders');
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.some(call => call.join(' ') === `claude ${env.CLAUDE_CONFIG_DIR} mcp remove --scope user tokenpet`));
  assert.ok(calls.some(call => call.join(' ') === `codex ${env.CODEX_HOME} mcp remove tokenpet`));
  assert.ok(calls.some(([cli, root, kind, value]) => cli === 'codex' && root === env.CODEX_HOME && kind === 'pet' && value === null));
  for (const cli of ['codex', 'claude']) assert.equal(resolve(native, readlinkSync(join(native, cli))), join(vendor, `${cli}.mjs`));
  assert.ok(!existsSync(env.TOKENPET_DATA_DIR!), '--purge removes game data');
});
