// นำเข้าทะเบียนล่าสุดจาก HR (020): อ่านไฟล์ · ดูผลก่อนบันทึก · นำเข้า · สถานะ 1/0
//
// กติกาที่ห้ามพัง (ผู้ใช้กำหนด 11 ต.ค. 2569 — ชุดเดียวกับระบบจองห้องประชุมและระบบนวด):
//   - ไม่อยู่ในไฟล์ → สถานะ 0 (active=false · ไม่ลบแถว) ยกเว้นกลุ่มรหัส AS/MS/PS (พนักงานสาขา) = คงเดิม
//   - กลุ่มรหัส = ตัวอักษรนำหน้าทั้งหมด: AS ไม่ใช่ A (ไม่งั้นพนักงานสำนักงาน A… ที่ออกแล้วไม่ถูกปิด)
//   - ช่องว่างในไฟล์ = คงค่าเดิม · การผูก LINE / อีเมล ห้ามถูกแตะ
//   - รหัสที่มีหลายแถวในระบบ = ห้ามเดา (กฎเหล็กข้อ 4)
// ชื่อในเทสต์เป็นชื่อสมมติทั้งหมด · รันบนโฟลเดอร์ข้อมูลชั่วคราว ไม่แตะ data/ ของเครื่องจริง
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
  if (id === 'next/headers') return { cookies: async () => ({ get: () => undefined }) };
  if (id === 'next/navigation') return { redirect(url) { throw new Error(`redirect:${url}`); } };
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'employees-import-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'true';
delete process.env.EMPLOYEE_SYNC_KEEP_PREFIXES;

const imp = require(path.join(root, 'src/lib/employee-import.ts'));
const emp = require(path.join(root, 'src/lib/db/employees.ts'));
const actions = require(path.join(root, 'src/app/actions/employees.ts'));

const dataDir = path.join(tmp, 'data');
const readData = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
const writeData = (name, rows) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(rows, null, 2));
};

after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const user = (over) => ({
  id: over.employee_id ?? over.id, display_name: 'คนเดิม', employee_id: null, department: null,
  line_user_id: null, email: null, created_at: '2026-09-26T00:00:00.000Z', title: null, nickname: null,
  position: null, level: null, company: null, active: true, ...over,
});

// ทุกเทสต์เริ่มจากทะเบียนสมมติชุดเดียวกัน + บอกว่า seed ซิงก์ครบทุกชุดแล้ว (ไม่งั้นรายชื่อจริง 338 คนจาก seed จะถูกผสมเข้ามา)
beforeEach(() => {
  writeData('registry_meta', emp.REGISTRY_SYNCS.map(({ id, version }) => ({ id, version, synced_at: 'x', added: 0, updated: 0 })));
  writeData('users', [
    user({ employee_id: 'A60001', display_name: 'สำนักงาน หนึ่ง', department: 'ฝ่ายขาย', line_user_id: 'U-a1',
      email: 'one@example.com', company: 'motta' }),
    user({ employee_id: 'A60002', display_name: 'สำนักงาน สอง', department: 'ฝ่ายออกแบบ' }),
    user({ employee_id: 'A60003', display_name: 'ลาออก แล้ว' }),
    user({ employee_id: 'M60001', display_name: 'มนตรี หนึ่ง', company: 'montipa' }),
    user({ employee_id: 'MD002', display_name: 'ผู้บริหาร สมมติ' }),
    user({ employee_id: 'AB52001', display_name: 'กลุ่ม เอบี' }),
    user({ employee_id: 'AS60001', display_name: 'สาขา หนึ่ง' }),
    user({ employee_id: 'MS60001', display_name: 'สาขา สอง' }),
    user({ employee_id: 'PS60001', display_name: 'สาขา สาม' }),
    user({ employee_id: 'A50001', display_name: 'ปิดไว้ แล้ว', active: false }),
    user({ id: 'manual', display_name: 'เพิ่มเอง ไม่มีรหัส' }),
  ]);
});

const HEADER = ['รหัสพนักงาน', 'ฝ่ายงาน', 'ชื่อเล่น', 'คำนำหน้าชื่อ', 'ชื่อ-นามสกุล'];
/** หน้าตาเหมือนทะเบียนจริง: แถวแรกว่าง · หัวตารางแถวที่ 2 */
const registry = (sheets) =>
  Object.entries(sheets).map(([name, rows]) => ({ name, first_row: 1, rows: [[null, null, null, null, null], HEADER, ...rows] }));

