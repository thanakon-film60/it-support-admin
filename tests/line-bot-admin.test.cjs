// คำขอ 13 ต.ค. 2026: ชื่อ LINE ของคนส่งเรื่อง · เปิด/ปิดบอทจากแชท LINE · บังคับระบุอุปกรณ์ตอนเบิก · เขต Motta ใหม่
//
// ทำไมต้องมีเทสต์ชุดนี้ (ฝั่งเว็บ — ฝั่งบอทอยู่ใน line-bot-python/tests):
//   - สิทธิ์สั่งบอทจากแชทเป็นของทีม IT ที่แอดมินอนุมัติเท่านั้น ถ้าด่านนี้รั่ว ผู้ใช้ทั่วไปปิดบอทกันเองได้
//   - ไฟล์ทะเบียนเสียต้องไม่กลายเป็น "ยังไม่มีใคร" แล้วถูกคำขอใหม่เขียนทับ (สิทธิ์ทั้งหมดหายเงียบๆ)
//   - ตารางเขตใหม่ต้องลงไปถึงเครื่องที่มีข้อมูลอยู่แล้ว โดยไม่สร้างสาขาซ้ำและไม่แตะสาขาที่แอดมินเพิ่มเอง
// ทุกข้อรันโค้ดจริงกับไฟล์ในโฟลเดอร์ชั่วคราว ไม่แตะ data/ ของเครื่องจริง และไม่ยิงไปบอท/LINE จริง
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'next/cache') return { revalidatePath() {} };
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }
).outputText, filename);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-bot-admin-'));
process.chdir(tmp);
process.env.INTERNAL_API_KEY = 'test-internal-key';
const dataDir = path.join(tmp, 'data');
const writeData = (name, rows) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${name}.json`), typeof rows === 'string' ? rows : JSON.stringify(rows, null, 2));
};
const readData = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));

const meta = require(path.join(root, 'src/lib/ticket-meta.ts'));
const staffDb = require(path.join(root, 'src/lib/db/lineStaff.ts'));
const { POST: staffRoute } = require(path.join(root, 'src/app/api/internal/line-staff/route.ts'));
const branches = require(path.join(root, 'src/lib/db/branches.ts'));
const control = require(path.join(root, 'src/lib/line/bot-control.ts'));

after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ─────────────────────────────── ชื่อ LINE + รายการอุปกรณ์ ─────────────────────────────── */

test('อ่านชื่อ LINE และรายการอุปกรณ์จาก meta โดยข้ามค่าที่เพี้ยน', () => {
  const ticket = {
    type: 'withdraw',
    meta: {
      line_display_name: '  JOB🐻🥰 ',
      items: [{ name: 'ขาตั้งกล้อง', qty: 3 }, null, { name: '', qty: 1 }, { name: 'เมาส์', qty: '2' }, { name: 'x', qty: -1 }, 'junk'],
    },
  };
  assert.equal(meta.ticketLineName(ticket), 'JOB🐻🥰');
  assert.deepEqual(meta.ticketItems(ticket), [{ name: 'ขาตั้งกล้อง', qty: 3 }, { name: 'เมาส์', qty: 2 }]);
  assert.equal(meta.ticketItemsLine(ticket), 'ขอเบิก ขาตั้งกล้อง x3, เมาส์ x2');
  assert.equal(meta.withdrawMissingItems(ticket), false);

  for (const bad of [null, {}, { line_display_name: 42, items: 'x' }, { line_display_name: '   ' }]) {
    assert.equal(meta.ticketLineName({ meta: bad }), null);
    assert.deepEqual(meta.ticketItems({ meta: bad }), []);
  }
  assert.equal(meta.withdrawMissingItems({ type: 'withdraw', meta: { items: [] } }), true, 'เรื่องเบิกเก่าที่ไม่มีรายการต้องถูกเตือน');
  assert.equal(meta.withdrawMissingItems({ type: 'repair', meta: null }), false);
  assert.equal(meta.ticketItemsLine({ type: 'return', meta: { items: [{ name: 'NB', qty: 1 }] } }), 'ขอคืน NB x1');
});

/* ─────────────────────────────── ทะเบียนทีม IT ที่สั่งบอทได้ ─────────────────────────────── */

const STAFF = 'U0123456789abcdef0123456789abcdef';
const ask = (body, key = 'test-internal-key') => staffRoute(new Request('http://localhost/api/internal/line-staff', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': key }, body: JSON.stringify(body),
}));

beforeEach(() => {
  fs.rmSync(path.join(dataDir, 'line_staff.json'), { force: true });
});

test('ไม่มี key / user id เพี้ยน / action แปลก ถูกปฏิเสธโดยไม่สร้างอะไร', async () => {
  assert.equal((await ask({ line_user_id: STAFF }, 'wrong')).status, 401);
  for (const body of [{}, { line_user_id: 'x' }, { line_user_id: 'U../../etc' }, { line_user_id: STAFF, action: 'approve' }]) {
    assert.equal((await ask(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(fs.existsSync(path.join(dataDir, 'line_staff.json')), false);
});

test('ขอสิทธิ์ -> รออนุมัติ -> อนุมัติในหน้าเว็บแล้วถึงจะสั่งบอทได้ · ถอดสิทธิ์แล้วหมดทันที', async () => {
  assert.deepEqual(await (await ask({ line_user_id: STAFF })).json(), { ok: true, status: 'none', name: null });

  let res = await (await ask({ line_user_id: STAFF, display_name: 'Film', action: 'request' })).json();
  assert.deepEqual(res, { ok: true, status: 'pending', name: 'Film' });
  res = await (await ask({ line_user_id: STAFF, display_name: 'Film', action: 'request' })).json();
  assert.equal(res.status, 'pending');
  assert.equal(staffDb.listLineStaff().length, 1, 'ขอซ้ำต้องไม่สร้างแถวใหม่');

  const row = staffDb.listLineStaff()[0];
  staffDb.approveLineStaff(row.id, 'หัวหน้า IT');
  res = await (await ask({ line_user_id: STAFF, display_name: 'Film IT' })).json();
  assert.deepEqual(res, { ok: true, status: 'approved', name: 'Film IT' }, 'ชื่อ LINE ที่เปลี่ยนต้องตามมาด้วย');
  const saved = staffDb.listLineStaff()[0];
  assert.equal(saved.approved_by, 'หัวหน้า IT');
  assert.ok(saved.last_seen_at, 'ต้องจำเวลาใช้งานล่าสุด');

  assert.equal(staffDb.removeLineStaff(row.id), true);
  assert.equal((await (await ask({ line_user_id: STAFF })).json()).status, 'none');
});

test('ไฟล์ทะเบียนเสีย: ตอบ error (บอทถือว่าไม่ใช่ทีม IT) และไม่เขียนทับไฟล์เดิม', async () => {
  writeData('line_staff', '[{"id": "broken"');
  for (const action of ['check', 'request']) {
    const res = await ask({ line_user_id: STAFF, action });
    assert.equal(res.status, 503);
  }
  assert.equal(fs.readFileSync(path.join(dataDir, 'line_staff.json'), 'utf8'), '[{"id": "broken"', 'ไฟล์เดิมต้องอยู่ครบ รอกู้');
});

test('คำขอค้างมีเพดาน กันคนพิมพ์ขอสิทธิ์รัวจากหลายบัญชี', async () => {
  for (let i = 0; i < staffDb.MAX_PENDING; i++) {
    await ask({ line_user_id: `Uspam${i}`, action: 'request' });
  }
  const res = await (await ask({ line_user_id: 'Uonemore', action: 'request' })).json();
  assert.equal(res.status, 'none');
  assert.equal(staffDb.listLineStaff().length, staffDb.MAX_PENDING);
});

/* ─────────────────────────────── ตัวเรียกบอท (หน้า "บอท LINE") ─────────────────────────────── */

test('สั่ง/ถามสถานะบอทพร้อม key และแปลงเวลาเป็น ISO · บอทล่มบอกเหตุผลได้', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  process.env.LINE_BOT_INTERNAL_URL = 'http://bot.test:8000';
  try {
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), key: init.headers['x-internal-key'] });
      return new Response(JSON.stringify({
        ok: true, chat_mode: 'chat', bot_off: { since: 1_800_000_000, by: 'Film' },
        users_off: [{ line_user_id: STAFF, name: 'Somchai', since: 1_800_000_100, by: 'Film' }, { name: 'no id' }],
      }), { status: 200 });
    };
    const status = await control.getBotControl();
    assert.equal(status.ok, true);
    assert.deepEqual(status.state.botOff, { since: new Date(1_800_000_000 * 1000).toISOString(), by: 'Film' });
    assert.equal(status.state.usersOff.length, 1, 'แถวที่ไม่มี user id ต้องถูกข้าม');
    assert.equal(status.state.usersOff[0].name, 'Somchai');

    await control.setBotGlobal(true, 'หัวหน้า IT');
    await control.setBotUser(STAFF, false, 'หัวหน้า IT');
    assert.deepEqual(calls.map((c) => c.url), [
      'http://bot.test:8000/internal/bot/status',
      'http://bot.test:8000/internal/bot/global',
      'http://bot.test:8000/internal/bot/user',
    ]);
    assert.ok(calls.every((c) => c.key === 'test-internal-key'));
    assert.deepEqual(calls[2].body, { line_user_id: STAFF, off: false, by: 'หัวหน้า IT' });

    global.fetch = async () => new Response(JSON.stringify({ ok: false, reason: 'chat_off' }), { status: 409 });
    assert.deepEqual(await control.setBotGlobal(true, 'x'), { ok: false, reason: 'chat_off' });
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    assert.deepEqual(await control.getBotControl(), { ok: false, reason: 'unreachable' });
  } finally {
    global.fetch = originalFetch;
  }
});

/* ─────────────────────────────── เขต Motta ตามตารางใหม่ ─────────────────────────────── */

// ข้อมูลจริงบนเครื่องก่อนอัปเดต (สำเนา backup 2 ต.ค. 2026): ป้ายเขตมีวรรค ("ทีม ปอ") และสาขาอยู่เขตตามตารางรุ่นเก่า
const OLD_MOTTA = {
  'ทีม ปอ': ['ลาดพร้าว', 'เวสเกต', 'ภูเก็ต', 'หาดใหญ่', 'นครศรี', 'ท่าพระ', 'ตรัง', 'สุราษฎร์ธานี', 'กระบี่', 'ถลาง'],
  'ทีม อุ้ม': ['ศาลายา', 'นครปฐม', 'ราชบุรี', 'พระราม 2', 'บางแค', 'มหาชัย', 'ปิ่นเกล้า', 'กาญจนบุรี', 'สามย่าน 1/9'],
  'ทีม เอ็ม': ['ซีคอน', 'บางกะปิ', 'อิสวิล', 'งามวงศ์วาน'],
  'ทีม แอน': ['เชียงใหม่เฟส', 'เชียงราย', 'ลำปาง', 'พิษณุโลก', 'นครสวรรค์', 'อยุธยา', 'แอร์พอร์ต', 'กำแพงเพชร', 'แม่สอด'],
  'ทีม บีม': ['ขอนแก่น', 'อุดรธานี', 'นครราชสีมา', 'เดอะมอลล์โคราช', 'บุรีรัมย์', 'ขอนแก่นแคมปัส', 'อิมพีเรียล', 'แฟชั่น', 'เซ็นทรัลเวิลด์'],
  'ทีม เมย์': ['อุบลราชธานี', 'ร้อยเอ็ด', 'สกลนคร', 'มุกดาหาร', 'เสริมไทย', 'สุรินทร์', 'แจ้งวัฒนะ'],
  'ทีม ปอ New': ['สุพรรณบุรี', 'ฟิวเจอร์', 'สระบุรี', 'พระราม 9', 'ศรีสมาน'],
  'ทีม มะลิ': ['บ่อวิน', 'ปราจีน', 'แพชชั่น', 'ระยอง'],
  'ทีม แนน': ['ฉะเชิงเทรา', 'ศรีราชา', 'ชลบุรี', 'สมุทรปราการ', 'ลพบุรี', 'ทรูดิจิตอล'],
  'ทีม ใบตอง': ['พัทยา', 'อมตะ', 'สุวรรณภูมิ', 'นอร์ทวิลล์', 'จันทบุรี', 'บ้านฉาง'],
};

function oldRows() {
  let n = 0;
  const rows = [];
  for (const [group, names] of Object.entries(OLD_MOTTA)) {
    for (const name of names) {
      rows.push({ id: `old-${n++}`, company: 'motta', name, group, floor: null, sale_manager: 'ต่อ / นัน New',
        area_manager: group.replace('ทีม ', ''), active: true, created_at: '2026-09-20T00:00:00.000Z' });
    }
  }
  rows.push({ id: 'montipa-1', company: 'montipa', name: 'เซ็นทรัล ศาลายา', group: 'กรุงเทพฯ และปริมณฑล', floor: null,
    sale_manager: null, area_manager: null, active: true, created_at: '2026-09-20T00:00:00.000Z' });
  rows.push({ id: 'admin-added', company: 'motta', name: 'สาขาทดลองของแอดมิน', group: 'ทีม ปอ', floor: '2',
    sale_manager: 'ใครก็ได้', area_manager: 'ปอ', active: true, created_at: '2026-10-01T00:00:00.000Z' });
  return rows;
}

test('ตารางเขตใหม่ลงข้อมูลเดิม: ย้ายเขต/เปลี่ยนชื่อในแถวเดิม เพิ่มสาขาใหม่ ไม่แตะสาขานอกตาราง', () => {
  const rows = oldRows();
  rows.find((r) => r.name === 'ระยอง').active = false; // แอดมินปิดไว้เอง — ต้องยังปิดอยู่
  writeData('branches', rows);
  writeData('registry_meta', [{ id: 'employees', version: 'x', synced_at: 'x', added: 0, updated: 0 }]);

  const all = branches.listAllBranches();
  const byName = (name) => all.filter((b) => b.company === 'motta' && b.name === name);
  const motta = all.filter((b) => b.company === 'motta');
  assert.equal(motta.length, 71 + 1, '69 สาขาเดิม + ชัยภูมิ + The Street (+ สาขาที่แอดมินเพิ่มเอง)');

  // ย้ายเขต: ศาลายาจากอุ้มไปเอ็ม — แถวเดิม (id เดิม) ไม่ใช่แถวใหม่
  const salaya = byName('ศาลายา');
  assert.equal(salaya.length, 1);
  assert.equal(salaya[0].id, 'old-10');
  assert.equal(salaya[0].group, 'ทีมเอ็ม');
  assert.equal(salaya[0].area_manager, 'เอ็ม');
  assert.equal(salaya[0].sale_manager, 'นัน');

  // เปลี่ยนชื่อตามตาราง ใช้แถวเดิม (id เดิม — ประวัติที่ผูกกับแถวนี้ไม่หลุด)
  assert.deepEqual([byName('อีสวิลล์')[0].id, byName('อีสวิลล์')[0].group], ['old-21', 'ทีมอุ้ม']);
  assert.deepEqual([byName('สามย่าน')[0].id, byName('สามย่าน')[0].group], ['old-18', 'ทีมอุ้ม']);
  assert.deepEqual([byName('ซีคอนศรีนครินทร์')[0].id, byName('ซีคอนศรีนครินทร์')[0].group], ['old-19', 'ทีมเอ็ม']);
  assert.deepEqual([byName('เวสต์เกสต์')[0].id, byName('เวสต์เกสต์')[0].group], ['old-1', 'ทีมปอ']);
  for (const old of ['อิสวิล', 'สามย่าน 1/9', 'ซีคอน', 'เวสเกต']) assert.equal(byName(old).length, 0, old);

  // สาขาใหม่
  assert.equal(byName('ชัยภูมิ')[0].group, 'ทีมบีม');
  assert.equal(byName('The Street')[0].group, 'ทีมเอ็ม');

  // ปอสองเขต: คนละ Sale Manager ป้ายไม่ซ้ำ
  assert.equal(byName('ลาดพร้าว')[0].sale_manager, 'ต่อ');
  assert.equal(byName('สุพรรณบุรี')[0].group, 'ทีมปอ New');
  assert.equal(byName('สุพรรณบุรี')[0].sale_manager, 'อีฟ');
  assert.equal(byName('สุพรรณบุรี')[0].area_manager, 'ปอ');

  // ของที่ต้องไม่ถูกแตะ
  assert.equal(byName('ระยอง')[0].active, false, 'แอดมินปิดไว้ ต้องยังปิดอยู่');
  const adminAdded = all.find((b) => b.id === 'admin-added');
  assert.deepEqual([adminAdded.group, adminAdded.sale_manager, adminAdded.floor], ['ทีม ปอ', 'ใครก็ได้', '2']);
  // Montipa ย้ายตามตารางของ Montipa เอง (ซิงก์คนละเวอร์ชันกับ Motta) — แถวเดิม ไม่ใช่แถวใหม่
  assert.equal(all.find((b) => b.id === 'montipa-1').group, 'ทีมปุ้ย');

  const metaRows = readData('registry_meta');
  assert.ok(metaRows.some((m) => m.id === 'employees'), 'ของทะเบียนพนักงานต้องอยู่ครบ');
  const mine = metaRows.find((m) => m.id === 'branches');
  assert.equal(mine.version, branches.BRANCH_REGISTRY_VERSION);
  assert.equal(mine.added, 2);
});

test('ซิงก์ครั้งเดียวต่อเวอร์ชัน — แอดมินแก้ต่อหลังจากนั้นไม่ถูกทับ', () => {
  writeData('branches', oldRows());
  writeData('registry_meta', []);
  branches.listAllBranches();
  const once = fs.readFileSync(path.join(dataDir, 'branches.json'), 'utf8');

  const target = branches.findBranchesByName('ศาลายา', 'motta')[0];
  branches.updateBranch(target.id, { group: 'เขตที่แอดมินตั้งเอง' });
  branches.listAllBranches();
  assert.equal(branches.getBranchById(target.id).group, 'เขตที่แอดมินตั้งเอง');
  assert.notEqual(once, fs.readFileSync(path.join(dataDir, 'branches.json'), 'utf8'));

  // ซิงก์ซ้ำกับข้อมูลที่ตรงตารางแล้ว = ไม่มีอะไรต้องแก้
  const rows = JSON.parse(once);
  assert.deepEqual(branches.syncMottaAreas(rows), { added: 0, updated: 0 });
});

test('เมนูเลือกเขตในบอท: เรียงตามตาราง บอก Sale Manager และสาขาตัวอย่าง · สาขาเรียงตามตาราง', () => {
  writeData('branches', oldRows());
  writeData('registry_meta', []);
  const groups = branches.listBranchOptions({ level: 'group', company: 'motta' }).options;
  assert.deepEqual(groups.slice(0, 10).map((g) => g.value),
    ['por', 'aum', 'em', 'ann', 'beam', 'may', 'por-new', 'mali', 'nan', 'baitong']);
  const por = groups.find((g) => g.value === 'por');
  assert.equal(por.label, 'ทีมปอ');
  assert.equal(por.count, 10);
  assert.match(por.sub, /^Sale Manager: ต่อ · ลาดพร้าว, เวสต์เกสต์, ภูเก็ต \+7$/);
  const em = groups.find((g) => g.value === 'em');
  assert.equal(em.count, 8);

  const emBranches = branches.listBranchOptions({ level: 'branch', company: 'motta', group: 'em' }).options.map((o) => o.value);
  assert.deepEqual(emBranches, ['บางกะปิ', 'ซีคอนศรีนครินทร์', 'พระราม 2', 'งามวงศ์วาน', 'มหาชัย', 'ศาลายา', 'นครปฐม', 'The Street']);

  // ชื่อใหม่หาเขตได้ถูก (ticket เก่าที่เก็บชื่อเดิมไว้มีรหัสบริษัทของตัวเองอยู่แล้ว ไม่ต้องพึ่งการค้นชื่อ)
  assert.equal(branches.resolveBranch('อีสวิลล์').groupKey, 'aum');
  assert.equal(branches.resolveBranch('ซีคอนศรีนครินทร์').groupKey, 'em');
});

/* ─────────────────────────────── เขต Montipa ตามตารางทีมขาย ต.ค. 2026 ─────────────────────────────── */

// ข้อมูลจริงบนเครื่องก่อนอัปเดต (สำเนา backup 13 ต.ค. 2026): แบ่งตามภูมิภาค · ชั้นที่แอดมินกรอกไว้ · แจ้งวัฒนะถูกปิดใช้งาน
const OLD_MONTIPA = {
  'กรุงเทพฯ และปริมณฑล': ['เซ็นทรัล พระราม 2', 'เซ็นทรัล พระราม 9', 'เดอะมอลล์ไลฟ์สโตร์ บางกะปิ', 'เซ็นทรัล มหาชัย',
    'เซ็นทรัล แจ้งวัฒนะ', 'เซ็นทรัล ศาลายา', 'เซ็นทรัล นครปฐม', 'โรบินสัน สมุทรปราการ', 'อิมพีเรียลเวิลด์ สำโรง',
    'เซ็นทรัล เวสต์เกต', 'โรบินสัน สุวรรณภูมิ', 'แฟชั่นไอซ์แลนด์'],
  'ภาคกลาง': ['เซ็นทรัล อยุธยา', 'โรบินสัน สระบุรี', 'เซ็นทรัล นครสวรรค์'],
  'ภาคตะวันออก': ['เซ็นทรัล ชลบุรี', 'โรบินสัน ฉะเชิงเทรา', 'โรบินสัน ชลบุรี อมตะนคร', 'เซ็นทรัล จันทบุรี'],
  'ภาคเหนือ': ['เซ็นทรัล เชียงราย', 'เซ็นทรัล ลำปาง'],
  'ภาคตะวันออกเฉียงเหนือ': ['เซ็นทรัล อุบล', 'เซ็นทรัล โคราช', 'เซ็นทรัล อุดร', 'เซ็นทรัล ขอนแก่น', 'โรบินสัน บุรีรัมย์'],
  'ภาคใต้': ['เซ็นทรัล นครศรี', 'เซ็นทรัล หาดใหญ่', 'เซ็นทรัล สุราษฎร์ธานี', 'โรบินสัน ตรัง'],
};

function oldMontipaRows() {
  let n = 0;
  const rows = [];
  for (const [group, names] of Object.entries(OLD_MONTIPA)) {
    for (const name of names) {
      rows.push({ id: `mtp-${n++}`, company: 'montipa', name, group, floor: 'G', sale_manager: null, area_manager: null,
        active: name !== 'เซ็นทรัล แจ้งวัฒนะ', created_at: '2026-09-20T00:00:00.000Z' });
    }
  }
  return rows;
}

// ตาราง "สาขาที่รับผิดชอบของทีมขาย MONTIPA เดือน ตุลาคม 2026" — คอลัมน์ละ 1 เขต: [ป้าย, ROM, จำนวนสาขาในตาราง]
const MONTIPA_AREAS = {
  pui: ['ทีมปุ้ย', 'ปุ้มปุ้ย', 11], ket: ['ทีมเกตุ', 'ปุ้มปุ้ย', 1], koy: ['ทีมก้อย', 'ปุ้มปุ้ย', 4], joy: ['ทีมจอย', 'ปุ้มปุ้ย', 2],
  mint: ['ทีมมิ้นท์', 'มิ้นท์', 9], pop: ['ทีมป๊อป', 'มิ้นท์', 1], tubtim: ['ทีมทับทิม', 'มิ้นท์', 2],
};

test('ตาราง Montipa: 7 เขต ครบ 30 สาขาเท่าทะเบียนเดิม ไม่มีชื่อซ้ำ', () => {
  const entry = branches.BRANCH_DIRECTORY.find((c) => c.company === 'montipa');
  assert.equal(entry.groupLabel, 'เขต (Area Manager)');
  assert.deepEqual(entry.groups.map((g) => [g.key, g.label, g.saleManager, g.branches.length]),
    Object.entries(MONTIPA_AREAS).map(([key, [label, rom, count]]) => [key, label, rom, count]));
  const names = entry.groups.flatMap((g) => g.branches);
  assert.equal(new Set(names).size, 30);
  assert.deepEqual([...names].sort(), Object.values(OLD_MONTIPA).flat().sort(), 'ชื่อสาขาต้องตรงทะเบียนเดิมทุกตัว (ticket เก่าอ้างชื่อพวกนี้)');
});

test('Montipa ย้ายจากภูมิภาคไปเขตของ AM: แถวเดิม (id เดิม) ชั้นเดิม · ROM อยู่ช่อง sale_manager · ไม่ซิงก์ Motta ซ้ำ', () => {
  // Motta ซิงก์รุ่นปัจจุบันไปแล้ว (เวอร์ชันตรง) แล้วแอดมินแก้เขตเองต่อ — ต้องไม่ถูกทับตอนซิงก์ Montipa
  const mottaRow = { id: 'motta-custom', company: 'motta', name: 'ลาดพร้าว', group: 'เขตที่แอดมินตั้งเอง', floor: null,
    sale_manager: 'ต่อ', area_manager: 'ปอ', active: true, created_at: '2026-10-14T00:00:00.000Z' };
  writeData('branches', [...oldMontipaRows(), mottaRow]);
  writeData('registry_meta', [{ id: 'branches', version: branches.BRANCH_REGISTRY_VERSION, synced_at: 'x', added: 0, updated: 0 }]);

  const all = branches.listAllBranches();
  const montipa = all.filter((b) => b.company === 'montipa');
  assert.equal(montipa.length, 30, 'ไม่มีแถวใหม่ — ทุกสาขาในตารางมีอยู่แล้ว');
  assert.ok(montipa.every((b) => b.id.startsWith('mtp-') && b.floor === 'G'), 'แถวเดิม ชั้นที่แอดมินกรอกไว้อยู่ครบ');
  const byName = (name) => montipa.find((b) => b.name === name);
  const hatyai = byName('เซ็นทรัล หาดใหญ่');
  assert.deepEqual([hatyai.group, hatyai.area_manager, hatyai.sale_manager], ['ทีมปุ้ย', 'ปุ้ย (ROM รักษาการ)', 'ปุ้มปุ้ย']);
  assert.deepEqual([byName('เซ็นทรัล สุราษฎร์ธานี').group, byName('เซ็นทรัล สุราษฎร์ธานี').area_manager], ['ทีมเกตุ', 'เกตุ']);
  assert.deepEqual([byName('เซ็นทรัล พระราม 9').group, byName('เซ็นทรัล พระราม 9').sale_manager], ['ทีมป๊อป', 'มิ้นท์']);
  assert.equal(byName('โรบินสัน ชลบุรี อมตะนคร').group, 'ทีมมิ้นท์');
  assert.equal(byName('เซ็นทรัล นครสวรรค์').group, 'ทีมทับทิม');
  assert.ok(montipa.every((b) => !/ภาค|กรุงเทพ/.test(b.group)), 'ไม่เหลือกลุ่มภูมิภาคค้าง');

  // เปิด/ปิดใช้งาน: แจ้งวัฒนะที่แอดมินปิดไว้ยังปิด · ลำปางปิดตามตาราง ("ปิด 10/10/69")
  assert.equal(byName('เซ็นทรัล แจ้งวัฒนะ').active, false);
  assert.deepEqual([byName('เซ็นทรัล ลำปาง').group, byName('เซ็นทรัล ลำปาง').active], ['ทีมมิ้นท์', false]);
  assert.equal(montipa.filter((b) => b.active).length, 28);

  assert.equal(all.find((b) => b.id === 'motta-custom').group, 'เขตที่แอดมินตั้งเอง', 'Motta ต้องไม่ถูกซิงก์ซ้ำ');
  const metaRows = readData('registry_meta');
  const mine = metaRows.find((m) => m.id === 'branches-montipa');
  assert.deepEqual([mine.version, mine.added, mine.updated], [branches.MONTIPA_AREAS_VERSION, 0, 30]);
  assert.equal(metaRows.find((m) => m.id === 'branches').synced_at, 'x', 'แถว meta ของ Motta ต้องไม่ถูกเขียนใหม่');
});

test('Montipa: แอดมินเปิดลำปางกลับเองแล้ว ซิงก์รอบหลังไม่ปิดซ้ำ · ข้อมูลที่ตรงตารางแล้ว = ไม่มีอะไรต้องแก้', () => {
  const rows = oldMontipaRows();
  assert.deepEqual(branches.syncMontipaAreas(rows), { added: 0, updated: 30 });
  const lampang = rows.find((b) => b.name === 'เซ็นทรัล ลำปาง');
  lampang.active = true; // แอดมินกดเปิดใช้งานที่หน้า "สาขา"
  assert.deepEqual(branches.syncMontipaAreas(rows), { added: 0, updated: 0 });
  assert.equal(lampang.active, true);
  assert.deepEqual(branches.syncMottaAreas(rows).updated, 0, 'ซิงก์ Motta ไม่แตะแถว Montipa');
});

test('เครื่องใหม่ (ยังไม่มีไฟล์): seed เป็นเขตของ AM เลย และลำปางที่ปิดแล้วไม่อยู่ในรายการที่เปิดอยู่', () => {
  fs.rmSync(path.join(dataDir, 'branches.json'), { force: true });
  writeData('registry_meta', []);
  const montipa = branches.listAllBranches().filter((b) => b.company === 'montipa');
  assert.equal(montipa.length, 30);
  assert.equal(montipa.find((b) => b.name === 'เซ็นทรัล ลำปาง').active, false);
  assert.ok(montipa.filter((b) => b.name !== 'เซ็นทรัล ลำปาง').every((b) => b.active));
  assert.ok(!branches.listBranches('montipa').some((b) => b.name === 'เซ็นทรัล ลำปาง'));
});

test('เมนูเลือกเขต Montipa ในบอท: 7 เขตเรียงตามตาราง บอก ROM + สาขาตัวอย่าง · นับเฉพาะสาขาที่เปิดอยู่', () => {
  writeData('branches', oldMontipaRows());
  writeData('registry_meta', []);
  const groups = branches.listBranchOptions({ level: 'group', company: 'montipa' }).options;
  assert.deepEqual(groups.map((g) => g.value), Object.keys(MONTIPA_AREAS));
  assert.deepEqual(groups.map((g) => g.label), Object.values(MONTIPA_AREAS).map(([label]) => label));
  // ปิดอยู่ไม่นับ: แจ้งวัฒนะ (ทีมปุ้ย) · ลำปาง (ทีมมิ้นท์)
  assert.deepEqual(groups.map((g) => g.count), [10, 1, 4, 2, 8, 1, 2]);
  assert.equal(groups[0].sub, 'ROM: ปุ้มปุ้ย · เซ็นทรัล หาดใหญ่, โรบินสัน ตรัง, เดอะมอลล์ไลฟ์สโตร์ บางกะปิ +7');
  assert.equal(groups[4].sub.split(' · ')[0], 'ROM: มิ้นท์');
  assert.match(branches.listBranchOptions({ level: 'group', company: 'motta' }).options[0].sub ?? '', /^Sale Manager: /,
    'Motta ยังเรียกว่า Sale Manager เหมือนเดิม');

  const koy = branches.listBranchOptions({ level: 'branch', company: 'montipa', group: 'koy' }).options.map((o) => o.value);
  assert.deepEqual(koy, ['เซ็นทรัล โคราช', 'เซ็นทรัล ขอนแก่น', 'เซ็นทรัล อุบล', 'โรบินสัน บุรีรัมย์']);
  const surat = branches.resolveBranch('เซ็นทรัล สุราษฎร์ธานี');
  assert.deepEqual([surat.groupKey, surat.groupLabel], ['ket', 'ทีมเกตุ']);
});
