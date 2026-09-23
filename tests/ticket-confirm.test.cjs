// สถานะ "สำเร็จแล้ว" — ผู้แจ้งกดยืนยันเองจากปุ่มในไลน์
//
// ทำไมต้องมีเทสต์ชุดนี้: ตัวเลข "งานที่สำเร็จ" จะมีความหมายก็ต่อเมื่อไม่มีทางปลอมได้
// จุดที่ปลอมได้คือ endpoint ยืนยัน ซึ่งรับแค่ ticket_code ที่เดารูปแบบได้ (ITRQ2026090158)
// ถ้าด่านเช็คเจ้าของหลุด ใครที่แอด OA ก็ปิดงานของทั้งบริษัทได้ทีละใบโดยไม่มีใครรู้
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
  if (id === 'next/headers') return { cookies: async () => ({ get: () => undefined }) };
  if (id === 'next/navigation') return { redirect() { throw new Error('unexpected redirect'); } };
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText, filename);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-confirm-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'true';
process.env.LINE_NOTIFY_STATUSES = '';
process.env.INTERNAL_API_KEY = 'test-internal-key';
delete process.env.LINE_ADMIN_USER_IDS;

const {
  createTicket, getTicketById, updateTicketStatus, readStatusHistory,
  confirmTicketByRequester, listCompletedTickets,
} = require(path.join(root, 'src/lib/db/tickets.ts'));
const { readConfirmation, readResolvedBy, confirmationLeadTimeHours, formatLeadTime } =
  require(path.join(root, 'src/lib/ticket-confirmation.ts'));
const { buildStatusConfirmFlex, buildConfirmPostbackData } =
  require(path.join(root, 'src/lib/line/confirm-card.ts'));
const { POST: confirmRoute } = require(path.join(root, 'src/app/api/internal/tickets/confirm/route.ts'));

after(() => { process.chdir(root); fs.rmSync(tmp, { recursive: true, force: true }); });

const LINE_USER = 'U_requester_001';

function newResolvedTicket(overrides = {}) {
  const ticket = createTicket({
    type: 'repair', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'จอไม่ติด', repair_cost: null,
    meta: { line_user_id: LINE_USER },
    ...overrides,
  });
  updateTicketStatus(ticket.id, 'resolved', 'ช่างเอ', { note: 'เปลี่ยนสายจอแล้ว' });
  return getTicketById(ticket.id);
}

function call(body, key = 'test-internal-key') {
  return confirmRoute(new Request('http://localhost/api/internal/tickets/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify(body),
  }));
}

/* ─────────────────────────────── ชั้นข้อมูล ─────────────────────────────── */

test('ผู้แจ้งยืนยัน -> สถานะเป็น completed พร้อมบันทึกว่าใครยืนยันเมื่อไหร่', () => {
  const ticket = newResolvedTicket();
  const before = { by: ticket.status_updated_by, at: ticket.status_updated_at };

  const saved = confirmTicketByRequester({
    ticketId: ticket.id, confirmed: true, by: 'Film', lineUserId: LINE_USER, note: 'ใช้ได้แล้วครับ',
  });

  assert.equal(saved.status, 'completed');
  assert.ok(saved.resolved_at, 'ต้องบันทึกวันปิดงาน');

  const confirmation = readConfirmation(saved);
  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.by, 'Film');
  assert.equal(confirmation.line_user_id, LINE_USER);
  assert.equal(confirmation.note, 'ใช้ได้แล้วครับ');

  // ชื่อผู้แก้ไข (ของทีม IT) ต้องไม่ถูกชื่อผู้แจ้งเขียนทับ ไม่งั้นคอลัมน์ "ผู้แก้ไขล่าสุด"
  // ในหน้าแอดมินจะกลายเป็นชื่อลูกค้า และชื่อลูกค้าจะไหลไปอยู่ในลิสต์ตัวเลือกผู้แก้ไขตลอดไป
  assert.equal(saved.status_updated_by, before.by);
  assert.equal(saved.status_updated_at, before.at);

  const last = readStatusHistory(saved).at(-1);
  assert.equal(last.from, 'resolved');
  assert.equal(last.to, 'completed');
  assert.equal(last.by, 'Film');
  assert.ok(last.id, 'ทุกรายการในประวัติต้องมี id ไว้อ้างอิงตอนอัปเดตผลการส่ง LINE');
});

