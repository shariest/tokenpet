import type { TestContext } from 'node:test';
import type { Activity, Draw } from '../dist/src/types.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../dist/src/game.js';
import { statusText, statusSummary, gachaSummary, activityText, rulesText, dexText } from '../dist/src/terminal.js';

async function state(t: TestContext) {
  const game = await Game.open(':memory:', { now: () => 1_000_000, random: () => 0 });
  t.after(() => game.close());
  return await game.state();
}

test('status explains low needs, growth and an actionable next step inside either CLI', async t => {
  const s = await state(t);
  s.active = { ...s.active, hunger: 25, happiness: 5, energy: 0, hygiene: 0, xp: 40, level: 2, nextLevelXp: 100 };
  const output = statusText(s, false);
  assert.match(output, /포만감 [■·]{10} 25\/100 · 배고파요/);
  assert.match(output, /기분 [■·]{10} 5\/100 · 심심해요/);
  assert.match(output, /에너지 [■·]{10} 0\/100 · 피곤해요/);
  assert.match(output, /청결 [■·]{10} 0\/100 · 씻고 싶어요/);
  assert.ok(output.includes('feed (5 C)'));
  assert.ok(output.includes('경험치 40/100 XP · 다음 레벨까지 60 XP'));
  assert.ok(output.includes('Codex $pet help · Claude /pet help'));
  assert.ok(output.includes('오늘 출석 보상 +100 C · checkin으로 받기'));
  const rules = rulesText(s);
  assert.ok(rules.includes('10,000토큰당 1 C · 20,000토큰당 1 XP'));
  assert.ok(rules.includes('7일째부터 매일 220 C'));
  assert.ok(rules.includes('gacha <횟수>'));
  assert.ok(rules.includes('전체 비용이 부족하면 한 번도 뽑지 않습니다'));
  assert.ok(rules.includes('유니크 50번째·레전더리 100번째 확정'));
  assert.ok(rules.includes('해당 카운트만 초기화'));
  s.active.hunger = 60;
  assert.ok(statusText(s, false).includes('sleep (무료)'));
  assert.ok(!statusText(s, false).includes('play (무료)'), 'do not suggest play without enough energy');
  s.active.sleeping = true;
  const sleeping = statusText(s, false);
  assert.ok(sleeping.includes('자는 중 · wake로 깨우기'));
  assert.ok(sleeping.includes('list → equip <id>'));
  assert.ok(!sleeping.includes('feed (5 C)'));
  s.active.nextLevelXp = null;
  assert.ok(statusText(s, false).includes('최고 레벨'));
  assert.ok(!statusText(s, false).includes('다음 레벨까지'));
});

test('terminal catalog paginates, searches unowned pets and keeps ownership and selection visible', async t => {
  const s = await state(t);
  const owned = dexText(s);
  assert.ok(owned.includes('보유 목록 1종'));
  assert.ok(owned.includes('sprout · 함께하는 중'));
  assert.ok(!owned.includes('미보유'));
  const first = dexText(s, { all: true });
  const second = dexText(s, { all: true, page: 2 });
  assert.ok(first.includes('전체 목록 360종 · 1/15페이지'));
  assert.equal(first.split('\n').filter(line => /^\d{3} /.test(line)).length, 24);
  assert.ok(first.includes(s.catalog[23].id));
  assert.ok(!first.includes(s.catalog[24].id));
  assert.ok(second.includes(s.catalog[24].id));
  assert.ok(second.includes('미보유'));
  assert.ok(!first.includes('\x1b'), 'MCP text never includes terminal escape sequences');
  assert.ok(dexText(s, { color: true }).includes('\x1b[0;38;2;'), 'interactive terminals get colored thumbnails');
  const blocks = first.split(/\n(?=\d{3} )/).slice(1);
  for (const block of blocks) assert.match(block, /[▀▄█]/, 'every pet, including unowned pets, has a thumbnail');
  assert.notEqual(blocks[0].split('\n').slice(1, 7).map(line => line.slice(0, 14)).join('\n'),
    blocks[1].split('\n').slice(1, 7).map(line => line.slice(0, 14)).join('\n'), 'different species have different silhouettes');
  const search = dexText(s, { all: true, tier: 'legendary', query: 'CAT' });
  assert.ok(search.includes('celestial-cat'));
  assert.ok(!search.includes('forest-cat'));
  assert.ok(dexText(s, { all: true, query: '없는 친구' }).includes('조건에 맞는 친구가 없어요.'));
  assert.throws(() => dexText(s, { page: 2 }), /1~1/);
  for (const page of [0, -1, 1.5, NaN]) assert.throws(() => dexText(s, { page }), /정수/);
});

test('owned pet lists show independent sleep and care states without changing selection', async t => {
  const s = await state(t);
  s.pets[0].sleeping = true;
  s.pets[0].energy = 35;
  s.pets.push({ ...s.pets[0], ...s.catalog[1], sleeping: false, energy: 73 });
  const before = JSON.stringify(s);
  const output = dexText(s);
  assert.match(output, /sprout · 함께하는 중 · 자는 중\n[^]*포만감 85\/100\n[^]*기분 85\/100\n[^]*에너지 35\/100\n[^]*청결 85\/100/);
  assert.match(output, /forest-cat · 대기 · 깨어 있음\n[^]*포만감 85\/100\n[^]*기분 85\/100\n[^]*에너지 73\/100\n[^]*청결 85\/100/);
  assert.ok(output.includes('무료 · 수면 상태 유지'));
  assert.ok(output.includes('에너지 +20/시간'));
  assert.equal(JSON.stringify(s), before);
});

