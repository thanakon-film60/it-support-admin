// สิทธิ์รายหน้า + การตัด session (ต.ค. 2026) — บัญชีสร้าง/แก้ด้วย tools/staff_admin.py
//
// ทำไมต้องมีเทสต์ชุดนี้: ข้อผิดพลาดด้านสิทธิ์ "ไม่มีใครเห็น" ตอนใช้งานปกติ
//   - แอดมินเข้าได้ทุกหน้า ถ้าลืมตรวจสิทธิ์ใน action ไหน แอดมินไม่มีวันรู้ แต่เจ้าหน้าที่แอบใช้ได้
//   - พิมพ์ key ผิด = เจ้าหน้าที่ถูกล็อกออกเงียบๆ ส่วนแอดมินยังเห็นทุกอย่างปกติ
//   - บัญชีที่ถูกปิด/เปลี่ยนรหัสแล้ว ถ้า cookie เดิมยังใช้ได้ หน้าเว็บก็ดูเหมือนทำงานปกติทุกอย่าง
// ทุกข้อรันโค้ดจริง (JWT จริง · bcrypt จริง · ไฟล์จริงในโฟลเดอร์ชั่วคราว) ไม่แตะ data/ ของเครื่องจริง
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const bcrypt = require('bcryptjs');

const root = path.resolve(__dirname, '..');

// cookie ของเบราว์เซอร์จำลอง — signIn เขียน, getSession อ่าน (เหมือน cookies() ของ Next ใน request เดียว)
const jar = new Map();
const cookieStore = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  set: (name, value) => { jar.set(name, value); },
  delete: (name) => { jar.delete(name); },
};

const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'next/cache') return { revalidatePath() {} };
  if (id === 'next/headers') return { cookies: async () => cookieStore };
  if (id === 'next/navigation') {
    // redirect จริงของ Next โยน error เพื่อหยุดการทำงาน — ตัวหลอกทำแบบเดียวกันและบอกปลายทาง
    return { redirect(url) { throw new Error(`redirect:${url}`); } };
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'false';
process.env.SESSION_SECRET = 'test-session-secret-for-access-tests';

const access = require(path.join(root, 'src/lib/access.ts'));
const auth = require(path.join(root, 'src/lib/auth.ts'));
const { loginAction } = require(path.join(root, 'src/app/actions/auth.ts'));
const notesActions = require(path.join(root, 'src/app/actions/notes.ts'));
const pagesJson = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/pages.json'), 'utf8'));

const dataDir = path.join(tmp, 'data');
const staffFile = path.join(dataDir, 'staff_accounts.json');
const PASSWORD = 'รหัสทดสอบ-Strong#2026';
const HASH = bcrypt.hashSync(PASSWORD, 4); // cost ต่ำเพื่อความเร็ว — compare ใช้ cost จาก hash เองอยู่แล้ว

const account = (over) => ({
  id: 'id-staff', username: 'somchai', password_hash: HASH, display_name: 'สมชาย ไอที',
  role: 'it_staff', created_at: '2026-10-13T03:00:00.000Z', pages: ['tickets', 'notes'], ...over,
});
const writeStaff = (rows) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(staffFile, JSON.stringify(rows, null, 2));
};
const login = (username, password = PASSWORD) => auth.signIn(username, password);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const rejectsTo = (promise, url) => assert.rejects(promise, new RegExp(`^Error: redirect:${escapeRe(url)}$`));

beforeEach(() => {
  jar.clear();
  writeStaff([
    account(),
    account({ id: 'id-admin', username: 'Admin', display_name: 'หัวหน้า IT', role: 'admin', pages: undefined }),
    account({ id: 'id-off', username: 'former', display_name: 'ลาออกแล้ว', active: false }),
  ]);
});

after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// ───────────── ทะเบียนหน้า ─────────────

