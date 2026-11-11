import { expect, test, type Browser, type Page } from '@playwright/test';

const QUESTIONS = 5;

async function newPlayer(browser: Browser, nickname: string, path = '/'): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await page.getByLabel('Biệt danh').fill(nickname);
  await page.getByRole('button', { name: 'Lưu' }).click();
  return page;
}

/** Host creates a room, guests join by link, host picks 5 questions / 10 s / the fixture artist, starts. */
async function setUpGame(browser: Browser, names: string[]): Promise<{ code: string; pages: Page[] }> {
  const host = await newPlayer(browser, names[0]);
  await host.getByRole('button', { name: 'Tạo phòng' }).click();
  await host.waitForURL(/\/r\/\d{5}$/);
  const code = host.url().split('/').pop()!;

  const guests: Page[] = [];
  for (const name of names.slice(1)) {
    const guest = await newPlayer(browser, name, `/r/${code}`);
    await expect(guest.getByText('Chờ chủ phòng bắt đầu…')).toBeVisible();
    guests.push(guest);
  }
  await expect(host.getByText(`${names.length}/10`)).toBeVisible();

  await host.getByLabel('Số câu').selectOption(String(QUESTIONS));
  await expect(host.getByLabel('Số câu')).toHaveValue(String(QUESTIONS));
  await host.getByLabel('Thời gian mỗi câu').selectOption('10000');
  await expect(host.getByLabel('Thời gian mỗi câu')).toHaveValue('10000');
  await host.getByRole('tab', { name: 'Ca sĩ' }).click();
  await host.getByRole('button', { name: /Đen Vâu/ }).click();
  for (const guest of guests) await expect(guest.getByText(`${QUESTIONS} câu`)).toBeVisible();

  await host.getByRole('button', { name: 'Bắt đầu' }).click();
  return { code, pages: [host, ...guests] };
}

interface RoundResult {
  labels: string[];
  title: string;
  points: number;
}

/** Plays round n: every page answers choice #i (i = player index) and reads its reveal. */
async function playRound(pages: Page[], n: number): Promise<RoundResult[]> {
  await Promise.all(
    pages.map((p) => expect(p.locator('.question-head')).toContainText(`Vòng ${n}/${QUESTIONS}`, { timeout: 30_000 })),
  );
  const labels = await Promise.all(pages.map((p) => p.locator('.choice .choice__label').allTextContents()));
  await Promise.all(
    pages.map(async (p, i) => {
      const choice = p.locator('.choice').nth(i % 4);
      await expect(choice).toBeEnabled();
      await choice.click();
      await expect(choice).toContainText('Bạn đã chọn');
    }),
  );
  return Promise.all(
    pages.map(async (p, i) => {
      const reveal = p.getByRole('region', { name: 'Đáp án' });
      await expect(reveal).toBeVisible({ timeout: 30_000 });
      const pointsText = (await reveal.locator('.reveal__points').textContent()) ?? '';
      const m = pointsText.match(/\+(\d+) điểm/);
      return {
        labels: labels[i],
        title: (await reveal.locator('.reveal__title').textContent()) ?? '',
        points: m ? Number(m[1]) : 0,
      };
    }),
  );
}

async function finalRanking(page: Page): Promise<Map<string, number>> {
  const ranking = page.getByRole('list', { name: 'Xếp hạng chung cuộc' });
  await expect(ranking).toBeVisible({ timeout: 30_000 });
  const rows = ranking.locator('li');
  const result = new Map<string, number>();
  for (let i = 0; i < (await rows.count()); i++) {
    const name = (await rows.nth(i).locator('.ranking__name').textContent())!.trim();
    result.set(name, Number(await rows.nth(i).locator('.ranking__score').textContent()));
  }
  return result;
}

test('host and two guests play a 5-question game, see the same rounds, and the ranking matches the sum of points', async ({
  browser,
}) => {
  const names = ['Chủ Xị', 'Khách Một', 'Khách Hai'];
  const { pages } = await setUpGame(browser, names);
  const totals = new Map(names.map((n) => [n, 0]));

  for (let n = 1; n <= QUESTIONS; n++) {
    const results = await playRound(pages, n);
    // Same round for everyone: identical choices and the same revealed track.
    for (const r of results) {
      expect(r.labels).toEqual(results[0].labels);
      expect(r.title).toBe(results[0].title);
      expect(r.labels).toContain(r.title);
    }
    // Distinct choices: at most one player can be right.
    expect(results.filter((r) => r.points > 0).length).toBeLessThanOrEqual(1);
    results.forEach((r, i) => totals.set(names[i], totals.get(names[i])! + r.points));
  }

  for (const page of pages) {
    expect(await finalRanking(page)).toEqual(totals);
  }
  await expect(pages[0].getByRole('button', { name: 'Ván mới' })).toBeVisible();
  await expect(pages[1].getByRole('button', { name: 'Ván mới' })).toHaveCount(0);
});

test('rematch returns everyone to the lobby with scores reset', async ({ browser }) => {
  // Four players pick four different choices, so every round has exactly one scorer.
  const names = ['Chủ Xị', 'Khách Một', 'Khách Hai', 'Khách Ba'];
  const { code, pages } = await setUpGame(browser, names);
  for (let n = 1; n <= QUESTIONS; n++) {
    const results = await playRound(pages, n);
    expect(results.filter((r) => r.points > 0)).toHaveLength(1);
  }
  const before = await finalRanking(pages[0]);
  expect([...before.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

  await pages[0].getByRole('button', { name: 'Ván mới' }).click();
  await expect(pages[0].getByRole('button', { name: 'Bắt đầu' })).toBeVisible();
  for (const guest of pages.slice(1)) await expect(guest.getByText('Chờ chủ phòng bắt đầu…')).toBeVisible();

  for (const page of pages) {
    const res = await page.request.get(`/api/rooms/${code}`);
    expect(res.status()).toBe(200);
    const snap = await res.json();
    expect(snap.phase).toBe('lobby');
    expect(snap.gameNo).toBe(2);
    expect(snap.players).toHaveLength(names.length);
    for (const p of snap.players) expect(p.score).toBe(0);
  }
});
