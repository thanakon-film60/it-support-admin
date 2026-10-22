// หน้า "รหัสผ่าน" (/passwords) — เข้ารหัส · ปลดล็อก 15 นาที · ประวัติการเข้าถึง · นำเข้า/ส่งออก
//
// ทำไมต้องมีเทสต์ชุดนี้: ความผิดพลาดของหน้านี้ "มองไม่เห็นจากหน้าจอ" ทั้งหมด
//   - รหัสหลุดเป็นข้อความธรรมดาลงไฟล์ → backup เข้า git → อยู่ในประวัติตลอดกาล
//   - ลืมตรวจการปลดล็อกใน action ตัวเดียว → ใครล็อกอินค้างไว้ก็ดึงรหัสได้โดยไม่มีประวัติ
//   - ตัวอ่านไฟล์ตัดแถวทิ้งเงียบๆ → รหัสหายตอนย้ายเข้าระบบโดยไม่มีใครรู้
// ใช้ข้อมูลปลอมทั้งหมด (ไม่แตะไฟล์ Password-story จริง) บนโฟลเดอร์ชั่วคราว
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const bcrypt = require('bcryptjs');

const root = path.resolve(__dirname, '..');

const jar = new Map();
const cookieOptions = new Map();
const cookieStore = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  set: (name, value, options = {}) => {
    if (options.maxAge === 0 || value === '') {
      jar.delete(name);
      cookieOptions.delete(name);
      return;
    }
    jar.set(name, value);
    cookieOptions.set(name, options);
  },
  delete: (name) => { jar.delete(name); cookieOptions.delete(name); },
};

const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'next/cache') return { revalidatePath() {} };
  if (id === 'next/headers') return { cookies: async () => cookieStore };
  if (id === 'next/navigation') {
    return {
      redirect(url) { throw new Error(`redirect:${url}`); },
      useRouter: () => ({ refresh() {} }),
    };
  }
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = require.extensions['.tsx'] = (mod, filename) =>
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true,
    },
  }).outputText, filename);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'false';
process.env.SESSION_SECRET = 'vault-test-session-secret';
const KEY = crypto.randomBytes(32).toString('base64');
process.env.VAULT_KEY = KEY;

const vcrypto = require(path.join(root, 'src/lib/vault/crypto.ts'));
const shared = require(path.join(root, 'src/lib/vault-shared.ts'));
const store = require(path.join(root, 'src/lib/db/vault.ts'));
const unlock = require(path.join(root, 'src/lib/vault/unlock.ts'));
const auth = require(path.join(root, 'src/lib/auth.ts'));
const actions = require(path.join(root, 'src/app/actions/vault.ts'));
const { CollectionReadError } = require(path.join(root, 'src/lib/db/store.ts'));

const dataDir = path.join(tmp, 'data');
const vaultFile = path.join(dataDir, 'vault.json');
const auditFile = path.join(dataDir, 'vault_audit.json');
const staffFile = path.join(dataDir, 'staff_accounts.json');
const PW = 'Staff-Login-Pass-1!';
const HASH = bcrypt.hashSync(PW, 4);

const staff = (over) => ({
  id: 'id-som', username: 'somchai', password_hash: HASH, display_name: 'สมชาย', role: 'it_staff',
  created_at: '2026-10-13T03:00:00.000Z', pages: ['passwords'], ...over,
});
function writeStaff(rows) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(staffFile, JSON.stringify(rows, null, 2));
}
const readAudit = () => (fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : []);
const input = (over) => ({ category: 'account', name: 'ระบบบัญชี', username: 'acc-user', url: '', band: '', location: '', note: '', ...over });

async function loginAs(username) {
  jar.clear();
  const r = await auth.signIn(username, PW);
  assert.equal(r.ok, true, `ล็อกอิน ${username} ไม่ผ่าน`);
  return r.session;
}

beforeEach(() => {
  jar.clear();
  cookieOptions.clear();
  process.env.VAULT_KEY = KEY;
  unlock.resetVaultUnlockFailures();
  for (const f of [vaultFile, auditFile]) { try { fs.unlinkSync(f); } catch { /* ยังไม่มี */ } }
  writeStaff([
    staff(),
    staff({ id: 'id-boss', username: 'boss', display_name: 'หัวหน้า', role: 'admin', pages: [] }),
    staff({ id: 'id-noperm', username: 'noperm', display_name: 'ไม่มีสิทธิ์', pages: ['tickets'] }),
  ]);
});

after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// ───────────── การเข้ารหัส ─────────────

