import type { TestContext } from 'node:test';
import type { Configuration } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, rmSync, symlinkSync, linkSync, readlinkSync, readdirSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { installLaunchers, cliExecutable, repairLaunchers, removeLaunchers } from '../dist/src/cli-install.js';
import { commandConflicts, installCommands, removeCommands } from '../dist/src/command-install.js';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "tokenpet install's-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const backupDir = join(dir, 'backups'), native = join(dir, 'bin'), vendor = join(dir, 'vendor');
  mkdirSync(backupDir); mkdirSync(native); mkdirSync(vendor);
  const config = { dataDir: join(dir, 'data') } as Configuration; // launcher functions read only dataDir
  const options = { config, bin: resolve('bin/tokenpet.mjs'), backupDir, userDir: dir, env: { PATH: native } };
  for (const cli of ['codex', 'claude']) {
    writeFileSync(join(vendor, cli), `#!${process.execPath}\nimport { readFileSync } from 'node:fs';\nconsole.log(JSON.stringify({ args: process.argv.slice(2), input: readFileSync(0, 'utf8'), term: process.env.TERM_PROGRAM, hint: process.env.ORCA_IMAGE_PROTOCOL, data: process.env.TOKENPET_DATA_DIR, override: process.env.TOKENPET_ORIGINAL_CODEX || process.env.TOKENPET_ORIGINAL_CLAUDE }));\nprocess.exit(17);\n`, { mode: 0o700 });
    symlinkSync(`../vendor/${cli}`, join(native, cli));
  }
  return { dir, native, vendor, config, options };
}

function run(path: string, args: string[], native: string) {
  return spawnSync(path, args, { input: 'stdin preserved\n', encoding: 'utf8', env: { ...process.env, PATH: native, TERM_PROGRAM: 'WarpTerminal', ORCA_IMAGE_PROTOCOL: undefined, TOKENPET_DATA_DIR: undefined, TOKENPET_ORIGINAL_CODEX: undefined, TOKENPET_ORIGINAL_CLAUDE: undefined }, timeout: 10000 });
}

