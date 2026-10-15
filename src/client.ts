import type { ApiResponses, Configuration, GameState } from './types.js';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration, credential } from './config.js';

export async function request<P extends keyof ApiResponses>(path: P, data?: unknown, { config = configuration(), key = randomUUID(), timeout = 8000 }: { config?: Configuration; key?: string; timeout?: number } = {}): Promise<ApiResponses[P]> {
  const token = credential(config);
  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: data === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { 'X-API-Key': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch { throw new Error(`작업실에 연결할 수 없어요: ${config.baseUrl}. 주소와 HTTPS 인증서를 확인해 주세요.`); }
  let result;
  try { result = await response.json(); } catch { throw new Error(`TokenPet API 응답이 아니에요: ${config.baseUrl}`); }
  if (!response.ok) throw new Error(response.status === 401 ? '서버 접근 키가 맞지 않아요. tokenpet connect로 다시 연결해 주세요.' : result.error || `HTTP ${response.status}`);
  const state: GameState | undefined = path === '/api/state' ? result : result.state;
  if (config.remote && state?.active && config.codexPetDir) {
    try {
      if (JSON.parse(readFileSync(join(config.codexPetDir, 'pet.json'), 'utf8')).id === 'tokenpet')
        (await import('./codex-pet.js')).installCodexPet(state, config.codexPetDir);
    }
    catch { /* A pet image failure must not turn a successful purchase into a retry. */ }
  }
  return result as ApiResponses[P];
}
