// Run against a disposable app container with no production data or LINE credentials.
// REFRESH_TEST_URL, REFRESH_TEST_KEY and PLAYWRIGHT_MODULE must be explicitly set.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseURL = process.env.REFRESH_TEST_URL;
const key = process.env.REFRESH_TEST_KEY;
if (!baseURL || !key) throw new Error('Use an isolated test app: set REFRESH_TEST_URL and REFRESH_TEST_KEY');

async function createTicket(name, type = 'it_service') {
  const response = await fetch(`${baseURL}/api/internal/tickets`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ type, requester_name: name, company: 'central', location: 'สำนักงานใหญ่', description: name }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const prefix = `refresh-${Date.now()}`;
    const first = await createTicket(`${prefix}-first`);
    const refresh = page.getByRole('button', { name: 'รีเฟรชข้อมูล', exact: true });
    const frequency = page.getByLabel('ความถี่รีเฟรชอัตโนมัติ');
    const snapshot = () => page.locator('[data-dashboard-updated-at]').getAttribute('data-dashboard-updated-at');
    const waitForRefresh = old => page.waitForFunction(old => document.querySelector('[data-dashboard-updated-at]')?.dataset.dashboardUpdatedAt !== old, old);

    await page.goto(`${baseURL}/tickets`);
    await frequency.selectOption('0');
    const search = page.getByPlaceholder('ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, รหัสทรัพย์สิน...');
    await search.fill(prefix);
    await page.getByRole('cell', { name: first.ticket_code, exact: true }).waitFor();
    await page.evaluate(() => { window.refreshSentinel = 'preserved'; });
    const second = await createTicket(`${prefix}-second`);
    const before = await snapshot();
    await refresh.click();
    await waitForRefresh(before);
    await page.getByRole('cell', { name: second.ticket_code, exact: true }).waitFor();
    assert.equal(await search.inputValue(), prefix);
    assert.equal(await page.evaluate(() => window.refreshSentinel), 'preserved');
    console.log('PASS manual refresh receives new tickets and preserves filters without reloading');

    await page.clock.install();
    await frequency.selectOption('30');
    const third = await createTicket(`${prefix}-third`);
    await page.clock.fastForward(31_000);
    await page.getByRole('cell', { name: third.ticket_code, exact: true }).waitFor();
    console.log('PASS automatic refresh receives new tickets');

    await context.setOffline(true);
    await page.getByRole('status').filter({ hasText: 'ออฟไลน์' }).waitFor();
    assert.equal(await refresh.isDisabled(), true);
    const offlineSnapshot = await snapshot();
    await page.clock.fastForward(31_000);
    assert.equal(await snapshot(), offlineSnapshot);
    await context.setOffline(false);
    await waitForRefresh(offlineSnapshot);
    console.log('PASS offline pauses refresh; reconnection refreshes data');

    await page.getByRole('cell', { name: first.ticket_code, exact: true }).click();
    await page.getByRole('button', { name: 'แก้ไขสถานะ / หมายเหตุ' }).click();
    await page.getByRole('dialog').waitFor();
    const editingSnapshot = await snapshot();
    await page.clock.fastForward(61_000);
    assert.equal(await snapshot(), editingSnapshot);
    await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    console.log('PASS automatic refresh pauses while an edit form is open');

    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
    const hiddenSnapshot = await snapshot();
    await page.clock.fastForward(61_000);
    assert.equal(await snapshot(), hiddenSnapshot);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await waitForRefresh(hiddenSnapshot);
    console.log('PASS hidden tabs pause refresh and resume when visible');

    await frequency.selectOption('0');
    const disabledSnapshot = await snapshot();
    await page.clock.fastForward(61_000);
    assert.equal(await snapshot(), disabledSnapshot);
    console.log('PASS automatic refresh can be disabled');

    await page.goto(`${baseURL}/repair-history`);
    await frequency.selectOption('0');
    const repair = await createTicket(`${prefix}-repair`, 'repair');
    await refresh.click();
    await page.getByRole('cell', { name: repair.ticket_code, exact: true }).waitFor();
    console.log('PASS repair history receives fresh server rows');

    await page.goto(baseURL);
    await frequency.selectOption('0');
    const overviewSnapshot = await snapshot();
    await refresh.click();
    await waitForRefresh(overviewSnapshot);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await refresh.isVisible());
    assert.ok(await frequency.isVisible());
    assert.deepEqual(errors, []);
    console.log('PASS overview refresh and mobile controls; no browser errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
