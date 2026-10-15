import type { GameState, Portrait, Vital } from './types.js';

interface Frame { width: number; height: number; pixels: Buffer }

import { crc32, deflateSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { petPixels } from '../public/pet-art.js';
import { cliInvocation } from './cli-install.js';

const digits = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
const gauges: { key: Vital; label: string; color: number; icon: string[] }[] = [
  { key: 'hunger', label: '포만감', color: 0xf0bc79ff, icon: ['0010100', '0101000', '0000000', '1111111', '1111111', '0111110', '0011100'] },
  { key: 'happiness', label: '기분', color: 0xf39aafff, icon: ['0110110', '1111111', '1111111', '1111111', '0111110', '0011100', '0001000'] },
  { key: 'energy', label: '에너지', color: 0xf6d76aff, icon: ['0001100', '0011000', '0110000', '1111110', '0001100', '0011000', '0110000'] },
  { key: 'hygiene', label: '청결', color: 0x85d9e2ff, icon: ['0001000', '0011100', '0011100', '0111110', '1111111', '1111111', '0111110'] },
];
const careValue = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;

export const selectCodexPet = (executable: string) => writeCodexPet(executable, 'custom:tokenpet');
export const clearCodexPet = (executable: string, env = process.env) => writeCodexPet(executable, null, env);

async function writeCodexPet(executable: string, pet: string | null, env = process.env) {
  // Persist through Codex: a -c override disables its shared daemon in 0.162.
  const child = spawn(...cliInvocation(executable, ['app-server']), { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
  let timer;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Codex 펫 설정 저장 시간이 초과됐어요.')), 10000);
      child.once('error', reject);
      child.stdin.on('error', reject);
      child.once('exit', () => reject(new Error('Codex 펫 설정을 저장하기 전에 연결이 종료됐어요.')));
      lines.on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (![1, 2].includes(message.id)) return;
        if (message.error) { reject(new Error(`Codex 펫 설정 저장 실패: ${message.error.message}`)); return; }
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'config/value/write', params: { keyPath: 'tui.pet', value: pet, mergeStrategy: 'replace' } });
        } else if (message.result?.status === 'ok') resolve();
        else reject(new Error('다른 Codex 설정이 TokenPet 펫 선택을 덮어쓰고 있어요.'));
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'tokenpet', version: '1.0.1' } } });
    });
  } finally { clearTimeout(timer); lines.close(); child.stdin.end(); child.kill(); }
}

function petFrame(pet: Portrait, index: number, width = 384) {
  const wide = width === 384, columns = 1536 / width, frame = index % columns;
  const stride = width * 4 + 1, pixels = Buffer.alloc(stride * 208);
  const rect = (x: number, y: number, w: number, h: number, rgba: number) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++)
      pixels.writeUInt32BE(rgba, (y + dy) * stride + 1 + (x + dx) * 4);
  };
  const { grid, palette } = petPixels(pet, frame === (wide ? 3 : 6));
  const lift = [0, 1, 2, 1, 0, -1, 0, 0][frame] * 2, scale = wide ? 6 : 4;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const pixel = grid[y][Math.floor(index / columns) === 2 ? 23 - x : x];
    if (pixel === ' ') continue;
    const rgba = Number.parseInt(palette[pixel].slice(1) + 'ff', 16);
    rect((wide ? 12 : 48) + x * scale, (wide ? 24 : 10) + y * scale - lift, scale, scale, rgba);
  }
  // Codex displays pets at 75px high; put large numbers beside the character.
  rect(wide ? 194 : 4, wide ? 8 : 112, 184, wide ? 192 : 92, 0x526454ff);
  rect(wide ? 196 : 6, wide ? 10 : 114, 180, wide ? 188 : 88, 0x25362cff);
  gauges.forEach(({ key, color, icon }, index) => {
    const y = (wide ? 13 : 115) + index * (wide ? 46 : 22), value = careValue(pet[key]);
    const iconScale = wide ? 4 : 3, digitScale = wide ? 6 : 4, digitWidth = wide ? 24 : 16;
    icon.forEach((line, iy) => [...line].forEach((pixel, ix) => {
      if (pixel === '1') rect((wide ? 204 : 12) + ix * iconScale, y + iy * iconScale, iconScale, iconScale, color);
    }));
    const barX = wide ? 244 : 42, barY = y + (wide ? 34 : 7), barWidth = wide ? 122 : 84, barHeight = wide ? 6 : 8;
    rect(barX, barY, barWidth, barHeight, 0x46574bff);
    if (value !== null) rect(barX, barY, Math.round(barWidth * value / 100), barHeight, color);
    const text = value === null ? '-' : String(value);
    [...text].forEach((digit, i) => {
      const bitmap = digits[Number(digit)] || '000000111000000';
      [...bitmap].forEach((pixel, bit) => {
        if (pixel === '1') rect((wide ? 372 : 182) - text.length * digitWidth + i * digitWidth + (bit % 3) * digitScale,
          y + Math.floor(bit / 3) * digitScale, digitScale, digitScale,
          value !== null && value < 30 ? 0xffada4ff : 0xf4f4ddff);
      });
    });
  });
  return { width, height: 208, pixels };
}

