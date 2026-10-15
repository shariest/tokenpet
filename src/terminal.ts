import type { Portrait, Pet, Vital, GameState, GachaResult, Draw, TierId, CareAction } from './types.js';

import { emitKeypressEvents } from 'node:readline';
import { petPixels } from '../public/pet-art.js';
import { request } from './client.js';

function careHint(p: Pick<Pet, Vital | 'sleeping'>, prefix = '') {
  if (p.sleeping) return `자는 중 · ${prefix}wake로 깨우기`;
  if (p.hunger < 30) return `배고파요 · ${prefix}feed (5 C)`;
  if (p.energy < 30) return `피곤해요 · ${prefix}sleep (무료)`;
  if (p.hygiene < 30) return `씻고 싶어요 · ${prefix}clean (3 C)`;
  if (p.happiness < 30) return `심심해요 · ${prefix}play (무료)`;
  return `잘 지내요 · ${prefix}help로 명령 보기`;
}
function pityText({ player, rules }: GameState) {
  const legendary = rules.pityAt - player.pity;
  const unique = Math.max(1, rules.uniquePityAt - player.unique_pity);
  return `유니크까지 최대 ${unique + (unique === legendary ? 1 : 0)}회 · 전설까지 최대 ${legendary}회`;
}

export function terminalPet(pet: Portrait, { color = process.stdout.isTTY && !process.env.NO_COLOR, blink = false, compact = false, small = false } = {}) {
  let { grid, palette } = petPixels(pet, blink);
  if (small) grid = grid.filter((_, y) => y % 2).map(row => row.filter((_, x) => x % 2));
  if (!color && !compact) return grid.map(row => row.map(c => c === ' ' ? ' ' : c === 'd' ? 'o' : c === 'o' ? '·' : '█').join('')).join('\n');
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';');
  const lines = [];
  for (let y = 0; y < grid.length; y += 2) {
    lines.push(grid[y].map((top, x) => {
      const bottom = grid[y + 1][x];
      if (!color) { const a = top !== ' ' && top !== 'd', b = bottom !== ' ' && bottom !== 'd'; return a ? b ? '█' : '▀' : b ? '▄' : ' '; }
      if (top === ' ' && bottom === ' ') return '\x1b[0m ';
      if (top === ' ') return `\x1b[0;38;2;${rgb(palette[bottom])}m▄`;
      return `\x1b[0;38;2;${rgb(palette[top])}m${bottom === ' ' ? '' : `\x1b[48;2;${rgb(palette[bottom])}m`}▀`;
    }).join('') + (color ? '\x1b[0m' : ''));
  }
  return lines.join('\n');
}
export function petStatusLine(state: GameState, { columns = Number(process.env.COLUMNS) || 80, color = !process.env.NO_COLOR, blink = false } = {}) {
  const p = state.active;
  const info = [p.name + ` · Lv.${p.level}`, `${state.player.coins.toLocaleString()} C · 도감 ${state.pets.length}/${state.catalog.length}`,
    `포만감 ${Math.round(p.hunger)}/100 · 기분 ${Math.round(p.happiness)}/100`, `에너지 ${Math.round(p.energy)}/100 · 청결 ${Math.round(p.hygiene)}/100`,
    careHint(p, '/pet '), '/pet help · 전체 명령'];
  const textWidth = (s: string) => [...s].reduce((width, c) => width + (/\p{Script=Hangul}/u.test(c) ? 2 : 1), 0);
  const width = 14 + Math.max(...info.map(textWidth));
  const padding = ' '.repeat(Math.max(0, Math.min(500, Math.floor(columns)) - width - 4));
  const art = terminalPet(p, { color, small: true, compact: true, blink }).split('\n');
  if (columns < width + 4) return art.join('\n') + '\n' + `${p.name} Lv.${p.level} · ${state.player.coins} C\n포만감 ${Math.round(p.hunger)}/100\n${careHint(p)}`;
  return art.map((line, i) => padding + line + '  ' + info[i]).join('\n');
}
export function statusText(state: GameState, art = true) {
  const p = state.active;
  const a = state.attendance;
  const attendance = a ? a.claimed ? `출석 완료 · 연속 ${a.streak}일 · 오늘 +${a.coins} C · 내일 +${a.nextCoins} C`
    : `오늘 출석 보상 +${a.coins} C · checkin으로 받기` : '';
  const vitals: [string, number, string, string][] = [['포만감', p.hunger, '배고파요', '든든해요'], ['기분', p.happiness, '심심해요', '좋아요'],
    ['에너지', p.energy, '피곤해요', '활기차요'], ['청결', p.hygiene, '씻고 싶어요', '깨끗해요']];
  const xp = p.nextLevelXp === null ? `경험치 ${p.xp} XP · 최고 레벨` : `경험치 ${p.xp}/${p.nextLevelXp} XP · 다음 레벨까지 ${p.nextLevelXp - p.xp} XP`;
  return `${art ? terminalPet(p, { compact: true }) + '\n' : ''}${state.player.name}\n${p.sleeping ? '(-ᴥ-)' : '(•ᴥ•)'} ${p.name} · Lv.${p.level} ${p.stage}\n` +
    vitals.map(([label, value, low, normal]) => `${label} ${'■'.repeat(Math.round(value / 10))}${'·'.repeat(10 - Math.round(value / 10))} ${Math.round(value)}/100 · ${value < 30 ? low : normal}`).join('\n') +
    `\n${careHint(p)}${p.sleeping ? '\n다른 친구 키우기: list → equip <id> · 이 펫은 계속 자면서 회복합니다.' : ''}\n${xp}\n${state.player.coins.toLocaleString()} C · 도감 ${state.pets.length}/${state.catalog.length} · ${pityText(state)}\n${attendance}\n명령: Codex $pet help · Claude /pet help`;
}