const OFFICE = registry({
  AFV: [
    ['A60001', 'Warehouse', 'หนึ่ง', 'นาย', 'สำนักงาน หนึ่ง'],          // ชื่อเดียวทุกคน → ย้ายฝ่ายตามทะเบียน
    ['A60002', 'Marketing', null, 'นาง', 'สำนักงาน สอง'],             // ชื่อใช้หลายฝ่าย → ไม่ทับฝ่ายที่จัดไว้
    ['A50001', null, null, null, 'ปิดไว้ แล้ว'],                        // กลับมาอยู่ในไฟล์ → 1
    ['A69001', 'Marketing', 'ใหม่', 'นาย', 'พนักงาน ใหม่'],            // คนใหม่ยังไม่มีฝ่าย → เดาได้
  ],
  MTP: [['M60001', null, null, 'นาง', 'มนตรี หนึ่ง']],
  'บุคคล': [['P54001', 'ฝ่ายขาย Motta', null, null, 'บุคคล หนึ่ง']],  // ชื่อฝ่ายไม่รู้จัก → เตือน
});

// ---------------------------------------------------------------- อ่านไฟล์
test('อ่านทะเบียนรูปแบบใหม่: หัวตารางแถวที่ 2 และคอลัมน์ "ฝ่ายงาน"', () => {
  const p = imp.parseRegistrySheets(OFFICE);
  assert.deepEqual(p.sheets.map((s) => [s.name, s.header_row, s.valid, s.has_department]),
    [['AFV', 2, 4, true], ['MTP', 2, 1, true], ['บุคคล', 2, 1, true]]);
  const a1 = p.rows.find((r) => r.code === 'A60001');
  assert.deepEqual([a1.department, a1.nickname, a1.title, a1.row, a1.sheet], ['Warehouse', 'หนึ่ง', 'นาย', 3, 'AFV']);
  assert.equal(p.problems.length, 0);
});

test('แถวที่ผิดถูกรายงานพร้อมเลขแถว Excel ไม่ทิ้งเงียบ · รหัสซ้ำใช้แถวแรก', () => {
  const p = imp.parseRegistrySheets([{ name: 'AFV', first_row: 4, rows: [
    HEADER,
    ['A', null, null, null, 'รหัสสั้นไป'],
    [null, null, null, null, 'ไม่มีรหัส'],
    ['A65009', null, null, null, null],
    [' a65010 ', null, null, null, '  ช่องว่าง   เกิน '],
    ['A65010', null, null, null, 'ซ้ำ'],
    [65011, null, null, null, 'รหัส ตัวเลข'],                          // Excel เก็บรหัสตัวเลขเป็น number
    [null, null, null, null, null],
  ] }]);
  assert.deepEqual(p.rows.map((r) => [r.code, r.name]), [['A65010', 'ช่องว่าง เกิน'], ['65011', 'รหัส ตัวเลข']]);
  assert.deepEqual(p.problems.map((x) => x.row), [5, 6, 7, 9]);              // ช่วงข้อมูลเริ่มแถว 4 ของ Excel
  assert.match(p.problems[3].message, /^รหัสซ้ำกับแถว 8 ของชีต AFV/);
  assert.throws(() => imp.parseRegistrySheets([{ name: 'สรุป', first_row: 1, rows: [['ยอดรวม', 3]] }]), imp.RegistryError);
});

test('ข้อมูลที่หน้าเว็บส่งมาถูกตรวจซ้ำที่เซิร์ฟเวอร์ — แก้ในเบราว์เซอร์แล้วผ่านไม่ได้', () => {
  assert.throws(() => imp.sanitizeRegistryRows('ไม่ใช่รายการ'), imp.RegistryError);
  assert.throws(() => imp.sanitizeRegistryRows([null]), imp.RegistryError);
  const rows = imp.sanitizeRegistryRows([
    { code: ' a1-ok ', name: ' ชื่อ   จริง ', department: 'x'.repeat(500), sheet: 'AFV', row: 3 },
    { code: '<script>', name: 'แอบใส่' },
    { code: 'A1-OK', name: 'ซ้ำ' },
    { code: 'B2', name: '' },
    { code: 'C3', name: { toString: () => 'อ็อบเจกต์' } },
  ]);
  assert.deepEqual(rows.map((r) => [r.code, r.name, r.department.length, r.row]), [['A1-OK', 'ชื่อ จริง', 120, 3]]);
});

