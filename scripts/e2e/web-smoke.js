// Run on the actual member service with playwright-cli run-code --filename=...
async page => {
  const member = new URL(page.url()).origin;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const json = async path => {
    const response = await page.request.get(member + path);
    check(response.ok(), `GET ${path}: ${response.status()}`);
    return response.json();
  };
  const clickRequest = async (selector, path, method = 'POST') => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method);
    await page.locator(selector).click();
    const result = await response;
    check(result.ok(), `${method} ${path}: ${result.status()}`);
    return result.json();
  };
  const close = () => page.locator('#modal .dialog-close').click();
  const noOverflow = async target => check(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
  const username = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const password = `E2E_${Math.random().toString(36)}_${Math.random().toString(36)}`;
  await page.addInitScript(() => {
    window.__installCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
      if (window.__denyCopy) throw new Error('Clipboard unavailable');
      window.__installCopies.push(text);
    } } });
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(member);
  await page.locator('.welcome').waitFor();
  check(!(await json('/api/me')).local, 'member service must require member authentication');
  const directory = await json('/api/catalog');
  check(directory.catalog.length === 360, 'public catalog contains every species');
  await page.locator('.nav[data-tab="dex"]').click();
  await page.locator('.dex-card').first().waitFor();
  check(await page.locator('.dex-card').count() === 24, 'public catalog is paginated');
  check(await page.locator('[data-filter="owned"]').count() === 0, 'guest cannot filter another account’s owned pets');
  await page.locator('[data-filter="legendary"]').click();
  check(await page.locator('.dex-card').count() > 0, 'legendary catalog filter works');
  await noOverflow(page);
  await page.locator('.nav[data-tab="connect"]').click();
  await page.locator('#install-tokenpet').waitFor();
  const installers = await page.locator('#install-tokenpet pre code').allTextContents();
  check(installers[0].startsWith('curl -fsSL ') && installers[0].endsWith('/main/install.sh | bash'), 'guest sees the macOS/Linux installer');
  check(installers[1].startsWith('irm ') && installers[1].endsWith('/main/install.ps1 | iex'), 'guest sees the Windows installer');
  check(await page.locator('.welcome').count() === 0, 'guest connect page displays installation instructions');
  const guide = await page.locator('#main').innerText();
  check(guide.indexOf('1. TokenPet') >= 0 && guide.indexOf('1. TokenPet') < guide.indexOf('2. 로그인') && guide.indexOf('2. 로그인') < guide.indexOf('tokenpet connect '), 'installation precedes token and connection steps');
  await page.locator('#copy-install-unix').click();
  await page.waitForFunction(() => window.__installCopies.length === 1);
  await page.locator('#copy-install-windows').click();
  await page.waitForFunction(() => window.__installCopies.length === 2);
  check(JSON.stringify(await page.evaluate(() => window.__installCopies)) === JSON.stringify(installers), 'copy buttons preserve both complete one-line commands');
  await page.evaluate(() => { window.__denyCopy = true; });
  await page.locator('#copy-install-unix').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Clipboard unavailable');
  check(!await page.locator('#copy-install-unix').isDisabled(), 'clipboard failure leaves the copy button usable');
  await page.evaluate(() => { window.__denyCopy = false; });
  for (const width of [320, 390, 768, 1024, 1920]) {
    const preview = await page.context().newPage();
    try {
      await preview.setViewportSize({ width, height: 1080 });
      await preview.goto(member + '/#connect');
      await preview.locator('#install-tokenpet').waitFor();
      await noOverflow(preview);
      check(await preview.locator('#install-tokenpet pre code').evaluateAll(codes => codes.every(code => code.getBoundingClientRect().height <= parseFloat(getComputedStyle(code).lineHeight) + 1)), `installer commands never wrap at ${width}px`);
      check(await preview.locator('.install-copy').evaluateAll(buttons => buttons.every(button => { const box = button.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })), `copy buttons fit at ${width}px`);
      if (width === 390 || width === 1920) await preview.screenshot({ path: `scripts/e2e/reports/release-install-${width}.png` });
    } finally { await preview.close(); }
  }

  await page.locator('.top-actions [data-auth="signup"]').click();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-nickname').fill('E2E 테스트 친구');
  await page.locator('#auth-password').fill(password);
  await clickRequest('#auth-form button[type="submit"]', '/api/signup');
  await page.locator('#logout').waitFor();
  check((await json('/api/state')).player.coins === 300, 'signup starts with the welcome wallet');
  await page.locator('.nav[data-tab="home"]').click();
  await page.locator('#checkin').waitFor();
  const attendance = await clickRequest('#checkin', '/api/checkin');
  check(attendance.awarded && attendance.state.player.coins === 400, 'attendance awards once');
  await page.waitForFunction(() => document.querySelector('#checkin')?.disabled);
  const fed = await clickRequest('#care-feed', '/api/care');
  check(fed.state.player.coins === 395 && Math.round(fed.state.active.hunger) === 100, 'care debits the test wallet and updates vitals');
  const slept = await clickRequest('#care-sleep', '/api/care');
  check(slept.state.active.sleeping, 'sleep persists');
  await page.waitForFunction(() => document.querySelector('#care-feed')?.disabled);
  const woke = await clickRequest('#care-wake', '/api/care');
  check(!woke.state.active.sleeping, 'wake persists');

  await page.locator('.nav[data-tab="hatch"]').click();
  await page.locator('details.odds summary').click();
  const odds = await page.locator('.odds-row b').allTextContents();
  check(JSON.stringify(odds) === JSON.stringify(['78.9%', '15%', '5%', '1%', '0.1%']), 'published rarity odds match game rules');
  const refresh = page.waitForResponse(r => new URL(r.url()).pathname === '/api/state' && r.request().method() === 'GET');
  await refresh;
  await page.waitForFunction(() => document.querySelector('details.odds')?.open);
  check(await page.locator('details.odds').evaluate(element => element.open), 'odds stay open across actual periodic refresh');
  const hatch = await clickRequest('[data-pull="1"]', '/api/gacha');
  check(hatch.results.length === 1 && hatch.state.player.coins === 295, 'one paid draw debits once');
  await page.locator('#modal .result').waitFor();
  await close();
  check(await page.locator('details.odds').evaluate(element => element.open), 'odds stay open after hatching');
  await page.screenshot({ path: 'scripts/e2e/reports/member-hatch-1920.png' });

  await page.locator('.nav[data-tab="dex"]').click();
  await page.locator('[data-filter="owned"]').click();
  const state = await json('/api/state');
  check(await page.locator('.dex-card').count() === state.pets.length, 'owned filter reflects only this account');
  await page.locator(`[data-preview="${state.active.id}"]`).click();
  await page.locator('.portrait-vitals').waitFor();
  check(await page.locator('.portrait-vitals .vital').count() === 4, 'selected pet preview shows all vitals');
  await close();
  await page.locator('#share-button').click();
  const share = await clickRequest('#enable-share', '/api/share');
  const publicCollection = await json('/api' + share.path);
  check(!('player' in publicCollection) && !('tokens' in publicCollection), 'shared collection does not expose wallet or usage');
  await page.locator('#disable-share').waitFor();
  await clickRequest('#disable-share', '/api/share');
  await page.locator('#enable-share').waitFor();
  await close();

  await page.locator('.nav[data-tab="ranking"]').click();
  await page.locator('.my-rank').waitFor();
  check((await json('/api/rankings?type=level')).me !== null, 'highest-pet ranking includes the new member');
  await page.locator('[data-ranking="collection"]').click();
  await page.locator('.my-rank').waitFor();
  check((await json('/api/rankings?type=collection')).me.speciesCount === state.pets.length, 'collection ranking counts distinct species');
  await page.locator('[data-ranking="tokens"]').click();
  await page.locator('.my-rank').waitFor();
  check((await json('/api/rankings?type=tokens')).me.tokens === state.player.tokens, 'token ranking reports lifetime tokens');
  check((await json('/api/rankings?type=tokens&from=2000-01-01&to=2999-12-31')).me !== null, 'token ranking accepts a period');
  await noOverflow(page);

  await page.locator('.nav[data-tab="connect"]').click();
  await page.locator('#install-tokenpet').waitFor();
  await page.locator('#issue-token').waitFor();
  const issue = async () => {
    await page.locator('#issue-token').click();
    const result = await clickRequest('#token-form button.primary', '/api/tokens');
    await page.locator('#new-token').waitFor();
    check(await page.locator('#new-token').inputValue() === result.token, 'new token is displayed once');
    await close();
    return result.token;
  };
  const first = await issue(), second = await issue();
  check(first !== second && (await json('/api/tokens')).tokens.length === 1, 'rotation retains exactly one token');
  const keyStatus = key => page.evaluate(async key => (await fetch('/api/state', { credentials: 'omit', headers: { 'X-API-Key': key } })).status, key);
  check(await keyStatus(first) === 401 && await keyStatus(second) === 200, 'rotating immediately invalidates the old token');
  await page.locator('[data-revoke]').click();
  await clickRequest('[data-confirm-revoke]', '/api/tokens/' + (await json('/api/tokens')).tokens[0].id, 'DELETE');
  check(await keyStatus(second) === 401, 'revocation invalidates the current token');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.nav[data-tab="dex"]').click();
  await page.locator('.dex-card').first().waitFor();
  await noOverflow(page);
  await page.screenshot({ path: 'scripts/e2e/reports/member-dex-mobile.png' });
  await clickRequest('#logout', '/api/session', 'DELETE');
  await page.locator('.top-actions [data-auth="login"]').click();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await clickRequest('#auth-form button[type="submit"]', '/api/login');
  await page.locator('#logout').waitFor();
  check((await json('/api/state')).player.coins === 295, 'logging back in preserves game state');
  await clickRequest('#logout', '/api/session', 'DELETE');
  check(!(await json('/api/me')).authenticated, 'logout removes authenticated access');

  const personal = await page.context().newPage();
  personal.on('pageerror', error => errors.push(error.message));
  try {
    await personal.setViewportSize({ width: 1920, height: 1080 });
    await personal.goto('http://127.0.0.1:4780');
    await personal.locator('#care-feed').waitFor();
    check(!await personal.locator('.nav[data-tab="ranking"]').isVisible(), 'personal mode hides member rankings');
    await personal.locator('.nav[data-tab="connect"]').click();
    await personal.locator('#install-tokenpet').waitFor();
    check(await personal.locator('#issue-token').count() === 0, 'personal mode does not require API tokens');
    await noOverflow(personal);
    await personal.locator('.nav[data-tab="dex"]').click();
    await personal.locator('[data-filter="owned"]').click();
    await personal.locator('.dex-card').first().waitFor();
  } finally { await personal.close(); }
  check(errors.length === 0, `browser exceptions: ${errors.join('; ')}`);
  return { status: 'passed', account: username, checks: ['public catalog', 'signup', 'attendance', 'care', 'sleep/wake',
    'odds refresh', 'gacha', 'owned catalog', 'pet preview', 'sharing privacy', 'three rankings',
    'single token rotation/revocation', 'mobile layout', 'login/logout', 'personal mode', 'no browser exceptions'] };
}
