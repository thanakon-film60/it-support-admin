// ปุ่มผลการแก้ไขในไลน์ — "ยังมีปัญหาอยู่" (เปิดเรื่องกลับ) และ "เรียบร้อยแล้ว" ของการ์ดรุ่นเก่าที่ยังค้างในห้องแชท
//
// ทำไมต้องมีเทสต์ชุดนี้: endpoint นี้รับแค่ ticket_code ที่เดารูปแบบได้ (ITRQ2026090158)
// ถ้าด่านเช็คเจ้าของหลุด ใครที่แอด OA ก็ปิด/เปิดงานของทั้งบริษัทได้ทีละใบโดยไม่มีใครรู้
// และการเปิดเรื่องกลับต้องไปถึงทีม IT เสมอ — ไม่งั้นเรื่องที่ปิดแล้วจะเงียบหายทั้งที่ผู้แจ้งยังรออยู่
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
// after() ของจริงทำงานได้เฉพาะใน request ของ Next — ในเทสต์เก็บงานไว้แล้วให้เทสต์รอเองได้
const afterTasks = [];
Module._load = function (id, parent, isMain) {
  if (id === 'next/server') return { after: (fn) => { afterTasks.push(Promise.resolve().then(fn)); } };
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
  createTicket, getTicketById, updateTicketStatus, readStatusHistory, confirmTicketByRequester,
} = require(path.join(root, 'src/lib/db/tickets.ts'));
const { readConfirmation, readResolvedBy, confirmationLeadTimeHours, formatLeadTime } =
  require(path.join(root, 'src/lib/ticket-confirmation.ts'));
const { buildConfirmPostbackData } = require(path.join(root, 'src/lib/line/confirm-card.ts'));
const { POST: confirmRoute } = require(path.join(root, 'src/app/api/internal/tickets/confirm/route.ts'));

after(() => { process.chdir(root); fs.rmSync(tmp, { recursive: true, force: true }); });

const LINE_USER = 'U_requester_001';

/** เรื่องที่ทีม IT ปิดงานแล้ว (แก้ไขแล้ว — สถานะสุดท้ายของระบบ 2 สถานะ) */
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

test('กด "เรียบร้อยแล้ว" จากการ์ดรุ่นเก่า กับเรื่องที่แก้ไขแล้ว = ไม่แตะอะไรเลย (ไม่มีขั้นรอยืนยันแล้ว)', () => {
  // การ์ดยืนยันที่ส่งไปก่อน ต.ค. 2026 ยังค้างในห้องแชท — ถ้ากดแล้วเขียนประวัติ/ชื่อทับ
  // ชื่อลูกค้าจะไปโผล่เป็นผู้แก้ไขล่าสุด และไหลเข้าลิสต์ตัวเลือกผู้แก้ไขตลอดไป
  const ticket = newResolvedTicket();
  const saved = confirmTicketByRequester({
    ticketId: ticket.id, confirmed: true, by: 'Film', lineUserId: LINE_USER, note: 'ใช้ได้แล้วครับ',
  });
  assert.equal(saved.status, 'resolved');
  assert.equal(saved.status_updated_by, ticket.status_updated_by);
  assert.equal(saved.status_updated_at, ticket.status_updated_at);
  assert.equal(readStatusHistory(saved).length, readStatusHistory(ticket).length, 'ต้องไม่งอกรายการในประวัติ');
});

test('ผู้แจ้งบอกยังไม่หาย -> กลับเป็นรอดำเนินการ ล้างวันปิดงาน และบันทึกว่าใครกด', () => {
  const ticket = newResolvedTicket();
  const before = { by: ticket.status_updated_by, at: ticket.status_updated_at };
  const saved = confirmTicketByRequester({ ticketId: ticket.id, confirmed: false, by: 'Film', lineUserId: LINE_USER });

  assert.equal(saved.status, 'pending');
  assert.equal(saved.resolved_at, null, 'ยังไม่จบงาน ต้องล้างวันปิดงานทิ้ง');
  const confirmation = readConfirmation(saved);
  assert.equal(confirmation.confirmed, false);
  assert.equal(confirmation.by, 'Film');
  assert.equal(confirmation.line_user_id, LINE_USER);
  // ชื่อผู้แก้ไข (ของทีม IT) ต้องไม่ถูกชื่อผู้แจ้งเขียนทับ
  assert.equal(saved.status_updated_by, before.by);
  assert.equal(saved.status_updated_at, before.at);

  const last = readStatusHistory(saved).at(-1);
  assert.equal(last.from, 'resolved');
  assert.equal(last.to, 'pending');
  assert.equal(last.by, 'Film');
  assert.equal(last.role, 'requester');
  assert.ok(last.id, 'ทุกรายการในประวัติต้องมี id ไว้อ้างอิงตอนอัปเดตผลการส่ง LINE');
});