export function statusSummary(state: GameState) {
  const p = state.active, a = state.attendance;
  return [
    `${state.player.name} · ${p.name} Lv.${p.level}${p.sleeping ? ' · 자는 중' : ''}`,
    `포만감 ${Math.round(p.hunger)}/100 · 기분 ${Math.round(p.happiness)}/100 · 에너지 ${Math.round(p.energy)}/100 · 청결 ${Math.round(p.hygiene)}/100`,
    `경험치 ${p.xp}${p.nextLevelXp === null ? ' XP · 최고 레벨' : `/${p.nextLevelXp} XP`} · ${state.player.coins.toLocaleString()} C · 도감 ${state.pets.length}/${state.catalog.length} · ${pityText(state)}`,
    ...(a ? [a.claimed ? `출석 완료 · 연속 ${a.streak}일 · 오늘 +${a.coins} C · 내일 +${a.nextCoins} C` : `출석 +${a.coins} C: checkin`] : []),
    ...(p.sleeping || Math.min(p.hunger, p.happiness, p.energy, p.hygiene) < 30 ? [careHint(p)] : []),
  ].join('\n');
}

export function gachaSummary({ results, state }: GachaResult) {
  const groups = new Map<string, Draw & { count: number }>(), counts = new Map<TierId, number>();
  for (const p of results) {
    const group = groups.get(p.id) || { ...p, count: 0 };
    group.count++; group.isNew ||= p.isNew;
    groups.set(p.id, group);
    counts.set(p.tier, (counts.get(p.tier) || 0) + 1);
  }
  const rank = new Map(state.tiers.map((t, i) => [t.id, i]));
  const pets = [...groups.values()].sort((a, b) => rank.get(b.tier)! - rank.get(a.tier)! || Number(b.isNew) - Number(a.isNew));
  const newCount = results.filter(p => p.isNew).length;
  return [
    `뽑기 ${results.length}회 · 신규 ${newCount}종 · 중복 ${results.length - newCount}회 (+25 XP/회) · 천장 ${results.filter(p => p.guaranteed).length}회`,
    state.tiers.filter(t => counts.has(t.id)).map(t => `${t.id} ${counts.get(t.id)}`).join(' · '),
    ...pets.slice(0, 10).map(p => `${p.name} [${p.tier}] ×${p.count} · ${p.id}${p.isNew ? ' · NEW' : ''}`),
    ...(pets.length > 10 ? [`외 ${pets.length - 10}종 생략 (높은 등급·신규 우선) · 보유 목록: list`] : []),
    `${results.length * state.rules.pullCost} C 사용 · 잔액 ${state.player.coins} C · ${pityText(state)}`,
  ].join('\n');
}

