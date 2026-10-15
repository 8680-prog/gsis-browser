import { expect, test, type Page } from '@playwright/test';

const OK = 'http://frame-ok.test:4101/';

async function go(page: Page, input: string) {
  const address = page.getByTestId('address');
  await address.click();
  await address.fill(input);
  await address.press('Enter');
}

const view = (page: Page) => page.getByTestId('active-view');
const frame = (page: Page) => view(page).frameLocator('iframe[data-testid="web-frame"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('shows the workspace shell with home page', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  const response = await page.goto('/');
  expect(response!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  for (const id of ['home', 'newtab', 'bookmarks', 'history', 'games', 'apps', 'settings']) {
    await expect(page.getByTestId(`side-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('tab')).toHaveCount(1);
  await expect(page.getByTestId('page-home')).toBeVisible();
  await expect(page.getByTestId('shortcut').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png' });
  expect(violations).toEqual([]);
});

test('loads an embeddable site and shows its title', async ({ page }) => {
  await go(page, OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');
  await expect(page.getByTestId('tab').first()).toContainText('Frame OK Fixture');
  await expect(page.getByTestId('address')).toHaveValue(OK);
  await page.screenshot({ path: 'test-results/embedded.png' });
});

test('normalizes a bare host and treats text as a search with the configured engine', async ({ page }) => {
  await go(page, 'frame-ok.test:4101/page2');
  // Bare hosts default to https; the fixture only speaks http, so the check reports a failure.
  await expect(page.getByTestId('address')).toHaveValue('https://frame-ok.test:4101/page2');

  await page.getByTestId('side-settings').click();
  await page.getByTestId('engine-select').selectOption('custom');
  await page.getByPlaceholder('https://example.com/search?q=%s').fill('http://search.test:4101/search?q=%s');
  await page.getByRole('button', { name: 'Save' }).first().click();

  await go(page, 'fern fronds & spores');
  await expect(page.getByTestId('address')).toHaveValue('http://search.test:4101/search?q=fern%20fronds%20%26%20spores');
  await expect(frame(page).locator('#q')).toHaveText('Query: fern fronds  spores');
});

test('explains X-Frame-Options and CSP blocks instead of showing a blank frame', async ({ page }) => {
  await go(page, 'http://frame-xfo.test:4101/');
  await expect(page.getByTestId('state-blocked')).toBeVisible();
  await expect(page.getByTestId('block-reason')).toContainText('X-Frame-Options: DENY');
  await expect(page.getByTestId('open-new-tab')).toBeVisible();
  await page.screenshot({ path: 'test-results/blocked-xfo.png' });

  // The browser itself really refuses the frame when we try anyway.
  await page.getByRole('button', { name: 'Try embedding anyway' }).click();
  await page.waitForTimeout(1000);
  await expect(frame(page).getByText('SECRET XFO CONTENT')).toHaveCount(0);

  await go(page, 'http://frame-csp.test:4101/');
  await expect(page.getByTestId('block-reason')).toContainText("frame-ancestors 'none'");
});

test('honours a CSP allow-list that names this app', async ({ page }) => {
  await go(page, 'http://frame-allowlist.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Allowlisted embed');
});

test('follows redirects and shows the final URL', async ({ page }) => {
  await go(page, 'http://redirect.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');
  await expect(page.getByTestId('address')).toHaveValue(OK);
});

test('reports DNS failures, refused connections and timeouts with retry', async ({ page }) => {
  await go(page, 'http://no-such-site.example:4101/');
  await expect(page.getByTestId('error-title')).toHaveText('Site not found');
  await expect(page.getByTestId('retry')).toBeVisible();

  await go(page, 'http://closed.test:4199/');
  await expect(page.getByTestId('error-title')).toHaveText('Connection refused');

  await go(page, 'http://slow.test:4101/');
  await expect(page.getByTestId('state-checking')).toBeVisible();
  await expect(page.getByTestId('error-title')).toHaveText('The site took too long to respond', { timeout: 10_000 });

  await go(page, 'http://10.0.0.1:4101/'); // private range: refused before any connection
  await expect(page.getByTestId('error-title')).toHaveText('This address cannot be opened');
});

test('tabs keep separate pages; switching and closing work', async ({ page }) => {
  await go(page, OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');

  await page.getByTestId('new-tab').click();
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await expect(page.getByTestId('page-home')).toBeVisible();
  await go(page, 'http://other-ok.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');

  await page.getByTestId('new-tab').click();
  await page.getByTestId('side-games').click();
  await expect(page.getByTestId('page-games')).toBeVisible();

  // Switch back to tab 1: its page is still there and the address bar follows.
  await page.getByTestId('tab').nth(0).click();
  await expect(page.getByTestId('address')).toHaveValue(OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');

  // Close the active middle tab -> the tab to its right becomes active.
  await page.getByTestId('tab').nth(1).click();
  await page.getByTestId('tab').nth(1).getByTestId('tab-close').click();
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await expect(page.getByTestId('page-games')).toBeVisible();

  // Close the last (active) tab -> the left neighbour becomes active.
  await page.getByTestId('tab').nth(1).getByTestId('tab-close').click();
  await expect(page.getByTestId('tab')).toHaveCount(1);
  await expect(page.getByTestId('address')).toHaveValue(OK);

  // Closing the only tab leaves a fresh home tab.
  await page.getByTestId('tab-close').click();
  await expect(page.getByTestId('tab')).toHaveCount(1);
  await expect(page.getByTestId('page-home')).toBeVisible();
});

test('back, forward and reload', async ({ page }) => {
  await go(page, 'http://frame-ok.test:4101/counter');
  await expect(frame(page).locator('#count')).toHaveText(/Load #\d+/);
  const first = Number((await frame(page).locator('#count').textContent())!.replace(/\D/g, ''));

  // Reload re-runs the embed check and reloads the frame (the fixture counts both requests).
  await page.getByTestId('reload').click();
  await expect
    .poll(async () => Number(((await frame(page).locator('#count').textContent()) ?? '').replace(/\D/g, '')))
    .toBeGreaterThan(first);

  await go(page, 'http://other-ok.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('address')).toHaveValue('http://frame-ok.test:4101/counter');
  await expect(frame(page).locator('#count')).toBeVisible();
  await page.getByTestId('forward').click();
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
  await expect(page.getByTestId('forward')).toBeDisabled();

});

test('Back and Forward step through links followed inside an embedded page', async ({ page }) => {
  await go(page, OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');
  await frame(page).locator('#next').click();
  await expect(frame(page).locator('h1')).toHaveText('Second fixture page');
  await frame(page).locator('#next').click();
  await expect(frame(page).locator('h1')).toHaveText('Third fixture page');
  await expect(page.getByTestId('frame-depth-hint')).toBeVisible();

  // Back undoes in-page links one at a time instead of leaving the site.
  await page.getByTestId('back').click();
  await expect(frame(page).locator('h1')).toHaveText('Second fixture page');
  await expect(page.getByTestId('forward')).toBeEnabled();
  await page.getByTestId('back').click();
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');
  await expect(page.getByTestId('frame-depth-hint')).toHaveCount(0);

  // Forward redoes them.
  await page.getByTestId('forward').click();
  await expect(frame(page).locator('h1')).toHaveText('Second fixture page');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');

  // Once the page is back where Fern opened it, Back continues with the tab's own history.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('page-home')).toBeVisible();
  await expect(page.getByTestId('back')).toBeDisabled();
  await page.getByTestId('forward').click();
  await expect(page.getByTestId('address')).toHaveValue(OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');
});

test('Back stays correct after a Fern navigation and across tabs', async ({ page }) => {
  // Links in a page that Fern later replaced must not be "undone" in the new page.
  await go(page, OK);
  await frame(page).locator('#next').click();
  await expect(frame(page).locator('h1')).toHaveText('Second fixture page');
  await go(page, 'http://other-ok.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
  await frame(page).locator('#next').click();
  await expect(frame(page).locator('h1')).toHaveText('Other site page B');
  await page.getByTestId('back').click();
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('address')).toHaveValue(OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');

  // Tab 1 follows a link, then tab 2 follows a link. Back in tab 1 must not move tab 2.
  await frame(page).locator('#next').click();
  await expect(frame(page).locator('h1')).toHaveText('Second fixture page');
  await page.getByTestId('new-tab').click();
  await go(page, 'http://other-ok.test:4101/');
  await frame(page).locator('#next').click();
  await expect(frame(page).locator('h1')).toHaveText('Other site page B');
  await page.getByTestId('tab').nth(0).click();
  await page.getByTestId('back').click();
  // Falls back to tab 1's own history (reload of the page Fern opened is not involved).
  await expect(page.getByTestId('page-home')).toBeVisible();
  await page.getByTestId('tab').nth(1).click();
  await expect(frame(page).locator('h1')).toHaveText('Other site page B');
});

test('re-entering the current address reloads without a duplicate history entry', async ({ page }) => {
  await go(page, 'http://other-ok.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
  await go(page, 'http://other-ok.test:4101/');
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('page-home')).toBeVisible();
});

test('without the embed-check backend (static hosting) pages still load with an honest notice', async ({ page }) => {
  // Simulates GitHub Pages and similar hosts, where /api/inspect does not exist.
  await page.route('**/api/inspect**', (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' }));
  await go(page, 'http://other-ok.test:4101/?static=1');
  await expect(page.getByTestId('frame-notice')).toContainText('embed check service is not available');
  await expect(page.getByTestId('frame-notice')).toContainText('site probably forbids embedding');
  await expect(frame(page).locator('h1')).toHaveText('Another embeddable site');
});

test('bookmarks, theme, history and open tabs persist across a refresh', async ({ page }) => {
  await go(page, OK);
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');
  await page.getByTestId('bookmark-toggle').click();
  await expect(page.getByTestId('bookmark-toggle')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('new-tab').click();
  await page.getByTestId('side-settings').click();
  await page.getByTestId('theme-select').selectOption('midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await expect(page.getByTestId('page-settings')).toBeVisible();

  await page.getByTestId('tab').nth(0).click();
  await expect(frame(page).locator('h1')).toHaveText('Embeddable fixture page');

  await page.getByTestId('side-bookmarks').click();
  await expect(page.getByTestId('bookmark-row')).toHaveCount(1);
  await expect(page.getByTestId('bookmark-row')).toContainText('Frame OK Fixture');

  await page.getByTestId('side-history').click();
  await expect(page.getByTestId('history-row').first()).toContainText('Frame OK Fixture');
});

test('keyboard shortcuts', async ({ page }) => {
  await page.locator('body').click();
  await page.keyboard.press('Control+l');
  await expect(page.getByTestId('address')).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Alt+t');
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await page.keyboard.press('Alt+1');
  await expect(page.getByTestId('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Alt+w');
  await expect(page.getByTestId('tab')).toHaveCount(1);
});

test('games and apps catalogs render', async ({ page }) => {
  await page.getByTestId('side-apps').click();
  await expect(page.getByTestId('catalog-card').first()).toBeVisible();
  await page.getByTestId('side-games').click();
  expect(await page.getByTestId('catalog-card').count()).toBeGreaterThan(5);
});

test('fits a small Chromebook-sized window', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 600 });
  await go(page, OK);
  await expect(frame(page).locator('h1')).toBeVisible();
  const box = await page.getByTestId('web-frame').boundingBox();
  expect(box!.width).toBeGreaterThan(560);
  expect(box!.height).toBeGreaterThan(450);
  await page.screenshot({ path: 'test-results/narrow.png' });
});
