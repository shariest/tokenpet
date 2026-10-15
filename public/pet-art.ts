import type { Portrait, Collection } from '../src/types.js';

export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

export function petPixels(pet: Portrait, blink = false): { grid: string[][]; palette: Record<string, string> } {
  const grid = Array.from({ length: 24 }, () => Array(24).fill(' '));
  const rect = (x: number, y: number, w: number, h: number, c = 'b') => {
    for (let j = Math.max(0, y); j < Math.min(24, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(24, x + w); i++) grid[j][i] = c;
  };
  const oval = (x: number, y: number, rx: number, ry: number, c = 'b') => {
    for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++)
      if (((i - x) / rx) ** 2 + ((j - y) / ry) ** 2 <= 1) grid[j][i] = c;
  };
  const s = pet.shape;
  if (['squirrel', 'fox', 'otter', 'dino', 'dragon', 'cat'].includes(s)) { oval(19, 16, 3, 3); rect(20, 11, 2, 5); }
  if (['bat', 'dragon', 'butterfly'].includes(s)) { oval(4, 12, 3, 5, 'a'); oval(20, 12, 3, 5, 'a'); }
  if (s === 'hedgehog') for (let x = 4; x < 21; x += 3) { rect(x, 8, 1, 10, 'a'); rect(x - 1, 10, 3, 7, 'a'); }
  if (s === 'axolotl') for (const x of [3, 19]) { rect(x, 9, 2, 8, 'p'); rect(x - 1, 9, 4, 1, 'p'); rect(x - 1, 13, 4, 1, 'p'); }
  if (s === 'crab') { rect(2, 10, 3, 5); rect(19, 10, 3, 5); rect(1, 8, 2, 3); rect(21, 8, 2, 3); }
  if (s === 'fish') { rect(19, 11, 2, 7); rect(21, 9, 2, 11); }
  if (s === 'whale') { rect(19, 14, 4, 4); rect(21, 11, 2, 5); rect(10, 5, 1, 4, 'a'); rect(8, 4, 5, 1, 'a'); }
  if (s === 'cactus') { rect(3, 10, 3, 7); rect(5, 15, 3, 2); rect(19, 8, 2, 7); rect(17, 13, 3, 2); }
  oval(12, 14, s === 'whale' ? 8 : 6, s === 'cactus' ? 7 : 5);
  if (s === 'jelly') { oval(12, 11, 8, 4); rect(8, 9, 3, 1, 'w'); }
  if (['bear', 'panda', 'hamster', 'koala', 'otter'].includes(s)) {
    oval(7, 8, s === 'koala' ? 3 : 2, 2, s === 'panda' ? 'd' : 'b'); oval(17, 8, s === 'koala' ? 3 : 2, 2, s === 'panda' ? 'd' : 'b');
  }
  if (['cat', 'fox', 'owl'].includes(s)) { rect(6, 6, 2, 5); rect(8, 8, 2, 3); rect(17, 6, 2, 5); rect(15, 8, 2, 3); }
  if (s === 'bunny') { rect(7, 3, 3, 8); rect(15, 3, 3, 8); rect(8, 4, 1, 5, 'p'); rect(16, 4, 1, 5, 'p'); }
  if (s === 'dog') { rect(5, 9, 3, 7, 'a'); rect(17, 9, 3, 7, 'a'); }
  if (s === 'sprout') { rect(12, 6, 1, 4, 'a'); oval(9, 5, 3, 1, 'a'); oval(15, 3, 2, 2, 'a'); }
  if (s === 'mushroom') { rect(8, 13, 9, 7, 'w'); oval(12, 9, 9, 4); rect(8, 7, 2, 2, 'w'); rect(15, 9, 3, 2, 'w'); }
  if (['dragon', 'dino'].includes(s)) { rect(8, 7, 2, 3, 'a'); rect(16, 6, 2, 4, 'a'); rect(17, 11, 3, 2, 'a'); }
  if (s === 'turtle') { oval(12, 16, 7, 4, 'a'); oval(12, 10, 4, 3); }
  if (s === 'frog') { oval(8, 9, 3, 2); oval(16, 9, 3, 2); }
  if (['penguin', 'panda', 'bear', 'fox', 'otter', 'hamster', 'bee'].includes(s)) oval(12, 15, 4, 3, 'w');
  if (s === 'bee') { rect(6, 15, 13, 1, 'a'); rect(7, 18, 11, 1, 'a'); oval(6, 8, 3, 2, 'w'); oval(18, 8, 3, 2, 'w'); }
  if (s === 'hamster') { oval(6, 16, 2, 2, 'w'); oval(18, 16, 2, 2, 'w'); }
  if (s === 'butterfly') { oval(3, 11, 1, 2, 'p'); oval(21, 11, 1, 2, 'p'); rect(10, 6, 1, 3, 'd'); rect(14, 6, 1, 3, 'd'); }
  if (s === 'parrot') { rect(11, 6, 2, 4, 'p'); oval(18, 14, 2, 4, 'a'); }
  if (s === 'chick') { rect(11, 7, 1, 3); rect(12, 6, 1, 3); }
  if (s === 'snail') { oval(8, 13, 5, 5, 'a'); oval(8, 13, 3, 3); rect(8, 12, 1, 3, 'a'); rect(17, 7, 1, 5); rect(20, 7, 1, 5); }
  if (s === 'slime') { oval(12, 17, 8, 3); rect(9, 10, 3, 2, 'w'); }
  if (s === 'robot') { rect(5, 9, 15, 10); rect(7, 11, 11, 5, 'w'); rect(12, 5, 1, 4, 'd'); rect(11, 4, 3, 2, 'p'); rect(3, 12, 2, 4, 'a'); rect(20, 12, 2, 4, 'a'); }
  if (s === 'ghost') { rect(6, 16, 13, 3); rect(6, 19, 3, 2); rect(11, 19, 3, 2); rect(16, 19, 3, 2); }
  else if (['octopus', 'jelly'].includes(s)) { for (let x = 6; x < 20; x += 4) rect(x, 17, 2, 5); }
  else { rect(7, 19, 4, 2, ['duck', 'chick', 'penguin'].includes(s) ? 'a' : 'b'); rect(15, 19, 4, 2, ['duck', 'chick', 'penguin'].includes(s) ? 'a' : 'b'); }
  if (s === 'owl') { oval(8, 12, 3, 3, 'w'); oval(16, 12, 3, 3, 'w'); }
  if (s === 'panda') { oval(8, 12, 2, 2, 'd'); oval(16, 12, 2, 2, 'd'); }
  const eyeY = s === 'turtle' ? 9 : 12;
  rect(8, eyeY, 2, pet.sleeping || blink ? 1 : 2, 'd'); rect(15, eyeY, 2, pet.sleeping || blink ? 1 : 2, 'd');
  rect(6, 15, 2, 1, 'p'); rect(17, 15, 2, 1, 'p'); rect(11, 16, 3, 1, 'd');
  if (['duck', 'chick', 'parrot', 'penguin', 'owl'].includes(s)) rect(11, 14, s === 'duck' ? 5 : 2, 2, 'a');
  if (s === 'koala') rect(11, 12, 3, 3, 'd');
  const variant = pet.variant || 0;
  if (variant === 0) { rect(18, 6, 2, 2, 'a'); rect(20, 5, 2, 1, 'a'); }
  if (variant === 1) { rect(18, 5, 3, 1, 'p'); rect(19, 4, 1, 3, 'p'); }
  if (variant === 2) { rect(18, 6, 4, 1, 'w'); rect(19, 5, 2, 1, 'a'); }
  if (variant === 3) { rect(19, 3, 1, 3, 'a'); rect(18, 5, 3, 2, 'a'); }
  if (variant === 4) { rect(20, 3, 1, 5, 'p'); rect(18, 4, 1, 3, 'p'); rect(19, 6, 3, 1, 'p'); }
  if (variant === 5) { rect(19, 3, 1, 5, 'w'); rect(17, 5, 5, 1, 'w'); }
  if (variant === 6) { rect(18, 3, 2, 4, 'a'); rect(20, 6, 2, 1, 'a'); }
  if (variant === 7) { rect(19, 3, 1, 5, 'p'); rect(18, 5, 3, 3, 'p'); rect(19, 6, 1, 2, 'w'); }
  if (variant === 8) { rect(17, 5, 3, 1, 'a'); rect(19, 4, 3, 1, 'p'); rect(18, 6, 3, 1, 'w'); }
  if (variant === 9 || (pet.level || 0) >= 10) { rect(9, 3, 7, 2, 'a'); for (const x of [9, 12, 15]) rect(x, 1, 1, 3, 'a'); }
  const outlined = grid.map(row => [...row]);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (grid[y][x] !== ' ')
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (grid[y + dy]?.[x + dx] === ' ') outlined[y + dy][x + dx] = 'o';
  return { grid: outlined, palette: { b: /^#[a-f0-9]{6}$/i.test(pet.color) ? pet.color : '#9bb97c', a: variant === 9 ? '#b58335' : '#64866b', d: '#303e35', o: '#465745', w: '#fff4dc', p: '#db9b8f' } };
}
export function sprite(pet: Portrait, className = '') {
  const { grid, palette } = petPixels(pet);
  return `<svg class="pet-sprite ${escapeHtml(className)}" viewBox="0 0 24 24" role="img" aria-label="${escapeHtml(pet.name)}" shape-rendering="crispEdges">${grid.flatMap((row, y) => row.map((c, x) => c === ' ' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[c]}"/>`)).join('')}</svg>`;
}
export function collectionHTML(collection: Collection) {
  const owned = new Map(collection.pets.map(p => [p.id, p]));
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(collection.name)} · TokenPet</title><style>body{background:#f7f5ed;color:#334638;font:16px sans-serif;max-width:1100px;margin:60px auto;padding:24px}h1{font-size:36px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.pet{background:white;padding:20px;text-align:center;border:1px solid #dedfd5;border-radius:16px}.pet-sprite{width:110px;display:block;margin:auto}small{color:#718074}</style><small>TOKENPET / COLLECTION</small><h1>${escapeHtml(collection.name)}</h1><p>${owned.size} / ${collection.catalog.length} 친구와 함께한 기록</p><div class="grid">${collection.catalog.filter(p => owned.has(p.id)).map(p => `<div class="pet">${sprite(p)}<h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(collection.tiers.find(t => t.id === p.tier)!.name)} · Lv.${owned.get(p.id)!.level}</p><small>보유 ${owned.get(p.id)!.copies}마리</small></div>`).join('')}</div></html>`;
}
