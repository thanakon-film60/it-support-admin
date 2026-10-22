// ทะเบียนพนักงาน: ซิงก์เข้า users.json, ค้นหา, และผูกบัญชี LINE
//
// จุดที่ห่วงที่สุดคือ "ซิงก์แล้วทับของเดิม" — ทะเบียนถูกรันทับข้อมูลจริงที่ใช้งานอยู่
// ถ้าเผลอล้าง line_user_id หรือฝ่ายที่แอดมินเพิ่งเติมให้ 193 คนที่ HR ยังไม่ได้จัด
// จะไม่มีอะไรฟ้องเลย รู้ตัวอีกทีคือผู้ใช้ทุกคนถูกถามชื่อใหม่หมดพร้อมกัน
const { test, after } = require('node:test');
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'employees-'));
process.chdir(tmp);
process.env.INTERNAL_API_KEY = 'local-test-key';

const emp = require(path.join(root, 'src/lib/db/employees.ts'));
const { listUsers } = require(path.join(root, 'src/lib/db/users.ts'));
const { POST: createTicket } = require(path.join(root, 'src/app/api/internal/tickets/route.ts'));
const { listTickets } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { createBranch } = require(path.join(root, 'src/lib/db/branches.ts'));

const dataFile = (name) => path.join(tmp, 'data', `${name}.json`);
const readData = (name) => JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
const writeData = (name, rows) => {
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.writeFileSync(dataFile(name), JSON.stringify(rows, null, 2));
};
const reset = () => {
  for (const name of ['users', 'registry_meta', 'tickets']) {
    try { fs.unlinkSync(dataFile(name)); } catch { /* ยังไม่มีไฟล์ = ถือว่าล้างแล้ว */ }
  }
};

// ต้อง chdir กลับก่อนลบ — เทสต์ชุดนี้ process.chdir(tmp) ไว้ และ Windows ลบโฟลเดอร์ที่เป็น
// cwd ของโปรเซสอยู่ไม่ได้ (EPERM) ไฟล์เทสต์อื่นทำแล้ว ไฟล์นี้ตกหล่น ผลคือชุดเทสต์แดง 1 เคส
// ทุกครั้งบน Windows จนคนเริ่มชินกับการเห็นสีแดง ซึ่งอันตรายกว่าไม่มีเทสต์
after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('ติดตั้งใหม่ได้รายชื่อครบทั้งทะเบียน ไม่ใช่ข้อมูลตัวอย่าง', () => {
  reset();
  const rows = emp.listEmployees();
  assert.equal(rows.length, emp.EMPLOYEE_REGISTRY.length);
  assert.equal(rows.length, 326);
  assert.ok(rows.every((u) => u.employee_id), 'ทุกคนต้องมีรหัสพนักงาน');
  assert.equal(new Set(rows.map((u) => u.employee_id)).size, rows.length, 'รหัสต้องไม่ซ้ำ');
});

test('ซิงก์ซ้ำกี่รอบก็ไม่เพิ่มคนซ้ำ', () => {
  reset();
  emp.listEmployees();
  const before = readData('users').length;
  for (let i = 0; i < 3; i += 1) {
    const result = emp.syncEmployeeRegistry();
    assert.equal(result.added, 0, `รอบที่ ${i + 1} เพิ่มคนซ้ำ ${result.added} คน`);
  }
  assert.equal(readData('users').length, before);
});

test('ระบบที่มี users.json อยู่แล้วต้องได้รายชื่อใหม่ด้วย (ไม่ใช่แค่ติดตั้งใหม่)', () => {
  // อาการที่กันอยู่: seedFn ของ store รันเฉพาะตอน "ยังไม่มีไฟล์" — เครื่องที่ใช้งานอยู่จริง
  // มีไฟล์แล้วเสมอ ถ้าพึ่ง seed อย่างเดียวจะไม่มีใครได้รายชื่อใหม่เลยสักคน
  reset();
  writeData('users', [
    { id: 'old-1', display_name: 'สมชาย ใจดี', employee_id: 'E1001', department: 'บัญชี',
      line_user_id: 'U_old', email: null, created_at: '2026-01-01T00:00:00.000Z' },
  ]);
  const rows = emp.listEmployees();
  assert.equal(rows.length, 1 + emp.EMPLOYEE_REGISTRY.length);
  assert.ok(rows.some((u) => u.id === 'old-1'), 'ของเดิมต้องไม่หาย');
});

test('ซิงก์ต้องไม่แตะ line_user_id ที่ผูกไว้แล้ว', () => {
  reset();
  emp.listEmployees();
  const target = emp.getEmployeeByCode('A69048');
  emp.bindLineUser('U_film', target.id);

  emp.syncEmployeeRegistry();

  assert.equal(emp.getEmployeeByCode('A69048').line_user_id, 'U_film');
});