test('pages.json กับ PAGE_KEYS ตรงกันทุกตัวและเรียงเหมือนกัน (โปรแกรม .py อ่าน pages.json)', () => {
  assert.deepEqual(pagesJson.map((p) => p.key), [...access.PAGE_KEYS]);
  const hrefs = new Set();
  for (const page of pagesJson) {
    for (const field of ['key', 'href', 'icon', 'label', 'hint']) {
      assert.equal(typeof page[field], 'string', `${page.key}.${field} ต้องเป็นข้อความ`);
      assert.ok(page[field].trim(), `${page.key}.${field} ว่างไม่ได้`);
    }
    assert.ok(!hrefs.has(page.href), `href ซ้ำ: ${page.href}`);
    hrefs.add(page.href);
    // ทุก href ต้องมีหน้าจริง — กันเพิ่มชื่อใน pages.json แล้วลืมสร้างหน้า (เมนูกดแล้ว 404)
    const pageFile = path.join(root, 'src/app/(dashboard)', page.href, 'page.tsx');
    assert.ok(fs.existsSync(pageFile), `ไม่มีไฟล์หน้า ${path.relative(root, pageFile)}`);
  }
  assert.equal(pagesJson[0].key, 'overview', 'หน้าแรกของเมนูต้องเป็นภาพรวม (ปลายทางหลังล็อกอิน)');
});

test('ทุกหน้าใน dashboard ตรวจสิทธิ์ของหน้าตัวเอง — ลืมใส่ = เจ้าหน้าที่พิมพ์ URL เข้าได้', () => {
  const dir = path.join(root, 'src/app/(dashboard)');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === 'page.tsx') files.push(full);
  });
  walk(dir);
  const keyOfHref = Object.fromEntries(pagesJson.map((p) => [p.href, p.key]));
  for (const file of files) {
    const rel = '/' + path.relative(dir, path.dirname(file)).split(path.sep).join('/');
    const route = rel === '/' ? '/' : rel;
    const code = fs.readFileSync(file, 'utf8');
    if (route === '/no-access') {
      assert.match(code, /requireSession\(\)/, 'หน้าไม่มีสิทธิ์ต้องล็อกอินก่อน');
      continue;
    }
    // หน้าเก่าที่ถูกรวมเข้า Tickets (21 ต.ค. 2026) เหลือแค่เด้งไปหน้า Tickets — หน้าปลายทางตรวจสิทธิ์ให้
    // ยกเว้นได้เฉพาะตอนที่หน้านั้นไม่อ่านข้อมูลอะไรเลย ไม่งั้นเจ้าหน้าที่ที่ไม่มีสิทธิ์ tickets จะเห็นข้อมูลผ่านหน้านี้
    const REDIRECT_ONLY = {
      '/completed': '/tickets?status=resolved',
      '/resolved': '/tickets?status=resolved',
      '/repair-history': '/tickets?type=repair',
    };
    if (Object.hasOwn(REDIRECT_ONLY, route)) {
      assert.ok(code.includes(`redirect("${REDIRECT_ONLY[route]}")`), `${route} ต้องเด้งไป ${REDIRECT_ONLY[route]}`);
      assert.doesNotMatch(code, /from "@\/(lib|components)\//, 'ถ้าหน้านี้เริ่มอ่านข้อมูลเอง ต้องตรวจสิทธิ์ด้วย');
      continue;
    }
    // หน้าย่อย (เช่น /stock/transactions) ใช้สิทธิ์ของหน้าแม่
    const top = '/' + route.split('/')[1];
    const key = keyOfHref[route] ?? keyOfHref[top];
    assert.ok(key, `หน้า ${route} ไม่อยู่ใน pages.json — เพิ่มก่อน ไม่งั้นให้สิทธิ์ใครไม่ได้`);
    if (key === 'overview') {
      assert.match(code, /canAccess\(session\.pages, "overview"\)/, 'หน้าภาพรวมต้องตรวจสิทธิ์ overview');
    } else {
      assert.match(code, new RegExp(`requireSession\\("${key}"\\)`), `หน้า ${route} ต้องเรียก requireSession("${key}")`);
    }
  }
});