test('เรื่องที่ยังไม่ปิด กดปุ่มบนการ์ดไม่มีผล', () => {
  const ticket = createTicket({
    type: 'repair', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'ยังไม่ปิด', repair_cost: null,
    meta: { line_user_id: LINE_USER },
  });
  assert.equal(confirmTicketByRequester({ ticketId: ticket.id, confirmed: false, by: 'Film' }), null);
  assert.equal(getTicketById(ticket.id).status, 'pending');
});

test('อ่านชื่อช่างที่ปิดงานได้จากประวัติ — ไม่ใช่ชื่อผู้แจ้งที่กดเปิดกลับ และไม่ใช่ "ระบบ"', () => {
  const ticket = newResolvedTicket();
  assert.equal(readResolvedBy(ticket).by, 'ช่างเอ');

  confirmTicketByRequester({ ticketId: ticket.id, confirmed: false, by: 'Film' });
  updateTicketStatus(ticket.id, 'resolved', 'ช่างบี', { note: 'แก้รอบสอง' });
  assert.equal(readResolvedBy(getTicketById(ticket.id)).by, 'ช่างบี', 'ต้องเป็นคนปิดรอบล่าสุด');

  // รายการที่ระบบแปลงสถานะเดิมให้ (role system) ต้องไม่ถูกนับเป็นคนแก้งาน
  const migrated = { meta: { status_history: [
    { id: '1', from: 'in_progress', to: 'completed', by: 'ช่างซี', at: '2026-10-01T00:00:00.000Z', note: '', notified: null, role: 'admin' },
    { id: '2', from: 'completed', to: 'resolved', by: 'ระบบ (ปรับเหลือ 2 สถานะ)', at: '2026-10-21T00:00:00.000Z', note: '', notified: null, role: 'system' },
  ] } };
  assert.equal(readResolvedBy(migrated).by, 'ช่างซี');
  assert.equal(readResolvedBy({ meta: null }), null);
});

test('คำนวณเวลาจากแจ้งถึงปิดงาน และกันข้อมูลเพี้ยน', () => {
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

/* ─────────────────────────────── ข้อมูลของปุ่มในการ์ด ─────────────────────────────── */

test('รูปแบบข้อมูลของปุ่ม a=confirm ต้องคงเดิมตลอดไป (การ์ดที่ส่งไปแล้วยังค้างในห้องแชท)', () => {
  assert.equal(buildConfirmPostbackData('ITSR2026100001', false), 'a=confirm&code=ITSR2026100001&v=0');
  assert.equal(buildConfirmPostbackData('ITSR2026100001', true), 'a=confirm&code=ITSR2026100001&v=1');
  assert.ok(Buffer.byteLength(buildConfirmPostbackData('ITSR2026100001', false)) <= 300, 'postback data ต้องไม่เกิน 300 ไบต์');
});

/* ─────────────────────────────── endpoint ─────────────────────────────── */

test('ไม่มี key ที่ถูกต้อง = 401 ไม่ว่าจะส่งอะไรมา', async () => {
  const ticket = newResolvedTicket();
  const res = await call({ ticket_code: ticket.ticket_code, confirmed: false, line_user_id: LINE_USER }, 'wrong');
  assert.equal(res.status, 401);
  assert.equal(getTicketById(ticket.id).status, 'resolved');
});

test('คนอื่นกดแทนไม่ได้ แม้จะรู้เลขที่ตั๋ว', async () => {
  const ticket = newResolvedTicket();
  const res = await call({ ticket_code: ticket.ticket_code, action: 'reject', line_user_id: 'U_someone_else' });

  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, 'not_owner');
  assert.equal(getTicketById(ticket.id).status, 'resolved', 'สถานะต้องไม่ขยับเลย');
});

test('ไม่ส่ง line_user_id มาเลยก็กดไม่ได้', async () => {
  const ticket = newResolvedTicket();
  const res = await call({ ticket_code: ticket.ticket_code, action: 'reject' });
  assert.equal(res.status, 403);
});

test('กดจากการ์ดเก่าหลังทีม IT เปิดเรื่องกลับไปแล้ว ต้องถูกปฏิเสธพร้อมบอกสถานะล่าสุด', async () => {
  const ticket = newResolvedTicket();
  updateTicketStatus(ticket.id, 'pending', 'ช่างเอ');

  const res = await call({ ticket_code: ticket.ticket_code, confirmed: true, line_user_id: LINE_USER });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.reason, 'not_confirmable');
  assert.equal(body.status, 'pending');
});