test('เข้ารหัสแล้วถอดกลับได้ตรงทุกตัวอักษร · IV สุ่มใหม่ทุกครั้ง', () => {
  const text = 'รหัส Wi-Fi: ห้องประชุม#2 🔐 "quote" \\ ,';
  const a = vcrypto.encryptText(text, 'x:secret');
  const b = vcrypto.encryptText(text, 'x:secret');
  assert.notEqual(a, b, 'ข้อความเดิมต้องได้ก้อนเข้ารหัสไม่ซ้ำกัน');
  assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(vcrypto.decryptText(a, 'x:secret'), text);
  assert.equal(vcrypto.decryptText(vcrypto.encryptText('', 'e'), 'e'), '');
});

test('ข้อมูลถูกแก้ / ย้ายไปแถวอื่น / กุญแจผิด = ถอดไม่ออก (ไม่คืนค่าผิดๆ)', () => {
  const token = vcrypto.encryptText('secret-123', 'row1:secret');
  const [v, iv, tag, body] = token.split('.');
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  for (const bad of [
    [v, iv, tag, flip(body)].join('.'),
    [v, iv, flip(tag), body].join('.'),
    [v, flip(iv), tag, body].join('.'),
    ['v2', iv, tag, body].join('.'),
    'ไม่ใช่ก้อนเข้ารหัส',
  ]) {
    assert.throws(() => vcrypto.decryptText(bad, 'row1:secret'), vcrypto.VaultDecryptError);
  }
  assert.throws(() => vcrypto.decryptText(token, 'row2:secret'), vcrypto.VaultDecryptError, 'ย้ายก้อนไปแถวอื่นต้องถอดไม่ได้');
  process.env.VAULT_KEY = crypto.randomBytes(32).toString('base64');
  assert.throws(() => vcrypto.decryptText(token, 'row1:secret'), vcrypto.VaultDecryptError);
});

test('VAULT_KEY ไม่มี / ผิดรูปแบบ / ผิดความยาว = ปฏิเสธพร้อมบอกวิธีแก้ (ไม่มีกุญแจสำรองในโค้ด)', () => {
  for (const [value, expect] of [[undefined, /ยังไม่ได้ตั้ง/], ['', /ยังไม่ได้ตั้ง/], ['สั้น', /base64/],
    [crypto.randomBytes(16).toString('base64'), /32 ไบต์/]]) {
    if (value === undefined) delete process.env.VAULT_KEY; else process.env.VAULT_KEY = value;
    assert.throws(() => vcrypto.encryptText('x', 'a'), (err) => err instanceof vcrypto.VaultKeyError && expect.test(err.message));
    assert.match(vcrypto.vaultKeyProblem(), expect);
  }
  process.env.VAULT_KEY = crypto.randomBytes(32).toString('base64url'); // แบบ url-safe ก็รับ
  assert.equal(vcrypto.vaultKeyProblem(), null);
});

// ───────────── ตัวอ่านไฟล์ ─────────────

