import type { SavedConnection } from './types.js';

import { createInterface } from 'node:readline/promises';
import { configuration, credential, endpoint, saveConnection } from './config.js';
import { request } from './client.js';

function secret() {
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const done = (error?: Error) => {
      process.stdin.off('data', input); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const input = (bytes: Buffer) => {
      for (const char of bytes.toString()) {
        if (char === '\u0003' || char === '\u0004') { done(new Error('설치를 취소했습니다.')); return; }
        if (char === '\r' || char === '\n') { done(); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input);
    process.stdout.write('회원 연결 토큰 / 서버 접근 키 (입력 내용은 표시되지 않음): ');
  });
}

export async function connect(target?: string, { env = process.env } = {}) {
  const config = configuration(env, { server: true });
  if (!target) {
    if (!process.stdin.isTTY) throw new Error('대화형 터미널에서 실행하거나 --local / --endpoint <주소>를 지정해 주세요.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('\nTokenPet을 어디에서 키울까요?\n  1) 이 컴퓨터에서 실행\n  2) 서버에 연결');
      const mode = (await prompt.question('선택 [1]: ')).trim() || '1';
      if (!['1', '2'].includes(mode)) throw new Error('1 또는 2를 선택해 주세요.');
      target = mode === '1' ? 'local' : await prompt.question('서버 도메인 또는 IP (예: pets.example.com): ');
    } finally { prompt.close(); }
  }
  let saved: SavedConnection = {};
  if (target !== 'local') {
    const server = endpoint(target);
    let key = config.token;
    if (!key) {
      if (!process.stdin.isTTY) throw new Error('TOKENPET_API_KEY_FILE 또는 TOKENPET_API_KEY로 서버 접근 키를 전달해 주세요.');
      key = await secret();
    }
    const remote = { ...config, baseUrl: server, token: key.trim(), remote: true };
    credential(remote);
    const state = await request('/api/state', undefined, { config: remote });
    if (!state.player || !state.active || !Array.isArray(state.catalog)) throw new Error('TokenPet 서버가 아니에요. 주소를 확인해 주세요.');
    saved = { server, key: remote.token };
  }
  // Save only after authentication succeeds; local credentials and games stay separate.
  saveConnection(config.dataDir, saved);
  delete env.TOKENPET_SERVER; delete env.TOKENPET_API_KEY; delete env.TOKENPET_API_KEY_FILE;
  console.log(saved.server ? `서버 연결 완료: ${saved.server} (API 경로 자동 설정)` : '로컬 모드를 선택했습니다.');
}