function runWithForeignOwners(paths: string[], script: string) {
  // An unprivileged process cannot create foreign owners; isolate metadata overrides in a child.
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { resolve } from 'node:path';
    const foreign = ${JSON.stringify(paths)};
    for (const name of ['lstatSync', 'statSync']) {
      const original = fs[name];
      fs[name] = (path, ...args) => {
        const info = original(path, ...args);
        if (foreign.includes(resolve(path))) info.uid = process.getuid() + 1;
        return info;
      };
    }
    syncBuiltinESMExports();
    const { installLaunchers, repairLaunchers } = await import(${JSON.stringify(new URL('../dist/src/cli-install.js', import.meta.url).href)});
    ${script}
  `], { encoding: 'utf8', timeout: 10000 });
}

test('install connects existing command paths, preserves native CLIs and leaves shell settings alone', t => {
  const { dir, native, vendor, options } = fixture(t);
  const dotfile = join(dir, 'my-zshrc'); writeFileSync(dotfile, '# existing settings\nexport MY_SETTING=kept\n');
  symlinkSync(dotfile, join(dir, '.zshrc'));
  writeFileSync(join(dir, '.profile'), '# login settings\n');
  const nativeBefore = readFileSync(join(vendor, 'codex'));
  installLaunchers(options);
  const link = readlinkSync(join(native, 'codex'));
  installLaunchers(options);
  assert.equal(readlinkSync(join(native, 'codex')), link);
  assert.equal(dirname(link), vendor, 'npm must still own the command symlink target');
  assert.equal(readFileSync(dotfile, 'utf8'), '# existing settings\nexport MY_SETTING=kept\n');
  assert.ok(lstatSync(join(dir, '.zshrc')).isSymbolicLink());
  assert.ok(!existsSync(join(dir, '.bash_profile')));
  assert.ok(!existsSync(join(dir, '.bashrc')));
  assert.equal(readFileSync(join(dir, '.profile'), 'utf8'), '# login settings\n');
  assert.deepEqual(readFileSync(join(vendor, 'codex')), nativeBefore);
  assert.equal(cliExecutable('codex', join(options.config.dataDir, 'bin'), native), join(vendor, 'codex'));
});

test('a shell opened before installation keeps its cached codex and claude commands working', async t => {
  const { native, options, config } = fixture(t);
  const shell = spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'hash codex claude; echo ready; read proceed; codex --version; claude --version'], { env: { ...process.env, PATH: native, TERM_PROGRAM: 'WarpTerminal', TOKENPET_DATA_DIR: undefined } });
  t.after(() => shell.kill());
  let output = '', errors = '';
  shell.stdout.on('data', bytes => { output += bytes; }); shell.stderr.on('data', bytes => { errors += bytes; });
  await once(shell.stdout, 'data');
  assert.equal(output, 'ready\n');
  installLaunchers(options);
  shell.stdin.end('continue\n');
  const [code] = await once(shell, 'close');
  assert.equal(code, 17, errors);
  assert.equal(errors, '');
  const lines = output.trim().split('\n').slice(1);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.deepEqual(JSON.parse(line), { args: ['--version'], input: '', term: 'WarpTerminal', data: config.dataDir });
  }
});

test('both launchers preserve arguments, stdin, output, exit status and headless environment', t => {
  const { native, config, options } = fixture(t);
  installLaunchers(options);
  for (const cli of ['codex', 'claude']) {
    const args = ['exec', 'words with spaces', "quote'and\"", '$(should-not-run)', '$pet feed'];
    // An absolute command path must not rely on the caller having that CLI on PATH.
    const result = run(join(native, cli), args, '/usr/bin:/bin');
    assert.equal(result.status, 17, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { args, input: 'stdin preserved\n', term: 'WarpTerminal', data: config.dataDir });
  }
  assert.ok(!existsSync(join(config.dataDir, 'game.sqlite')));
});

test('removed package falls back to the native CLI without recursion', t => {
  const { native, options, dir } = fixture(t);
  installLaunchers({ ...options, bin: join(dir, 'removed package', 'tokenpet.mjs') });
  for (const cli of ['codex', 'claude']) {
    const result = run(join(native, cli), ['--version'], native);
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { args: ['--version'], input: 'stdin preserved\n', term: 'WarpTerminal' });
  }
});

test('CLI updates are repaired automatically and uninstalled CLIs stay removed', t => {
  const { native, vendor, options, config } = fixture(t);
  installLaunchers(options);
  // Native and npm installers replace their symlink as they update the CLI.
  const updated = join(vendor, 'codex-v2'); copyFileSync(join(vendor, 'codex'), updated);
  rmSync(join(native, 'codex')); symlinkSync(updated, join(native, 'codex'));
  repairLaunchers(config);
  assert.equal(cliExecutable('codex', join(config.dataDir, 'bin'), native), updated);
  assert.equal(JSON.parse(run(join(native, 'codex'), ['--version'], native).stdout).data, config.dataDir);
  rmSync(join(native, 'claude')); repairLaunchers(config);
  assert.ok(!existsSync(join(native, 'claude')));
});

test('Orca image hints are saved in launchers, survive CLI repair and are removed by reinstall without a hint', t => {
  const { native, vendor, options, config } = fixture(t);
  const file = join(config.dataDir, 'cli-launchers.json');
  installLaunchers({ ...options, env: { ...options.env, ORCA_IMAGE_PROTOCOL: 'kitty' } });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).env.ORCA_IMAGE_PROTOCOL, 'kitty');
  for (const cli of ['codex', 'claude']) {
    const result = run(join(native, cli), ['--version'], native);
    assert.equal(result.status, 17, result.stderr);
    assert.equal(JSON.parse(result.stdout).hint, 'kitty');
    assert.equal(JSON.parse(result.stdout).term, 'WarpTerminal', 'stored hints must not change help or headless terminal identification');
  }
  const updated = join(vendor, 'codex-v2'); copyFileSync(join(vendor, 'codex'), updated);
  rmSync(join(native, 'codex')); symlinkSync(updated, join(native, 'codex'));
  repairLaunchers(config);
  assert.equal(JSON.parse(run(join(native, 'codex'), ['--version'], native).stdout).hint, 'kitty');
  assert.equal(cliExecutable('codex', join(config.dataDir, 'bin'), native), updated);
  installLaunchers(options);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).env.ORCA_IMAGE_PROTOCOL, undefined);
  for (const cli of ['codex', 'claude']) assert.equal(JSON.parse(run(join(native, cli), ['--version'], native).stdout).hint, undefined);
  rmSync(join(native, 'codex')); symlinkSync(updated, join(native, 'codex'));
  repairLaunchers(config);
  assert.equal(JSON.parse(run(join(native, 'codex'), ['--version'], native).stdout).hint, undefined);
});

test('standalone executables are preserved and restored to the launch path after an update', t => {
  const { native, vendor, options, config } = fixture(t);
  const command = join(native, 'codex'); rmSync(command); copyFileSync(join(vendor, 'codex'), command);
  const before = readFileSync(command);
  installLaunchers(options); installLaunchers(options);
  const saved = join(native, '.tokenpet-original-codex');
  assert.deepEqual(readFileSync(saved), before);
  assert.equal(cliExecutable('codex', join(config.dataDir, 'bin'), native), saved);
  writeFileSync(command, before);
  repairLaunchers(config);
  const result = run(command, ['--version'], native);
  assert.equal(result.status, 17, result.stderr);
  assert.equal(JSON.parse(result.stdout).data, config.dataDir);
});

test('installation skips read-only command and vendor directories before changing native CLIs', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  for (const directory of ['native', 'vendor'] as const) {
    const blocked = fixture(t), writable = fixture(t);
    const originals = ['codex', 'claude'].map(cli => readFileSync(join(blocked.vendor, cli)));
    const options = { ...blocked.options, env: { PATH: `${blocked.native}:${writable.native}` } };
    chmodSync(blocked[directory], 0o555);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(installLaunchers(options), ['codex', 'claude'].map(cli => ({ cli, path: join(writable.native, cli) })));
        const entries = JSON.parse(readFileSync(join(blocked.config.dataDir, 'cli-launchers.json'), 'utf8')).entries;
        assert.deepEqual(entries.map((entry: { path: string }) => entry.path).sort(), ['claude', 'codex'].map(cli => join(writable.native, cli)));
        for (const [index, cli] of ['codex', 'claude'].entries()) {
          assert.equal(readlinkSync(join(blocked.native, cli)), `../vendor/${cli}`);
          assert.deepEqual(readFileSync(join(blocked.vendor, cli)), originals[index]);
          assert.ok(!existsSync(join(blocked.vendor, `${cli}.tokenpet-launcher`)), 'permission checks must precede any candidate writes');
          assert.equal(JSON.parse(run(join(writable.native, cli), ['--version'], writable.native).stdout).data, blocked.config.dataDir);
        }
      }
      assert.ok(warnings.some(message => message.includes(blocked[directory]) && message.includes('tokenpet setup')));
    } finally { chmodSync(blocked[directory], 0o700); }
  }
});

test('installation skips a read-only standalone command without making a backup', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const { native, vendor, options, config } = fixture(t);
  const command = join(native, 'codex');
  rmSync(command); copyFileSync(join(vendor, 'codex'), command); chmodSync(command, 0o500);
  const before = readFileSync(command), warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  assert.deepEqual(installLaunchers(options), [{ cli: 'claude', path: join(native, 'claude') }]);
  assert.deepEqual(readFileSync(command), before);
  assert.ok(!existsSync(join(native, '.tokenpet-original-codex')));
  assert.deepEqual(JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8')).entries.map((entry: { cli: string }) => entry.cli), ['claude']);
  assert.ok(warnings.some(message => message.includes(command) && message.includes('건너뛰었습니다')));
});

test('reinstallation skips an unwritable managed launcher destination and updates other CLI hints', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const { native, vendor, options, config } = fixture(t);
  installLaunchers(options);
  const target = join(vendor, 'codex.tokenpet-launcher'), before = readFileSync(target);
  rmSync(join(native, 'codex')); symlinkSync('../vendor/codex', join(native, 'codex'));
  chmodSync(target, 0o500);
  const warnings: string[] = []; t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  assert.deepEqual(installLaunchers({ ...options, env: { ...options.env, ORCA_IMAGE_PROTOCOL: 'kitty' } }), [{ cli: 'claude', path: join(native, 'claude') }]);
  assert.deepEqual(readFileSync(target), before);
  assert.equal(readlinkSync(join(native, 'codex')), '../vendor/codex');
  assert.equal(JSON.parse(run(join(native, 'claude'), ['--version'], native).stdout).hint, 'kitty');
  assert.equal(JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8')).entries.length, 2, 'skipping a previously registered path must retain its original recovery record');
  assert.ok(warnings.some(message => message.includes(target)));
});

test('automatic repair skips an unwritable registered CLI and still repairs the next entry', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const { native, vendor, options, config } = fixture(t);
  installLaunchers({ ...options, env: { ...options.env, ORCA_IMAGE_PROTOCOL: 'kitty' } });
  const before = JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8'));
  for (const cli of ['codex', 'claude']) {
    const updated = join(vendor, `${cli}-v2`); copyFileSync(join(vendor, cli), updated);
    rmSync(join(native, cli)); symlinkSync(updated, join(native, cli));
  }
  chmodSync(join(vendor, 'codex-v2'), 0o500);
  const warnings: string[] = []; t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  repairLaunchers(config);
  const registry = JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8'));
  assert.deepEqual(registry.entries[0], before.entries[0]);
  assert.equal(registry.entries[1].original, join(vendor, 'claude-v2'));
  assert.equal(readlinkSync(join(native, 'codex')), join(vendor, 'codex-v2'));
  assert.ok(!existsSync(join(vendor, 'codex-v2.tokenpet-launcher')));
  assert.equal(JSON.parse(run(join(native, 'claude'), ['--version'], native).stdout).hint, 'kitty');
  assert.ok(warnings.some(message => message.includes(join(native, 'codex'))));
});

test('an all-skipped reinstall persists new settings without dropping the recovery entries', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const { dir, native, vendor, options, config } = fixture(t);
  installLaunchers({ ...options, env: { ...options.env, ORCA_IMAGE_PROTOCOL: 'kitty' } });
  const file = join(config.dataDir, 'cli-launchers.json'), previous = JSON.parse(readFileSync(file, 'utf8'));
  const before = ['codex', 'claude'].map(cli => ({ link: readlinkSync(join(native, cli)), content: readFileSync(join(native, cli)) }));
  const bin = join(dir, 'updated-package', 'tokenpet.mjs'); mkdirSync(dirname(bin)); copyFileSync(options.bin, bin);
  t.mock.method(console, 'warn', () => {});
  chmodSync(native, 0o555);
  try {
    assert.deepEqual(installLaunchers({ ...options, bin, env: { ...options.env, TOKENPET_PORT: '5678' } }), []);
    const registry = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(registry.entries, previous.entries);
    assert.equal(registry.bin, bin);
    assert.equal(registry.env.ORCA_IMAGE_PROTOCOL, undefined);
    assert.equal(registry.env.TOKENPET_PORT, '5678');
    for (const [index, cli] of ['codex', 'claude'].entries()) {
      assert.equal(readlinkSync(join(native, cli)), before[index].link);
      assert.deepEqual(readFileSync(join(native, cli)), before[index].content);
    }
  } finally { chmodSync(native, 0o700); }
  const updated = join(vendor, 'claude-v2'); copyFileSync(join(vendor, 'claude'), updated);
  rmSync(join(native, 'claude')); symlinkSync(updated, join(native, 'claude'));
  repairLaunchers(config);
  const repaired = readFileSync(join(native, 'claude'), 'utf8');
  assert.ok(!repaired.includes('ORCA_IMAGE_PROTOCOL='));
  assert.ok(repaired.includes('TOKENPET_PORT=') && repaired.includes('5678'));
  assert.ok(repaired.includes(bin.replaceAll("'", "'\\''")), 'later repair must use the newly saved package');
});

test('installation skips foreign-owned command paths and symlink targets while connecting user commands', { skip: !process.getuid }, t => {
  for (const kind of ['command', 'target']) {
    const { native, vendor, options, config } = fixture(t);
    const before = readFileSync(join(vendor, 'codex'));
    const foreign = kind === 'command' ? join(native, 'codex') : join(vendor, 'codex');
    const child = runWithForeignOwners([foreign], `console.log(JSON.stringify(installLaunchers(${JSON.stringify(options)})));`);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), [{ cli: 'claude', path: join(native, 'claude') }]);
    assert.match(child.stderr, /현재 사용자 소유가 아닙니다/);
    assert.ok(child.stderr.includes(foreign));
    assert.equal(readlinkSync(join(native, 'codex')), '../vendor/codex');
    assert.deepEqual(readFileSync(join(vendor, 'codex')), before);
    assert.ok(!existsSync(join(vendor, 'codex.tokenpet-launcher')));
    assert.deepEqual(JSON.parse(readFileSync(join(config.dataDir, 'cli-launchers.json'), 'utf8')).entries.map((entry: { cli: string }) => entry.cli), ['claude']);
    assert.equal(JSON.parse(run(join(native, 'claude'), ['--version'], native).stdout).data, config.dataDir);
  }
});

test('repair skips a foreign-owned registered command without dropping its record or stopping later repair', { skip: !process.getuid }, t => {
  const { native, vendor, options, config } = fixture(t);
  installLaunchers({ ...options, env: { ...options.env, ORCA_IMAGE_PROTOCOL: 'kitty' } });
  const file = join(config.dataDir, 'cli-launchers.json'), before = JSON.parse(readFileSync(file, 'utf8'));
  for (const cli of ['codex', 'claude']) {
    const updated = join(vendor, `${cli}-v2`); copyFileSync(join(vendor, cli), updated);
    rmSync(join(native, cli)); symlinkSync(updated, join(native, cli));
  }
  const child = runWithForeignOwners([join(native, 'codex')], `repairLaunchers(${JSON.stringify(config)});`);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /현재 사용자 소유가 아닙니다/);
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(registry.entries[0], before.entries[0]);
  assert.equal(registry.entries[1].original, join(vendor, 'claude-v2'));
  assert.equal(readlinkSync(join(native, 'codex')), join(vendor, 'codex-v2'));
  assert.ok(!existsSync(join(vendor, 'codex-v2.tokenpet-launcher')));
  assert.equal(JSON.parse(run(join(native, 'claude'), ['--version'], native).stdout).hint, 'kitty');
});

test('invalid managed launchers and missing originals are not treated as permission skips', t => {
  const { native, vendor, options, config } = fixture(t);
  const target = join(vendor, 'codex.tokenpet-launcher');
  writeFileSync(target, '#!/bin/sh\n# >>> tokenpet >>>\n# tokenpet-original: broken-json\n', { mode: 0o700 });
  assert.throws(() => installLaunchers(options), SyntaxError);
  assert.equal(readlinkSync(join(native, 'codex')), '../vendor/codex');
  assert.ok(!existsSync(join(config.dataDir, 'cli-launchers.json')));
  rmSync(target); installLaunchers(options);
  writeFileSync(join(native, 'codex'), `#!/bin/sh\n# >>> tokenpet >>>\n# tokenpet-original: ${JSON.stringify(join(native, 'codex'))}\n`);
  assert.throws(() => installLaunchers(options), /CLI 연결이 손상/);
  writeFileSync(join(native, 'codex'), `#!/bin/sh\n# >>> tokenpet >>>\n# tokenpet-original: ${JSON.stringify(join(vendor, 'missing-original'))}\n`);
  assert.throws(() => installLaunchers(options), { code: 'ENOENT' });
});