/** จำลองโครงไฟล์ "Account and Password for AT FAVOURITE" — ตำแหน่ง/หัวคอลัมน์เหมือนจริง ค่าปลอมทั้งหมด */
function fakeSheet() {
  const W = 13;
  const row = (cells) => { const r = Array(W).fill(''); for (const [c, v] of Object.entries(cells)) r[c] = v; return r; };
  const rows = [
    row({}),
    row({ 0: 'ALL Account & Password', 6: 'Network & Server Account' }),
    row({ 0: 'ลำดับที่', 1: 'ชื่อรายการ', 2: 'ชื่อผู้ใช้', 3: 'รหัสผ่าน', 4: 'URL',
      6: 'ลำดับที่', 7: 'ชื่อรายการ', 8: 'ชื่อผู้ใช้', 9: 'รหัสผ่าน', 10: 'URL', 11: 'หมายเหตุ' }),
    row({ 0: '1', 1: 'ระบบเงินเดือน', 2: 'payroll-admin', 3: 'Fake#Pay1', 4: 'https://payroll.example',
      6: '1', 7: 'Router หลัก', 8: 'admin', 9: 'FakeRouter1', 10: '192.0.2.1', 11: 'ห้อง Server' }),
    row({ 0: '2', 1: 'อีเมลกลาง', 2: 'it@example.com', 3: 'FakeMail2', 4: '-',
      6: '2', 7: 'Switch ชั้น 2', 8: 'user', 9: 'password', 10: '192.0.2.2', 11: '-' }),
    row({ 0: '3', 1: 'โปรแกรมบัญชี', 3: 'FakeAcc3',
      6: '3', 7: 'NAS', 8: 'nas', 9: 'FakeNas3', 10: '192.0.2.3', 11: 'ชั้น 3' }),
    row({ 0: '4', 3: 'OrphanPass4', 6: '4' }), // มีรหัสแต่ไม่มีชื่อ → นำเข้าด้วยชื่อชั่วคราว + แจ้งปัญหา
    row({ 0: '5', 1: 'ระบบลา', 2: 'leave', 3: 'FakeLeave5', 6: 'Wi-Fi' }),
    row({ 0: '6', 1: 'ระบบจองห้อง', 2: 'room', 3: 'FakeRoom6',
      6: 'ลำดับที่', 7: 'ชื่อการเชื่อมต่อ', 8: 'รหัสผ่าน', 9: 'GHz', 10: 'Location', 11: 'URL', 12: 'หมายเหตุ' }),
    row({ 0: '7', 6: '1', 7: 'FAV-Office', 8: '12345678', 9: '2.4G', 10: 'ชั้น 1', 11: '-', 12: '-' }),
    row({ 0: '8', 6: '2', 7: 'FAV-Office-5G', 8: 'FakeWifi 2', 9: '5G', 10: 'ชั้น 1', 11: '192.0.2.10', 12: 'Guest' }),
    row({ 0: '9', 6: '3', 7: 'FAV-Open', 8: '-', 9: '2.4G', 10: 'ล็อบบี้' }),
    row({ 0: '10' }), // ตารางเผื่อกรอกต่อ: มีแต่เลขลำดับ
    row({ 6: 'Apple ID Account' }),
    row({ 6: 'ลำดับที่', 7: 'ชื่อผู้ใช้', 8: 'รหัสผ่าน', 9: 'หมายเหตุ' }),
    row({ 6: '1', 7: 'ipad@example.com', 8: 'FakeApple1', 9: 'iPad ห้องประชุม' }),
    row({ 6: '2' }),
    row({ 6: '3' }),
  ];
  return rows;
}