test('เรื่องที่ยกเลิกแล้ว กด "ยังมีปัญหาอยู่" จากการ์ดเก่าไม่ได้ — ต้องแจ้งเรื่องใหม่', async () => {
  // ยกเลิกคือเรื่องที่ไม่ได้ทำ (แจ้งซ้ำ/แจ้งผิด) ไม่ใช่งานที่แก้แล้วไม่หาย — เปิดกลับได้เมื่อไหร่
  // การ์ดดาวใบเก่าของรอบก่อนยกเลิกจะดึงเรื่องซ้ำกลับมาค้างในคิวทีม IT
  const ticket = newResolvedTicket();
  updateTicketStatus(ticket.id, 'cancelled', 'ช่างเอ', { note: 'แจ้งซ้ำ' });
  const res = await call({ ticket_code: ticket.ticket_code, action: 'reject', line_user_id: LINE_USER });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'not_resolved');
  assert.equal(body.status, 'cancelled');
  assert.equal(getTicketById(ticket.id).status, 'cancelled');
  assert.equal(afterTasks.length, 0, 'ไม่ได้เปิดเรื่อง = ต้องไม่แจ้งทีม');
});

test('กด "เรียบร้อยแล้ว" ผ่าน endpoint ได้ duplicate ทุกครั้ง และไม่พัง', async () => {
  const ticket = newResolvedTicket();
  for (let i = 0; i < 2; i++) {
    // คนกดซ้ำเพราะไม่แน่ใจว่ากดติดไหม เป็นพฤติกรรมปกติ ห้ามเด้ง error ใส่หน้า
    const res = await call({ ticket_code: ticket.ticket_code, confirmed: true, line_user_id: LINE_USER, display_name: 'Film' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, true);
    assert.equal(body.status, 'resolved');
  }
  assert.equal(readStatusHistory(getTicketById(ticket.id)).length, 1, 'ประวัติต้องมีแค่รายการปิดงานของช่าง');
});

test('การ์ดยืนยันรุ่นเก่า: กด "เรียบร้อยแล้ว" ไปก่อนแล้วกลับมาเสียอีก ยังกด "ยังไม่หาย" ได้จากการ์ดเดิม', async () => {
  const ticket = newResolvedTicket();
  await call({ ticket_code: ticket.ticket_code, confirmed: true, line_user_id: LINE_USER });

  const res = await call({ ticket_code: ticket.ticket_code, confirmed: false, line_user_id: LINE_USER });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'pending');
  await Promise.all(afterTasks.splice(0));
});

/* ─────────────────────────────── ทีม IT ปิดงานเอง → ผู้แจ้งกด "ยังมีปัญหาอยู่" ─────────────────────────────── */

function newCompletedTicket() {
  const ticket = createTicket({
    type: 'it_service', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'เน็ตหลุด', repair_cost: null,
    meta: { line_user_id: LINE_USER },
  });
  updateTicketStatus(ticket.id, 'resolved', 'ช่างบี', { note: 'รีสตาร์ทเราเตอร์แล้ว' });
  return getTicketById(ticket.id);
}