test('ผู้แจ้งบอกยังไม่หาย -> กลับไปกำลังดำเนินการ ไม่ใช่รอดำเนินการ', () => {
  // ถอยไป pending จะทำให้เรื่องหล่นไปท้ายคิวและหลุดจากสายตาช่างที่ดูแลอยู่
  const ticket = newResolvedTicket();
  const saved = confirmTicketByRequester({ ticketId: ticket.id, confirmed: false, by: 'Film' });

  assert.equal(saved.status, 'in_progress');
  assert.equal(saved.resolved_at, null, 'ยังไม่จบงาน ต้องล้างวันปิดงานทิ้ง');
  assert.equal(readConfirmation(saved).confirmed, false);
});

test('หน้า /completed เห็นเฉพาะเรื่องที่ผู้แจ้งยืนยันแล้วจริงๆ', () => {
  const confirmed = newResolvedTicket();
  const resolvedOnly = newResolvedTicket();
  confirmTicketByRequester({ ticketId: confirmed.id, confirmed: true, by: 'Film' });

  const codes = listCompletedTickets().map((t) => t.ticket_code);
  assert.ok(codes.includes(confirmed.ticket_code));
  assert.ok(!codes.includes(resolvedOnly.ticket_code), 'เรื่องที่ทีม IT กดเสร็จเองต้องไม่นับ');
});

test('อ่านชื่อช่างที่แก้ได้จากประวัติ ไม่ใช่จากคนที่แตะล่าสุด', () => {
  const ticket = newResolvedTicket();
  confirmTicketByRequester({ ticketId: ticket.id, confirmed: true, by: 'Film' });
  const saved = getTicketById(ticket.id);

  assert.equal(readResolvedBy(saved).by, 'ช่างเอ');
  assert.equal(readResolvedBy({ meta: null }), null);
});

test('คำนวณเวลาจากแจ้งถึงยืนยัน และกันข้อมูลเพี้ยน', () => {
  const start = '2026-09-20T01:00:00.000Z';
  assert.equal(confirmationLeadTimeHours(start, '2026-09-20T04:30:00.000Z'), 3.5);
  assert.equal(confirmationLeadTimeHours(start, null), null);
  // เวลาย้อนหลัง = ไฟล์ JSON ถูกแก้ด้วยมือแล้วพลาด ต้องคืน null ไม่ใช่ค่าติดลบที่ดูเหมือนจริง
  assert.equal(confirmationLeadTimeHours(start, '2026-09-19T00:00:00.000Z'), null);

  assert.equal(formatLeadTime(null), '-');
  assert.equal(formatLeadTime(0.5), '30 นาที');
  assert.equal(formatLeadTime(3.5), '3 ชม. 30 นาที');
  assert.equal(formatLeadTime(50), '2 วัน 2 ชม.');
});

/* ─────────────────────────────── การ์ดใน LINE ─────────────────────────────── */

test('การ์ดยืนยันมีปุ่ม postback ครบสองปุ่มและไม่เกินขีดจำกัดของ LINE', () => {
  const ticket = newResolvedTicket();
  const card = buildStatusConfirmFlex(ticket, 'เปลี่ยนสายจอแล้ว', null);

  assert.equal(card.type, 'flex');
  assert.ok(card.altText.length <= 400, 'altText ยาวเกิน 400 ตัวอักษร LINE จะตอบ 400 ทั้งข้อความ');

  const buttons = card.contents.footer.contents;
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].action.data, buildConfirmPostbackData(ticket.ticket_code, true));
  assert.equal(buttons[1].action.data, buildConfirmPostbackData(ticket.ticket_code, false));
  for (const b of buttons) {
    assert.equal(b.action.type, 'postback');
    assert.ok(b.action.label.length <= 20, b.action.label);
    assert.ok(Buffer.byteLength(b.action.data) <= 300, 'postback data ต้องไม่เกิน 300 ไบต์');
  }
});