test('Server Action ทุกตัวตรวจสิทธิ์หน้า — ซ่อนปุ่มอย่างเดียวกันไม่ได้ เพราะ action ถูกเรียกตรงได้', () => {
  const dir = path.join(root, 'src/app/actions');
  // auth = ล็อกอิน/ออก · liff = ผู้ใช้ LINE (ตรวจด้วย token ของ LINE แทน)
  const PUBLIC = new Set(['auth.ts', 'liff.ts']);
  for (const name of fs.readdirSync(dir)) {
    if (PUBLIC.has(name)) continue;
    const code = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(code, /requireSession\(\)/, `${name}: requireSession() ต้องระบุหน้าเสมอ`);
    const chunks = code.split(/export async function /).slice(1);
    assert.ok(chunks.length > 0, `${name}: ไม่พบ action เลย`);
    for (const chunk of chunks) {
      const fn = chunk.slice(0, chunk.indexOf('('));
      const m = /requireSession\(([^)]+)\)/.exec(chunk);
      assert.ok(m, `${name} → ${fn}: ไม่ได้เรียก requireSession(หน้า)`);
      const keys = m[1].startsWith('"')
        ? [m[1].slice(1, -1)]
        : JSON.parse((new RegExp(`const ${m[1]} = (\\[[^\\]]*\\]) as const`).exec(code) || [])[1] ?? 'null');
      assert.ok(Array.isArray(keys) && keys.length > 0, `${name} → ${fn}: อ่านรายชื่อหน้าไม่ได้`);
      for (const key of keys) assert.ok(access.isPageKey(key), `${name} → ${fn}: ไม่รู้จักหน้า "${key}"`);
    }
  }
});

// ───────────── กติกาสิทธิ์ ─────────────

test('แอดมินได้ทุกหน้า · เจ้าหน้าที่ได้เฉพาะที่ติ๊ก · ค่าแปลกปลอมถูกตัดทิ้ง', () => {
  assert.deepEqual(access.pagesOf({ role: 'admin' }), [...access.PAGE_KEYS]);
  assert.deepEqual(access.pagesOf({ role: 'admin', pages: [] }), [...access.PAGE_KEYS], 'แอดมินไม่ขึ้นกับรายการติ๊ก');
  assert.deepEqual(access.pagesOf({ role: 'it_staff', pages: ['notes', 'tickets', 'ไม่มีจริง', '__proto__'] }), ['tickets', 'notes']);
  // หน้าที่ถูกรวมเข้า Tickets แล้ว (21 ต.ค. 2026) ยังค้างในบัญชีเก่าได้ — ต้องถูกตัดทิ้งเงียบๆ ไม่ใช่ทำให้ล็อกอินพัง
  assert.deepEqual(access.pagesOf({ role: 'it_staff', pages: ['resolved', 'repair-history', 'stock'] }), ['stock']);
  assert.deepEqual(access.pagesOf({ role: 'it_staff' }), [], 'บัญชีเจ้าหน้าที่ที่ไม่ได้ติ๊กอะไร = ไม่มีสิทธิ์สักหน้า');
  assert.deepEqual(access.pagesOf({ role: 'it_staff', pages: 'tickets' }), [], 'ไฟล์แก้มือผิดรูปแบบ = ไม่ให้สิทธิ์');
  assert.deepEqual(access.pagesOf({ role: 'superuser', pages: ['tickets'] }), ['tickets'], 'role แปลก ≠ แอดมิน');
});

test('canAccess: หลายหน้า = หน้าใดหน้าหนึ่งก็พอ · landingPath พาไปหน้าแรกที่มีสิทธิ์', () => {
  assert.ok(access.canAccess(['notes'], ['tickets', 'notes']));
  assert.ok(!access.canAccess(['notes'], ['tickets', 'stock']));
  assert.ok(!access.canAccess([], 'overview'));
  assert.equal(access.landingPath([...access.PAGE_KEYS]), '/');
  assert.equal(access.landingPath(['faq', 'tickets']), '/tickets', 'ตามลำดับเมนู ไม่ใช่ลำดับที่ติ๊ก');
  assert.equal(access.landingPath([]), '/no-access');
});

test('ปลายทางหลังล็อกอินรับแค่ path ในระบบนี้ (กัน open redirect ไปเว็บปลอม)', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil.example', '/\t/evil.example',
    ' //evil.example', '', null, undefined, 42]) {
    assert.equal(access.safeRedirectPath(bad), '/', `ต้องปฏิเสธ ${JSON.stringify(bad)}`);
  }
  assert.equal(access.safeRedirectPath('/tickets?code=IT2026100001'), '/tickets?code=IT2026100001');
  assert.equal(access.safeRedirectPath('/files'), '/files');
});

// ───────────── ล็อกอิน + session ─────────────