/** แทน fetch ชั่วคราว แล้วคืนของเดิมเสมอ — เทสต์อื่นในไฟล์ต้องไม่ได้ fetch ปลอมติดไปด้วย */
async function withLineMock(run) {
  const original = { fetch: global.fetch, token: process.env.LINE_CHANNEL_ACCESS_TOKEN, admins: process.env.LINE_ADMIN_USER_IDS };
  const pushes = [];
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
  process.env.LINE_ADMIN_USER_IDS = 'U_admin_1, U_admin_2';
  global.fetch = async (url, init) => {
    pushes.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  try {
    await run(pushes);
  } finally {
    global.fetch = original.fetch;
    for (const [key, value] of [['LINE_CHANNEL_ACCESS_TOKEN', original.token], ['LINE_ADMIN_USER_IDS', original.admins]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('กด "ยังมีปัญหาอยู่" หลังทีม IT ปิดงาน -> กลับเป็นรอดำเนินการ และทีม IT ได้แจ้งเตือนทันที', async () => {
  const ticket = newCompletedTicket();
  await withLineMock(async (pushes) => {
    const res = await call({ ticket_code: ticket.ticket_code, action: 'reject', line_user_id: LINE_USER, viewer_name: 'Film' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'pending');
    // แจ้งทีมหลังตอบบอทแล้ว (after) — ตอนตอบ request ต้องยังไม่ได้รอ LINE
    await Promise.all(afterTasks.splice(0));

    assert.deepEqual(pushes.map((p) => p.body.to).sort(), ['U_admin_1', 'U_admin_2']);
    const text = pushes[0].body.messages[0].text;
    assert.match(text, /ยังมีปัญหา/);
    assert.ok(text.includes(ticket.ticket_code));
    assert.ok(text.includes('ช่างบี'), 'ต้องบอกว่าใครปิดงานรอบก่อน ทีมจะได้ส่งเรื่องกลับคนเดิม');
  });

  const saved = getTicketById(ticket.id);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.resolved_at, null);
  assert.equal(readConfirmation(saved).confirmed, false);
});

test('แจ้งทีม IT ไม่สำเร็จต้องไม่ทำให้การเปิดเรื่องกลับล้ม', async () => {
  const ticket = newCompletedTicket();
  const original = { fetch: global.fetch, token: process.env.LINE_CHANNEL_ACCESS_TOKEN, admins: process.env.LINE_ADMIN_USER_IDS };
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
  process.env.LINE_ADMIN_USER_IDS = 'U_admin_1';
  global.fetch = async () => { throw new Error('LINE ล่ม'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await call({ ticket_code: ticket.ticket_code, action: 'reject', line_user_id: LINE_USER });
    assert.equal((await res.json()).status, 'pending');
    await Promise.all(afterTasks.splice(0)); // ต้องไม่ throw ออกมา
  } finally {
    console.error = originalError;
    global.fetch = original.fetch;
    for (const [key, value] of [['LINE_CHANNEL_ACCESS_TOKEN', original.token], ['LINE_ADMIN_USER_IDS', original.admins]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(getTicketById(ticket.id).status, 'pending');
});

test('ปิดงานไปเกินกำหนดแล้ว กดยังมีปัญหาไม่ได้ ต้องให้แจ้งเรื่องใหม่', async () => {
  const { REOPEN_WINDOW_DAYS } = require(path.join(root, 'src/lib/ticket-feedback.ts'));
  const { patchOne } = require(path.join(root, 'src/lib/db/store.ts'));
  const ticket = newCompletedTicket();
  const longAgo = new Date(Date.now() - (REOPEN_WINDOW_DAYS + 1) * 86400000).toISOString();
  patchOne('tickets', ticket.id, { meta: { ...ticket.meta, completed_at: longAgo } });

  const res = await call({ ticket_code: ticket.ticket_code, action: 'reject', line_user_id: LINE_USER });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'reopen_expired');
  assert.equal(body.reopen_days, REOPEN_WINDOW_DAYS);
  assert.equal(getTicketById(ticket.id).status, 'resolved', 'เรื่องเก่าต้องไม่ถูกดึงกลับมาเปิด');
  assert.equal(afterTasks.length, 0, 'ไม่ได้เปิดเรื่อง = ต้องไม่แจ้งทีม');
});

test('เปิดเรื่องกลับแล้วคะแนนของรอบที่ล้มเหลวต้องหายจากเรื่อง (แต่ยังอยู่ในไทม์ไลน์)', async () => {
  const { rateTicketByRequester } = require(path.join(root, 'src/lib/db/tickets.ts'));
  const { listEventsForTicket } = require(path.join(root, 'src/lib/db/ticketEvents.ts'));
  const { readRating } = require(path.join(root, 'src/lib/ticket-feedback.ts'));
  const ticket = newCompletedTicket();
  rateTicketByRequester({ ticketId: ticket.id, score: 5, by: 'Film', lineUserId: LINE_USER });
  assert.equal(readRating(getTicketById(ticket.id)).score, 5);

  await withLineMock(async () => {
    await call({ ticket_code: ticket.ticket_code, action: 'reject', line_user_id: LINE_USER });
    await Promise.all(afterTasks.splice(0));
  });

  assert.equal(readRating(getTicketById(ticket.id)), null, 'คะแนน 5 ดาวของงานที่ยังไม่หายต้องไม่ติดไปกับการปิดรอบใหม่');
  assert.ok(listEventsForTicket(ticket.id).some((e) => e.type === 'rated'), 'ประวัติการให้คะแนนต้องยังอยู่');
});

test('ไม่พบเลขที่ = 404 และ payload ไม่ครบ = 400', async () => {
  assert.equal((await call({ ticket_code: 'ITRQ9999999999', confirmed: true, line_user_id: LINE_USER })).status, 404);
  assert.equal((await call({ confirmed: true, line_user_id: LINE_USER })).status, 400);
  const ticket = newResolvedTicket();
  assert.equal((await call({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER })).status, 400);
});
