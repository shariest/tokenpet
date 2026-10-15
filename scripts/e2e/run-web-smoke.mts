import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const session = '-s=tokenpet-issues-e2e';
const cli = (...args: string[]) => execute('playwright-cli', [session, ...args], { timeout: 90000, maxBuffer: 1024 * 1024 });
mkdirSync('scripts/e2e/reports', { recursive: true });
try {
  const opened = await cli('open', process.argv[2] || 'http://localhost:4880');
  assert.doesNotMatch(opened.stdout, /^### Error/m, 'browser must open successfully');
  const result = await cli('run-code', '--filename=scripts/e2e/web-smoke.js');
  writeFileSync('scripts/e2e/reports/web-smoke.log', result.stdout + result.stderr, { mode: 0o600 });
  assert.doesNotMatch(result.stdout, /^### Error/m, 'Playwright scenario must finish without an error');
  const match = /^### Result\r?\n([\s\S]+?)(?=\r?\n### |$)/m.exec(result.stdout);
  assert.ok(match, 'Playwright must return a scenario result');
  const evidence = JSON.parse(match[1]);
  assert.equal(evidence.status, 'passed');
  assert.match(evidence.account, /^e2e_\d+_[a-z0-9]+$/);
  assert.equal(evidence.checks.length, 16);
  writeFileSync('scripts/e2e/reports/result.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(`TOKENPET_WEB_E2E_PASS (${evidence.checks.length} checks, account ${evidence.account})`);
} finally {
  await cli('close');
}