for (const reference of ['target', 'normalized alias', 'symlink', 'hard link']) {
  test(`managed launcher self-reference through its ${reference} is rejected without changing CLI files`, { skip: process.platform === 'win32' }, t => {
    const { dir, native, vendor, options, config } = fixture(t);
    installLaunchers(options);
    const command = join(native, 'codex'), target = join(vendor, 'codex.tokenpet-launcher');
    let original = target;
    if (reference === 'normalized alias') original = `${vendor}/../vendor/codex.tokenpet-launcher`;
    if (reference === 'symlink' || reference === 'hard link') {
      original = join(vendor, 'codex-alias');
      if (reference === 'symlink') symlinkSync(target, original); else linkSync(target, original);
    }
    writeFileSync(target, `#!/bin/sh\n# >>> tokenpet >>>\n# tokenpet-original: ${JSON.stringify(original)}\n`);
    const registry = join(config.dataDir, 'cli-launchers.json');
    const files = [target, join(vendor, 'codex'), join(vendor, 'claude'), join(vendor, 'claude.tokenpet-launcher'), registry];
    const contents = files.map(file => readFileSync(file));
    const links = ['codex', 'claude'].map(cli => readlinkSync(join(native, cli)));
    const paths = readdirSync(dir, { recursive: true }).sort();
    for (const invoke of [() => cliExecutable('codex', join(config.dataDir, 'bin'), native), () => installLaunchers(options), () => repairLaunchers(config)]) {
      assert.throws(invoke, /CLI 연결이 손상/);
      assert.deepEqual(files.map(file => readFileSync(file)), contents);
      assert.deepEqual(['codex', 'claude'].map(cli => readlinkSync(join(native, cli))), links);
      assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), paths);
      assert.ok(!existsSync(`${original}.tokenpet-launcher`), 'invalid originals must never create nested launchers');
      assert.equal(readlinkSync(command), target);
    }
  });
}