export function rulesText(state: GameState) {
  return [
    `첫 지급: ${state.rules.welcomeCoins} C + 일반 가챠와 같은 등급 확률의 무료 랜덤 펫 1마리. 첫 펫은 바로 선택되며 유료 뽑기 횟수·천장 카운트에는 포함하지 않습니다.`,
    '돌봄 수치는 0~100이며 높을수록 좋습니다. 30 미만이면 돌봄이 필요해요.',
    `feed · ${state.care.feed.cost} C · 포만감 +25 · 기분 +5 · 경험치 +10 (수치는 100까지)`,
    'play · 무료 · 기분 +25 · 에너지 -10 · 경험치 +10 (에너지 10 이상 필요)',
    `clean · ${state.care.clean.cost} C · 청결 +35 · 경험치 +10 (100까지)`,
    'sleep / wake · 무료 · 자는 동안 에너지 +20/시간 · 자는 중에는 먼저 wake 후 돌봄',
    '교대: sleep → list → equip <id> · 선택은 무료이며 각 펫의 수면 상태를 유지합니다. 다른 펫을 키우는 동안에도 잠든 펫은 회복합니다.',
    '돌봄과 코딩 경험치는 현재 선택한 펫에게, 코인은 공용 지갑에 쌓입니다.',
    `같은 돌봄은 ${state.rules.careCooldownMs / 1000}초마다 가능합니다. 잠들기·깨우기는 경험치를 주지 않습니다.`,
    '선택한 펫만 시간당 포만감 -2 · 기분 -1 · 청결 -1.5, 깨어 있으면 에너지 -2. 대기 중인 펫은 다른 수치를 유지하며 깨어 있으면 에너지 +2/시간, 잠들면 +20/시간. CLI를 꺼둔 시간도 반영하며 죽거나 사라지지 않습니다.',
    `코딩 ${state.rules.tokensPerCoin.toLocaleString()}토큰당 1 C · ${(state.rules.tokensPerCoin * 2).toLocaleString()}토큰당 1 XP. Claude·Codex 사용량을 합산합니다.`,
    `출석: CLI 시작 시 하루 한 번 자동 지급 (한국 시간 00시 기준). 기본 ${state.rules.checkinBaseCoins} C + 연속 하루마다 ${state.rules.checkinStepCoins} C, ${state.rules.checkinMaxDays}일째부터 매일 ${state.rules.checkinBaseCoins + (state.rules.checkinMaxDays - 1) * state.rules.checkinStepCoins} C. 하루 빠지면 1일차부터. 세션을 계속 켜뒀다면 checkin으로 받기.`,
    '성장: Lv.5 청소년 · Lv.10 성체 · 최고 Lv.50',
    `뽑기: gacha <횟수> · 1 이상의 정수, 생략 시 1회 · 1회 ${state.rules.pullCost} C · 요청한 전체 비용이 부족하면 한 번도 뽑지 않습니다. 중복 시 보유 수 +1, 해당 펫 경험치 +25`,
    ...state.tiers.map(t => `${t.name} (${t.id}) · ${t.chance}% · ${state.catalog.filter(p => p.tier === t.id).length}종`),
    `등급 내 확률은 같습니다. 유니크 ${state.rules.uniquePityAt}번째·레전더리 ${state.rules.pityAt}번째 확정, 각 등급 획득 시 해당 카운트만 초기화. 동시에 도달하면 레전더리 먼저, 다음 뽑기 유니크. ${pityText(state)}.`,
  ].join('\n');
}

export function activityText(state: GameState, compact = false) {
  const lines = [`잔액 ${state.player.coins.toLocaleString()} C · 누적 정산 ${state.player.tokens.toLocaleString()}토큰`];
  for (const source of ['claude', 'codex']) {
    const connection = state.connections.find(c => c.source === source);
    lines.push(connection ? `${source} · ${connection.tokens.toLocaleString()}토큰 · 마지막 수집 ${new Date(connection.last_seen).toISOString()}` : `${source} · 수집 기록 없음`);
  }
  if (state.collector) lines.push(`자동 수집 ${state.collector.enabled ? '켜짐' : '꺼짐'} · ${state.collector.files}개 파일 · 읽기 오류 ${state.collector.errors}개${state.collector.scanning ? ' · 스캔 중' : ''}`);
  const limit = compact ? 5 : 20;
  lines.push(`최근 활동 (최대 ${limit}건, 시간은 UTC)`);
  lines.push(...state.activity.slice(0, limit).map(a => {
    const label = compact && a.label.length > 120 ? `${Array.from(a.label).slice(0, 120).join('')}…` : a.label;
    return `${new Date(a.created).toISOString()} · ${label} · ${a.coins > 0 ? '+' : ''}${a.coins} C`;
  }));
  if (!state.activity.length) lines.push('아직 활동 기록이 없어요.');
  return lines.join('\n');
}

