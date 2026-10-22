// ยุบสถานะเหลือ 2 ค่า (21 ต.ค. 2026) — แปลงข้อมูลเดิมที่อยู่บนเครื่องจริงอัตโนมัติตอนอ่าน
//
// ทำไมต้องมีเทสต์ชุดนี้: การแปลงรันกับข้อมูลจริงครั้งเดียวและเขียนทับไฟล์ — พลาดตรงไหนกู้คืนจาก backup ได้อย่างเดียว
// อาการเวลาพังเงียบมาก: เรื่องที่ยกเลิกไปกลายเป็น "ปิดวันนี้" · คะแนนหาย · ไทม์ไลน์งอกทุกครั้งที่เปิดหน้า
// หรือเรื่องค้างสถานะเดิมแล้วหายจากทั้งสองแท็บของหน้า Tickets
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
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText, filename);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'status-migration-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, 'data'));
after(() => { process.chdir(root); fs.rmSync(tmp, { recursive: true, force: true }); });

const base = (over) => ({
  ticket_code: 'X', type: 'repair', location: 'สำนักงานใหญ่', requester_id: 'u1', equipment_id: null,
  description: 'ทดสอบ', repair_cost: null, created_at: '2026-09-01T02:00:00.000Z', resolved_at: null,
  meta: { line_user_id: 'U1' }, company: 'central', status_updated_by: null, status_updated_at: null, ...over,
});
const RATING = { score: 2, comment: 'ช้า', by: 'ลูกค้า', line_user_id: 'U1', at: '2026-09-03T00:00:00.000Z' };
const LEGACY = [
  base({ id: 't-progress', ticket_code: 'ITSR2026090001', status: 'in_progress' }),
  base({ id: 't-info', ticket_code: 'ITSR2026090002', status: 'waiting_info' }),
  base({ id: 't-delivery', ticket_code: 'ITSR2026090003', status: 'waiting_delivery' }),
  base({
    id: 't-done', ticket_code: 'ITSR2026090004', status: 'completed', resolved_at: '2026-09-02T05:00:00.000Z',
    meta: {
      line_user_id: 'U1', rating: RATING, resolution_note: 'เปลี่ยนสาย', completed_at: '2026-09-02T05:00:00.000Z',
      status_history: [{ id: 'h1', from: 'pending', to: 'completed', by: 'ช่างเอ', at: '2026-09-02T05:00:00.000Z', note: 'เปลี่ยนสาย', notified: true, role: 'admin' }],
    },
  }),
  base({
    id: 't-cancel', ticket_code: 'ITSR2026090005', status: 'cancelled',
    meta: { status_history: [{ id: 'h2', from: 'pending', to: 'cancelled', by: 'ช่างบี', at: '2026-09-05T08:00:00.000Z', note: '', notified: null, role: 'admin' }] },
  }),
  base({ id: 't-closed', ticket_code: 'ITSR2026090006', status: 'closed', resolved_at: '2026-09-06T00:00:00.000Z' }),
  base({ id: 't-pending', ticket_code: 'ITSR2026090007', status: 'pending' }),
  base({ id: 't-resolved', ticket_code: 'ITSR2026090008', status: 'resolved', resolved_at: '2026-09-07T00:00:00.000Z' }),
];
fs.writeFileSync(path.join(tmp, 'data/tickets.json'), JSON.stringify(LEGACY, null, 2));

const { listTickets } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { listEventsForTicket } = require(path.join(root, 'src/lib/db/ticketEvents.ts'));
const { readResolvedBy } = require(path.join(root, 'src/lib/ticket-confirmation.ts'));
const { readRating, canReopen } = require(path.join(root, 'src/lib/ticket-feedback.ts'));
const { statusLabel } = require(path.join(root, 'src/lib/ticket-status.ts'));

const byId = (id) => listTickets().find((t) => t.id === id);

