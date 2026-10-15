import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { existsSync } from 'node:fs';
import { cliExecutable, cliInvocation } from './cli-install.js';
import { ensureServer } from './runtime.js';
import { request } from './client.js';
import { installCodexPet } from './codex-pet.js';
import { codexImageFilter } from './codex-render.js';
import { shellQuote } from './shell-install.js';

function interactiveArguments(cli: string, args: string[]) {
  const headlessCommands = ['exec', 'e', 'review'];
  // shortcut: match documented CLI option arity; update these lists when new value-taking options are added.
  const values = cli === 'codex' ? [
    '-c', '--config', '--enable', '--disable', '--remote', '--remote-auth-token-env', '-i', '--image',
    '-m', '--model', '--local-provider', '-p', '--profile', '-s', '--sandbox', '-C', '--cd', '--add-dir', '-a', '--ask-for-approval',
  ] : [
    '--add-dir', '--agent', '--agents', '--allowedTools', '--allowed-tools', '--append-system-prompt', '--append-system-prompt-file',
    '--autocompact', '--betas', '--debug-file', '--disallowedTools', '--disallowed-tools', '--effort', '--environment',
    '--fallback-model', '--file', '--input-format', '--json-schema', '--max-budget-usd', '--mcp-config', '--model', '-n', '--name',
    '--output-format', '--permission-mode', '--permission-prompts', '--plugin-dir', '--plugin-url', '--remote-control-session-name-prefix',
    '--session-id', '--setting-sources', '--settings', '--system-prompt', '--system-prompt-file', '--system-prompt-snapshot', '--tools',
  ];
  const optionalValues = cli === 'claude' ? [
    '--cloud', '-d', '--debug', '--from-pr', '--prompt-suggestions', '--remote-control', '-r', '--resume', '--teleport', '-w', '--worktree',
  ] : [];
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') return !(cli === 'codex' && !positional && headlessCommands.includes(args[i + 1] || ''));
    if (!arg.startsWith('-')) {
      if (cli === 'codex' && !positional && headlessCommands.includes(arg)) return false;
      positional = true;
      continue;
    }
    const long = arg.startsWith('--');
    const flags = long ? [arg.split('=')[0]!] : [...arg.slice(1)].map(letter => '-' + letter);
    for (let j = 0; j < flags.length; j++) {
      const flag = flags[j]!;
      if (['--version', '-V', '--help', '-h'].includes(flag) || (cli === 'claude' && ['-v', '-p', '--print'].includes(flag))) return false;
      if (values.includes(flag) || optionalValues.includes(flag)) {
        const attached = long ? arg.includes('=') : j < flags.length - 1;
        const next = args[i + 1];
        if (!attached && next !== undefined && ((cli === 'claude' && values.includes(flag)) || !next.startsWith('-'))) {
          i++;
          if (cli === 'codex' && ['-i', '--image'].includes(flag))
            while (args[i + 1] && !args[i + 1]!.startsWith('-')) i++;
        }
        break;
      }
    }
  }
  return true;
}

export async function launchCLI(cli: string | undefined, args: string[]) {
  if (typeof cli !== 'string' || !['codex', 'claude'].includes(cli)) throw new Error('지원하지 않는 CLI예요.');
  const executable = process.env[`TOKENPET_ORIGINAL_${cli.toUpperCase()}`] || cliExecutable(cli);
  const env = { ...process.env };
  let stableImages = false;
  delete env.TOKENPET_ORIGINAL_CODEX; delete env.TOKENPET_ORIGINAL_CLAUDE;
  if (process.stdin.isTTY && process.stdout.isTTY && interactiveArguments(cli, args)) {
    try {
      await ensureServer();
      const checkin = await request('/api/checkin', {});
      if (checkin.awarded) console.error(`TokenPet: ${checkin.message}`);
      if (cli === 'codex') {
        installCodexPet(checkin.state);
      }
    } catch (error) { console.error(`TokenPet: ${error instanceof Error ? error.message : String(error)} CLI는 계속 실행합니다.`); }
    if (cli === 'codex') {
      const warp = env.TERM_PROGRAM === 'WarpTerminal';
      // shortcut: assume Kitty for hintless Orca until older remote servers advertise image capabilities.
      const orca = env.TERM_PROGRAM === 'Orca' && (env.ORCA_IMAGE_PROTOCOL ?? 'kitty') === 'kitty';
      if (warp || orca) {
        env.TERM = 'xterm-kitty'; env.TERM_PROGRAM = 'kitty';
        stableImages = warp && ['darwin', 'linux'].includes(process.platform) && existsSync('/usr/bin/script');
      }
    }
  }
  const invocation = cliInvocation(executable, args);
  const child = stableImages ? spawn('/usr/bin/script', process.platform === 'darwin'
    ? ['-q', '/dev/null', invocation[0], ...invocation[1]]
    : ['-qefc', [invocation[0], ...invocation[1]].map(shellQuote).join(' '), '/dev/null'],
  { stdio: ['inherit', 'pipe', 'inherit'], env }) : spawn(...invocation, { stdio: 'inherit', env });
  const wasRaw = !!process.stdin.isRaw;
  if (stableImages) {
    process.stdin.setRawMode(true);
    child.stdout!.pipe(codexImageFilter()).pipe(process.stdout, { end: false });
  }
  const interrupt = () => {}; // The foreground child receives Ctrl+C directly.
  const terminate = () => child.kill('SIGTERM');
  const resize = () => { if (stableImages) child.kill('SIGWINCH'); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  process.on('SIGWINCH', resize);
  try {
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolveExit({ code, signal }));
    });
    process.exitCode = code ?? (128 + (signal ? osConstants.signals[signal] || 0 : 0));
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); process.off('SIGWINCH', resize);
    if (stableImages) process.stdin.setRawMode(wasRaw);
  }
}