function png({ width, height, pixels }: Frame) {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(payload));
    return Buffer.concat([size, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export function petSpritesheet(pet: Portrait) {
  // Keep Codex's required 1536×1872 sheet, using four wide frames per row.
  const width = 1536, height = 1872, stride = width * 4 + 1, pixels = Buffer.alloc(stride * height);
  for (let index = 0; index < 36; index++) {
    const frame = petFrame(pet, index), frameStride = frame.width * 4 + 1;
    for (let y = 0; y < 208; y++) frame.pixels.copy(pixels,
      (Math.floor(index / 4) * 208 + y) * stride + 1 + (index % 4) * 384 * 4, y * frameStride + 1, (y + 1) * frameStride);
  }
  return png({ width, height, pixels });
}

function atomicWrite(path: string, contents: string | Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

function sixel(frame: Frame) {
  const height = 75, width = Math.floor(frame.width * height / frame.height), colors = new Map();
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const rgba = frame.pixels.readUInt32BE(Math.floor(y * frame.height / height) * (frame.width * 4 + 1) + 1 + Math.floor(x * frame.width / width) * 4);
    if (!(rgba & 255)) return -1;
    if (!colors.has(rgba)) colors.set(rgba, colors.size);
    return colors.get(rgba);
  }));
  let output = `\x1bP0;1;0q"1;1;${width};${height}`;
  for (const [rgba, id] of colors) output += `#${id};2;${[24, 16, 8].map(shift => Math.round(((rgba >>> shift) & 255) * 100 / 255)).join(';')}`;
  for (let y = 0; y < height; y += 6) {
    for (const id of colors.values()) {
      const band = Array.from({ length: width }, (_, x) => {
        let bits = 0;
        for (let dy = 0; dy < 6; dy++) if (rows[y + dy]?.[x] === id) bits |= 1 << dy;
        return String.fromCharCode(63 + bits);
      }).join('').replace(/\?+$/, '');
      if (band) output += `#${id}${band}$`;
    }
    output += '-';
  }
  return output + '\x1b\\';
}

function refreshFrameCaches(pet: Portrait, directory: string, signature: string) {
  if (basename(directory) !== 'tokenpet' || basename(dirname(directory)) !== 'pets') return;
  const root = join(dirname(dirname(directory)), 'cache', 'tui-pets', 'frame-cache', 'custom-tokenpet');
  let entries;
  try { if (!lstatSync(root).isDirectory()) return; entries = readdirSync(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const rendered = new Map<number, { png: Buffer; sixel: string }[]>();
  // shortcut: update Codex 0.161–0.162 frame caches until native live asset reload is available.
  for (const entry of entries) {
    const match = /^sha256-[a-f0-9]{64}-(192x208-8x9|384x208-4x9)$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const cache = join(root, entry.name), frames = join(cache, 'frames'), sixels = join(cache, 'sixel'), marker = join(cache, '.tokenpet-state');
    try {
      if (!lstatSync(frames).isDirectory()) continue;
      try { if (readFileSync(marker, 'utf8') === signature) continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      mkdirSync(sixels, { recursive: true });
      if (!lstatSync(sixels).isDirectory()) continue;
      const width = Number(match[1].split('x')[0]);
      if (!rendered.has(width)) rendered.set(width, Array.from({ length: 1536 / width * 9 }, (_, i) => {
        const frame = petFrame(pet, i, width);
        return { png: png(frame), sixel: sixel(frame) };
      }));
      rendered.get(width)!.forEach((frame, i) => {
        const name = `frame_${String(i).padStart(3, '0')}`;
        atomicWrite(join(frames, `${name}.png`), frame.png);
        atomicWrite(join(sixels, `${name}_h75_v2.six`), frame.sixel);
      });
      atomicWrite(marker, signature);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export function installCodexPet(state: GameState, directory = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'pets', 'tokenpet')) {
  const image = petSpritesheet(state.active), signature = createHash('sha256').update(image).digest('hex');
  const filename = `pet-${signature.slice(0, 16)}.png`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(directory, filename), image, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const manifest = { id: 'tokenpet', displayName: `TokenPet · ${state.active.name}`,
    description: gauges.map(({ key, label }) => `${label} ${careValue(state.active[key]) ?? '-'}/100`).join(' · '), spritesheetPath: filename,
    frame: { width: 384, height: 208, columns: 4, rows: 9 },
    // Override every default: Codex's built-in animations assume eight columns.
    animations: Object.fromEntries(([['idle', 0], ['running-right', 1], ['running-left', 2], ['waving', 3], ['jumping', 4],
      ['failed', 5], ['waiting', 6], ['running', 7], ['review', 8], ['move_right', 1], ['move_left', 2], ['wave', 3], ['bounce', 4], ['sad', 5]] as [string, number][])
      .map(([name, row]) => [name, { frames: (row ? [0, 1, 2, 3] : [0, 0, 0, 1, 0, 3]).map(i => row * 4 + i), fps: row ? 4 : 2, loop: true }])) };
  const contents = JSON.stringify(manifest, null, 2) + '\n';
  refreshFrameCaches(state.active, directory, signature);
  try { if (readFileSync(join(directory, 'pet.json'), 'utf8') === contents) return directory; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  atomicWrite(join(directory, 'pet.json'), contents);
  return directory;
}

export function removeCodexPet(codexRoot: string) {
  const directory = join(codexRoot, 'pets', 'tokenpet');
  try { if (JSON.parse(readFileSync(join(directory, 'pet.json'), 'utf8')).id !== 'tokenpet') return false; }
  catch { return false; }
  rmSync(directory, { recursive: true, force: true });
  rmSync(join(codexRoot, 'cache', 'tui-pets', 'frame-cache', 'custom-tokenpet'), { recursive: true, force: true });
  return true;
}
