import type { Species, Tier, TierId } from './types.js';

export const RULES = { tokensPerCoin: 10_000, pullCost: 100, uniquePityAt: 50, pityAt: 100, welcomeCoins: 300, careCooldownMs: 30_000,
  checkinBaseCoins: 100, checkinStepCoins: 20, checkinMaxDays: 7 };
export const TIERS: Tier[] = [
  { id: 'common', name: '커먼', chance: 78.9, color: '#879987' },
  { id: 'rare', name: '레어', chance: 15, color: '#548ccc' },
  { id: 'epic', name: '에픽', chance: 5, color: '#a274bc' },
  { id: 'unique', name: '유니크', chance: 1, color: '#dc8755' },
  { id: 'legendary', name: '레전더리', chance: 0.1, color: '#bc921f' },
];
export const FAMILIES = [
  ['sprout', '모스', '작은 커밋을 모으는 새싹'], ['cat', '미오', '세미콜론을 쫓는 고양이'],
  ['bunny', '토토', '브랜치 사이를 뛰어다니는 토끼'], ['dog', '바우', '배포를 기다리는 강아지'],
  ['fox', '루루', '버그 냄새를 맡는 여우'], ['bear', '보보', '묵묵히 곁을 지키는 곰'],
  ['panda', '판디', '휴식을 좋아하는 판다'], ['koala', '코코', '나무 위에서 생각하는 코알라'],
  ['hamster', '햄찌', '작은 아이디어를 저장하는 햄스터'], ['squirrel', '도토', '캐시를 모아 두는 다람쥐'],
  ['hedgehog', '고슴', '방어적인 코드를 좋아하는 고슴도치'], ['otter', '수리', '돌멩이로 리듬을 타는 수달'],
  ['owl', '오울', '밤의 작업실을 지키는 부엉이'], ['penguin', '핑구', '차가운 서버실의 펭귄'],
  ['chick', '삐요', '첫 빌드를 응원하는 병아리'], ['duck', '꽥이', '디버깅 이야기를 들어주는 오리'],
  ['parrot', '파로', '좋은 코드를 따라 읽는 앵무새'], ['bat', '배티', '어둠 속에서 길을 찾는 박쥐'],
  ['dragon', '드라고', '아이디어에 불을 붙이는 용'], ['dino', '디노', '오래된 코드를 기억하는 공룡'],
  ['turtle', '터티', '천천히 확실하게 나아가는 거북이'], ['frog', '개굴', '웅덩이 사이를 점프하는 개구리'],
  ['axolotl', '우파', '언제나 다시 시작하는 우파루파'], ['fish', '피니', '데이터의 강을 헤엄치는 물고기'],
  ['whale', '고래', '큰 꿈을 품은 작은 고래'], ['octopus', '문어', '여덟 가지 일을 돕는 문어'],
  ['jelly', '젤리', '생각을 둥실 띄우는 해파리'], ['crab', '크랩', '실수를 집어내는 게'],
  ['snail', '달팽', '자기만의 속도로 걷는 달팽이'], ['bee', '붕붕', '작은 성과를 모으는 꿀벌'],
  ['butterfly', '나비', '리팩터링 끝에 날아오르는 나비'], ['mushroom', '머쉬', '조용히 지혜를 키우는 버섯'],
  ['cactus', '선인', '긴 기다림에도 씩씩한 선인장'], ['slime', '말랑', '어떤 문제에도 유연한 슬라임'],
  ['ghost', '유령', '숨은 에러를 발견하는 유령'], ['robot', '로보', '반복 작업을 좋아하는 로봇'],
].map(([id, name, description]) => ({ id, name, shape: id, description }));
export const HABITATS = [
  ['forest', '숲속', 'common', '#9bb97c', '잎사귀'], ['meadow', '들판', 'common', '#d3b47d', '들꽃'],
  ['shore', '바닷가', 'common', '#99c1c1', '조개'], ['cloud', '구름', 'rare', '#a5c7e7', '빗방울'],
  ['coral', '산호', 'rare', '#e5a296', '산호 조각'], ['frost', '서리', 'rare', '#abbce0', '눈송이'],
  ['moon', '달빛', 'epic', '#b9a1d3', '달 조각'], ['ember', '불꽃', 'epic', '#dda071', '작은 불씨'],
  ['aurora', '오로라', 'unique', '#8bc8b4', '빛의 결정'], ['celestial', '별의', 'legendary', '#e8c36f', '왕관'],
].map(([id, name, tier, color, accessory]) => ({ id, name, tier: tier as TierId, color, accessory }));
export const CATALOG: Species[] = HABITATS.flatMap((habitat, h) => FAMILIES.map((family, f) => ({
  id: h === 0 && f === 0 ? 'sprout' : `${habitat.id}-${family.id}`,
  name: `${habitat.name} ${family.name}`, family: family.id, habitat: habitat.id, variant: h,
  tier: habitat.tier, color: habitat.color, shape: family.shape, number: h * FAMILIES.length + f + 1,
  description: `${family.description}. 소중한 보물은 ${habitat.accessory}.`,
})));
export const CARE = {
  feed: { label: '밥 주기', cost: 5 }, play: { label: '놀아주기', cost: 0 },
  clean: { label: '씻겨주기', cost: 3 }, sleep: { label: '재우기', cost: 0 }, wake: { label: '깨우기', cost: 0 },
};