test('a missing managed original still falls back to the next CLI and rejects reinstallation as missing', { skip: process.platform === 'win32' }, t => {
  const { native, vendor, options, config } = fixture(t), fallback = fixture(t);
  installLaunchers(options);
  rmSync(join(vendor, 'codex'));
  assert.equal(cliExecutable('codex', join(config.dataDir, 'bin'), `${native}:${fallback.native}`), join(fallback.native, 'codex'));
  assert.throws(() => installLaunchers(options), { code: 'ENOENT' });
});

test('installer refuses unrelated launcher and backup files', t => {
  const { options, native, vendor } = fixture(t);
  writeFileSync(join(vendor, 'codex.tokenpet-launcher'), '# unrelated program', { mode: 0o400 });
  assert.throws(() => installLaunchers(options), /덮어쓸/);
  assert.equal(readlinkSync(join(native, 'codex')), '../vendor/codex');
  rmSync(join(vendor, 'codex.tokenpet-launcher'));
  rmSync(join(native, 'codex')); copyFileSync(join(vendor, 'codex'), join(native, 'codex'));
  writeFileSync(join(native, '.tokenpet-original-codex'), '# unrelated program');
  assert.throws(() => installLaunchers(options), /덮어쓸/);
  assert.equal(readFileSync(join(native, '.tokenpet-original-codex'), 'utf8'), '# unrelated program');
});

