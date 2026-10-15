import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface CommandRoots { claudeRoot: string; codexRoot: string }

const commandPaths = ({ claudeRoot, codexRoot }: CommandRoots) =>
  [join(claudeRoot, 'commands/pet.md'), join(codexRoot, 'skills/pet/SKILL.md'), join(codexRoot, 'skills/pet/agents/openai.yaml')];
const managed = (path: string) => readFileSync(path, 'utf8').includes('Managed by tokenpet.');

export const commandConflicts = (roots: CommandRoots) => commandPaths(roots).filter(path => existsSync(path) && !managed(path));

export function installCommands({ claudeRoot, codexRoot, backupDir, overwrite = false }: CommandRoots & { backupDir: string; overwrite?: boolean }) {
  const skill = readFileSync(new URL('../integrations/pet/SKILL.md', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('../integrations/pet/agents/openai.yaml', import.meta.url), 'utf8');
  const [command, codexSkill, codexPolicy] = commandPaths({ claudeRoot, codexRoot });
  const files = [
    // Codex also scans Claude skills; a Claude command file avoids duplicate entries.
    [command, skill.replace('name: pet\n', 'disable-model-invocation: true\nargument-hint: "[status|checkin|feed|play|clean|sleep|wake|gacha|list|dex|catalog|find|equip|rules|log|name|share|export|help]"\n')],
    [codexSkill, skill],
    [codexPolicy, policy],
  ];
  const conflict = commandConflicts({ claudeRoot, codexRoot })[0];
  if (conflict && !overwrite) throw new Error(`기존 명령을 덮어쓸 수 없어요: ${conflict}`);
  for (const [index, [path, content]] of files.entries()) {
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (previous === content) continue;
    if (previous !== null) writeFileSync(join(backupDir, `${index}-command-backup`), previous, { mode: 0o600 });
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  }
}

export function removeCommands({ claudeRoot, codexRoot }: Partial<CommandRoots>) {
  const owned = [
    ...(claudeRoot ? [[join(claudeRoot, 'commands/pet.md'), join(claudeRoot, 'commands/pet.md')]] : []),
    ...(codexRoot ? [[join(codexRoot, 'skills/pet/SKILL.md'), join(codexRoot, 'skills/pet')]] : []),
  ];
  return owned.filter(([file]) => existsSync(file) && managed(file)).map(([, target]) => {
    rmSync(target, { recursive: true, force: true });
    return target;
  });
}