test('ล็อกอินถูก = ได้ cookie และสิทธิ์ตามไฟล์ · รหัสผิดกับไม่มีบัญชีตอบเหมือนกันทุกตัวอักษร', async () => {
  const wrong = await login('somchai', 'ผิด');
  const ghost = await login('ไม่มีคนนี้', PASSWORD);
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong, ghost, 'ข้อความต้องเหมือนกัน ไม่งั้นรู้ได้ว่าชื่อไหนมีบัญชีจริง');
  assert.equal(jar.size, 0);

  const ok = await login('SOMCHAI'); // ชื่อผู้ใช้ไม่สนตัวพิมพ์
  assert.equal(ok.ok, true);
  assert.equal(jar.size, 1);
  const session = await auth.getSession();
  assert.equal(session.staffId, 'id-staff');
  assert.equal(session.displayName, 'สมชาย ไอที');
  assert.deepEqual(session.pages, ['tickets', 'notes']);
});

test('บัญชีที่ถูกปิดใช้งาน: รหัสถูกก็เข้าไม่ได้ และบอกให้ติดต่อแอดมิน', async () => {
  const result = await login('former');
  assert.equal(result.ok, false);
  assert.match(result.error, /ปิดใช้งาน/);
  assert.equal(jar.size, 0);
  const wrongPassword = await login('former', 'ผิด');
  assert.doesNotMatch(wrongPassword.error, /ปิดใช้งาน/, 'รหัสผิดห้ามบอกว่าบัญชีถูกปิด (ยืนยันว่ามีบัญชีให้คนเดาสุ่ม)');
});

test('ชื่อผู้ใช้ซ้ำในไฟล์ (ไม่สนตัวพิมพ์) = ปฏิเสธทั้งคู่ ไม่หยิบอันแรก', async () => {
  writeStaff([account(), account({ id: 'id-dup', username: 'SomChai', role: 'admin' })]);
  const logError = console.error;
  console.error = () => {};
  try {
    assert.equal((await login('somchai')).ok, false);
  } finally {
    console.error = logError;
  }
});

test('ปิดใช้งาน / ลบบัญชี / สั่งออกจากระบบ (session_version) = cookie เดิมใช้ไม่ได้ทันที', async () => {
  const rows = JSON.parse(fs.readFileSync(staffFile, 'utf8'));
  for (const change of [
    (r) => { r[0].active = false; },
    (r) => { r.splice(0, 1); },
    (r) => { r[0].session_version = 1; },
  ]) {
    writeStaff(rows);
    jar.clear();
    await login('somchai');
    assert.ok(await auth.getSession(), 'ก่อนเปลี่ยนต้องใช้ได้');
    const next = JSON.parse(JSON.stringify(rows));
    change(next);
    writeStaff(next);
    assert.equal(await auth.getSession(), null);
    await rejectsTo(auth.requireSession(), '/login');
  }
});

test('เปลี่ยนชื่อ/สิทธิ์ในไฟล์ = มีผลทันทีโดยไม่ต้องล็อกอินใหม่', async () => {
  await login('somchai');
  const rows = JSON.parse(fs.readFileSync(staffFile, 'utf8'));
  rows[0].display_name = 'สมชาย (หัวหน้าเวร)';
  rows[0].pages = ['faq'];
  writeStaff(rows);
  const session = await auth.getSession();
  assert.equal(session.displayName, 'สมชาย (หัวหน้าเวร)');
  assert.deepEqual(session.pages, ['faq']);
});