test('dedicated commands install with explicit-only policies and preserve unrelated skills', t => {
  const { dir, options } = fixture(t);
  const roots = { claudeRoot: join(dir, 'claude'), codexRoot: join(dir, 'codex'), backupDir: options.backupDir };
  installCommands(roots);
  const claudePath = join(roots.claudeRoot, 'commands/pet.md');
  const codexPath = join(roots.codexRoot, 'skills/pet/SKILL.md');
  const policyPath = join(roots.codexRoot, 'skills/pet/agents/openai.yaml');
  const before = [claudePath, codexPath, policyPath].map(path => readFileSync(path, 'utf8'));
  assert.match(before[0].split('---')[1], /^disable-model-invocation: true$/m);
  assert.ok(!existsSync(join(roots.claudeRoot, 'skills/pet')));
  assert.ok(before[1].includes('\nname: pet\n'));
  assert.ok(before[0].includes('gacha|list|dex|catalog'));
  assert.ok(before[1].includes('`list [tier] [page]`, `dex [tier] [page]`'));
  assert.match(before[2], /^policy:\n  allow_implicit_invocation: false$/m);
  installCommands(roots);
  assert.deepEqual([claudePath, codexPath, policyPath].map(path => readFileSync(path, 'utf8')), before);
  writeFileSync(claudePath, 'My existing pet skill');
  assert.throws(() => installCommands(roots), /덮어쓸/);
  assert.equal(readFileSync(claudePath, 'utf8'), 'My existing pet skill');
});

