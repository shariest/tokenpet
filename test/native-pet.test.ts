import type { GameState } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { stripVTControlCharacters } from 'node:util';
import { CATALOG } from '../dist/src/catalog.js';
import { petPixels } from '../dist/public/pet-art.js';
import { petStatusLine } from '../dist/src/terminal.js';
import { clearCodexPet, installCodexPet, petSpritesheet, selectCodexPet } from '../dist/src/codex-pet.js';

// Partial on purpose: only the fields the footer and Codex export read.
const state = { active: { ...CATALOG[0], level: 1, hunger: 70, happiness: 80, energy: 60, hygiene: 90 },
  player: { coins: 305 }, pets: [CATALOG[0]], catalog: CATALOG } as GameState;

test('Claude footer fits six rows within terminal width and shows live state', () => {
  const output = petStatusLine(state, { columns: 80, color: true });
  const lines = stripVTControlCharacters(output).split('\n');
  assert.equal(lines.length, 6);
  assert.ok(output.includes('\x1b[0;38;2;'));
  assert.ok(lines[0].includes('숲속 모스 · Lv.1'));
  assert.ok(lines[1].includes('305 C · 도감 1/360'));
  assert.ok(lines[2].includes('포만감 70/100 · 기분 80/100'));
  assert.ok(lines[5].includes('/pet help'));
  for (const line of lines) {
    const width = [...line].reduce((n, c) => n + (/\p{Script=Hangul}/u.test(c) ? 2 : 1), 0);
    assert.ok(width <= 76, `footer overflows: ${width}`);
  }
  const narrow = petStatusLine(state, { columns: 32, color: false });
  assert.ok(!narrow.includes('\x1b'));
  assert.equal(narrow.split('\n').length, 9);
  assert.match(narrow, /[▀▄█]/u, 'narrow terminals retain the pixel character');
  assert.ok(narrow.includes('숲속 모스 Lv.1 · 305 C\n포만감 70/100'));
  assert.ok(narrow.endsWith('잘 지내요 · help로 명령 보기'));
  const hungry = petStatusLine({ ...state, active: { ...state.active, hunger: 25 } }, { columns: 80, color: false });
  assert.ok(hungry.includes('배고파요 · /pet feed (5 C)'));
  assert.ok(petStatusLine({ ...state, active: { ...state.active, sleeping: true } }).includes('자는 중'));
  assert.notEqual(output, petStatusLine(state, { columns: 80, color: true, blink: true }));
});

test('Codex spritesheet is a valid transparent PNG with the shared pet artwork', () => {
  const png = petSpritesheet(state.active);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = new Map();
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    assert.equal(crc32(png.subarray(offset + 4, offset + 8 + size)), png.readUInt32BE(offset + 8 + size));
    chunks.set(type, png.subarray(offset + 8, offset + 8 + size));
    offset += 12 + size;
  }
  assert.deepEqual([...chunks.keys()], ['IHDR', 'IDAT', 'IEND']);
  const header = chunks.get('IHDR');
  assert.equal(header.readUInt32BE(0), 1536); assert.equal(header.readUInt32BE(4), 1872);
  assert.equal(header[8], 8); assert.equal(header[9], 6);
  const pixels = inflateSync(chunks.get('IDAT')), stride = 1536 * 4 + 1;
  assert.equal(pixels.length, stride * 1872);
  assert.equal(pixels.readUInt32BE(1), 0);
  const { grid, palette } = petPixels(state.active);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const actual = pixels.readUInt32BE((24 + y * 6) * stride + 1 + (12 + x * 6) * 4);
    assert.equal(actual, grid[y][x] === ' ' ? 0 : Number.parseInt(palette[grid[y][x]].slice(1) + 'ff', 16));
  }
  assert.notDeepEqual(png, petSpritesheet({ ...state.active, sleeping: true }));
  const pixel = (x: number, y: number) => pixels.readUInt32BE(y * stride + 1 + x * 4);
  assert.equal(pixel(328, 47), 0xf0bc79ff, '70/100 fills 85 pixels of the food gauge');
  assert.equal(pixel(329, 47), 0x46574bff, 'the unfilled gauge stays visible');
  assert.equal(pixel(324, 13), 0xf4f4ddff, 'the number 7 starts with a lit top row');
  assert.equal(pixel(324, 19), 0x25362cff, 'the left stroke of 7 is empty');
  assert.equal(pixel(336, 19), 0xf4f4ddff, 'the right stroke of 7 is lit');
  for (let row = 0; row < 9; row++) for (let frame = 0; frame < 4; frame++) for (let y = 0; y < 208; y++) {
    const offset = (row * 208 + y) * stride + 1 + (frame * 384 + 194) * 4;
    assert.deepEqual(pixels.subarray(offset, offset + 190 * 4), pixels.subarray(y * stride + 1 + 194 * 4, y * stride + 1 + 384 * 4), 'gauges must stay still beside the pet in every animation frame');
  }
  for (const key of ['hunger', 'happiness', 'energy', 'hygiene'])
    assert.notDeepEqual(png, petSpritesheet({ ...state.active, [key]: 0 }), `${key} changes the displayed image`);
  assert.deepEqual(petSpritesheet({ ...state.active, hunger: -10, happiness: 110 }), petSpritesheet({ ...state.active, hunger: 0, happiness: 100 }));
  assert.deepEqual(petSpritesheet({ ...state.active, hunger: 69.6 }), png, 'display precision matches the chat status');
  assert.doesNotThrow(() => petSpritesheet({ ...state.active, level: 10 }), 'a grown pet fits without clipping or writing outside the sheet');
});