test('altText ถูกตัดเมื่อหมายเหตุยาวมาก', () => {
  const ticket = newResolvedTicket();
  const card = buildStatusConfirmFlex(ticket, 'x'.repeat(600), null);
  assert.equal(card.altText.length, 400);
  assert.ok(card.altText.endsWith('...'));
});

/* ─────────────────────────────── endpoint ─────────────────────────────── */

test('ไม่มี key ที่ถูกต้อง = 401 ไม่ว่าจะส่งอะไรมา', async () => {
  const ticket = newResolvedTicket();
  const res = await call({ ticket_code: ticket.ticket_code, confirmed: true, line_user_id: LINE_USER }, 'wrong');
  assert.equal(res.status, 401);
  assert.equal(getTicketById(ticket.id).status, 'resolved');
});

test('คนอื่นกดยืนยันแทนไม่ได้ แม้จะรู้เลขที่ตั๋ว', async () => {
  const ticket = newResolvedTicket();
  const res = await call({ ticket_code: ticket.ticket_code, confirmed: true, line_user_id: 'U_someone_else' });

  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, 'not_owner');
  assert.equal(getTicketById(ticket.id).status, 'resolved', 'สถานะต้องไม่ขยับเลย');
});

test('ไม่ส่ง line_user_id มาเลยก็กดไม่ได้', async () => {
  const ticket = newResolvedTicket();
  const res = await call({ ticket_code: ticket.ticket_code, confirmed: true });
  assert.equal(res.status, 403);
});

test('กดจากการ์ดเก่าที่สถานะเดินหน้าไปแล้ว ต้องถูกปฏิเสธพร้อมบอกสถานะล่าสุด', async () => {
  const ticket = newResolvedTicket();
  updateTicketStatus(ticket.id, 'in_progress', 'ช่างเอ');

  const res = await call({ ticket_code: ticket.ticket_code, confirmed: true, line_user_id: LINE_USER });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.reason, 'not_confirmable');
  assert.equal(body.status, 'in_progress');
});

test('ยืนยันผ่าน endpoint แล้วสถานะเปลี่ยนจริง และกดซ้ำไม่พัง', async () => {
  const ticket = newResolvedTicket();

  const first = await call({
    ticket_code: ticket.ticket_code, confirmed: true,
    line_user_id: LINE_USER, display_name: 'Film', note: 'ใช้ได้แล้ว',
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.status, 'completed');
  assert.equal(firstBody.duplicate, false);

  // คนกดซ้ำเพราะไม่แน่ใจว่ากดติดไหม เป็นพฤติกรรมปกติ ห้ามเด้ง error ใส่หน้า
  const again = await call({
    ticket_code: ticket.ticket_code, confirmed: true, line_user_id: LINE_USER, display_name: 'Film',
  });
  assert.equal(again.status, 200);
  const againBody = await again.json();
  assert.equal(againBody.ok, true);
  assert.equal(againBody.duplicate, true);

  // ประวัติต้องมีรายการยืนยันครั้งเดียว ไม่ใช่งอกทุกครั้งที่กด
  const history = readStatusHistory(getTicketById(ticket.id)).filter((e) => e.to === 'completed');
  assert.equal(history.length, 1);
});

test('เรื่องที่ยืนยันไปแล้วแต่กลับมาเสียอีก กดยังไม่หายได้จากการ์ดเดิม', async () => {
  const ticket = newResolvedTicket();
  confirmTicketByRequester({ ticketId: ticket.id, confirmed: true, by: 'Film', lineUserId: LINE_USER });

  const res = await call({ ticket_code: ticket.ticket_code, confirmed: false, line_user_id: LINE_USER });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'in_progress');
});

test('ไม่พบเลขที่ = 404 และ payload ไม่ครบ = 400', async () => {
  assert.equal((await call({ ticket_code: 'ITRQ9999999999', confirmed: true, line_user_id: LINE_USER })).status, 404);
  assert.equal((await call({ confirmed: true, line_user_id: LINE_USER })).status, 400);
  const ticket = newResolvedTicket();
  assert.equal((await call({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER })).status, 400);
});