export function dexText(state: GameState, { tier, all = false, query, page = 1, color = false, detail = true, pageSize = 24 }: { tier?: TierId; all?: boolean; query?: string; page?: number; color?: boolean; detail?: boolean; pageSize?: number } = {}) {
  const owned = new Map(state.pets.map(p => [p.id, p]));
  const matches = state.catalog.filter(p => (all || owned.has(p.id)) && (!tier || p.tier === tier) &&
    (!query || `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase())));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error(`도감 페이지는 1~${pages}의 정수입니다.`);
  return [`도감 ${owned.size}/${state.catalog.length}종 보유 · ${all ? '전체' : '보유'} 목록 ${matches.length}종 · ${page}/${pages}페이지`,
    ...matches.slice((page - 1) * pageSize, page * pageSize).map(p => {
      const pet = owned.get(p.id);
      const row = `${String(p.number).padStart(3, '0')} ${p.name} [${p.tier}] · ${pet ? `Lv.${pet.level} ×${pet.copies}` : '미보유'} · ${p.id}` +
        (pet ? ` · ${p.id === state.player.equipped ? '함께하는 중' : '대기'} · ${pet.sleeping ? '자는 중' : '깨어 있음'}` : '');
      if (!detail) return row;
      const info = pet ? ['', `포만감 ${Math.round(pet.hunger)}/100`, `기분 ${Math.round(pet.happiness)}/100`,
        `에너지 ${Math.round(pet.energy)}/100`, `청결 ${Math.round(pet.hygiene)}/100`] : ['', '아직 만나지 못했어요'];
      const thumbnail = terminalPet({ ...p, ...pet }, { color, compact: true, small: true }).split('\n')
        .map((line, i) => `  ${line}  ${info[i] || ''}`.trimEnd()).join('\n');
      return row + `\n${thumbnail}\n`;
    }),
    ...(matches.length ? detail ? ['선택: equip <id> (무료 · 수면 상태 유지) · 다음 페이지: 같은 명령 끝의 페이지 번호 변경',
      '대기 중인 펫: 다른 수치 유지 · 깨어 있으면 에너지 +2/시간, 잠들면 에너지 +20/시간 · 돌봄: equip <id> 후 필요하면 wake']
      : [`선택: equip <id>${page < pages ? ` · 다음: page ${page + 1}` : ''}`] : ['조건에 맞는 친구가 없어요.']),
  ].join('\n');
}
export async function terminalUI() {
  let state: GameState = await request('/api/state');
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.log(statusText(state)); return; }
  let message = careHint(state.active), busy = false, closed = false, frame = 0;
  const draw = () => {
    if (closed) return;
    const pet = state.active;
    let lines = [ '  T O K E N P E T', '', ...terminalPet(pet, { color: !process.env.NO_COLOR, compact: true, blink: frame++ % 6 === 5 }).split('\n').map(s => `  ${s}`),
      '', `  ${pet.name}`, `  Lv.${pet.level} ${pet.stage} · ${state.player.coins.toLocaleString()} C`, '',
      ...([['포만감', pet.hunger], ['기분', pet.happiness], ['에너지', pet.energy], ['청결', pet.hygiene]] as [string, number][]).map(([label, n]) => `  ${label.padEnd(4)} ${'■'.repeat(Math.round(n / 10))}${'·'.repeat(10 - Math.round(n / 10))} ${Math.round(n)}/100`),
      '', `  도감 ${state.pets.length}/${state.catalog.length}`, `  ${pityText(state)}`, '',
      '  [f] 밥  [p] 놀이  [c] 목욕', '  [s] 잠/깨우기  [g] 뽑기', '  [d] 도감  [q] 닫기', '', `  ${message}` ];
    if ((process.stdout.rows || 40) < 34) lines = lines.filter(Boolean).filter(line => !line.includes('전설까지') && !line.startsWith('  도감 '));
    process.stdout.write('\x1b[H\x1b[J' + lines.slice(0, process.stdout.rows || 40).join('\n'));
  };
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  const cleanup = () => {
    if (closed) return; closed = true; clearInterval(timer);
    process.stdin.setRawMode(false); process.stdin.off('keypress', onKey); process.stdin.pause();
    process.off('SIGTERM', cleanup); process.off('SIGINT', cleanup);
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  };
  const onKey = async (_: string, key: import('node:readline').Key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return cleanup();
    if (busy) return;
    if (key.name === 'd') { message = state.pets.map(p => `${p.name}×${p.copies}`).join(' / '); draw(); return; }
    const actions: Partial<Record<string, CareAction>> = { f: 'feed', p: 'play', c: 'clean', s: state.active.sleeping ? 'wake' : 'sleep' };
    const action = actions[key.name || ''];
    if (!action && key.name !== 'g') return;
    busy = true;
    try {
      const result = await request(action ? '/api/care' : '/api/gacha', action ? { action } : { count: 1 });
      state = result.state; message = 'message' in result ? result.message : result.results.map(p => `${p.name}${p.isNew ? ' NEW!' : ' 중복 +25 XP'}`).join(', ');
    } catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { busy = false; draw(); }
  };
  process.stdin.on('keypress', onKey); process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try { state = await request('/api/state'); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { busy = false; draw(); }
  }, 2000);
  draw();
}