function toCsv(rows) {
  const esc = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

test('CSV: BOM · CRLF · ช่องที่มี , " และขึ้นบรรทัดในเครื่องหมายคำพูด', () => {
  const rows = shared.parseCsv('﻿a,"b,1","c ""q""","d\r\ne"\r\n,,\r\nx');
  assert.deepEqual(rows, [['a', 'b,1', 'c "q"', 'd\r\ne'], ['', '', ''], ['x']]);
  const sheet = fakeSheet();
  assert.deepEqual(shared.parseCsv(toCsv(sheet)), sheet, 'แปลงไป-กลับต้องได้ตารางเดิมทุกช่อง');
});

test('อ่านไฟล์โครงเดียวกับของจริง: 4 ตาราง ครบทุกแถว ไม่ตัดแถวเงียบๆ', () => {
  const parsed = shared.parseVaultGrids([{ name: 'test.csv', first_row: 1, rows: shared.parseCsv(toCsv(fakeSheet())) }]);
  const byCat = (c) => parsed.entries.filter((e) => e.input.category === c);
  assert.deepEqual(parsed.sections.map((s) => [s.title, s.category, s.count]), [
    ['ALL Account & Password', 'account', 6],
    ['Network & Server Account', 'network', 3],
    ['Wi-Fi', 'wifi', 3],
    ['Apple ID Account', 'apple_id', 1],
  ]);
  // ทุกแถวที่มีข้อมูล รวมแถวที่ไม่มีชื่อ · แถวที่มีแค่เลขลำดับถูกข้าม
  assert.deepEqual(byCat('account').map((e) => e.input.name), [
    'ระบบเงินเดือน', 'อีเมลกลาง', 'โปรแกรมบัญชี', 'ไม่มีชื่อ (แถว 7)', 'ระบบลา', 'ระบบจองห้อง',
  ]);

  const mail = byCat('account').find((e) => e.input.name === 'อีเมลกลาง');
  assert.equal(mail.input.url, '', '"-" = ไม่มีค่า ไม่ใช่ข้อความ "-"');
  assert.equal(mail.row, 5, 'เลขแถวตรงกับ Excel');

  const sw = byCat('network').find((e) => e.input.name === 'Switch ชั้น 2');
  assert.equal(sw.secret, 'password', 'รหัส "password" เป็นข้อมูล ไม่ใช่หัวตาราง — ตารางต้องอ่านต่อจนครบ');
  assert.equal(sw.input.username, 'user');
  assert.deepEqual(byCat('network').map((e) => e.input.url), ['192.0.2.1', '192.0.2.2', '192.0.2.3']);

  const wifi = byCat('wifi');
  assert.deepEqual(wifi.map((e) => [e.input.name, e.secret, e.input.band, e.input.location]), [
    ['FAV-Office', '12345678', '2.4G', 'ชั้น 1'],
    ['FAV-Office-5G', 'FakeWifi 2', '5G', 'ชั้น 1'],
    ['FAV-Open', '', '2.4G', 'ล็อบบี้'],
  ]);
  assert.equal(wifi[1].input.note, 'Guest');

  const apple = byCat('apple_id');
  assert.deepEqual(apple.map((e) => [e.input.name, e.input.username, e.secret, e.input.note]), [
    ['ipad@example.com', '', 'FakeApple1', 'iPad ห้องประชุม'],
  ]);

  assert.deepEqual(parsed.problems.map((p) => [p.row, /ไม่มีชื่อ/.test(p.message)]), [[7, true]]);
  assert.equal(byCat('account').find((e) => e.row === 7).secret, 'OrphanPass4', 'รหัสที่ไม่มีชื่อต้องไม่หาย');
});

test('คอลัมน์ที่ไม่รู้จักไปต่อท้ายหมายเหตุ · ชื่อตารางกลางทางไม่ตัดรายการที่มีแค่ชื่อ', () => {
  const parsed = shared.parseVaultGrids([{ name: 's', first_row: 1, rows: [
    ['ระบบ CCTV'],
    ['ลำดับที่', 'ชื่อรายการ', 'ชื่อผู้ใช้', 'รหัสผ่าน', 'เบอร์ติดต่อ'],
    ['1', 'กล้องหน้าร้าน', 'cam', 'FakeCam1', '02-000-0000'],
    ['2', 'เครื่องบันทึก'],
    ['3', 'กล้องหลังร้าน', 'cam2', 'FakeCam3', ''],
  ] }]);
  assert.deepEqual(parsed.entries.map((e) => e.input.name), ['กล้องหน้าร้าน', 'เครื่องบันทึก', 'กล้องหลังร้าน']);
  assert.equal(parsed.entries[0].input.note, 'เบอร์ติดต่อ: 02-000-0000');
  assert.equal(parsed.entries[0].input.category, 'account');
});

test('ส่งออกแล้วนำเข้ากลับได้ครบทุกช่อง (ไฟล์สำรองใช้กู้ได้จริง)', () => {
  const rows = [
    { ...input({ name: 'ERP', username: 'erp', url: 'https://erp.example', note: 'บรรทัด 1\nบรรทัด 2' }), secret: 'Fake,"ERP"1' },
    { ...input({ category: 'network', name: 'Firewall', username: 'fw', url: '192.0.2.9' }), secret: '' },
    { ...input({ category: 'wifi', name: 'FAV-Guest', username: '', band: '5G', location: 'ชั้น 2' }), secret: '00012345' },
    { ...input({ category: 'apple_id', name: 'mac@example.com', username: '' }), secret: 'FakeMac1' },
  ];
  const grids = shared.vaultExportGrids(rows);
  assert.deepEqual(grids.map((g) => g.name), ['บัญชีระบบ', 'Network & Server', 'Wi-Fi', 'Apple ID']);
  assert.deepEqual(grids[2].rows[1], ['ลำดับที่', 'ชื่อการเชื่อมต่อ', 'รหัสผ่าน', 'GHz', 'Location', 'URL', 'หมายเหตุ'], 'หัวคอลัมน์เหมือนไฟล์ต้นฉบับ');
  // ผ่าน CSV ด้วย เพื่อพิสูจน์ว่าข้อความที่มี , " ขึ้นบรรทัด ไม่เพี้ยน
  const back = shared.parseVaultGrids(grids.map((g) => ({ ...g, rows: shared.parseCsv(toCsv(g.rows)) })));
  assert.deepEqual(back.problems, []);
  assert.deepEqual(
    back.entries.map((e) => ({ ...e.input, secret: e.secret })),
    rows.map((r) => ({ ...r, username: r.category === 'apple_id' ? '' : r.username })),
  );
});

test('ข้อมูลไฟล์จากหน้าเว็บถูกตรวจรูปร่างก่อนอ่าน (ไม่เชื่อหน้าเว็บ)', () => {
  for (const bad of [null, [], 'x', [{ rows: 'x' }], [{ rows: Array(shared.VAULT_IMPORT_MAX_ROWS + 1).fill([]) }],
    [{ rows: [Array(shared.VAULT_IMPORT_MAX_COLS + 1).fill('a')] }], [{ rows: [['a'.repeat(shared.VAULT_IMPORT_MAX_CELL + 1)]] }]]) {
    assert.throws(() => shared.sanitizeVaultGrids(bad), shared.VaultImportError);
  }
  const ok = shared.sanitizeVaultGrids([{ name: 1, first_row: -3, rows: [[1, null, true, { x: 1 }]] }]);
  assert.deepEqual(ok, [{ name: 'ไฟล์', first_row: 1, rows: [['1', '', 'true', '']] }]);
});

test('สุ่มรหัส: ยาวตามสั่ง มีครบทุกกลุ่ม ไม่มีตัวอ่านสับสน', () => {
  for (let i = 0; i < 200; i++) {
    const s = shared.generateVaultSecret(16);
    assert.equal(s.length, 16);
    assert.match(s, /[a-z]/); assert.match(s, /[A-Z]/); assert.match(s, /[2-9]/); assert.match(s, /[!@#%+=?\-_]/);
    assert.doesNotMatch(s, /[0O1lI]/);
  }
});

// ───────────── ที่เก็บข้อมูล ─────────────

test('ไฟล์บนดิสก์ไม่มีข้อมูลจริงเป็นข้อความธรรมดาเลย — ชื่อ/ผู้ใช้/URL/หมายเหตุ/รหัส', () => {
  const values = { name: 'เซิร์ฟเวอร์ลับ-XYZ', username: 'root-user-xyz', url: 'https://secret.example', note: 'โน้ตลับ-XYZ' };
  const entry = store.createVaultEntry(input(values), 'Sup3r-Secret-Value', 'สมชาย');
  store.appendVaultAudit({ staff_id: 'id-som', staff_name: 'สมชาย', action: 'view', entry_id: entry.id, label: values.name });
  const raw = fs.readFileSync(vaultFile, 'utf8') + fs.readFileSync(auditFile, 'utf8');
  for (const v of [...Object.values(values), 'Sup3r-Secret-Value']) {
    assert.ok(!raw.includes(v), `"${v}" หลุดลงไฟล์เป็นข้อความธรรมดา`);
  }
  const listed = store.listVaultEntries();
  assert.equal(listed[0].name, values.name);
  assert.equal(listed[0].has_secret, true);
  assert.ok(!('secret' in listed[0]), 'รายการที่ส่งให้หน้าเว็บต้องไม่มีช่องรหัสผ่านเลย');
  assert.equal(store.getVaultSecret(entry.id).secret, 'Sup3r-Secret-Value');
  assert.equal(store.listVaultAudit()[0].label, values.name, 'ประวัติอ่านชื่อรายการได้');
});

test('แก้ไข: ไม่ส่งรหัส = คงรหัสเดิม · ส่งค่าว่าง = ไม่มีรหัส · กดบันทึกเฉยๆ = ไม่แตะไฟล์', () => {
  const e = store.createVaultEntry(input(), 'Old-Pass-1', 'ก');
  const before = fs.readFileSync(vaultFile, 'utf8');
  assert.equal(store.updateVaultEntry(e.id, input(), undefined, 'ข').changed, false);
  assert.equal(fs.readFileSync(vaultFile, 'utf8'), before);

  const r1 = store.updateVaultEntry(e.id, input({ note: 'เพิ่มโน้ต' }), undefined, 'ข');
  assert.equal(r1.changed, true);
  assert.equal(store.getVaultSecret(e.id).secret, 'Old-Pass-1');
  assert.equal(r1.entry.secret_updated_at, e.secret_updated_at, 'ไม่ได้เปลี่ยนรหัส = วันเปลี่ยนรหัสเดิม');

  store.updateVaultEntry(e.id, input({ note: 'เพิ่มโน้ต' }), 'New-Pass-2', 'ข');
  assert.equal(store.getVaultSecret(e.id).secret, 'New-Pass-2');
  const cleared = store.updateVaultEntry(e.id, input({ note: 'เพิ่มโน้ต' }), '', 'ข');
  assert.equal(cleared.entry.has_secret, false);
  assert.equal(store.updateVaultEntry('ไม่มี', input(), undefined, 'ข'), null);
});

test('นำเข้าซ้ำ = ข้าม (ไม่เขียนทับรหัสเดิม) · ลบคืนชื่อไว้บันทึกประวัติ', () => {
  const items = [{ input: input({ name: 'ERP' }), secret: 'a' }, { input: input({ name: 'erp ' }), secret: 'b' }];
  assert.deepEqual(store.importVaultEntries(items, 'ก'), { added: 1, duplicates: 1 });
  assert.deepEqual(store.importVaultEntries(items, 'ก'), { added: 0, duplicates: 2 });
  const [only] = store.listVaultEntries();
  assert.equal(store.getVaultSecret(only.id).secret, 'a', 'รหัสเดิมต้องไม่ถูกแทนที่');
  assert.equal(store.deleteVaultEntry(only.id), 'ERP');
  assert.equal(store.deleteVaultEntry(only.id), null);
});

test('VAULT_KEY ถูกเปลี่ยน: อ่านไม่ได้ และห้ามบันทึกอะไรใหม่ปนกุญแจคนละดอก', () => {
  store.createVaultEntry(input(), 'k1', 'ก');
  const before = fs.readFileSync(vaultFile, 'utf8');
  process.env.VAULT_KEY = crypto.randomBytes(32).toString('base64');
  assert.throws(() => store.listVaultEntries(), vcrypto.VaultDecryptError);
  assert.throws(() => store.createVaultEntry(input({ name: 'ใหม่' }), 'k2', 'ก'), vcrypto.VaultDecryptError);
  assert.throws(() => store.importVaultEntries([{ input: input({ name: 'ใหม่' }), secret: 'x' }], 'ก'), vcrypto.VaultDecryptError);
  assert.equal(fs.readFileSync(vaultFile, 'utf8'), before, 'ไฟล์ต้องเหมือนเดิมทุกไบต์');
});

test('ไฟล์ข้อมูลเสีย: ไม่ยอมเขียนทับ', () => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(vaultFile, '[{"id":"x"');
  assert.throws(() => store.listVaultEntries(), CollectionReadError);
  assert.throws(() => store.createVaultEntry(input(), 'x', 'ก'), CollectionReadError);
  assert.equal(fs.readFileSync(vaultFile, 'utf8'), '[{"id":"x"');
});

// ───────────── ด่านของ Server Action ─────────────

test('ไม่มีสิทธิ์หน้ารหัสผ่าน = ทุก action เด้งไป /no-access', async () => {
  await loginAs('noperm');
  for (const run of [
    () => actions.unlockVaultAction(PW),
    () => actions.revealVaultSecretAction('x', 'view'),
    () => actions.createVaultEntryAction(input(), 'x'),
    () => actions.exportVaultAction(),
    () => actions.importVaultAction([]),
  ]) {
    await assert.rejects(run(), /^Error: redirect:\/no-access$/);
  }
});

test('ล็อกอยู่: ดู/คัดลอก/เพิ่ม/แก้/ลบ/นำเข้า/ส่งออก ไม่ได้ และไม่มีอะไรเปลี่ยน', async () => {
  const e = store.createVaultEntry(input(), 'Locked-1', 'ก');
  const before = fs.readFileSync(vaultFile, 'utf8');
  await loginAs('somchai');
  for (const run of [
    () => actions.revealVaultSecretAction(e.id, 'view'),
    () => actions.revealVaultSecretAction(e.id, 'copy'),
    () => actions.createVaultEntryAction(input({ name: 'ใหม่' }), 'x'),
    () => actions.updateVaultEntryAction(e.id, input({ name: 'แก้' }), null),
    () => actions.deleteVaultEntryAction(e.id),
    () => actions.importVaultAction([{ name: 'a', first_row: 1, rows: fakeSheet() }]),
    () => actions.exportVaultAction(),
  ]) {
    const r = await run();
    assert.equal(r.locked, true);
    assert.ok(!('secret' in r) && !('grids' in r));
  }
  assert.equal(fs.readFileSync(vaultFile, 'utf8'), before);
});

test('ปลดล็อก: รหัสผิดถูกบันทึก · ผิดเกิน 5 ครั้งต้องรอ แม้รหัสถูก · รหัสถูก = cookie ปลดล็อก 15 นาที', async () => {
  await loginAs('somchai');
  for (let i = 0; i < unlock.VAULT_MAX_FAILS; i++) {
    const r = await actions.unlockVaultAction('ผิด');
    assert.match(r.error, /ไม่ถูกต้อง/);
  }
  assert.equal(readAudit().filter((a) => a.action === 'unlock_failed').length, unlock.VAULT_MAX_FAILS);
  const throttled = await actions.unlockVaultAction(PW);
  assert.match(throttled.error, /รออีก/);
  assert.ok(!jar.has(unlock.VAULT_COOKIE));

  unlock.resetVaultUnlockFailures();
  const ok = await actions.unlockVaultAction(PW);
  assert.equal(ok.error, undefined);
  assert.ok(ok.until > Date.now() + 14 * 60 * 1000 && ok.until <= Date.now() + 15 * 60 * 1000 + 1000);
  const opts = cookieOptions.get(unlock.VAULT_COOKIE);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, 'strict');
  assert.equal(opts.path, '/passwords', 'cookie ปลดล็อกต้องไม่ถูกส่งไปกับหน้าอื่น');
  assert.equal(opts.maxAge, 15 * 60);
  assert.equal(readAudit().at(-1).action, 'unlock');
});

test('ปลดล็อกแล้ว: ดู/คัดลอกได้และถูกบันทึกทุกครั้ง · ล็อกตอนนี้ = ดูไม่ได้ทันที', async () => {
  const e = store.createVaultEntry(input({ name: 'Router' }), 'Rtr-Pass-9', 'ก');
  await loginAs('somchai');
  await actions.unlockVaultAction(PW);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).secret, 'Rtr-Pass-9');
  assert.equal((await actions.revealVaultSecretAction(e.id, 'copy')).secret, 'Rtr-Pass-9');
  const logged = store.listVaultAudit().filter((a) => a.entry_id === e.id).map((a) => [a.action, a.label, a.staff_name]);
  assert.deepEqual(logged, [['copy', 'Router', 'สมชาย'], ['view', 'Router', 'สมชาย']]);

  assert.deepEqual(await actions.lockVaultAction(), {});
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).locked, true);
});