test('กติกาแปลงฝ่ายและบริษัทตามชื่อชีต', () => {
  const r = (v, cur) => imp.resolveDepartment(v, cur, emp.DEPARTMENTS);
  assert.deepEqual(r(null, 'ฝ่ายขาย'), { value: 'ฝ่ายขาย', how: 'blank' });
  assert.deepEqual(r('Warehouse', 'ฝ่ายขาย'), { value: 'ฝ่ายคลังสินค้า', how: 'exact' });
  assert.deepEqual(r('  ฝ่าย  VM ', null), { value: 'ฝ่ายวิชวลเมอร์แชนไดซ์', how: 'exact' });
  assert.deepEqual(r('Marketing', 'ฝ่ายออกแบบ'), { value: 'ฝ่ายออกแบบ', how: 'guess_kept' });
  assert.deepEqual(r('marketing', null), { value: 'ฝ่ายการตลาดและพาณิชย์', how: 'guess_used' });
  assert.deepEqual(r('ฝ่ายวางแผน', null), { value: 'ฝ่ายวางแผน', how: 'exact' });
  assert.deepEqual(r('ฝ่ายขาย Motta', 'ฝ่ายขาย'), { value: 'ฝ่ายขาย', how: 'unknown' });
  assert.deepEqual(['AFV', 'mtp ', 'Motta', 'บุคคล', 'P'].map(imp.companyForSheet), ['motta', 'montipa', 'motta', null, null]);
  assert.deepEqual([...imp.parsePrefixes(undefined)], ['AS', 'MS', 'PS']);
  assert.deepEqual([...imp.parsePrefixes('')], []);
  assert.equal(imp.codePrefix('AS12345'), 'AS');
  assert.equal(imp.codePrefix('1234'), '');
});

