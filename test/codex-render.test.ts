import test from 'node:test';
import assert from 'node:assert/strict';
import { finished } from 'node:stream/promises';
import { codexImageFilter } from '../dist/src/codex-render.js';

const stop = '\x1b\\';
const remove = (id: number) => `\x1b_Ga=d,d=I,i=${id},q=2;${stop}`;
const draw = (id: number, image = 'PNG') => `\x1b_Ga=T,t=d,f=100,c=18,r=5,q=2,i=${id},m=0;${Buffer.from(image).toString('base64')}${stop}`;
async function filter(parts: (string | Buffer)[]) {
  const stream = codexImageFilter(), chunks: Buffer[] = [];
  stream.on('data', chunk => chunks.push(chunk));
  for (const part of parts) stream.write(part);
  stream.end(); await finished(stream);
  return Buffer.concat(chunks).toString();
}
const ids = (value: string) => [...value.matchAll(/\x1b_G[^;]*,i=(\d+)(?=[,;])/g)].map(match => Number(match[1]));

test('Codex sessions use separate pet and preview image IDs for both display and deletion', async () => {
  const input = remove(49374) + draw(49374) + draw(49375) + remove(49375) + draw(49374, 'changed stats') + remove(49374);
  const first = await filter([input]), second = await filter([input]);
  const a = ids(first), b = ids(second);
  assert.equal(a.length, 6);
  assert.equal(new Set(a).size, 2);
  assert.deepEqual(a, [a[0], a[0], a[0] + 1, a[0] + 1, a[0], a[0]]);
  assert.ok(a.every(id => id > 49375 && id < 2 ** 32));
  assert.ok(b.every(id => !a.includes(id)), 'one Codex session must not replace or erase another session’s pet');
  const restored = first.replaceAll(`i=${a[0]},`, 'i=49374,').replaceAll(`i=${a[0] + 1},`, 'i=49375,');
  assert.equal(restored, input, 'only image IDs change; animation, dimensions, PNGs and cleanup stay native');
});

test('fragmented graphics headers and UTF-8 input do not corrupt terminal output', async () => {
  const input = `한국어 🐾\r\n\x1b[?2026h${remove(49374)}\x1b7\x1b[3;103H${draw(49374)}\x1b8\x1b[?2026l끝`;
  const output = await filter([...Buffer.from(input)].map(byte => Buffer.from([byte])));
  assert.equal(output.replaceAll(`i=${ids(output)[0]},`, 'i=49374,'), input);
  assert.equal(new Set(ids(output)).size, 1);
});

test('chunked PNG transfers, placement, and clears outside synchronized redraws keep the same session ID', async () => {
  const input = `\x1b_Ga=T,t=d,f=100,i=49374,m=1;YWJj${stop}\x1b_Gm=0;ZGVm${stop}` +
    `\x1b_Ga=p,p=1,i=49374;${stop}${remove(49374)}`;
  const output = await filter([input]);
  assert.equal(new Set(ids(output)).size, 1);
  assert.equal(output.replaceAll(`i=${ids(output)[0]}`, 'i=49374'), input);
});

test('other images, text, Sixel and incomplete or oversized headers pass through unchanged', async () => {
  const inputs = [draw(493740), draw(42), 'i=49374, text', '\x1bP0;1;0qSixel i=49374;\x1b\\',
    '\x1b_Gunfinished', '\x1b_', '\x1b_G' + 'x'.repeat(1025), '\x1b_Gbroken\x1b[i=49374;'];
  for (const input of inputs) assert.equal(await filter([input]), input);
});