test('cookie รุ่นก่อนอัปเดต (ไม่มี sv) ยังใช้ได้ — deploy แล้วไม่เตะทุกคนออก', async () => {
  const { SignJWT } = require('jose');
  const legacy = await new SignJWT({ staffId: 'id-admin', username: 'Admin', displayName: 'x', role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  jar.set('itadmin_session', legacy);
  const session = await auth.getSession();
  assert.equal(session?.staffId, 'id-admin');
  assert.equal(session.displayName, 'หัวหน้า IT', 'ชื่อมาจากไฟล์ ไม่ใช่จาก cookie');
  assert.deepEqual(session.pages, [...access.PAGE_KEYS]);
});

test('cookie ปลอม / ลายเซ็นผิด / ไม่มี staffId = ไม่ผ่าน', async () => {
  const { SignJWT } = require('jose');
  const sign = (claims, secret) => new SignJWT(claims).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  for (const token of [
    'ไม่ใช่-jwt',
    await sign({ staffId: 'id-admin', sv: 0 }, 'secret-ของคนอื่น'),
    await sign({ sv: 0 }, process.env.SESSION_SECRET),
    await sign({ staffId: 'ไม่มีจริง', sv: 0 }, process.env.SESSION_SECRET),
  ]) {
    jar.set('itadmin_session', token);
    assert.equal(await auth.getSession(), null);
  }
});

test('requireSession(หน้า): ไม่มีสิทธิ์ → /no-access · หลายหน้า = หน้าใดหน้าหนึ่งก็พอ', async () => {
  await login('somchai');
  await rejectsTo(auth.requireSession('employees'), '/no-access');
  assert.equal((await auth.requireSession('tickets')).staffId, 'id-staff');
  assert.equal((await auth.requireSession(['employees', 'notes'])).staffId, 'id-staff');
  await rejectsTo(auth.requireSession(['employees', 'stock']), '/no-access');
});

test('Server Action ของหน้าที่ไม่มีสิทธิ์ถูกปฏิเสธก่อนแตะข้อมูล', async () => {
  await login('somchai');
  assert.deepEqual(await notesActions.createNoteAction('ฝากไว้'), {}, 'มีสิทธิ์หน้าฝากข้อความ = เขียนได้');
  const notesFile = path.join(dataDir, 'notes.json');
  const before = fs.readFileSync(notesFile, 'utf8');

  const rows = JSON.parse(fs.readFileSync(staffFile, 'utf8'));
  rows[0].pages = ['tickets'];
  writeStaff(rows);
  await rejectsTo(notesActions.createNoteAction('แอบเขียน'), '/no-access');
  await rejectsTo(notesActions.deleteNoteAction(JSON.parse(before)[0].id), '/no-access');
  assert.equal(fs.readFileSync(notesFile, 'utf8'), before, 'ไฟล์ต้องไม่ถูกแตะ');
});

test('หลังล็อกอิน: พาไปหน้าแรกที่มีสิทธิ์ และไม่ยอมพาออกนอกระบบ', async () => {
  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  // เจ้าหน้าที่ไม่มีสิทธิ์หน้าภาพรวม → หน้าแรกที่มีสิทธิ์ตามลำดับเมนู
  await rejectsTo(loginAction({}, form({ username: 'somchai', password: PASSWORD, redirectTo: '/' })), '/tickets');
  jar.clear();
  await rejectsTo(loginAction({}, form({ username: 'somchai', password: PASSWORD, redirectTo: 'https://evil.example/login' })), '/tickets');
  jar.clear();
  await rejectsTo(loginAction({}, form({ username: 'admin', password: PASSWORD, redirectTo: '//evil.example' })), '/');
  jar.clear();
  await rejectsTo(loginAction({}, form({ username: 'admin', password: PASSWORD, redirectTo: '/stock?status=low' })), '/stock?status=low');
});

test('รูปแนบ ticket / FAQ: ต้องล็อกอินจริงและมีสิทธิ์หน้าที่ใช้รูปนั้น', async () => {
  const { GET } = require(path.join(root, 'src/app/uploads/[...path]/route.ts'));
  const uploadDir = path.join(tmp, 'public', 'uploads', 'tickets');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const get = (...segments) => GET(new Request('http://x/uploads'), { params: Promise.resolve({ path: segments }) });

  jar.set('itadmin_session', 'cookie-มั่ว'); // ไฟล์ที่อัปโหลดหลังเซิร์ฟเวอร์เริ่มมาถึง route นี้ — ต้องตรวจเองด้วย
  assert.equal((await get('tickets', 'a.png')).status, 404);

  jar.clear();
  await login('somchai'); // มีสิทธิ์ tickets
  const ok = await get('tickets', 'a.png');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /^private/, 'ห้ามให้ CDN เก็บไฟล์ที่ต้องล็อกอิน');
  assert.equal((await get('faq', 'a.png')).status, 404, 'ไม่มีสิทธิ์หน้า FAQ');
  assert.equal((await get('อื่นๆ', 'a.png')).status, 404, 'โฟลเดอร์ที่ไม่รู้จักไม่เสิร์ฟ');
});

test('API คลังไฟล์: ล็อกอินแต่ไม่มีสิทธิ์หน้าคลังไฟล์ = 403', async () => {
  const { requireDriveSession } = require(path.join(root, 'src/lib/drive/http.ts'));
  const { DRIVE_HEADER } = require(path.join(root, 'src/lib/drive-shared.ts'));
  await login('somchai');
  const res = await requireDriveSession(new Request('http://x', { headers: { [DRIVE_HEADER]: '1' } }), { mutate: true });
  assert.ok(res instanceof Response);
  assert.equal(res.status, 403);

  jar.clear();
  await login('admin');
  const session = await requireDriveSession(new Request('http://x'), { mutate: false });
  assert.equal(session.staffId, 'id-admin');
});

test('proxy: /uploads ตรวจ session จริง + สิทธิ์หน้า — ไฟล์ที่มีตอนเซิร์ฟเวอร์เริ่ม Next เสิร์ฟตรงจาก public/ ไม่ผ่าน route', async () => {
  const { NextRequest } = require('next/server');
  const { proxy } = require(path.join(root, 'src/proxy.ts'));
  const call = (url, cookie) => proxy(new NextRequest(`http://x${url}`, { headers: cookie ? { cookie } : {} }));
  const passed = (res) => res.headers.get('x-middleware-next') === '1';

  assert.equal((await call('/uploads/tickets/a.png', 'itadmin_session=fake-cookie-value')).status, 404);
  assert.equal((await call('/uploads/tickets/a.png')).status, 404);

  await login('somchai'); // มีสิทธิ์ tickets + notes
  const cookie = `itadmin_session=${jar.get('itadmin_session')}`;
  assert.ok(passed(await call('/uploads/tickets/a.png', cookie)));
  assert.equal((await call('/uploads/faq/a.png', cookie)).status, 404, 'ไม่มีสิทธิ์หน้า FAQ');
  assert.equal((await call('/uploads/other/a.png', cookie)).status, 404, 'โฟลเดอร์ที่ไม่รู้จัก');

  // หน้าอื่นยังเป็นแบบเดิม: ไม่มี cookie → ไปหน้า login พร้อมบอกว่ามาจากไหน
  const res = await call('/tickets?code=IT2026100001');
  assert.equal(res.status, 307);
  const from = new URL(res.headers.get('location')).searchParams.get('from');
  assert.equal(from, '/tickets?code=IT2026100001', 'ลิงก์จากแชทต้องพากลับเรื่องเดิมหลังล็อกอิน');
});

test('proxy อยู่ที่ src/proxy.ts เท่านั้น — วางที่ราก repo แล้ว Next ข้ามไปเงียบๆ (โปรเจกต์ใช้ src/app)', () => {
  // บั๊กจริงที่อยู่มาตั้งแต่แรก: ไฟล์อยู่ที่ราก ด่านนี้จึงไม่เคยทำงาน รูปแนบเปิดได้โดยไม่ล็อกอิน
  assert.ok(fs.existsSync(path.join(root, 'src/app')), 'ถ้าย้าย app ออกจาก src ต้องย้าย proxy ตาม');
  assert.ok(fs.existsSync(path.join(root, 'src/proxy.ts')));
  for (const stray of ['proxy.ts', 'proxy.js', 'middleware.ts', 'middleware.js', 'src/middleware.ts']) {
    assert.ok(!fs.existsSync(path.join(root, stray)), `${stray} จะไม่ถูกใช้ หรือชนกับ src/proxy.ts`);
  }
  const { config } = require(path.join(root, 'src/proxy.ts'));
  const matches = (p) => config.matcher.some((m) => new RegExp(`^${m}$`).test(p));
  assert.ok(matches('/uploads/tickets/a.png'), 'รูปแนบต้องผ่าน proxy เสมอ');
  assert.ok(matches('/tickets'));
  for (const api of ['/api/drive/uploads', '/api/internal/attachments', '/api/health']) {
    assert.ok(!matches(api), `${api} ต้องไม่ผ่าน proxy (body เกิน 10 MB ถูกตัดเงียบๆ)`);
  }
});