test('cookie ปลดล็อกใช้ได้เฉพาะเจ้าของ · เปลี่ยนรหัส/สั่งออก (session_version) = ล็อกทันที · หมดอายุ = ล็อก', async () => {
  const e = store.createVaultEntry(input(), 'P-1', 'ก');
  await loginAs('somchai');
  await actions.unlockVaultAction(PW);
  const vaultCookie = jar.get(unlock.VAULT_COOKIE);

  await loginAs('boss'); // อีกคนเอา cookie ปลดล็อกของสมชายมาใช้
  jar.set(unlock.VAULT_COOKIE, vaultCookie);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).locked, true);

  await loginAs('somchai');
  jar.set(unlock.VAULT_COOKIE, vaultCookie);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).secret, 'P-1');
  const rows = JSON.parse(fs.readFileSync(staffFile, 'utf8'));
  rows[0].session_version = 0; // ยังเท่าเดิม (ไม่มีช่อง = 0)
  writeStaff(rows);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).secret, 'P-1');

  // หมดอายุ: เซ็นด้วยกุญแจจริงแต่ exp ผ่านไปแล้ว
  const { SignJWT } = require('jose');
  const expired = await new SignJWT({ staffId: 'id-som', sv: 0, purpose: 'vault' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(vcrypto.vaultSubKey('unlock'));
  jar.set(unlock.VAULT_COOKIE, expired);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).locked, true);

  // เซ็นด้วย SESSION_SECRET (ไม่ใช่กุญแจปลดล็อก) = ปลอม
  const forged = await new SignJWT({ staffId: 'id-som', sv: 0, purpose: 'vault' })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m')
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  jar.set(unlock.VAULT_COOKIE, forged);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).locked, true);

  // บังคับออก/เปลี่ยนรหัสในโปรแกรมจัดการผู้ใช้ → session หลักหลุดด้วย ต้องล็อกอินใหม่ แล้ว cookie ปลดล็อกเดิมใช้ไม่ได้
  jar.set(unlock.VAULT_COOKIE, vaultCookie);
  rows[0].session_version = 1;
  writeStaff(rows);
  await loginAs('somchai');
  jar.set(unlock.VAULT_COOKIE, vaultCookie);
  assert.equal((await actions.revealVaultSecretAction(e.id, 'view')).locked, true);
});