test('สถานะเดิมถูกแปลง: งานที่ยังต้องทำ = รอดำเนินการ · งานที่จบแล้ว = แก้ไขแล้ว · ยกเลิกคงเป็นยกเลิก', () => {
  const statuses = Object.fromEntries(listTickets().map((t) => [t.id, t.status]));
  assert.deepEqual(statuses, {
    't-progress': 'pending', 't-info': 'pending', 't-delivery': 'pending',
    't-done': 'resolved', 't-cancel': 'cancelled', 't-closed': 'resolved',
    't-pending': 'pending', 't-resolved': 'resolved',
  });
  // เขียนลงไฟล์จริง ไม่ใช่แปลงแค่ในหน่วยความจำ — ไม่งั้น Excel/บอทที่อ่านไฟล์ยังเห็นสถานะเดิม
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'data/tickets.json'), 'utf8'));
  assert.ok(onDisk.every((t) => ['pending', 'resolved', 'cancelled'].includes(t.status)));
});

test('ประวัติบอกได้ว่าเดิมเป็นสถานะอะไร · เรื่องที่ยกเลิก (สถานะปัจจุบันอยู่แล้ว) ไม่ถูกแตะเลย', () => {
  const closed = byId('t-closed');
  const last = closed.meta.status_history.at(-1);
  assert.equal(last.from, 'closed');
  assert.equal(last.to, 'resolved');
  assert.equal(last.role, 'system');
  assert.match(last.note, /ปิดแล้ว/);

  const events = listEventsForTicket('t-closed');
  assert.equal(events.length, 1);
  assert.equal(statusLabel(events[0].from_status), 'ปิดแล้ว', 'ไทม์ไลน์ของเรื่องเก่าต้องยังอ่านออก');

  // ไฟล์ที่กู้จาก backup ก่อนยุบสถานะยังมีเรื่องยกเลิก — ต้องคงเป็นยกเลิก ไม่ใช่กลายเป็น "แก้ไขแล้ว"
  // (ถ้าแปลง ตัวเลขงานที่แก้เสร็จ/ระยะเวลาเฉลี่ยจะรวมเรื่องที่ไม่ได้แก้จริงเข้าไปด้วย)
  const cancelled = byId('t-cancel');
  assert.equal(cancelled.meta.status_history.length, 1, 'ห้ามเพิ่มรายการในประวัติ');
  assert.equal(listEventsForTicket('t-cancel').length, 0);
  assert.equal(cancelled.resolved_at, null);
});

test('วันปิดงาน: ของเดิมไม่ถูกทับ · เรื่องที่ยังทำอยู่ไม่มีวันปิด', () => {
  assert.equal(byId('t-done').resolved_at, '2026-09-02T05:00:00.000Z', 'ของเดิมต้องไม่ถูกทับ');
  assert.equal(byId('t-closed').resolved_at, '2026-09-06T00:00:00.000Z');
  assert.equal(byId('t-progress').resolved_at, null);
});

test('คะแนน วิธีแก้ และชื่อช่างที่ปิดงานของเรื่องเดิมอยู่ครบ', () => {
  const done = byId('t-done');
  assert.deepEqual(readRating(done), RATING);
  assert.equal(done.meta.resolution_note, 'เปลี่ยนสาย');
  assert.equal(readResolvedBy(done).by, 'ช่างเอ', 'รายการของระบบต้องไม่ขึ้นเป็นคนปิดงาน');
  // เพดานเปิดกลับยังนับจากวันปิดจริง (นานแล้ว) — ไม่ใช่เริ่มนับใหม่จากวันที่แปลง
  assert.equal(canReopen(done, Date.parse('2026-10-21T00:00:00.000Z')), false);
});

test('อ่านซ้ำกี่รอบก็แปลงแค่ครั้งเดียว — ไทม์ไลน์/ประวัติไม่งอกทุกครั้งที่เปิดหน้า', () => {
  for (let i = 0; i < 3; i++) listTickets();
  assert.equal(listEventsForTicket('t-progress').length, 1);
  assert.equal(byId('t-progress').meta.status_history.length, 1);
  assert.equal(listEventsForTicket('t-pending').length, 0, 'เรื่องที่เป็นสถานะใหม่อยู่แล้วต้องไม่ถูกแตะ');
  assert.equal(byId('t-pending').meta.status_history, undefined);
});