// ---------------------------------------------------------------- ดูผล + นำเข้า
test('ดูผลก่อนบันทึก: ไม่อยู่ในไฟล์เป็น 0 ยกเว้นพนักงานสาขา (AS ≠ A) และไม่เขียนไฟล์', () => {
  const before = fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8');
  const plan = emp.planRegistryImport(imp.parseRegistrySheets(OFFICE).rows);
  assert.deepEqual(plan.deactivate.map((p) => p.employee_id), ['A60003', 'AB52001', 'MD002']);
  assert.deepEqual(plan.kept_missing_by_prefix, { AS: 1, MS: 1, PS: 1 });
  assert.deepEqual([plan.inserted.length, plan.reactivated.length, plan.active_in_scope, plan.without_code, plan.mass],
    [2, 1, 6, 1, false]);
  assert.deepEqual(plan.departments, { unknown: [{ value: 'ฝ่ายขาย Motta', count: 1 }], guess_kept: 1, guess_used: 1 });
  assert.equal(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'), before, 'ดูผลต้องไม่เขียนอะไรเลย');
});

test('นำเข้าจริง: สถานะ 1/0 · ฝ่าย · บริษัท · ไม่แตะ LINE/อีเมล · ไม่ลบแถว · รันซ้ำไม่เปลี่ยนอะไร', () => {
  const rows = imp.parseRegistrySheets(OFFICE).rows;
  const r = emp.applyRegistryImport(rows, { confirmMass: false });
  assert.deepEqual(r, { in_file: 6, inserted: 2, updated: 4, reactivated: 1, unchanged: 0, deactivated: 3,
    kept_missing: 3, ambiguous: 0 });
  const users = Object.fromEntries(readData('users').map((u) => [u.employee_id ?? u.id, u]));
  assert.equal(Object.keys(users).length, 13, 'คนที่เป็น 0 ต้องยังอยู่ในไฟล์ (ไม่ลบ)');
  const a1 = users.A60001;
  assert.deepEqual([a1.department, a1.nickname, a1.title, a1.line_user_id, a1.email, a1.active],
    ['ฝ่ายคลังสินค้า', 'หนึ่ง', 'นาย', 'U-a1', 'one@example.com', true]);
  assert.equal(users.A60002.department, 'ฝ่ายออกแบบ');                         // Marketing ไม่ทับฝ่ายที่จัดไว้
  assert.deepEqual([users.A69001.department, users.A69001.company, users.A69001.active],
    ['ฝ่ายการตลาดและพาณิชย์', 'motta', true]);
  assert.deepEqual([users.P54001.company, users.P54001.department], [null, null]);  // ชีต "บุคคล" ไม่ระบุบริษัท
  assert.equal(users.A50001.active, true);                                       // กลับมาอยู่ในไฟล์ = 1
  for (const code of ['A60003', 'AB52001', 'MD002']) assert.equal(users[code].active, false, `${code} ต้องเป็น 0`);
  for (const code of ['AS60001', 'MS60001', 'PS60001']) assert.equal(users[code].active, true, `${code} ต้องคงเดิม`);
  assert.equal(users.manual.active, true, 'คนที่ไม่มีรหัสจับคู่กับไฟล์ไม่ได้ — ห้ามแตะ');

  const again = emp.applyRegistryImport(rows, { confirmMass: false });
  assert.deepEqual([again.inserted, again.updated, again.deactivated, again.unchanged], [0, 0, 0, 6]);
});

test('เปลี่ยนเป็น 0 จำนวนมากต้องยืนยันก่อน และถ้าไม่ยืนยันต้องไม่มีอะไรเปลี่ยน', () => {
  writeData('users', Array.from({ length: 30 }, (_, i) => user({ employee_id: `A6${String(i).padStart(4, '0')}` })));
  const before = fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8');
  const rows = imp.parseRegistrySheets(registry({ AFV: [['A60000', null, null, null, 'คนเดิม']] })).rows;
  assert.equal(emp.planRegistryImport(rows).mass, true);                         // 29 จาก 30 คน
  assert.throws(() => emp.applyRegistryImport(rows, { confirmMass: false }), emp.MassDeactivationError);
  assert.equal(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'), before);
  assert.equal(emp.applyRegistryImport(rows, { confirmMass: true }).deactivated, 29);
});

test('รหัสที่มีหลายแถวในระบบ = ข้าม ไม่เดาว่าคนไหน', () => {
  const users = readData('users');
  users.push(user({ id: 'dup', employee_id: 'a60001 ', display_name: 'รหัสซ้ำ' }));
  writeData('users', users);
  const r = emp.applyRegistryImport(imp.parseRegistrySheets(OFFICE).rows, { confirmMass: false });
  assert.equal(r.ambiguous, 1);
  const after = readData('users').filter((u) => (u.employee_id ?? '').trim().toUpperCase() === 'A60001');
  assert.deepEqual(after.map((u) => [u.department, u.active]), [['ฝ่ายขาย', true], [null, true]], 'ทั้ง 2 แถวต้องไม่ถูกแตะ');
});

test('ตั้ง EMPLOYEE_SYNC_KEEP_PREFIXES เป็นค่าว่าง = ไฟล์คือรายชื่อทั้งหมด (สาขาก็เป็น 0)', () => {
  process.env.EMPLOYEE_SYNC_KEEP_PREFIXES = '';
  try {
    const plan = emp.planRegistryImport(imp.parseRegistrySheets(OFFICE).rows);
    assert.equal(plan.kept_missing, 0);
    assert.ok(plan.deactivate.some((p) => p.employee_id === 'AS60001'));
  } finally {
    delete process.env.EMPLOYEE_SYNC_KEEP_PREFIXES;
  }
});

// ---------------------------------------------------------------- Server Action
test('Server Action: ดูผล → นำเข้า · ยืนยันซ้ำเมื่อปิดจำนวนมาก · ข้อมูลเสียได้ข้อความไทย', async () => {
  const rows = imp.parseRegistrySheets(OFFICE).rows;
  const p = await actions.previewRegistryAction(rows);
  assert.deepEqual([p.preview.counts.inserted, p.preview.counts.deactivate, p.preview.counts.kept_missing], [2, 3, 3]);
  assert.deepEqual(await actions.previewRegistryAction('ขยะ'), { error: 'ข้อมูลรายชื่อไม่ถูกต้อง — โหลดหน้าใหม่แล้วเลือกไฟล์อีกครั้ง' });
  assert.deepEqual(await actions.previewRegistryAction([]), { error: 'ไม่มีรายชื่อที่ใช้ได้ในไฟล์นี้' });
  const done = await actions.importRegistryAction(rows, false);
  assert.equal(done.result.deactivated, 3);

  writeData('users', Array.from({ length: 30 }, (_, i) => user({ employee_id: `A6${String(i).padStart(4, '0')}` })));
  const one = imp.parseRegistrySheets(registry({ AFV: [['A60000', null, null, null, 'คนเดิม']] })).rows;
  const blocked = await actions.importRegistryAction(one, false);
  assert.equal(blocked.needConfirm, true);
  assert.match(blocked.error, /^ไฟล์นี้จะเปลี่ยนพนักงาน 29 คนเป็นสถานะ 0/);
});

test('ไม่ได้ล็อกอิน = ดูผลหรือนำเข้าไม่ได้ และไฟล์ข้อมูลไม่ถูกแตะ', async () => {
  const before = fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8');
  process.env.AUTH_DISABLED = 'false';
  for (const file of ['src/lib/auth.ts', 'src/app/actions/employees.ts']) delete require.cache[path.join(root, file)];
  const guarded = require(path.join(root, 'src/app/actions/employees.ts'));
  const rows = imp.parseRegistrySheets(OFFICE).rows;
  try {
    await assert.rejects(() => guarded.previewRegistryAction(rows), /redirect:\/login/);
    await assert.rejects(() => guarded.importRegistryAction(rows, true), /redirect:\/login/);
  } finally {
    process.env.AUTH_DISABLED = 'true';
  }
  assert.equal(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'), before);
});