test('ฝ่ายที่แอดมินเติมให้คนที่ทะเบียนยังว่าง ต้องไม่ถูกล้างตอนซิงก์', () => {
  // 193 คนในทะเบียนมี department = null ("อื่นๆ") ถ้าปล่อยให้ทะเบียนทับทุกช่องเสมอ
  // งานที่แอดมินนั่งเติมฝ่ายให้ทีละคนจะหายหมดทุกครั้งที่ซิงก์ โดยไม่มีอะไรเตือน
  reset();
  emp.listEmployees();
  const other = emp.EMPLOYEE_REGISTRY.find((r) => r.department === null);
  const row = emp.getEmployeeByCode(other.code);
  emp.updateEmployee(row.id, { department: 'ฝ่ายขาย' });

  emp.syncEmployeeRegistry();

  assert.equal(emp.getEmployeeByCode(other.code).department, 'ฝ่ายขาย');
});

test('เมนูเลือกฝ่าย: เรียงตามผังองค์กร และ "อื่นๆ" อยู่ท้ายสุดเสมอ', () => {
  reset();
  const summary = emp.departmentSummary();
  assert.equal(summary.at(-1).name, emp.OTHER_DEPARTMENT);
  assert.equal(summary.at(-1).count, 193);
  assert.equal(summary[0].name, emp.DEPARTMENTS[0]);
  assert.ok(summary.every((d) => d.count > 0), 'ห้ามมีฝ่ายที่กดเข้าไปแล้วว่างเปล่า');
  assert.equal(summary.reduce((sum, d) => sum + d.count, 0), 326);
});

test('ค้นหา: รหัสพนักงานมาก่อนชื่อเล่น และชื่อเล่นมาก่อนชื่อที่แค่คล้าย', () => {
  reset();
  const byCode = emp.searchEmployees('A69048');
  assert.equal(byCode[0].user.display_name, 'ธนากร โฮงทอง');

  const byNick = emp.searchEmployees('ฟิล์ม');
  assert.ok(byNick.length > 0);
  assert.equal(byNick[0].score, 2, 'ชื่อเล่นตรงเป๊ะต้องได้คะแนนสูงกว่าแค่มีคำนั้นอยู่ในชื่อ');

  assert.deepEqual(emp.searchEmployees('ก'), [], 'คำสั้นเกินไปต้องไม่คืนทั้งบริษัทกลับมา');
});

test('ค้นหาข้ามช่องว่างในชื่อได้ (คนพิมพ์เว้นวรรคไม่เหมือนกัน)', () => {
  reset();
  const spaced = emp.searchEmployees('ธนากร โฮงทอง');
  const packed = emp.searchEmployees('ธนากรโฮงทอง');
  assert.equal(spaced[0].user.id, packed[0].user.id);
});

test('1 บัญชี LINE ผูกได้กับพนักงานคนเดียว — ผูกคนใหม่ต้องถอดคนเก่าออก', () => {
  // ถ้าปล่อยให้ค้าง 2 แถว การค้นย้อนกลับจะคืน "แถวไหนก็ได้ที่เจอก่อน" แปลว่าคนคนเดียว
  // กลายเป็นผู้แจ้งคนละคนได้ในแต่ละครั้ง โดยไม่มีอะไรฟ้อง
  reset();
  emp.listEmployees();
  const a = emp.getEmployeeByCode('A69048');
  const b = emp.getEmployeeByCode('A69035');

  emp.bindLineUser('U_same', a.id);
  emp.bindLineUser('U_same', b.id);

  const bound = emp.listEmployees(true).filter((u) => u.line_user_id === 'U_same');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].id, b.id);
});

test('ถอดการผูกแล้วไม่มีใครถือ line_user_id นั้นอีก', () => {
  reset();
  emp.listEmployees();
  emp.bindLineUser('U_gone', emp.getEmployeeByCode('A69048').id);
  assert.equal(emp.unbindLineUser('U_gone'), 1);
  assert.equal(emp.listEmployees(true).filter((u) => u.line_user_id === 'U_gone').length, 0);
});

test('ticket ที่ส่ง requester_user_id มา ต้องผูกกับแถวเดิม ไม่สร้างคนใหม่', async () => {
  reset();
  createBranch({ company: 'central', name: 'สำนักงานใหญ่', group: 'สำนักงานและคลัง' });
  const me = emp.getEmployeeByCode('A69048');
  const before = listUsers().length;

  const res = await createTicket(new Request('http://localhost/api/internal/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': 'local-test-key' },
    body: JSON.stringify({
      type: 'repair', location: 'สำนักงานใหญ่', description: 'จอไม่ติด',
      // จงใจส่งชื่อที่สะกดต่างจากในทะเบียน — ถ้าโค้ดไปหาจากชื่อ จะสร้าง user แถวใหม่ทันที
      requester_name: 'ธนากร  โฮงทอง ', requester_user_id: me.id, line_user_id: 'U_film',
    }),
  }));

  assert.equal(res.status, 200);
  assert.equal(listUsers().length, before, 'ต้องไม่มี user แถวใหม่เกิดขึ้น');
  const body = await res.json();
  // หาจากเลขที่ ไม่ใช่ .at(-1) — createTicket ใส่ ticket ใหม่ไว้บนสุดของลิสต์
  const ticket = listTickets().find((t) => t.ticket_code === body.ticket_code);
  assert.ok(ticket, 'หา ticket ที่เพิ่งสร้างไม่เจอ');
  assert.equal(ticket.requester_id, me.id);
  assert.equal(ticket.meta.requester_department, 'ฝ่ายเทคโนโลยีสารสนเทศ');
});
