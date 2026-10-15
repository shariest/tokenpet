import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const powershellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
// PowerShell can take well over 10 seconds to start on a cold or busy Windows machine.
export const powershellTimeout = 60_000;
export const powershell = (script: string): [string, string[]] => ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]];

export function windowsStatuslineShell() {
  const candidates = [process.env.CLAUDE_CODE_GIT_BASH_PATH];
  try {
    const git = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 1000 }).trim().split(/\r?\n/)[0];
    candidates.push(resolve(dirname(git), '../bin/bash.exe'), resolve(dirname(git), '../../bin/bash.exe'));
  } catch {}
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (root) candidates.push(join(root, 'Git', 'bin', 'bash.exe'));
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  // Match Claude's Windows shell so existing Bash and PowerShell statuslines keep working.
  return candidates.find(path => path && existsSync(path)) || 'powershell.exe';
}

export function privateWindowsDirectory(path: string) {
  const script = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
[System.IO.Directory]::SetAccessControl(${powershellQuote(path)}, $acl)`;
  execFileSync(...powershell(script), { stdio: 'pipe', windowsHide: true, timeout: powershellTimeout });
}

export function windowsStatusline(node: string, bin: string, variables: Record<string, string>) {
  const env = Object.entries(variables).map(([key, value]) => `$env:${key}=${powershellQuote(value)}`).join('\n');
  const script = `# TokenPet statusline\n$ProgressPreference='SilentlyContinue'\n$OutputEncoding=[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)\n${env}\n$input | & ${powershellQuote(node)} ${powershellQuote(bin)} statusline`;
  const [command, args] = powershell(script);
  return [command, ...args].join(' ');
}

export function isWindowsStatusline(command: string) {
  const encoded = /^powershell\.exe .* -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command)?.[1];
  // Match the invocation; the header comment is informational only.
  return encoded ? /tokenpet\.mjs'\s+statusline$/.test(Buffer.from(encoded, 'base64').toString('utf16le')) : false;
}
