import type { Configuration } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { cliExecutable, cliInvocation } from '../dist/src/cli-install.js';
import { windowsStatusline, isWindowsStatusline, powershell, windowsStatuslineShell } from '../dist/src/windows.js';
import { credential, saveConnection } from '../dist/src/config.js';

test('Windows discovers native EXEs and invokes official npm CLIs without a command shell', t => {
  const dir = mkdtempSync(join(tmpdir(), "tokenpet windows's-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shim = join(dir, 'unused');
  for (const cli of ['claude', 'codex']) {
    const pkg = join(dir, 'node_modules', cli === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code');
    mkdirSync(pkg, { recursive: true });
    const entrypoint = join(pkg, 'cli.cjs');
    writeFileSync(entrypoint, 'console.log(JSON.stringify(process.argv.slice(2)));', { mode: 0o700 });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { [cli]: './cli.cjs' } }));
    writeFileSync(join(dir, `${cli}.cmd`), '@echo off\nexit /b 99\n', { mode: 0o700 });
    const path = cliExecutable(cli, shim, dir, 'win32');
    assert.equal(path, entrypoint);
    const args = ['words with spaces', '"quote"', 'a&b', '%USERPROFILE%', '$(no-command)', '한글'];
    const output = execFileSync(...cliInvocation(path, args), { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), args);
    writeFileSync(join(dir, `${cli}.exe`), 'native exe fixture', { mode: 0o700 });
    assert.equal(cliExecutable(cli, shim, dir, 'win32'), join(dir, `${cli}.exe`));
  }
});

test('Windows statusline safely encodes paths and recognizes its own command during upgrades', () => {
  const node = "C:\\Users\\Dev's 컴퓨터\\node.exe", bin = 'C:\\TokenPet & friends\\bin\\tokenpet.mjs';
  const command = windowsStatusline(node, bin, { TOKENPET_DATA_DIR: 'C:\\Users\\my data', NODE_EXTRA_CA_CERTS: 'C:\\certs\\ca.pem' });
  assert.ok(isWindowsStatusline(command));
  assert.ok(!isWindowsStatusline('powershell.exe -File unrelated.ps1'));
  assert.ok(!isWindowsStatusline('echo tokenpet.mjs statusline'));
  const script = Buffer.from(command.split(' ').at(-1)!, 'base64').toString('utf16le');
  assert.ok(script.includes("'C:\\Users\\Dev''s 컴퓨터\\node.exe'"));
  assert.ok(script.includes("$env:TOKENPET_DATA_DIR='C:\\Users\\my data'"));
  const [executable, args] = powershell(script.replace(/^# .+\n/, '# custom header\n'));
  assert.ok(isWindowsStatusline([executable, ...args].join(' ')), 'detection does not depend on the header comment');
});

test('Windows stores credentials with a private inherited ACL', { skip: process.platform !== 'win32' }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenpet-acl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = { dataDir: dir } as Configuration; // partial config on purpose: credential() only needs dataDir
  const key = credential(config, true);
  saveConnection(dir, { server: 'https://pets.example.test', key });
  const inspect = `$p='${join(dir, 'connection.json').replaceAll("'", "''")}'; $acl=[System.IO.File]::GetAccessControl($p); @{ user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; identities=@($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }) } | ConvertTo-Json -Compress`;
  const { user, identities } = JSON.parse(execFileSync(...powershell(inspect), { encoding: 'utf8', windowsHide: true }));
  assert.equal(identities.length, 2);
  assert.ok(identities.includes(user));
  assert.ok(identities.includes('S-1-5-18'));
  assert.ok(!identities.includes('S-1-1-0'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'connection.json'), 'utf8')).key, key);
});

test('Windows preserves PowerShell statusline commands when Git Bash is absent', { skip: process.platform !== 'win32' }, t => {
  const names = ['Path', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'CLAUDE_CODE_GIT_BASH_PATH'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of names) delete process.env[name];
  process.env.Path = join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0');
  const shell = windowsStatuslineShell();
  const output = execSync('Write-Output (6 * 7)', { shell, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(output.trim(), '42');
});