test('an unrelated Codex skill prevents installing the command', t => {
  const { dir, options } = fixture(t);
  const roots = { claudeRoot: join(dir, 'claude'), codexRoot: join(dir, 'codex'), backupDir: options.backupDir };
  const path = join(roots.codexRoot, 'skills/pet/SKILL.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'An unrelated skill');
  assert.throws(() => installCommands(roots), /덮어쓸/);
  assert.equal(readFileSync(path, 'utf8'), 'An unrelated skill');
  assert.ok(!existsSync(roots.claudeRoot), 'collisions must be checked before writing commands');
  assert.ok(!existsSync(join(roots.codexRoot, 'skills/pet/agents')));
});

test('uninstall restores symlinked and standalone CLIs and removes every launcher', t => {
  const { native, vendor, options, config } = fixture(t);
  const standalone = join(native, 'codex'); rmSync(standalone); copyFileSync(join(vendor, 'codex'), standalone);
  const before = readFileSync(standalone);
  installLaunchers(options);
  // A launcher left beside an earlier CLI version is removed as well.
  writeFileSync(join(vendor, 'claude-old.tokenpet-launcher'), readFileSync(join(vendor, 'claude.tokenpet-launcher')));
  assert.deepEqual(removeLaunchers(config).map(entry => entry.cli).sort(), ['claude', 'codex']);
  assert.equal(resolve(native, readlinkSync(join(native, 'claude'))), join(vendor, 'claude'));
  assert.deepEqual(readFileSync(standalone), before);
  assert.deepEqual([...readdirSync(vendor), ...readdirSync(native)].filter(name => name.includes('tokenpet')), []);
  assert.ok(!existsSync(join(config.dataDir, 'cli-launchers.json')));
  for (const cli of ['codex', 'claude']) {
    const result = run(join(native, cli), ['--version'], native);
    assert.equal(result.status, 17, result.stderr);
    assert.equal(JSON.parse(result.stdout).data, undefined, `${cli} runs without the launcher`);
  }
  assert.deepEqual(removeLaunchers(config), [], 'a second uninstall changes nothing');
});

test('existing command files are reported, kept by default, and replaced with a backup only when allowed', t => {
  const { dir, options } = fixture(t);
  const roots = { claudeRoot: join(dir, 'claude'), codexRoot: join(dir, 'codex'), backupDir: options.backupDir };
  const command = join(roots.claudeRoot, 'commands/pet.md');
  mkdirSync(dirname(command), { recursive: true }); writeFileSync(command, 'An older pet command');
  assert.deepEqual(commandConflicts(roots), [command]);
  assert.throws(() => installCommands(roots), /덮어쓸/);
  installCommands({ ...roots, overwrite: true });
  assert.match(readFileSync(command, 'utf8'), /Managed by tokenpet\./);
  assert.equal(readFileSync(join(options.backupDir, '0-command-backup'), 'utf8'), 'An older pet command');
  assert.deepEqual(commandConflicts(roots), []);
  const unrelated = join(roots.codexRoot, 'skills/other/SKILL.md');
  mkdirSync(dirname(unrelated), { recursive: true }); writeFileSync(unrelated, 'keep');
  assert.deepEqual(removeCommands(roots), [command, join(roots.codexRoot, 'skills/pet')]);
  assert.ok(!existsSync(command) && !existsSync(join(roots.codexRoot, 'skills/pet')));
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep');
});