test('terminal summaries keep essential state and page boundaries without art', async t => {
  const s = await state(t);
  assert.match(statusSummary(s), /출석 \+100 C: checkin/);
  assert.match(statusSummary(s), /유니크까지 최대 50회 · 전설까지 최대 100회/);
  s.player.pity = 99; s.player.unique_pity = 49;
  assert.match(statusSummary(s), /유니크까지 최대 2회 · 전설까지 최대 1회/);
  s.player.pity = 0; s.player.unique_pity = 50;
  assert.match(statusSummary(s), /유니크까지 최대 1회 · 전설까지 최대 100회/);
  s.player.unique_pity = 0;
  s.active = { ...s.active, sleeping: true, level: 50, nextLevelXp: null };
  const summary = statusSummary(s);
  assert.match(summary, /최고 레벨/); assert.match(summary, /자는 중 · wake로 깨우기/);
  assert.doesNotMatch(summary, /[▀▄█■]|null|undefined/);
  assert.ok(summary.length < 300);
  s.active.sleeping = false; s.active.energy = 0;
  assert.match(statusSummary(s), /sleep \(무료\)/);
  const rows = (output: string) => output.split('\n').filter(line => /^\d{3} /.test(line));
  const ids = [];
  for (let page = 1; page <= 36; page++) {
    const brief = dexText(s, { all: true, detail: false, pageSize: 10, page });
    assert.equal(rows(brief).length, 10); assert.doesNotMatch(brief, /[▀▄█]/);
    assert.ok(brief.length < 1100);
    ids.push(...rows(brief));
    if (page === 2) assert.deepEqual(rows(dexText(s, { all: true, pageSize: 10, page })), rows(brief));
  }
  assert.equal(new Set(ids).size, 360);
  assert.throws(() => dexText(s, { all: true, detail: false, pageSize: 10, page: 37 }), /1~36/);
});

test('terminal gacha summary bounds large draws but retains totals, rarity, new pets and spending', async t => {
  const s = await state(t);
  const common = s.catalog.filter(p => p.tier === 'common');
  const legendary = s.catalog.find(p => p.tier === 'legendary')!;
  const results = [
    ...common.slice(0, 12).map(p => ({ ...p, isNew: false })),
    { ...common[12], isNew: true },
    { ...legendary, isNew: true, guaranteed: true },
    ...Array.from({ length: 126 }, () => ({ ...common[0], isNew: false })),
  ] as Draw[]; // partial draws omit duplicateXp and most guaranteed flags
  const before = JSON.stringify(results);
  const summary = gachaSummary({ results, state: s });
  assert.match(summary, /뽑기 140회 · 신규 2종 · 중복 138회 .*천장 1회/);
  assert.match(summary, /common 139 · legendary 1/);
  assert.match(summary, /\[common\] ×127 · sprout/);
  assert.match(summary, /외 4종 생략/);
  assert.match(summary, /14000 C 사용 · 잔액 300 C · 유니크까지 최대 50회 · 전설까지 최대 100회/);
  const rows = summary.split('\n').filter(line => /\[\w+\]/.test(line));
  assert.equal(rows.length, 10);
  assert.ok(rows[0].includes(legendary.id)); assert.ok(rows[0].includes('NEW'));
  assert.ok(rows[1].includes(common[12].id)); assert.ok(rows[1].includes('NEW'));
  assert.ok(summary.length < 1000);
  assert.equal(JSON.stringify(results), before);
  const duplicate = gachaSummary({ results: [{ ...legendary, isNew: true }, { ...legendary, isNew: false }] as Draw[], state: s });
  assert.match(duplicate, /신규 1종 · 중복 1회/);
  assert.match(duplicate, /\[legendary\] ×2 .* NEW/);
  const single = gachaSummary({ results: [{ ...common[0], isNew: false }] as Draw[], state: s });
  assert.match(single, /뽑기 1회 · 신규 0종 · 중복 1회/);
  assert.match(single, /100 C 사용/); assert.doesNotMatch(single, /생략|NEW/);
});

test('terminal activity summary limits entries and long gacha labels while retaining charges', async t => {
  const s = await state(t);
  s.activity = Array.from({ length: 20 }, (_, i) => ({ created: i * 1000, label: '별의 루루 +25 XP · '.repeat(140), coins: -14000 })) as Activity[];
  const compact = activityText(s, true), detailed = activityText(s);
  assert.equal(compact.split('\n').filter(line => line.startsWith('1970-')).length, 5);
  assert.equal(detailed.split('\n').filter(line => line.startsWith('1970-')).length, 20);
  assert.match(compact, /… · -14000 C/); assert.ok(compact.length < 1000);
  assert.ok(detailed.includes(s.activity[0].label));
});
