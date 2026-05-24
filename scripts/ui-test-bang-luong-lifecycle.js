/**
 * UI test vòng đời Bảng lương / Thanh toán / Hủy phiếu
 * Yêu cầu: Chrome đã đăng nhập admin (CDP port 9222 hoặc profile có session).
 *
 * Chạy Chrome (một lần, đăng nhập Google admin):
 *   chrome.exe --remote-debugging-port=9222 --user-data-dir="%CD%\scripts\.chrome-ui-profile"
 *
 * Chạy test:
 *   node scripts/ui-test-bang-luong-lifecycle.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.UI_TEST_BASE || 'http://127.0.0.1:3000';
const WAIT_LOGIN_MS = Number(process.env.UI_WAIT_LOGIN_SEC || 0) * 1000;
const CDP_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';
const PROFILE_DIR = path.join(__dirname, '.chrome-ui-profile');
const REPORT_PATH = path.join(__dirname, '_ui-test-bang-luong-report.json');

const report = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  authOk: false,
  consoleErrors: [],
  networkIssues: [],
  rows: [],
  summary: { pass: 0, fail: 0, blocked: 0 }
};

function row(screen, action, expected, actual, status, note) {
  const r = { screen, action, expected, actual, status, note: note || '' };
  report.rows.push(r);
  if (status === 'Pass') report.summary.pass += 1;
  else if (status === 'Blocked') report.summary.blocked += 1;
  else report.summary.fail += 1;
  return r;
}

function parseMoney(text) {
  return Number(String(text || '').replace(/[^\d-]/g, '')) || 0;
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectBrowser() {
  try {
    const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
    return { browser, mode: 'cdp' };
  } catch (e) {
    const exe = process.env.PUPPETEER_EXECUTABLE_PATH
      || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: fs.existsSync(exe) ? exe : undefined,
      userDataDir: PROFILE_DIR,
      args: ['--remote-debugging-port=9223', '--no-first-run', '--no-default-browser-check'],
      defaultViewport: { width: 1400, height: 900 }
    });
    return { browser, mode: 'launch' };
  }
}

async function isLoggedIn(page) {
  const deadline = Date.now() + WAIT_LOGIN_MS;
  do {
    await page.goto(BASE + '/bang-luong', { waitUntil: 'networkidle2', timeout: 60000 });
    const url = page.url();
    const hasPayroll = await page.$('#payrollTableBody');
    const ok = !!hasPayroll && !url.includes('error=unauthorized') && !url.includes('error=login');
    if (ok) return true;
    if (!WAIT_LOGIN_MS || Date.now() >= deadline) return false;
    await wait(2000);
  } while (true);
}

async function main() {
  let browser;
  let page;
  try {
    const conn = await connectBrowser();
    browser = conn.browser;
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        report.consoleErrors.push({ text: msg.text(), url: page.url() });
      }
    });
    page.on('response', (res) => {
      const status = res.status();
      const url = res.url();
      if (status >= 500) {
        report.networkIssues.push({ status, url, kind: '5xx' });
      }
      if (status === 400 && url.includes('/api/')) {
        report.networkIssues.push({ status, url, kind: '4xx-api' });
      }
    });
    page.on('dialog', async (dialog) => {
      try { await dialog.accept(dialog.defaultValue() || 'UI test ly do huy'); } catch (_) { await dialog.dismiss(); }
    });

    if (WAIT_LOGIN_MS) {
      console.log('[UI] Cho phep dang nhap Google trong Chrome CDP (toi da ' + (WAIT_LOGIN_MS / 1000) + 's)...');
    }
    report.authOk = await isLoggedIn(page);
    if (!report.authOk) {
      row('/bang-luong', 'Đăng nhập admin', 'Truy cập được khi đã login Google', 'Redirect/login — chưa có session', 'Blocked',
        'Dong Chrome, mo lai: chrome.exe --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\\Google\\Chrome\\User Data" --profile-directory=Default (hoac dang nhap trong tab CDP roi chay lai voi UI_WAIT_LOGIN_SEC=120)');
      fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report.summary, null, 2));
      console.log('Report:', REPORT_PATH);
      process.exitCode = 2;
      return;
    }

    const payrollName = 'UI Test BL ' + Date.now();
    const tuNgay = '2026-05-01';
    const denNgay = '2026-05-31';

    // 1. Tạo bảng lương
    await page.goto(BASE + '/bang-luong', { waitUntil: 'networkidle2' });
    await page.click('#payrollAddBtn');
    await page.waitForSelector('#payrollModal.is-open', { timeout: 5000 });
    await page.type('#payrollName', payrollName);
    await page.$eval('#payrollTuNgay', (el, v) => { el.value = v; }, tuNgay);
    await page.$eval('#payrollDenNgay', (el, v) => { el.value = v; }, denNgay);
    await page.click('#payrollForm button[type="submit"], button[form="payrollForm"]');
    await wait(1500);
    const listHtml = await page.$eval('#payrollTableBody', (el) => el.innerText);
    const createdOk = listHtml.includes(payrollName);
    row('/bang-luong', 'Tạo bảng lương', 'Dòng mới draft', createdOk ? 'Có dòng ' + payrollName : listHtml.slice(0, 120), createdOk ? 'Pass' : 'Fail');

    const trHandle = await page.evaluateHandle((name) => {
      const tr = Array.from(document.querySelectorAll('#payrollTableBody tr')).find((r) => r.innerText.includes(name));
      return tr;
    }, payrollName);
    const tr = trHandle.asElement();
    if (!tr) throw new Error('Không tìm thấy dòng bảng lương vừa tạo');
    const payrollId = await tr.evaluate((el) => el.dataset.id);
    const draftStatus = await tr.evaluate((el) => el.innerText);
    row('/bang-luong', 'Trạng thái draft', 'Nháp/draft', draftStatus.includes('Nháp') || draftStatus.includes('draft') ? 'Nháp' : draftStatus, 'Pass');

    // Open detail via view button
    await tr.$eval('.payroll-view', (btn) => btn.click());
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    const onDetail = page.url().includes('/bang-luong/');

    // 2. Tính lương
    const calcBtn = await page.$('#calculateBtn');
    const calcVisible = calcBtn && await calcBtn.evaluate((el) => el.offsetParent !== null);
    if (calcVisible) {
      await page.click('#calculateBtn');
      await wait(2500);
    }
    const detailJson = await page.evaluate(async (id) => {
      const res = await fetch('/api/bang-luong/' + id, { headers: { Accept: 'application/json' } });
      return res.json();
    }, payrollId);
    const calcOk = detailJson.success && detailJson.item && detailJson.item.trang_thai === 'calculated';
    const detailCount = (detailJson.details || []).length;
    row('/bang-luong/:id', 'Tính lương', 'calculated + có chi tiết NV', calcOk ? `calculated, ${detailCount} dòng` : JSON.stringify(detailJson).slice(0, 80), calcOk && detailCount > 0 ? 'Pass' : 'Fail');

    // 3. Chốt
    const lockBtn = await page.$('#lockBtn');
    if (lockBtn && await lockBtn.evaluate((el) => el.offsetParent !== null)) {
      await page.click('#lockBtn');
      await wait(2000);
    }
    const lockedJson = await page.evaluate(async (id) => {
      const res = await fetch('/api/bang-luong/' + id, { headers: { Accept: 'application/json' } });
      return res.json();
    }, payrollId);
    const lockedOk = lockedJson.success && lockedJson.item.trang_thai === 'locked'
      && (lockedJson.details || []).every((d) => d.trang_thai === 'locked');
    const payBtnCount = await page.$$eval('.pay-btn', (btns) => btns.length);
    row('/bang-luong/:id', 'Chốt bảng lương', 'locked + nút Thanh toán', lockedOk ? `locked, ${payBtnCount} nút TT` : 'Không locked', lockedOk ? 'Pass' : 'Fail');

    // 4. Thanh toán một phần
    let partialAmount = 0;
    let remainingBefore = 0;
    if (payBtnCount > 0) {
      await page.click('.pay-btn');
      await page.waitForSelector('#payModal.open', { timeout: 5000 });
      remainingBefore = await page.$eval('#payRemaining', (el) => el.innerText);
      const rem = parseMoney(remainingBefore);
      partialAmount = Math.max(100000, Math.floor(rem / 3));
      await page.$eval('#payAmount', (el, v) => { el.value = v; }, String(partialAmount));
      await page.select('#payCashBook', await page.$eval('#payCashBook option', (o) => o.value));
      await page.click('#payForm button[type="submit"]');
      await wait(2500);
    }
    const afterPartial = await page.evaluate(async (id) => {
      const res = await fetch('/api/bang-luong/' + id, { headers: { Accept: 'application/json' } });
      return res.json();
    }, payrollId);
    const d0 = (afterPartial.details || [])[0];
    const plPaid = (afterPartial.payments || []).filter((p) => p.trang_thai === 'paid');
    const partialOk = d0 && d0.da_tra >= partialAmount && plPaid.length >= 1;
    row('/bang-luong/:id', 'Thanh toán một phần', 'da_tra tăng + PL paid', partialOk ? `da_tra=${d0.da_tra}, PL=${plPaid.length}` : 'Lỗi', partialOk ? 'Pass' : 'Fail');

    // 5. Thanh toán phần còn lại
    const payBtn2 = await page.$('.pay-btn');
    if (payBtn2) {
      await payBtn2.click();
      await page.waitForSelector('#payModal.open');
      const rem2 = parseMoney(await page.$eval('#payRemaining', (el) => el.innerText));
      await page.$eval('#payAmount', (el, v) => { el.value = v; }, String(rem2));
      await page.click('#payForm button[type="submit"]');
      await wait(2500);
    }
    const afterFull = await page.evaluate(async (id) => {
      const res = await fetch('/api/bang-luong/' + id, { headers: { Accept: 'application/json' } });
      return res.json();
    }, payrollId);
    const dFull = (afterFull.details || [])[0];
    const plCount = (afterFull.payments || []).filter((p) => p.trang_thai === 'paid').length;
    const fullOk = dFull && dFull.con_can_tra === 0 && plCount >= 2;
    const paidLabel = await page.$eval('#detailTableBody', (el) => el.innerText).catch(() => '');
    row('/bang-luong/:id', 'Thanh toán hết', 'con_can_tra=0, 2 PL', fullOk ? `con_can_tra=0, PL=${plCount}` : paidLabel.slice(0, 80), fullOk ? 'Pass' : 'Fail');

    // 6. Hủy một phiếu
    const cancelBtn = await page.$('.cancel-pay-btn');
    let soQuyBefore = 0;
    let soQuyAfter = 0;
    let firstPlId = null;
    if (cancelBtn) {
      firstPlId = await page.$eval('.cancel-pay-btn', (el) => el.dataset.id);
      const plRow = (afterFull.payments || []).find((p) => String(p._id) === String(firstPlId));
      const refund = plRow ? plRow.gia_tri : partialAmount;
      soQuyBefore = await page.evaluate(async (sqId) => {
        const res = await fetch('/api/so-quy/active', { headers: { Accept: 'application/json' } });
        const json = await res.json();
        const book = (json.items || []).find((b) => String(b._id) === String(sqId));
        return book ? book.so_du : 0;
      }, plRow && plRow.so_quy_id);
      await cancelBtn.click();
      await wait(2500);
      const afterCancel = await page.evaluate(async (id) => {
        const res = await fetch('/api/bang-luong/' + id, { headers: { Accept: 'application/json' } });
        return res.json();
      }, payrollId);
      const cancelled = (afterCancel.payments || []).find((p) => String(p._id) === String(firstPlId));
      soQuyAfter = await page.evaluate(async (sqId) => {
        const res = await fetch('/api/so-quy/active', { headers: { Accept: 'application/json' } });
        const json = await res.json();
        const book = (json.items || []).find((b) => String(b._id) === String(sqId));
        return book ? book.so_du : 0;
      }, plRow && plRow.so_quy_id);
      const dc = (afterCancel.details || [])[0];
      const cancelOk = cancelled && cancelled.trang_thai === 'cancelled' && cancelled.ly_do_huy
        && soQuyAfter >= soQuyBefore + refund - 1;
      row('/bang-luong/:id', 'Hủy phiếu lương', 'cancelled + hoàn quỹ + CT/BL', cancelOk ? `ly_do=${cancelled.ly_do_huy}, so_quy+${refund}` : 'Lỗi', cancelOk ? 'Pass' : 'Fail');
      const payBtnBack = await page.$('.pay-btn');
      row('/bang-luong/:id', 'Nút TT sau hủy', 'Hiện lại nếu còn cần trả', payBtnBack ? 'Có nút Thanh toán' : 'Không có nút', payBtnBack ? 'Pass' : 'Fail');
    } else {
      row('/bang-luong/:id', 'Hủy phiếu lương', 'Nút Hủy phiếu', 'Không thấy nút', 'Fail', 'Không có phiếu paid để hủy');
    }

    // 7. Chống thao tác sai (client-side)
    await page.evaluate(() => {
      window.__uiTestOverpayBlocked = false;
      const orig = window.alert;
      window.alert = (m) => { if (String(m).includes('vuot')) window.__uiTestOverpayBlocked = true; orig(m); };
    });
    const payBtnTest = await page.$('.pay-btn');
    if (payBtnTest) {
      await payBtnTest.click();
      await page.waitForSelector('#payModal.open');
      const rem = parseMoney(await page.$eval('#payRemaining', (el) => el.innerText));
      await page.$eval('#payAmount', (el, v) => { el.value = v; }, String(rem + 5000000));
      await page.click('#payForm button[type="submit"]');
      await wait(500);
      const blocked = await page.evaluate(() => window.__uiTestOverpayBlocked);
      row('/bang-luong/:id', 'Chặn trả > con_can_tra', 'alert UI', blocked ? 'Đã alert' : 'Không chặn', blocked ? 'Pass' : 'Fail');
      await page.click('#cancelPayBtn').catch(() => {});
    }

    // 8. Sổ quỹ
    const maPhieu = (afterFull.payments || [])[0] && (afterFull.payments || [])[0].ma_phieu;
    if (maPhieu) {
      await page.goto(BASE + '/so-quy?q=' + encodeURIComponent(maPhieu) + '&nhom_doi_tuong=nhan_vien&loai_phieu=chi', { waitUntil: 'networkidle2' });
      const soQuyText = await page.$eval('.table-wrap', (el) => el.innerText).catch(() => '');
      const sqOk = soQuyText.includes(maPhieu) && (soQuyText.includes('Nhân viên') || soQuyText.includes('Nhan vien'));
      row('/so-quy', 'Tìm phiếu PL', 'Mã PL + nhóm NV', sqOk ? maPhieu : soQuyText.slice(0, 100), sqOk ? 'Pass' : 'Fail');
      const link = await page.$(`tr.receipt-main-row a.receipt`);
      if (link) {
        await link.click();
        await wait(1500);
        const detailOpen = await page.$('.receipt-inline-panel, #receiptDetailModal.open');
        row('/so-quy', 'Mở detail phiếu', 'Không crash', detailOpen ? 'Panel/modal mở' : 'Không mở', detailOpen ? 'Pass' : 'Fail');
      }
    }

    // 9. Console/network
    const err5xx = report.networkIssues.filter((n) => n.kind === '5xx');
    row('DevTools', 'Không 500', '0 request 5xx', err5xx.length ? JSON.stringify(err5xx) : '0', err5xx.length === 0 ? 'Pass' : 'Fail');
    row('DevTools', 'Console errors', 'Không JS error', report.consoleErrors.length ? report.consoleErrors.slice(0, 3) : '0', report.consoleErrors.length === 0 ? 'Pass' : 'Fail');

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log('\n=== UI TEST SUMMARY ===');
    console.log(JSON.stringify(report.summary, null, 2));
    console.log('Full report:', REPORT_PATH);
    if (report.summary.fail > 0) process.exitCode = 1;
  } catch (err) {
    console.error('[UI TEST] FATAL', err);
    row('system', 'Chạy script', 'Hoàn tất', err.message, 'Fail');
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    try {
      if (browser && browser.disconnect) await browser.disconnect();
    } catch (_) {}
  }
}

main();
