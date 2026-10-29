import type { ApiResponses, ApiToken, ServerState, Collection, Directory, Identity, Ranking, RankingEntry, Species, Pet, Cli } from '../src/types.js';

import { sprite, escapeHtml as esc, collectionHTML } from './pet-art.js';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
const tabs = ['home', 'dex', 'hatch', 'connect', 'ranking'];
let state: ServerState | null = null, shared: Collection | undefined, directory: Directory | undefined;
let identity: Partial<Identity> = {}, tokens: ApiToken[] = [], ranking: Ranking | null = null;
let rankingType: Ranking['type'] = 'level', rankingPage = 1, rankingRange: { from: string; to: string } | null = null, rankingRequest = 0, loadRequest = 0;
let tab = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home', filter = 'all', search = '', page = 0, busy = false;
let toastTimer: number | undefined;
const fmt = (n: number) => Number(n).toLocaleString('ko-KR');
const modal = $<HTMLDialogElement>('#modal');
const tier = (id: string) => (shared || state || directory)!.tiers.find(t => t.id === id)!;
const pill = (id: string) => `<span class="tag" style="color:${tier(id).color}">${tier(id).name}</span>`;
const button = (label: string, id: string, classes = 'secondary') => `<button class="${classes}" id="${id}">${label}</button>`;
function toast(message: string) {
  $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
type ApiPath = keyof ApiResponses | `/api/rankings?${string}` | `/api/share/${string}` | `/api/tokens/${string}`;
type ApiResponse<P extends ApiPath> = P extends keyof ApiResponses ? ApiResponses[P] : P extends `/api/rankings?${string}` ? Ranking : P extends `/api/share/${string}` ? Collection : { ok: boolean };
function api(path: '/api/tokens', data: { days: number }): Promise<ApiToken & { token: string }>;
function api<P extends ApiPath>(path: P, data?: unknown, method?: string): Promise<ApiResponse<P>>;
async function api(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST'): Promise<unknown> {
  const response = await fetch(path, { method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) { throw Object.assign(new Error(result.error), { status: response.status }); }
  return result;
}
modal.addEventListener('close', () => { if (!modal.open) $('#modal-content').replaceChildren(); });
modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
function closeModal() { modal.close(); $('#modal-content').replaceChildren(); }
function openModal(html: string) {
  $('#modal-content').innerHTML = html;
  const title = $('#modal-content h2'); if (title) { title.id = 'modal-title'; modal.setAttribute('aria-labelledby', 'modal-title'); }
  if (!modal.open) modal.showModal();
}
function heading(eyebrow: string, title: string, description: string, action = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function welcome() {
  const friends = ['forest-cat', 'celestial-fox', 'sprout'].map(id => directory!.catalog.find(p => p.id === id)).filter((pet): pet is Species => !!pet);
  return `<section class="welcome"><div class="welcome-copy"><p class="eyebrow">A SMALL COMPANION FOR BIG IDEAS</p><h1>오늘 만든 코드가<br>내일의 친구를 키워요.</h1><p>개발하고, 돌보고, 새로운 친구를 만나세요.<br>Claude와 Codex의 작업이 작은 성장으로 쌓입니다.</p><div class="welcome-actions"><button class="primary" data-auth="signup">나의 첫 친구 만나기 ↗</button><button class="text-button" data-tab="dex">360종 도감 둘러보기</button></div><small>가입하면 첫 친구와 300 C · 무료로 시작해요</small></div><div class="welcome-garden"><span class="garden-label">LITTLE FRIENDS, BIG POSSIBILITIES</span>${friends.map((p, i) => `<div class="garden-friend friend-${i}">${sprite(p)}<span>${esc(p.name)}</span></div>`).join('')}<span class="garden-ground">YOUR NEXT CHAPTER STARTS HERE.</span></div></section>
    <div class="welcome-facts"><div><b>360</b><span>서로 다른 작은 친구들</span></div><div><b>10,000</b><span>작업 토큰마다 1 C</span></div><div><b>20,000</b><span>작업 토큰마다 1 XP</span></div></div>
    <div class="section-heading"><h2>조금씩, 함께 자라는 방법</h2><span class="eyebrow">HOW IT WORKS</span></div><div class="journey"><article><span>01 / MEET</span><h3>나의 작업실을 열어요</h3><p>아이디와 닉네임으로 가입하고 첫 친구를 만나세요. 비밀번호는 12자 이상으로 정해 주세요.</p></article><article><span>02 / CONNECT</span><h3>터미널과 연결해요</h3><p>내 연결 토큰 하나로 Claude와 Codex를 연결하세요. 대화와 코드는 전송하지 않아요.</p></article><article><span>03 / GROW</span><h3>함께한 기록을 쌓아요</h3><p>코딩과 돌봄으로 친구를 키우고, 도감과 두 가지 랭킹에서 성장을 확인하세요.</p></article></div>`;
}
function authDialog(mode = 'login') {
  const signup = mode === 'signup';
  openModal(`<p class="eyebrow">YOUR OWN LITTLE WORKSPACE</p><h2>${signup ? '첫 친구를 만나러 가요.' : '다시 만나서 반가워요.'}</h2><p>${signup ? '닉네임과 펫 성장·수집 기록은 랭킹에 공개돼요. 아이디는 공개하지 않아요.' : '아이디와 비밀번호로 나의 작업실을 열어요.'}</p><form id="auth-form" data-mode="${mode}"><label for="auth-username">아이디</label><input class="form-input" id="auth-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[a-zA-Z0-9_]{3,32}" minlength="3" maxlength="32" placeholder="영문·숫자·밑줄 3~32자" required>${signup ? '<label for="auth-nickname">공개 닉네임</label><input class="form-input" id="auth-nickname" name="nickname" autocomplete="nickname" maxlength="20" placeholder="랭킹에 표시할 이름" required>' : ''}<label for="auth-password">비밀번호</label><input class="form-input" id="auth-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="12" maxlength="128" placeholder="12~128자" required><p class="form-error" role="alert"></p><button class="primary" type="submit">${signup ? '작업실 만들기' : '로그인'}</button><button type="button" class="text-button" data-auth="${signup ? 'login' : 'signup'}">${signup ? '이미 계정이 있어요' : '처음 오셨나요? 회원가입'}</button></form>${signup ? '<p class="auth-note">이메일을 받지 않아 비밀번호 찾기는 제공하지 않아요. 비밀번호 관리자에 저장해 주세요. 기존 로컬 작업실과는 별도로 시작해요.</p>' : ''}`);
}
const date = (value: number | null | undefined) => value ? new Date(value).toLocaleDateString('ko-KR') : '아직 연결하지 않음';
function tokenPanel() {
  if (identity.local) return '';
  if (!identity.user) return `<section class="panel token-panel"><p class="eyebrow">02 / TOKEN</p><h2>2. 로그인하고 연결 토큰을 발급해요.</h2><p>가입 후 내 연결 토큰을 발급받을 수 있어요. 로컬 작업실은 이 컴퓨터에 그대로 보관됩니다.</p><button class="primary" data-auth="signup">회원가입</button> <button class="secondary" data-auth="login">로그인</button></section>`;
  const token = tokens[0];
  return `<section class="panel token-panel"><div class="panel-head"><div><p class="eyebrow">02 / TOKEN</p><h2>2. ${esc(identity.user.nickname)}님의 연결 토큰</h2></div><span class="status-label">${token ? token.expires > Date.now() ? '발급됨' : '만료됨' : '미발급'}</span></div><p>회원당 토큰 하나를 사용해요. 같은 토큰으로 여러 CLI를 연결할 수 있고, 재발급하면 기존 토큰은 즉시 폐기됩니다.</p>${token ? `<dl class="token-details"><div><dt>토큰 식별값</dt><dd><code>${esc(token.prefix)}…</code></dd></div><div><dt>만료일</dt><dd>${date(token.expires)}</dd></div><div><dt>최근 연결</dt><dd>${date(token.last_used)}</dd></div></dl>` : '<p class="empty">아직 연결 토큰이 없어요. 첫 토큰을 발급해 주세요.</p>'}<div class="token-actions"><button class="primary" id="issue-token">${token ? '토큰 재발급' : '연결 토큰 발급'}</button>${token ? `<button class="text-button danger" data-revoke="${token.id}">현재 토큰 폐기</button>` : ''}</div></section>`;
}
function issueTokenDialog() {
  openModal(`<p class="eyebrow">CLI ACCESS TOKEN</p><h2>${tokens.length ? '새 토큰으로 교체할까요?' : '터미널로 이어지는 작은 열쇠.'}</h2><p>${tokens.length ? '재발급이 완료되면 기존 토큰은 즉시 폐기돼요. 연결해 둔 모든 CLI에서 새 토큰을 입력해 주세요.' : '발급한 토큰은 이 화면에서 한 번만 보여드려요.'}</p><form id="token-form"><label for="token-days">유효 기간</label><select class="form-input" id="token-days"><option value="30">30일</option><option value="90" selected>90일</option><option value="365">365일</option></select><p class="form-error" role="alert"></p><button class="primary">${tokens.length ? '기존 토큰 폐기하고 재발급' : '토큰 발급'}</button></form>`);
}
function rankingView() {
  const period = rankingType === 'tokens' ? rankingRange : null;
  const intro = rankingType === 'level' ? '가장 많이 자란 한 마리의 레벨로 순위를 정해요.' : rankingType === 'collection' ? '서로 다른 펫의 종류 수로 순위를 정해요. 중복 보유는 합산하지 않아요.' : 'CLI에서 수집한 토큰의 누적 획득량으로 순위를 정해요. 기간을 정하면 그 기간에 획득한 토큰만 합산해요.';
  const score = (entry: RankingEntry) => rankingType === 'level' ? `<b>Lv.${entry.pet.level}</b><small>${fmt(entry.pet.xp)} XP</small>` : rankingType === 'collection' ? `<b>${entry.speciesCount}종</b><small>${fmt(entry.copies)}마리 보유</small>` : `<b>${fmt(entry.tokens)}</b><small>${period ? '기간 내 획득 토큰' : '누적 획득 토큰'}</small>`;
  const row = (entry: RankingEntry, featured = false) => `<${featured ? 'div' : 'li'} class="ranking-row ${entry.mine ? 'is-mine' : ''}"><span class="rank-number">${String(entry.rank).padStart(2, '0')}</span><div class="rank-pet">${sprite(entry.pet)}</div><div class="rank-person"><b>${esc(entry.nickname)} ${entry.mine ? '<span class="tag">나</span>' : ''}</b><small>${esc(entry.pet.name)} · ${tier(entry.pet.tier).name}</small></div><div class="rank-score">${score(entry)}</div></${featured ? 'div' : 'li'}>`;
  const tabButton = (type: Ranking['type'], label: string, note: string) => `<button class="filter ${rankingType === type ? 'selected' : ''}" data-ranking="${type}" aria-pressed="${rankingType === type}">${label} <small>${note}</small></button>`;
  const rangeForm = rankingType === 'tokens' ? `<form class="toolbar ranking-range" id="rank-range" aria-label="집계 기간"><label>시작일 <input type="date" name="from" value="${esc(rankingRange?.from ?? '')}" required></label><span>~</span><label>종료일 <input type="date" name="to" value="${esc(rankingRange?.to ?? '')}" required></label><button class="secondary" type="submit">기간 집계</button>${rankingRange ? '<button class="text-button" type="button" id="rank-range-clear">전체 기간 보기</button>' : ''}</form>` : '';
  const title = rankingType === 'level' ? '오늘의 성장 기록' : rankingType === 'collection' ? '오늘의 수집 기록' : period ? `${esc(period.from)} ~ ${esc(period.to)} 토큰 기록` : '누적 토큰 기록';
  return heading('GROW TOGETHER, ONE DAY AT A TIME', '함께 자란 기록', '각자의 작업실에서 쌓아 올린 작은 성장을 만나보세요.') + `<div class="ranking-tabs" aria-label="랭킹 기준">${tabButton('level', '성장 랭킹', '최고 레벨 펫')}${tabButton('collection', '수집 랭킹', '서로 다른 종류')}${tabButton('tokens', '토큰 랭킹', '누적 획득량')}</div><p class="ranking-description">${intro}</p>${rangeForm}${!ranking ? '<div class="loading" role="status">친구들의 기록을 모으고 있어요…</div>' : `${ranking.me ? `<section class="my-rank"><p class="eyebrow">MY LITTLE MILESTONE</p>${row(ranking.me, true)}</section>` : ''}<section class="panel ranking-board"><div class="panel-head"><h2>${title}</h2><small>${fmt(ranking.total)}명의 수집가</small></div>${ranking.entries.length ? `<ol class="ranking-list" start="${(ranking.page - 1) * ranking.pageSize + 1}">${ranking.entries.map(e => row(e)).join('')}</ol>` : '<div class="empty"><h3>첫 번째 기록의 주인공이 되어 주세요.</h3><p>가입한 친구들의 기록이 여기에 모여요.</p><button class="primary" data-auth="signup">작업실 만들기</button></div>'}</section><div class="toolbar"><button class="secondary" id="rank-prev" ${ranking.page <= 1 ? 'disabled' : ''}>← 이전</button><span>${ranking.page} / ${ranking.pages} 페이지</span><button class="secondary" id="rank-next" ${ranking.page >= ranking.pages ? 'disabled' : ''}>다음 →</button></div>`}<p class="ranking-note">성장: 레벨 → 경험치 → 종류 수 순. 수집: 종류 수 → 최고 경험치 순. 토큰: 획득량 → 최고 경험치 순. 동률은 가입 순으로 정해요.<br>기간 집계는 한국 시간으로 시작일 00:00:00부터 종료일 23:59:59.999까지 획득한 토큰을 더해요.<br>CLI에서 전송한 사용량이 반영되는 커뮤니티 기록입니다. 로컬 전용 작업실은 포함하지 않아요.</p>`;
}
async function loadRanking() {
  const current = ++rankingRequest;
  ranking = null; render();
  const period = rankingType === 'tokens' && rankingRange ? `&from=${rankingRange.from}&to=${rankingRange.to}` : '';
  try { const result = await api(`/api/rankings?type=${rankingType}&page=${rankingPage}${period}`); if (current === rankingRequest) { ranking = result; render(); } }
  catch (error) { if (current === rankingRequest) { $('#main').innerHTML = `<div class="empty">${esc((error instanceof Error ? error.message : String(error)))}<p><button class="secondary" id="retry-ranking">다시 불러오기</button></p></div>`; } }
}
function gachaPanel() {
  const current = state; if (!current) return '';
  const remaining = current.rules.pityAt - current.player.pity;
  const uniqueRemaining = Math.max(1, current.rules.uniquePityAt - current.player.unique_pity);
  const uniqueProgress = Math.min(current.rules.uniquePityAt, current.player.unique_pity);
  return `<section class="panel hatch-panel"><div class="panel-head"><h2>어떤 친구를 만나게 될까요?</h2><small>GACHA</small></div>
    <div class="hatch-art" aria-hidden="true"><div class="egg"></div></div>
    <div class="hatch-copy"><p class="eyebrow">A LITTLE SURPRISE</p><h3>작은 알, 새로운 시작</h3><p>360가지 가능성 중 하나.<br>함께할 친구가 당신을 기다려요.</p>
    <button class="primary" data-pull="1" ${current.player.coins < 100 ? 'disabled' : ''}>알 하나 부화시키기 <small>✦ 100 C</small></button>
    <button class="ten-pull" data-pull="10" ${current.player.coins < 1000 ? 'disabled' : ''}>한 번에 10마리 만나기 · 1,000 C ↗</button></div>
    <div class="pity"><div class="pity-label"><span>전설의 친구를 향해</span><b>${current.player.pity} / ${current.rules.pityAt}</b></div><div class="meter"><span style="width:${current.player.pity / current.rules.pityAt * 100}%"></span></div><p>최대 ${remaining}회 안에 레전더리 확정 · 중복 펫 +25 XP</p></div>
    <div class="pity"><div class="pity-label"><span>유니크 친구를 향해</span><b>${uniqueProgress} / ${current.rules.uniquePityAt}</b></div><div class="meter"><span style="width:${uniqueProgress / current.rules.uniquePityAt * 100}%"></span></div><p>최대 ${uniqueRemaining + (uniqueRemaining === remaining ? 1 : 0)}회 안에 유니크 확정</p></div>
    <details class="odds"><summary>등급별 확률 보기</summary>${current.tiers.map(t => `<div class="odds-row"><span>${t.name} · ${current.catalog.filter(p => p.tier === t.id).length}종</span><b>${t.chance}%</b></div>`).join('')}<p>등급 내 모든 펫은 같은 확률입니다. 유니크 ${current.rules.uniquePityAt}회·레전더리 ${current.rules.pityAt}회 천장을 각각 계산하며, 해당 등급을 얻으면 그 카운트만 초기화합니다. 동시에 도달하면 레전더리 먼저, 다음 뽑기 유니크입니다.</p></details></section>`;
}
function connection(source: Cli) {
  const c = state?.connections.find(c => c.source === source);
  const recent = c && Date.now() - c.last_seen < 15 * 60_000;
  return `<div class="connection-pill ${source}"><span class="provider-logo">${source === 'claude' ? '✳' : '⌘'}</span><span>${source === 'claude' ? 'Claude Code' : 'Codex CLI'}</span><i class="live-dot ${recent ? '' : 'dot-idle'}"></i><small>${recent ? '수집 중' : c ? '최근 기록 있음' : '기록 대기'}</small></div>`;
}
function home() {
  const current = state; if (!current) return '';
  const p = current.active;
  const speech = p.sleeping ? '잠깐 충전하고 있을게요… z Z' : p.hunger < 30 ? '우리 같이 밥 먹을까요?' : p.happiness < 30 ? '잠깐 나랑 놀아줄래요?' : '오늘도 멋진 걸 만들어 봐요!';
  const actions = [['feed', '♧', '밥 주기', '5 C'], ['play', '⚐', '놀아주기', 'FREE'], ['clean', '♒', '씻겨주기', '3 C'], [p.sleeping ? 'wake' : 'sleep', '☾', p.sleeping ? '깨우기' : '재우기', 'FREE']];
  const friends = [p, ...current.pets.filter(x => x.id !== p.id), ...current.catalog.filter(x => !current.pets.some(y => y.id === x.id))].slice(0, 6);
  return heading('A SMALL COMPANION FOR BIG IDEAS', '코드가 자라는 동안,<br>우리도 함께 자라요.', '오늘의 작업실에도 작은 친구가 기다리고 있어요.', `<span class="date-label">${new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}</span>`) +
    `<div class="home-grid"><section class="panel"><div class="panel-head"><h2>함께하는 친구</h2><span class="status-label">${p.sleeping ? '쉬는 중' : '작업실 산책 중'}</span></div>
      <div class="room"><div class="window"><div class="window-cross"></div></div><div class="shelf"></div><div class="books"></div><div class="plant"></div><div class="speech">${speech}</div><div class="pet-shadow"></div><div class="room-pet ${p.sleeping ? 'sleeping' : ''}">${sprite(p)}</div><span class="room-caption">A PLACE TO GROW.</span></div>
      <div class="pet-info"><div class="pet-title"><h3>${p.name}</h3>${pill(p.tier)}<small>Lv.${p.level} · ${p.stage}</small></div><div class="xp" title="${p.xp} XP"><span style="width:${p.nextLevelXp ? Math.min(100, p.xp / p.nextLevelXp * 100) : 100}%"></span></div>
      <div class="vitals">${([['포만감', p.hunger], ['행복', p.happiness], ['에너지', p.energy], ['청결', p.hygiene]] as [string, number][]).map(([label, n]) => `<div class="vital"><div><span>${label}</span><b>${Math.round(n)}</b></div><div class="meter"><span style="width:${n}%"></span></div></div>`).join('')}</div></div>
      <div class="care-actions">${actions.map(([action, icon, label, cost]) => `<button id="care-${action}" data-care="${action}" class="care-button" ${p.sleeping && action !== 'wake' ? 'disabled' : ''}><span class="care-icon" aria-hidden="true">${icon}</span><span>${label}</span><small>${cost}</small></button>`).join('')}</div></section>${gachaPanel()}</div>
      <div class="section-heading"><h2>나의 작은 친구들 <span class="tag">${current.pets.length} / 360</span></h2><button class="text-button" data-tab="dex">도감 펼쳐보기 ↗</button></div>
      <div class="friends-strip">${friends.map(f => { const owned = current.pets.some(x => x.id === f.id); return `<button class="mini-pet ${owned ? '' : 'locked'}" data-tab="dex">${sprite(f)}<b>${owned ? f.name : '아직 만나지 못한 친구'}</b><small>${owned ? tier(f.tier).id.toUpperCase() : 'UNKNOWN FRIEND'}</small></button>`; }).join('')}</div>
      <div class="panel integration-strip"><div class="integration-title">개발이 쌓이면, 추억도 쌓여요.<small>Claude와 Codex의 토큰을 각각 코인으로 · ${fmt(current.rules.tokensPerCoin)} TOKENS = 1 C</small></div>${connection('claude')}${connection('codex')}</div>
      <section class="panel integration-strip" aria-label="매일 출석"><div class="integration-title">${current.attendance.claimed ? `연속 ${current.attendance.streak}일 출석 · 오늘 +${current.attendance.coins} C` : `오늘의 출석 보상 +${current.attendance.coins} C`}<small>CLI를 켜면 자동 출석 · 한국 시간 00시 기준 · ${current.attendance.claimed ? `내일도 오면 +${current.attendance.nextCoins} C` : '매일 연속 출석하면 보상이 늘어요'}</small></div><button id="checkin" class="secondary" ${current.attendance.claimed ? 'disabled' : ''}>${current.attendance.claimed ? '오늘 출석 완료' : '출석 보상 받기'}</button></section>
      <div class="section-heading"><h2>작업실의 작은 기록</h2><small class="eyebrow">RECENT MOMENTS</small></div>${activity()}`;
}
function activity() {
  const current = state; if (!current) return '';
  return current.activity.length ? `<ul class="activity-list">${current.activity.slice(0, 5).map(a => `<li><span>${esc(a.label)}</span><small>${new Date(a.created).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</small><b>${a.coins > 0 ? '+' : ''}${a.coins} C</b></li>`).join('')}</ul>` : '<div class="empty">첫 번째 코딩과 돌봄이 이곳에 기록돼요.</div>';
}
function dex() {
  const data = (shared || state || directory)!, pets = new Map(data.pets.map(p => [p.id, p]));
  const catalog = data.catalog.filter(p => (filter === 'all' || filter === 'owned' && pets.has(p.id) || p.tier === filter) && `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(catalog.length / 24)); page = Math.min(page, pages - 1);
  return heading(shared ? 'A COLLECTION OF LITTLE FRIENDS' : 'THE FRIENDSHIP FIELD GUIDE', shared ? esc(shared.name) : '친구 도감', `${state || shared ? `${pets.size} / ${data.catalog.length}종의 친구를 만났어요.` : `${data.catalog.length}종의 친구를 미리 만나보세요.`} 캐릭터를 누르면 크게 볼 수 있어요.`, state && !shared ? button('↗ 도감 자랑하기', 'share-button') : '') +
    `<div class="toolbar"><button class="filter ${filter === 'all' ? 'selected' : ''}" data-filter="all">전체</button>${state || shared ? `<button class="filter ${filter === 'owned' ? 'selected' : ''}" data-filter="owned">${shared ? '만난 친구' : '내가 보유한 친구'}</button>` : '<button class="filter" data-auth="login">로그인하고 내 친구 보기 ↗</button>'}${data.tiers.map(t => `<button class="filter ${filter === t.id ? 'selected' : ''}" data-filter="${t.id}">${t.name}</button>`).join('')}<input class="search" id="search" aria-label="친구 검색" placeholder="친구 이름 찾기…" value="${esc(search)}"></div>
    <div class="dex-grid">${catalog.slice(page * 24, (page + 1) * 24).map(p => { const owned = pets.get(p.id); return `<article class="dex-card ${owned ? '' : 'unowned'} ${p.id === (shared?.equipped || state?.player.equipped) ? 'selected' : ''}"><small class="dex-number">NO. ${String(p.number).padStart(3, '0')}</small><button class="pet-thumbnail" id="preview-${p.id}" data-preview="${p.id}" aria-label="${esc(p.name)} 크게 보기" aria-haspopup="dialog">${sprite({ ...p, ...owned })}<span>크게 보기 ↗</span></button><h3>${esc(p.name)}</h3>${pill(p.tier)}<p>${owned ? `Lv.${owned.level} · ${owned.copies}마리 보유${shared ? '' : ` · ${'sleeping' in owned && owned.sleeping ? '자는 중' : '깨어 있음'}`}` : '미보유 · 미리 만나보기'}</p>${owned && state && !shared ? `<button class="secondary" data-equip="${p.id}" ${state.player.equipped === p.id ? 'disabled' : ''}>${state.player.equipped === p.id ? '함께하는 중' : '함께하기'}</button>` : ''}</article>`; }).join('')}</div>
    ${catalog.length ? `<div class="toolbar">${button('← 이전', 'prev')}<span>${page + 1} / ${pages} 페이지 · ${catalog.length}종</span>${button('다음 →', 'next')}</div>` : '<p class="empty">아직 해당하는 친구가 없어요.</p>'}`;
}
function preview(id: string) {
  const data = (shared || state || directory)!, species = data.catalog.find(p => p.id === id);
  if (!species) return;
  const owned = data.pets.find(p => p.id === id), pet: Species & Partial<Pet> = { ...species, ...owned };
  const selected = id === (shared?.equipped || state?.player.equipped);
  openModal(`<p class="eyebrow">FRIEND PORTRAIT / NO. ${String(pet.number).padStart(3, '0')}</p><h2>${esc(pet.name)}</h2>
    <div class="pet-preview"><div class="portrait-art">${sprite(pet)}<span>${owned && !shared && pet.sleeping ? '쉬는 중 · z Z' : '작은 친구, 가까이 보기'}</span></div>
    <div class="portrait-info">${pill(pet.tier)}<p>${owned ? `Lv.${pet.level} · ${pet.copies}마리 보유${selected ? ' · 함께하는 중' : ''}` : '아직 만나지 못한 친구예요.'}</p><code>${esc(pet.id)}</code>
    ${owned && state && !shared ? `<div class="portrait-vitals">${([['포만감', pet.hunger!], ['기분', pet.happiness!], ['에너지', pet.energy!], ['청결', pet.hygiene!]] as [string, number][]).map(([label, value]) => `<div class="vital"><div><span>${label}</span><b>${Math.round(value)}/100</b></div><div class="meter"><span style="width:${value}%"></span></div></div>`).join('')}</div><p>${pet.sleeping ? '잠을 자며 에너지를 시간당 20씩 회복하고, 가득 차면 스스로 깨요.' : selected ? '함께하는 동안 상태가 줄고, 에너지를 시간당 2씩 사용해요.' : '대기 중에는 다른 상태를 유지하고, 에너지를 시간당 2씩 회복해요.'}</p>` : ''}</div></div>`);
}
function connections() {
  const current = state;
  const guide = heading('BETTER TOGETHER', '터미널에서도, 늘 곁에.', 'Claude와 Codex 어디서 개발하든 같은 친구, 같은 지갑을 만나요.') +
    `<section class="panel connect-steps install-guide" id="install-tokenpet"><p class="eyebrow">01 / INSTALL</p><h2>1. TokenPet을 설치해요.</h2><p>Claude Code 또는 Codex CLI가 설치된 PC에서, 운영체제에 맞는 명령을 터미널에 붙여 넣으세요.</p>
    <div class="install-command"><div class="install-command-head"><h3>macOS / Linux / WSL</h3><button type="button" class="secondary install-copy" id="copy-install-unix" data-copy-install="install-unix" aria-label="macOS / Linux / WSL 설치 명령 복사">복사</button></div><pre><code id="install-unix">curl -fsSL https://raw.githubusercontent.com/shariest/tokenpet/main/install.sh | bash</code></pre></div>
    <div class="install-command"><div class="install-command-head"><h3>Windows · PowerShell 5.1 이상</h3><button type="button" class="secondary install-copy" id="copy-install-windows" data-copy-install="install-windows" aria-label="Windows 설치 명령 복사">복사</button></div><pre><code id="install-windows">irm https://raw.githubusercontent.com/shariest/tokenpet/main/install.ps1 | iex</code></pre></div>
    <p>복사 버튼으로 전체 명령을 복사하세요. 긴 명령은 가로로 스크롤해서 볼 수 있어요.</p>
    <p>Git이나 관리자 권한은 필요하지 않아요. Node.js 24 이상이 없으면 설치 프로그램이 자동으로 준비합니다. 설치가 끝나면 새 터미널을 열고 <code>tokenpet help</code>로 확인하세요.</p>
    <p>${identity.local ? '같은 설치 명령으로 업데이트할 수 있고, 기존 펫과 게임 기록은 유지됩니다.' : '처음 설치하면 개인 PC용으로 시작해요. 이 서버의 친구와 연결하려면 아래에서 토큰을 발급한 뒤 서버 연결 명령을 실행하세요.'}</p></section>` + tokenPanel() +
    (identity.local ? `<section class="panel connect-steps"><p class="eyebrow">YOUR PERSONAL WORKSPACE</p><h2>이 컴퓨터에서, 나만의 친구와 함께해요.</h2><p>회원가입이나 연결 토큰 없이 사용할 수 있어요. 펫과 게임 기록은 이 PC에 저장됩니다.</p></section>` : `<section class="panel connect-steps"><p class="eyebrow">03 / CONNECT</p><h2>3. 터미널에서 서버에 연결해요.</h2><pre><code>tokenpet connect ${esc(location.origin)}</code></pre><p>발급한 토큰을 접근 키 입력란에 붙여 넣으세요. 입력은 화면에 표시되지 않아요.</p><p>토큰을 재발급했다면 이 명령으로 연결된 모든 CLI의 접근 키를 바꿔 주세요.</p></section>`);
  const removal = `<section class="panel connect-steps" id="uninstall-tokenpet"><p class="eyebrow">UNINSTALL</p><h2>TokenPet을 삭제하려면</h2><p>MCP 연결, Claude 상태줄, 전용 명령, Codex 펫 설정을 설치 전으로 되돌리고 프로그램을 지워요. 운영체제와 관계없이 같은 명령입니다.</p>
    <div class="install-command"><div class="install-command-head"><h3>삭제 · 게임 데이터는 남김</h3><button type="button" class="secondary install-copy" data-copy-uninstall="uninstall-keep" aria-label="삭제 명령 복사">복사</button></div><pre><code id="uninstall-keep">tokenpet uninstall</code></pre></div>
    <div class="install-command"><div class="install-command-head"><h3>완전 삭제 · 게임 데이터까지</h3><button type="button" class="secondary install-copy" data-copy-uninstall="uninstall-purge" aria-label="완전 삭제 명령 복사">복사</button></div><pre><code id="uninstall-purge">tokenpet uninstall --purge</code></pre></div>
    <p>삭제한 뒤 실행 중인 Claude·Codex는 다시 시작하세요. 게임 데이터를 남기면 다시 설치했을 때 펫과 코인이 그대로예요.${identity.local ? '' : ' 이 서버에 저장된 회원 기록은 지워지지 않아요.'}</p></section>`;
  if (!current) return guide + removal;
  return guide +
    `<div class="connect-grid"><section class="panel connect-card"><h2>✳ Claude Code</h2>${connection('claude')}<p>상태줄의 작은 캐릭터와 MCP 돌봄 도구가 함께합니다.</p><pre><code>tokenpet setup\nclaude\n"펫 상태를 보여줘"</code></pre><p>사용량 ${fmt(current.connections.find(c => c.source === 'claude')?.tokens || 0)} tokens</p></section>
    <section class="panel connect-card"><h2>⌘ Codex CLI</h2>${connection('codex')}<p>MCP 도구와 터미널 펫 화면을 함께 열어 두세요.</p><pre><code>tokenpet setup\ncodex\n"펫에게 밥을 줘"</code></pre><p>사용량 ${fmt(current.connections.find(c => c.source === 'codex')?.tokens || 0)} tokens</p></section>
    <section class="panel connect-card"><h2>작은 터미널 친구</h2><p>터미널을 분할하고 옆 창에서 실행하면 픽셀 캐릭터가 계속 보여요.</p><pre><code>tokenpet ui\n# f 밥 · p 놀이 · c 목욕\n# s 잠 · g 가챠 · q 닫기</code></pre></section>
    <section class="panel connect-card"><h2>사용량 수집</h2><p>${current.collector.enabled ? '서버가 10초마다 로컬 기록을 확인해요.' : '서버 자동 수집이 꺼져 있어요. 로컬 tokenpet watch를 사용하세요.'}</p><p>${current.collector.scanning ? '처음 기록을 확인하는 중…' : `${current.collector.files}개 파일 확인 · 읽기 오류 ${current.collector.errors}개`}</p><ul><li>Claude와 Codex에 각각 보상</li><li>같은 기록을 다시 읽어도 한 번만 정산</li><li>대화와 코드는 서버에 전송하지 않음</li><li>설치 이전 기록은 코인 지급에서 제외</li></ul></section></div>
    <section class="panel economy"><p class="eyebrow">A LITTLE EVERY DAY</p><h2>개발하고, 출석하고, 친구를 만나요.</h2><div class="economy-numbers"><div>${fmt(current.rules.tokensPerCoin)}<small>토큰당 1코인</small></div><div>${current.rules.pullCost} C<small>한 번의 만남</small></div><div>${current.rules.pityAt}회<small>전설 확정까지 최대</small></div></div><p>${fmt(current.rules.tokensPerCoin * 2)}토큰당 선택한 펫에게 1 XP. 코인과 경험치의 잔여 토큰은 각각 이월하며 Claude와 Codex 사용량을 합산해요.</p><p>출석 기본 ${current.rules.checkinBaseCoins} C + 연속 하루마다 ${current.rules.checkinStepCoins} C. ${current.rules.checkinMaxDays}일째부터 매일 ${current.rules.checkinBaseCoins + (current.rules.checkinMaxDays - 1) * current.rules.checkinStepCoins} C를 받고, 하루 빠지면 1일차부터 다시 시작해요.</p></section>` + removal;
}
function render() {
  if (!state && !shared && !directory) return;
  if (identity.local && tab === 'ranking') { tab = 'home'; history.replaceState(null, '', '#home'); }
  const focusId = document.activeElement?.id;
  const oddsOpen = document.querySelector<HTMLDetailsElement>('.odds')?.open;
  if (!shared) {
    $('.top-actions').innerHTML = state ? `<span class="coin-balance"><span>✦</span><b id="coins">${fmt(state.player.coins)}</b><small>COINS</small></span><button class="avatar" id="profile-button" aria-label="작업실 이름 변경">${esc((identity.user?.nickname || 'M').slice(0, 1))}</button>${identity.local ? '' : identity.user ? '<button class="text-button" id="logout">로그아웃</button>' : '<button class="text-button" data-auth="login">회원 로그인</button>'}` : '<button class="text-button" data-auth="login">로그인</button><button class="primary" data-auth="signup">회원가입</button>';
    $('.nav[data-tab="ranking"]').style.display = identity.local ? 'none' : '';
    $('#nav-count').textContent = String(state ? state.pets.length : directory!.total);
    $('#workspace-name').textContent = state?.player.name || '작은 친구들의 작업실';
    $('#server-label').textContent = identity.user ? `${identity.user.nickname} · 연결됨` : state ? '로컬 작업실' : '친구들을 둘러보는 중';
    document.querySelectorAll<HTMLElement>('.nav').forEach(n => { n.classList.toggle('active', n.dataset.tab === tab); if (n.dataset.tab === tab) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  }
  $('#main').innerHTML = shared || tab === 'dex' ? dex() : tab === 'ranking' ? rankingView() : tab === 'connect' ? connections() : !state ? welcome() : tab === 'home' ? home() :
    heading('SOMETHING WONDERFUL IS WAITING', '알 속의 작은 우주.', '같은 친구를 다시 만나면 인연이 깊어져요. 중복 펫은 수량과 경험치가 늘어납니다.') + `<div class="home-grid">${gachaPanel()}<section class="panel connect-card"><p class="eyebrow">THE NEXT CHAPTER</p><h2>천천히, 오래 함께.</h2><p>돌봄과 코딩으로 경험치를 모으세요.<br>5레벨에는 청소년, 10레벨에는 성체가 됩니다.</p><p>각 등급의 모든 펫은 같은 확률로 등장해요. 보유한 펫도 다시 나올 수 있습니다.</p><h2>✦ 전설의 친구</h2>${sprite(state!.catalog.find(p => p.tier === 'legendary')!)}<p>레전더리 기본 확률 ${tier('legendary').chance}%. ${state!.rules.pityAt - 1}회 동안 만나지 못했다면 다음 만남은 확정입니다.</p></section></div>`;
  if (oddsOpen) document.querySelector<HTMLDetailsElement>('.odds')?.setAttribute('open', '');
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
async function mutate<P extends '/api/checkin' | '/api/care' | '/api/equip' | '/api/gacha' | '/api/profile' | '/api/share'>(path: P, data: unknown): Promise<ApiResponses[P]> {
  const result = await api(path, data) as ApiResponses[P];
  if (result.state && state) state = { ...state, ...result.state, collector: state.collector };
  render(); return result;
}
function shareDialog() {
  const current = state; if (!current) return;
  const path = current.player.share ? `${location.origin}/share/${current.player.share}` : '';
  openModal(`<p class="eyebrow">GOOD FRIENDS ARE WORTH SHARING</p><h2>나의 도감을 자랑해요.</h2><p>작업실 이름, 수집한 펫, 레벨과 보유 수량을 공유해요. 토큰 기록과 코인 잔액은 공개하지 않습니다.</p>${path ? `<label for="share-url">공유 링크</label><input class="share-link" id="share-url" value="${esc(path)}" readonly>${button('링크 복사', 'copy-share', 'primary')} ${button('공유 끄기', 'disable-share')}` : button('공유 링크 만들기', 'enable-share', 'primary')}<p>현재 로컬 서버 주소는 이 컴퓨터에서만 열립니다. HTML 도감은 파일로 전달할 수 있어요.</p>${button('도감을 HTML 파일로 저장', 'export-button')}`);
}
document.addEventListener('click', async event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<HTMLButtonElement>('button'); if (!target || target.disabled) return;
  if (busy) return;
  if (target.dataset.auth) { authDialog(target.dataset.auth); return; }
  if (target.classList.contains('dialog-close')) { closeModal(); return; }
  if (target.dataset.tab) { location.hash = target.dataset.tab; window.scrollTo({ top: 0 }); return; }
  if (target.dataset.preview) { preview(target.dataset.preview); return; }
  if (target.dataset.filter) { filter = target.dataset.filter; page = 0; render(); return; }
  if (target.id === 'prev' || target.id === 'next') { page = Math.max(0, page + (target.id === 'next' ? 1 : -1)); render(); return; }
  if (target.id === 'issue-token') { issueTokenDialog(); return; }
  if (target.dataset.revoke) { openModal(`<h2>연결 토큰을 폐기할까요?</h2><p>연결된 모든 CLI에서 이 토큰을 더 이상 사용할 수 없어요. 게임 기록은 그대로 남습니다.</p><button class="primary" data-confirm-revoke="${target.dataset.revoke}">토큰 폐기</button>`); return; }
  if (target.dataset.ranking || ['rank-prev', 'rank-next', 'retry-ranking', 'rank-range-clear'].includes(target.id)) {
    if (target.dataset.ranking) { rankingType = target.dataset.ranking as Ranking['type']; rankingPage = 1; }
    else if (target.id === 'rank-range-clear') { rankingRange = null; rankingPage = 1; }
    else if (target.id !== 'retry-ranking') rankingPage = Math.max(1, rankingPage + (target.id === 'rank-next' ? 1 : -1));
    await loadRanking(); return;
  }
  if (target.id === 'share-button') { shareDialog(); return; }
  if (target.id === 'profile-button') { if (!state) return; openModal(`<h2>작업실에 이름을 붙여요.</h2><form id="profile-form"><label for="profile-name">작업실 이름</label><input id="profile-name" class="form-input" maxlength="30" value="${esc(state.player.name)}" required><button class="primary">저장하기</button></form>`); return; }
  if (busy) return; busy = true; target.disabled = true;
  try {
    if (target.id === 'logout') { ++loadRequest; await api('/api/session', undefined, 'DELETE'); state = null; identity = {}; tokens = []; ranking = null; filter = 'all'; await load(); if (tab === 'ranking') await loadRanking(); toast('로그아웃했어요.'); }
    if (target.id === 'copy-token') { await navigator.clipboard.writeText($<HTMLInputElement>('#new-token').value); toast('토큰을 복사했어요. 터미널의 접근 키 입력란에 붙여 넣으세요.'); }
    if (target.dataset.copyInstall) { await navigator.clipboard.writeText($(`#${target.dataset.copyInstall}`).textContent || ''); toast('설치 명령을 복사했어요. 터미널에 붙여 넣으세요.'); }
    if (target.dataset.copyUninstall) { await navigator.clipboard.writeText($(`#${target.dataset.copyUninstall}`).textContent || ''); toast('삭제 명령을 복사했어요. 터미널에 붙여 넣으세요.'); }
    if (target.dataset.confirmRevoke) { await api(`/api/tokens/${target.dataset.confirmRevoke}`, undefined, 'DELETE'); tokens = []; closeModal(); render(); toast('토큰을 폐기했어요.'); }
    if (target.id === 'checkin') { const r = await mutate('/api/checkin', {}); toast(r.message); }
    if (target.dataset.care) { const r = await mutate('/api/care', { action: target.dataset.care }); toast(r.message); }
    if (target.dataset.equip) { await mutate('/api/equip', { id: target.dataset.equip }); toast('새 친구와 함께해요.'); }
    if (target.dataset.pull) {
      const r = await mutate('/api/gacha', { count: Number(target.dataset.pull) });
      openModal(`<p class="eyebrow">HELLO, LITTLE FRIEND!</p><h2>우리의 새로운 만남.</h2><div class="results">${r.results.map((p, i) => `<div class="result ${p.tier}" style="animation-delay:${i * .08}s"><span class="result-label">${p.isNew ? 'NEW FRIEND' : 'FRIENDS AGAIN'}</span>${sprite(p)}<h3>${p.name}</h3>${pill(p.tier)}<p>${p.isNew ? '도감에 새로 등록했어요!' : '보유 수량 +1 · 경험치 +25'}</p></div>`).join('')}</div><div class="result-actions">${button('도감에서 만나기', 'result-dex', 'primary')}${button('좋아!', 'result-close')}</div>`);
    }
    if (target.id === 'result-dex') { closeModal(); tab = 'dex'; filter = 'owned'; location.hash = 'dex'; render(); }
    if (target.id === 'result-close') closeModal();
    if (target.id === 'enable-share' || target.id === 'disable-share') { await mutate('/api/share', { enabled: target.id === 'enable-share' }); shareDialog(); }
    if (target.id === 'copy-share') { await navigator.clipboard.writeText($<HTMLInputElement>('#share-url').value); toast('도감 링크를 복사했어요.'); }
    if (target.id === 'export-button') {
      const html = collectionHTML({ name: state!.player.name, ...state! });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'tokenpet-collection.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) { toast((error instanceof Error ? error.message : String(error)) || '처리하지 못했어요. 다시 시도해 주세요.'); }
  finally { busy = false; target.disabled = false; }
});
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (tabs.includes(next)) { tab = next; render(); if (tab === 'ranking') void loadRanking(); if (tab === 'connect' && identity.user) void load().catch(error => toast((error instanceof Error ? error.message : String(error)))); }
});
document.addEventListener('input', event => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'search') { const cursor = event.target.selectionStart; search = event.target.value; page = 0; render(); $<HTMLInputElement>('#search')?.setSelectionRange(cursor, cursor); }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !(event.target instanceof HTMLFormElement)) return; busy = true;
  const form = event.target, submit = form.querySelector<HTMLButtonElement>('button[type="submit"], button.primary');
  if (submit) submit.disabled = true;
  const errorArea = form.querySelector('.form-error'); if (errorArea) errorArea.textContent = '';
  try {
    if (form.id === 'profile-form') { await mutate('/api/profile', { name: $<HTMLInputElement>('#profile-name').value }); closeModal(); toast('이름을 저장했어요.'); }
    if (form.id === 'rank-range') {
      const from = $<HTMLInputElement>('#rank-range [name="from"]').value, to = $<HTMLInputElement>('#rank-range [name="to"]').value;
      if (from > to) throw new Error('시작일은 종료일보다 늦을 수 없어요.');
      rankingRange = { from, to }; rankingPage = 1; await loadRanking();
    }
    if (form.id === 'auth-form') {
      ++loadRequest;
      const mode = form.dataset.mode;
      if (mode !== 'login' && mode !== 'signup') throw new Error('로그인 방식을 확인해 주세요.');
      await api(`/api/${mode}`, { username: $<HTMLInputElement>('#auth-username').value, password: $<HTMLInputElement>('#auth-password').value, ...(mode === 'signup' ? { nickname: $<HTMLInputElement>('#auth-nickname').value } : {}) });
      $<HTMLInputElement>('#auth-password').value = ''; closeModal(); filter = 'all'; await load();
      if (tab === 'ranking') await loadRanking();
      toast(mode === 'signup' ? '첫 친구가 작업실에서 기다리고 있어요.' : '작업실에 돌아왔어요.');
    }
    if (form.id === 'token-form') {
      const result = await api('/api/tokens', { days: Number($<HTMLSelectElement>('#token-days').value) });
      const { token, ...metadata } = result; tokens = [metadata]; render();
      openModal(`<p class="eyebrow">YOUR NEW CONNECTION TOKEN</p><h2>이 토큰을 안전하게 보관해 주세요.</h2><p>토큰은 지금 한 번만 보여드려요. 다시 발급하면 기존 토큰은 즉시 폐기됩니다.</p><label for="new-token">CLI 연결 토큰</label><input class="share-link" id="new-token" value="${esc(result.token)}" readonly autocomplete="off" spellcheck="false"><button class="primary" id="copy-token">토큰 복사</button><pre><code>tokenpet connect ${esc(location.origin)}</code></pre><p>위 명령 실행 후 접근 키 입력란에 토큰을 붙여 넣으세요. 만료일: ${date(result.expires)}</p>`);
    }
  } catch (error) { if (errorArea?.isConnected) errorArea.textContent = (error instanceof Error ? error.message : String(error)); else toast((error instanceof Error ? error.message : String(error))); }
  finally { busy = false; if (submit) submit.disabled = false; }
});
async function load() {
  const current = ++loadRequest;
  let nextIdentity: Partial<Identity> = await api('/api/me'), nextState: ServerState | null = null, nextTokens: ApiToken[] = [];
  if (nextIdentity.local && !nextIdentity.authenticated) {
    await api('/api/session', {}); nextIdentity = await api('/api/me');
  }
  if (nextIdentity.authenticated) {
    try { nextState = await api('/api/state'); }
    catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 401)) throw error; nextIdentity = {}; }
  }
  if (tab === 'connect' && nextIdentity.user && !nextIdentity.local) nextTokens = (await api('/api/tokens')).tokens;
  if (current !== loadRequest) return;
  identity = nextIdentity; state = nextState; tokens = nextTokens;
  if (!state && filter === 'owned') filter = 'all';
  render();
}
async function start() {
  const slug = /^\/share\/([a-f0-9-]{36})$/.exec(location.pathname)?.[1];
  try {
    if (slug) {
      shared = await api(`/api/share/${slug}`); tab = 'dex'; filter = 'owned';
      $('.sidebar').hidden = true; $('.sidebar').style.display = 'none'; $('.workspace').style.marginLeft = '0';
      $('.top-actions').style.display = 'none'; $('#workspace-name').textContent = 'TokenPet / 함께한 친구들의 기록'; render(); return;
    }
    directory = { ...await api('/api/catalog'), pets: [] };
    await load(); if (tab === 'ranking') await loadRanking();
    setInterval(async () => {
      if (busy || modal.open || ['INPUT', 'SELECT'].includes(document.activeElement?.tagName || '') || document.hidden || !state) return;
      try { await load(); } catch { $('#server-label').textContent = '서버 연결 확인 필요'; }
    }, 5000);
  } catch (error) { $('#main').innerHTML = `<div class="loading">${esc((error instanceof Error ? error.message : String(error)))}<p>서버를 확인하고 새로고침해 주세요.</p></div>`; }
}
start();