test('Codex export follows the native manifest contract and replaces only its own selection', t => {
  const directory = mkdtempSync(join(tmpdir(), 'tokenpet-native-pet-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  installCodexPet(state, directory);
  const manifest = JSON.parse(readFileSync(join(directory, 'pet.json'), 'utf8'));
  assert.equal(manifest.id, 'tokenpet');
  assert.equal(manifest.displayName, 'TokenPet · 숲속 모스');
  assert.equal(manifest.description, '포만감 70/100 · 기분 80/100 · 에너지 60/100 · 청결 90/100');
  assert.deepEqual(manifest.frame, { width: 384, height: 208, columns: 4, rows: 9 });
  for (const name of ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review', 'move_right', 'move_left', 'wave', 'bounce', 'sad'])
    assert.ok(manifest.animations[name].frames.every((frame: number) => frame >= 0 && frame < 36), `Codex's ${name} animation must fit the wide grid`);
  const originalImage = readFileSync(join(directory, manifest.spritesheetPath));
  const modified = statSync(join(directory, 'pet.json')).mtimeMs;
  installCodexPet(state, directory);
  assert.equal(readdirSync(directory).length, 2);
  assert.equal(statSync(join(directory, 'pet.json')).mtimeMs, modified, 'unchanged state must not rewrite the manifest');
  installCodexPet({ ...state, active: { ...state.active, ...CATALOG[1] } }, directory);
  const next = JSON.parse(readFileSync(join(directory, 'pet.json'), 'utf8'));
  assert.notEqual(manifest.spritesheetPath, next.spritesheetPath);
  assert.deepEqual(originalImage, readFileSync(join(directory, manifest.spritesheetPath)));
  assert.ok(!readdirSync(directory).some(name => name.endsWith('.tmp')));
});

test('live Codex frame caches refresh across sessions without touching other pets or linked directories', t => {
  const home = mkdtempSync(join(tmpdir(), 'tokenpet-live-pet-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, 'pets', 'tokenpet');
  const root = join(home, 'cache', 'tui-pets', 'frame-cache');
  const cache = (spec: string) => join(root, 'custom-tokenpet', `sha256-${'a'.repeat(64)}-${spec}`);
  const legacy = cache('192x208-8x9'), wide = cache('384x208-4x9'), other = join(root, 'custom-another-pet');
  for (const path of [legacy, wide, other]) mkdirSync(join(path, 'frames'), { recursive: true });
  writeFileSync(join(other, 'frames', 'frame_000.png'), 'untouched');
  symlinkSync(other, join(root, 'custom-tokenpet', `sha256-${'b'.repeat(64)}-384x208-4x9`), 'junction');
  installCodexPet(state, directory);
  const before = readFileSync(join(wide, 'frames', 'frame_000.png'));
  const legacyImage = readFileSync(join(legacy, 'frames', 'frame_000.png'));
  assert.equal(before.readUInt32BE(16), 384);
  assert.equal(legacyImage.readUInt32BE(16), 192, 'already-running older sessions keep their existing frame dimensions');
  assert.equal(readdirSync(join(legacy, 'frames')).length, 72);
  assert.equal(readdirSync(join(wide, 'frames')).length, 36);
  const six = join(wide, 'sixel', 'frame_000_h75_v2.six');
  const oldSixel = readFileSync(six, 'utf8');
  assert.ok(oldSixel.startsWith('\x1bP0;1;0q"1;1;138;75'));
  assert.ok(oldSixel.endsWith('\x1b\\'));
  const colors = new Map(), decoded = Array(138 * 75).fill(null);
  let x = 0, y = 0, color;
  for (const token of oldSixel.slice(oldSixel.indexOf('#'), -2).matchAll(/#(\d+)(?:;2;(\d+);(\d+);(\d+))?|\$|-|[?-~]/g)) {
    if (token[1] !== undefined) {
      color = token[1];
      if (token[2] !== undefined) colors.set(color, token.slice(2, 5).join(';'));
    } else if (token[0] === '$') x = 0;
    else if (token[0] === '-') { y += 6; x = 0; }
    else {
      const bits = token[0].charCodeAt(0) - 63;
      for (let dy = 0; dy < 6; dy++) if (bits & (1 << dy)) decoded[(y + dy) * 138 + x] = colors.get(color);
      x++;
    }
  }
  const rgba = inflateSync(before.subarray(41, 41 + before.readUInt32BE(33))), stride = 384 * 4 + 1;
  const expected = Array.from({ length: 138 * 75 }, (_, i) => {
    const pixel = rgba.readUInt32BE(Math.floor(Math.floor(i / 138) * 208 / 75) * stride + 1 + Math.floor((i % 138) * 384 / 138) * 4);
    return pixel & 255 ? [24, 16, 8].map(shift => Math.round(((pixel >>> shift) & 255) * 100 / 255)).join(';') : null;
  });
  assert.deepEqual(decoded, expected, 'Sixel pixels preserve the resized PNG portrait, gauges, digits, and transparency');
  const modified = statSync(join(wide, 'frames', 'frame_000.png')).mtimeMs;
  installCodexPet(state, directory);
  assert.equal(statSync(join(wide, 'frames', 'frame_000.png')).mtimeMs, modified, 'unchanged state does not rewrite active caches');
  installCodexPet({ ...state, active: { ...state.active, ...CATALOG[1], hunger: 5 } }, directory);
  assert.notDeepEqual(readFileSync(join(wide, 'frames', 'frame_000.png')), before, 'selection and care update existing frame paths');
  assert.notDeepEqual(readFileSync(join(legacy, 'frames', 'frame_000.png')), legacyImage);
  assert.notEqual(readFileSync(six, 'utf8'), oldSixel, 'Sixel terminals must not reuse stale encoded frames');
  assert.equal(readFileSync(join(other, 'frames', 'frame_000.png'), 'utf8'), 'untouched');
  assert.ok(!(readdirSync(wide, { recursive: true }) as string[]).some(p => p.endsWith('.tmp')));
  const linkedHome = join(home, 'linked-home'), linkedRoot = join(linkedHome, 'cache', 'tui-pets', 'frame-cache');
  mkdirSync(linkedRoot, { recursive: true });
  symlinkSync(join(root, 'custom-tokenpet'), join(linkedRoot, 'custom-tokenpet'), 'junction');
  const unchanged = readFileSync(join(wide, 'frames', 'frame_000.png'));
  installCodexPet(state, join(linkedHome, 'pets', 'tokenpet'));
  assert.deepEqual(readFileSync(join(wide, 'frames', 'frame_000.png')), unchanged, 'a linked pet cache root must not redirect writes');
});

test('Codex pet selection is persisted through its native config API without session overrides', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tokenpet-codex-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, 'codex'), recorded = join(directory, 'write.json');
  writeFileSync(executable, `#!${process.execPath}\n
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['app-server']);
let initialized = false;
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: {} }));
  if (request.method === 'initialized') initialized = true;
  if (request.method === 'config/value/write') {
    assert.ok(initialized);
    writeFileSync(${JSON.stringify(recorded)}, JSON.stringify(request.params));
    console.log(JSON.stringify({ id: request.id, result: { status: 'ok' } }));
  }
});\n`, { mode: 0o700 });
  await selectCodexPet(executable);
  assert.deepEqual(JSON.parse(readFileSync(recorded, 'utf8')), { keyPath: 'tui.pet', value: 'custom:tokenpet', mergeStrategy: 'replace' });
  await clearCodexPet(executable);
  assert.deepEqual(JSON.parse(readFileSync(recorded, 'utf8')), { keyPath: 'tui.pet', value: null, mergeStrategy: 'replace' });
  for (const reply of [{ id: 1, error: { message: 'read-only settings' } }, { id: 2, result: { status: 'okOverridden' } }]) {
    writeFileSync(executable, `#!${process.execPath}\nprocess.stdin.once('data', () => console.log(${JSON.stringify(JSON.stringify(reply))}));\n`, { mode: 0o700 });
    await assert.rejects(selectCodexPet(executable), /read-only settings|덮어쓰고/);
  }
});