test('ปิดล็อกอิน (AUTH_DISABLED) หรือไม่มี VAULT_KEY = ปลดล็อกไม่ได้', async () => {
  const guest = { staffId: 'guest', username: 'guest', displayName: 'ผู้ใช้ทั่วไป', role: 'admin', pages: ['passwords'] };
  assert.equal(unlock.vaultBlockedState(guest).status, 'auth_disabled');
  assert.equal((await unlock.unlockVault(guest, 'อะไรก็ได้')).ok, false);

  await loginAs('somchai');
  delete process.env.VAULT_KEY;
  const r = await actions.unlockVaultAction(PW);
  assert.match(r.error, /VAULT_KEY/);
  assert.ok(!jar.has(unlock.VAULT_COOKIE));
});

test('เพิ่ม/แก้/ลบ/นำเข้า/ส่งออก ผ่าน action ครบวงจร พร้อมประวัติ', async () => {
  await loginAs('somchai');
  await actions.unlockVaultAction(PW);

  const created = await actions.createVaultEntryAction(input({ name: 'ระบบ HR' }), 'Hr-Pass-1');
  assert.ok(created.id);
  assert.match((await actions.createVaultEntryAction(input({ name: '   ' }), 'x')).error, /กรอก/);
  assert.match((await actions.createVaultEntryAction({ ...input(), category: 'อื่นๆ' }, 'x')).error, /หมวด/);

  assert.deepEqual(await actions.updateVaultEntryAction(created.id, input({ name: 'ระบบ HR ใหม่' }), null), {});
  assert.equal(store.getVaultSecret(created.id).secret, 'Hr-Pass-1', 'null = คงรหัสเดิม');
  await actions.updateVaultEntryAction(created.id, input({ name: 'ระบบ HR ใหม่' }), 'Hr-Pass-2');
  assert.equal(store.getVaultSecret(created.id).secret, 'Hr-Pass-2');

  const imp = await actions.importVaultAction([{ name: 'test.csv', first_row: 1, rows: fakeSheet() }]);
  assert.deepEqual(imp.result, { added: 13, duplicates: 0, problems: 1 });
  const again = await actions.importVaultAction([{ name: 'test.csv', first_row: 1, rows: fakeSheet() }]);
  assert.deepEqual(again.result, { added: 0, duplicates: 13, problems: 1 });

  const exp = await actions.exportVaultAction();
  assert.equal(exp.count, 14);
  const wifiSheet = exp.grids.find((g) => g.name === 'Wi-Fi');
  assert.ok(wifiSheet.rows.some((r) => r.includes('FakeWifi 2')), 'ไฟล์ส่งออกต้องมีรหัสจริง (คือจุดประสงค์ของไฟล์)');

  assert.deepEqual(await actions.deleteVaultEntryAction(created.id), {});
  const actionsLogged = store.listVaultAudit().map((a) => a.action).reverse();
  assert.deepEqual(actionsLogged, ['unlock', 'create', 'update', 'update', 'import', 'import', 'export', 'delete']);
  assert.equal(store.listVaultAudit()[0].label, 'ระบบ HR ใหม่', 'ลบแล้วประวัติยังบอกได้ว่าลบอะไร');
});

// ───────────── หน้าเว็บ ─────────────

test('หน้าเว็บ: ล็อกอยู่ไม่มีข้อมูลรายการ · ปลดล็อกแล้วรหัสไม่อยู่ใน HTML เลย', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PasswordVaultBoard } = require(path.join(root, 'src/components/vault/PasswordVaultBoard.tsx'));
  const render = (props) => renderToStaticMarkup(React.createElement(PasswordVaultBoard, {
    counts: null, entries: [], audit: [], loadError: null, unlockMinutes: 15, maxFails: 5, ...props,
  }));

  const locked = render({ state: { status: 'locked' }, counts: { account: 3, network: 1, wifi: 2, apple_id: 0 } });
  assert.match(locked, /ปลดล็อก 15 นาที/);
  assert.match(locked, /type="password"/);
  assert.match(locked, /Wi-Fi · <span[^>]*>2<\/span>/);

  const noKey = render({ state: { status: 'no_key', problem: 'ยังไม่ได้ตั้งค่า VAULT_KEY ใน .env' } });
  assert.match(noKey, /VAULT_KEY/);
  assert.match(noKey, /randomBytes\(32\)/);
  assert.doesNotMatch(noKey, /type="password"/);

  const e = store.createVaultEntry(input({ name: 'ระบบ ERP', username: 'erp-admin', url: 'https://erp.example' }), 'Never-In-Html-1', 'ก');
  const unlocked = render({ state: { status: 'unlocked', until: Date.now() + 600000 }, entries: store.listVaultEntries() });
  for (const text of ['ระบบ ERP', 'erp-admin', 'https://erp.example', '••••••••', 'ล็อกตอนนี้', 'ประวัติการเข้าถึง']) {
    assert.ok(unlocked.includes(text), `ไม่เห็น "${text}"`);
  }
  assert.ok(!unlocked.includes('Never-In-Html-1'), 'รหัสผ่านต้องไม่อยู่ใน HTML');
  assert.ok(unlocked.includes(e.name));
});
