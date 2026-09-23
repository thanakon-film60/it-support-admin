// ฟิลด์ "ผู้แก้ไขสถานะ" + การแก้ไขผู้ครอบครอง — รันโค้ดจริงบนคลังข้อมูลชั่วคราว ไม่แตะข้อมูลจริง
//
// ทำไมต้องมีเทสต์ชุดนี้: ทั้งสองฟีเจอร์เขียนทับข้อมูลที่กู้คืนไม่ได้ (ชื่อผู้รับผิดชอบงาน
// และการผูกทรัพย์สินกับคน) อาการเวลาพังคือ "ข้อมูลเงียบๆ กลายเป็นค่าอื่น" ซึ่งไม่มี error ให้เห็น
// และมักรู้ตัวอีกทีตอนที่ของจริงเสียไปแล้วหลายสิบแถว
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'status-editor-'));
process.chdir(tmp);
// ปิดล็อกอิน = requireSession() คืน guest โดยไม่แตะ cookie · ปิดแจ้งเตือน LINE = ไม่มี fetch ออกเน็ต
process.env.AUTH_DISABLED = 'true';
process.env.LINE_NOTIFY_STATUSES = '';

const { listTickets, listStatusEditors, updateTicketStatus, readStatusHistory } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { canNotifyOnLine } = require(path.join(root, 'src/lib/line/notify.ts'));
const { createTicket } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { findOrCreateUserByName } = require(path.join(root, 'src/lib/db/users.ts'));
const { changeTicketStatusAction } = require(path.join(root, 'src/app/actions/tickets.ts'));
const { updateCustodianAction } = require(path.join(root, 'src/app/actions/equipment.ts'));
const { getEquipmentById, listEquipmentSummary } = require(path.join(root, 'src/lib/db/equipment.ts'));
const { listUsers } = require(path.join(root, 'src/lib/db/users.ts'));

after(() => { process.chdir(root); fs.rmSync(tmp, { recursive: true, force: true }); });

const byId = (id) => listTickets().find((t) => t.id === id);
const form = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

test('บันทึกชื่อผู้แก้ไข และไม่ล้างชื่อเดิมทิ้งเมื่อครั้งถัดไปไม่ได้ส่งชื่อมา', () => {
  const target = listTickets()[0];

  updateTicketStatus(target.id, 'in_progress', '  ฟิล์ม (IT)  ');
  const first = byId(target.id);
  assert.equal(first.status, 'in_progress');
  assert.equal(first.status_updated_by, 'ฟิล์ม (IT)'); // ตัดช่องว่างหัวท้ายให้แล้ว
  assert.ok(first.status_updated_at);

  // ไม่ส่งชื่อ = ไม่รู้ว่าใครแก้ ไม่ใช่ "ไม่มีใครแก้" — ของเดิมต้องอยู่ครบ
  updateTicketStatus(target.id, 'resolved');
  const second = byId(target.id);
  assert.equal(second.status, 'resolved');
  assert.equal(second.status_updated_by, 'ฟิล์ม (IT)');
  assert.equal(second.status_updated_at, first.status_updated_at);
  assert.ok(second.resolved_at, 'resolved ต้องบันทึกวันปิดงาน');

  // ช่องว่างล้วนก็ไม่นับเป็นชื่อเช่นกัน
  updateTicketStatus(target.id, 'pending', '   ');
  const third = byId(target.id);
  assert.equal(third.status_updated_by, 'ฟิล์ม (IT)');
  assert.equal(third.resolved_at, null, 'ย้ายกลับสถานะที่ยังไม่จบต้องล้างวันปิดงาน');
});

test('Server Action ปฏิเสธชื่อว่าง/ยาวเกิน โดยไม่แตะสถานะเดิม', async () => {
  const target = listTickets()[1];
  const before = target.status;

  for (const bad of [undefined, '', '   ']) {
    const result = await changeTicketStatusAction(target.id, 'closed', bad);
    assert.equal(result.error, 'กรุณาระบุชื่อผู้แก้ไข');
    assert.equal(byId(target.id).status, before, 'สถานะต้องไม่เปลี่ยนเมื่อถูกปฏิเสธ');
  }

  const tooLong = await changeTicketStatusAction(target.id, 'closed', 'ก'.repeat(61));
  assert.match(tooLong.error ?? '', /ยาวเกินไป/);
  assert.equal(byId(target.id).status, before);

  const ok = await changeTicketStatusAction(target.id, 'closed', 'ต้น');
  assert.equal(ok.success, true);
  assert.equal(byId(target.id).status, 'closed');
  assert.equal(byId(target.id).status_updated_by, 'ต้น');
});

test('รายชื่อผู้แก้ไขไม่ซ้ำ และคนที่เพิ่งแก้ล่าสุดอยู่บนสุด', async () => {
  const [a, b] = listTickets().slice(2, 4);
  await changeTicketStatusAction(a.id, a.status === 'in_progress' ? 'pending' : 'in_progress', 'ฟิล์ม (IT)');
  // รอให้ timestamp ต่างกันจริงก่อนแก้ใบถัดไป — สองใบที่ถูกแก้ในมิลลิวินาทีเดียวกัน
  // ลำดับจะขึ้นกับลำดับของ listTickets ไม่ใช่เวลาที่แก้ (ซึ่งไม่กระทบผู้ใช้จริง
  // เพราะมันเป็นแค่ลำดับตัวเลือกในช่องพิมพ์ชื่อ) แต่ทำให้เทสต์ล้มแบบสุ่มถ้าไม่เว้นระยะ
  await new Promise((r) => setTimeout(r, 5));
  await changeTicketStatusAction(b.id, b.status === 'in_progress' ? 'pending' : 'in_progress', 'FILM (IT)'); // สะกดคนละแบบ

  const editors = listStatusEditors();
  const lowered = editors.map((e) => e.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, 'ต้องไม่มีชื่อซ้ำแบบไม่สนตัวพิมพ์');
  assert.equal(editors[0], 'FILM (IT)', 'คนที่เพิ่งแก้ล่าสุดต้องมาก่อน');
  assert.ok(editors.includes('ต้น'));
});

test('เปลี่ยนผู้ครอบครอง: คนใหม่ได้วันเริ่มถือครองใหม่ ส่วนคนเดิมต้องไม่ถูกรีเซ็ต', async () => {
  const asset = listEquipmentSummary().find((e) => e.current_holder_id);
  const originalSince = asset.current_holder_since;

  // คนเดิม แต่มาเติมแผนก -> ห้ามเกิด user ใหม่ และห้ามรีเซ็ตวันที่รับเครื่อง
  const usersBefore = listUsers().length;
  const same = await updateCustodianAction(asset.id, {}, form({
    owner_name: asset.owner_name,
    owner_employee_id: 'E9999',
    owner_department: 'แผนกใหม่',
    holder_since: '',
    status: asset.status,
  }));
  assert.equal(same.success, true);
  assert.equal(listUsers().length, usersBefore, 'แก้โปรไฟล์คนเดิมต้องไม่สร้างคนซ้ำ');
  const afterSame = getEquipmentById(asset.id);
  assert.equal(afterSame.current_holder_id, asset.current_holder_id);
  assert.equal(afterSame.current_holder_since, originalSince, 'คนเดิมต้องคงวันรับเครื่องเดิม');
  const owner = listUsers().find((u) => u.id === asset.current_holder_id);
  assert.equal(owner.employee_id, 'E9999');
  assert.equal(owner.department, 'แผนกใหม่');

  // เปลี่ยนเป็นคนใหม่ -> เริ่มนับวันใหม่
  const moved = await updateCustodianAction(asset.id, {}, form({
    owner_name: 'ผู้ถือครองคนใหม่',
    owner_employee_id: 'E1234',
    owner_department: 'IT',
    holder_since: '',
    status: 'ใช้งานอยู่',
  }));
  assert.equal(moved.success, true);
  const afterMove = getEquipmentById(asset.id);
  assert.notEqual(afterMove.current_holder_id, asset.current_holder_id);
  assert.notEqual(afterMove.current_holder_since, originalSince);
  assert.equal(listUsers().length, usersBefore + 1, 'คนใหม่จริงๆ ต้องถูกสร้าง');
});

test('ระบุวันที่เริ่มถือครองเองได้ตามเวลาไทย และวันในอนาคตถูกปฏิเสธ', async () => {
  const asset = listEquipmentSummary().find((e) => e.current_holder_id);

  const dated = await updateCustodianAction(asset.id, {}, form({
    owner_name: asset.owner_name,
    owner_department: asset.owner_department ?? '',
    holder_since: '2026-01-15',
    status: asset.status,
  }));
  assert.equal(dated.success, true);
  // 15 ม.ค. 2026 เวลา 00:00 ไทย = 14 ม.ค. 17:00 UTC — ถ้าแปลงด้วยเวลาเครื่อง (คอนเทนเนอร์เป็น UTC)
  // ค่าจะกลายเป็น 15 ม.ค. 00:00 UTC ซึ่งคือ 07:00 ตามเวลาไทย คนละเวลากับที่แอดมินเลือก
  assert.equal(getEquipmentById(asset.id).current_holder_since, '2026-01-14T17:00:00.000Z');

  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const rejected = await updateCustodianAction(asset.id, {}, form({
    owner_name: asset.owner_name,
    holder_since: future,
    status: asset.status,
  }));
  assert.match(rejected.error ?? '', /อนาคต/);
  assert.equal(getEquipmentById(asset.id).current_holder_since, '2026-01-14T17:00:00.000Z');
});

test('คืนเครื่อง: ปลดผู้ครอบครองแต่ยังเก็บทรัพย์สินไว้ในระบบ', async () => {
  const asset = listEquipmentSummary().find((e) => e.current_holder_id);
  const result = await updateCustodianAction(asset.id, {}, form({
    release: 'on',
    owner_name: '',
    status: 'ว่าง',
  }));
  assert.equal(result.success, true);

  const after = getEquipmentById(asset.id);
  assert.equal(after.current_holder_id, null);
  assert.equal(after.current_holder_since, null);
  assert.equal(after.status, 'ว่าง');
  assert.ok(after.asset_code, 'ทรัพย์สินต้องยังอยู่ ไม่ใช่ถูกลบทิ้ง');

  // ไม่ติ๊กคืนเครื่องแล้วไม่กรอกชื่อ = ปฏิเสธ ไม่ใช่ปลดผู้ครอบครองให้เงียบๆ
  const blank = await updateCustodianAction(asset.id, {}, form({ owner_name: '  ', status: 'ว่าง' }));
  assert.match(blank.error ?? '', /ชื่อผู้ครอบครอง/);
});

/* ---------------------------------------------------------------- หมายเหตุถึงผู้แจ้ง + แจ้ง LINE */

test('บันทึกหมายเหตุลงประวัติทุกครั้ง แม้ครั้งที่ไม่ได้ส่ง LINE', async () => {
  const target = listTickets()[5];

  const first = await changeTicketStatusAction(target.id, 'in_progress', 'ฟิล์ม', {
    note: 'รับเรื่องแล้ว กำลังหาอะไหล่',
  });
  assert.equal(first.success, true);
  assert.equal(first.notify, 'not_requested', 'ไม่ได้ติ๊กแจ้ง = ต้องไม่ยิง LINE');

  const history = readStatusHistory(byId(target.id));
  assert.equal(history.length, 1);
  assert.equal(history[0].from, target.status);
  assert.equal(history[0].to, 'in_progress');
  assert.equal(history[0].by, 'ฟิล์ม');
  assert.equal(history[0].note, 'รับเรื่องแล้ว กำลังหาอะไรที่ไม่ตรง'.slice(0, 0) + 'รับเรื่องแล้ว กำลังหาอะไหล่');
  assert.equal(history[0].notified, null, 'ไม่ได้เลือกให้ส่ง = null ไม่ใช่ false');

  // ครั้งที่สองต้องต่อท้าย ไม่ใช่ทับของเดิม — ประวัติที่หายไปคือข้อมูลที่กู้ไม่ได้
  await changeTicketStatusAction(target.id, 'resolved', 'ต้น', { note: 'เปลี่ยนอะไหล่เรียบร้อย' });
  const after = readStatusHistory(byId(target.id));
  assert.equal(after.length, 2);
  assert.equal(after[1].by, 'ต้น');
  assert.equal(after[1].from, 'in_progress');
});

test('ติ๊กแจ้ง LINE แต่ผู้แจ้งไม่มี LINE ผูกไว้ -> บอกเหตุผล ไม่เงียบ', async () => {
  // สร้างเคส "แอดมินคีย์เอง" ขึ้นมาเองแทนการไปหาในชุด seed
  // (ผู้ใช้ทุกคนใน seed มี line_user_id ครบ ถ้าไล่หาจะได้ null แล้วเทสต์จะข้ามไปเงียบๆ)
  const walkIn = findOrCreateUserByName({ display_name: 'พนักงานเดินมาแจ้งเอง' });
  assert.equal(walkIn.line_user_id, null);

  const ticket = createTicket({
    type: 'repair',
    status: 'pending',
    company: 'central',
    location: 'สำนักงานใหญ่',
    requester_id: walkIn.id,
    equipment_id: null,
    description: 'แอดมินคีย์แทนให้',
    repair_cost: null,
    meta: null,
  });
  assert.equal(canNotifyOnLine(ticket), false);

  const result = await changeTicketStatusAction(ticket.id, 'closed', 'ฟิล์ม', {
    note: 'ปิดงาน',
    notifyLine: true,
  });
  assert.equal(result.success, true, 'ส่งไม่ได้ต้องไม่ทำให้บันทึกสถานะล้มเหลว');
  assert.equal(result.notify, 'skipped_no_line_user');

  const history = readStatusHistory(byId(ticket.id));
  assert.equal(history[history.length - 1].notified, false, 'ต้องบันทึกว่าแจ้งไม่สำเร็จ');
  assert.equal(history[history.length - 1].note, 'ปิดงาน');
  assert.equal(byId(ticket.id).status, 'closed');
});

test('หมายเหตุยาวเกิน 500 ตัวอักษรถูกปฏิเสธ โดยไม่แตะสถานะ', async () => {
  const target = listTickets()[7];
  const before = target.status;
  const result = await changeTicketStatusAction(target.id, 'cancelled', 'ฟิล์ม', {
    note: 'ก'.repeat(501),
  });
  assert.match(result.error ?? '', /ยาวเกินไป/);
  assert.equal(byId(target.id).status, before);
});

test('canNotifyOnLine อ่านจาก meta ก่อน แล้วค่อยดูที่ผู้แจ้ง', () => {
  const withMeta = { ...listTickets()[0], meta: { line_user_id: 'U_direct' }, requester_id: 'ไม่มีจริง' };
  assert.equal(canNotifyOnLine(withMeta), true);

  const none = { ...listTickets()[0], meta: null, requester_id: 'ไม่มีจริง' };
  assert.equal(canNotifyOnLine(none), false);
});

test('ปฏิเสธสถานะปลอมและการบันทึกที่ไม่มีการแก้ไข', async () => {
  const ticket = listTickets()[0];
  const before = JSON.stringify(ticket);
  assert.ok((await changeTicketStatusAction(ticket.id, 'invalid', 'IT')).error);
  assert.ok((await changeTicketStatusAction(ticket.id, ticket.status, 'IT')).error);
  assert.equal(JSON.stringify(byId(ticket.id)), before);
});

test('เพิ่มหมายเหตุหลังแก้ไขเสร็จได้ และเก็บวันเสร็จงานเดิม', async () => {
  const ticket = listTickets()[0];
  updateTicketStatus(ticket.id, 'resolved', 'IT');
  const before = byId(ticket.id);
  const saved = await changeTicketStatusAction(ticket.id, 'resolved', 'IT', {
    note: 'ทดสอบร่วมกับผู้แจ้งแล้ว', expectedUpdatedAt: before.status_updated_at,
  });
  assert.equal(saved.success, true);
  assert.equal(saved.ticket.resolved_at, before.resolved_at);
  assert.equal(readStatusHistory(saved.ticket).at(-1).note, 'ทดสอบร่วมกับผู้แจ้งแล้ว');
});

test('หน้าต่างเก่าต้องไม่เขียนทับสถานะที่ผู้อื่นบันทึกไปแล้ว', async () => {
  const ticket = listTickets()[0];
  const before = JSON.stringify(ticket);
  const saved = await changeTicketStatusAction(ticket.id, 'closed', 'IT', { expectedUpdatedAt: null });
  assert.match(saved.error, /อัปเดตแล้ว/);
  assert.equal(JSON.stringify(byId(ticket.id)), before);
});

test('adding a note to an open ticket does not set its resolution date', async () => {
  const ticket = listTickets()[0];
  updateTicketStatus(ticket.id, 'in_progress', 'IT');
  const saved = await changeTicketStatusAction(ticket.id, 'in_progress', 'IT', { note: 'Still investigating' });
  assert.equal(saved.success, true);
  assert.equal(saved.ticket.resolved_at, null);
});

test('LINE ส่งข้อความตรงกับตัวอย่างถึงผู้แจ้ง และไม่รายงานสำเร็จเมื่อ API ปฏิเสธ', async () => {
  const { buildTicketStatusMessage } = require(path.join(root, 'src/lib/line/status-message.ts'));
  const originalFetch = global.fetch;
  const originalToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
  const ticket = createTicket({
    type: 'it_service', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'test', repair_cost: null,
    meta: { line_user_id: 'U_test_requester' },
  });
  const requests = [];
  try {
    global.fetch = async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    };
    const note = 'เปลี่ยนสายเรียบร้อยแล้ว';
    const sent = await changeTicketStatusAction(ticket.id, 'resolved', 'IT', { note, notifyLine: true });
    assert.equal(sent.notify, 'sent');
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/message\/push$/);
    assert.equal(requests[0].body.to, 'U_test_requester');
    // สถานะ resolved ส่งเป็นการ์ด Flex ที่มีปุ่มยืนยันในตัว ไม่ใช่ข้อความเปล่า
    // และต้องเป็น "ข้อความเดียว" เท่านั้น เพราะ push แพ็กเกจฟรีมีโควตา 300 ข้อความ/เดือน
    const [card] = requests[0].body.messages;
    assert.equal(card.type, 'flex');
    assert.equal(card.altText, buildTicketStatusMessage(sent.ticket, note));
    const buttons = card.contents.footer.contents;
    assert.equal(buttons[0].action.data, `a=confirm&code=${sent.ticket.ticket_code}&v=1`);
    assert.equal(buttons[1].action.data, `a=confirm&code=${sent.ticket.ticket_code}&v=0`);
    // label ของ action ยาวเกิน 20 ตัวอักษรเมื่อไหร่ LINE ตอบ 400 ทั้งข้อความ ไม่ใช่แค่ตัดคำ
    for (const b of buttons) assert.ok(b.action.label.length <= 20, b.action.label);
    assert.equal(readStatusHistory(sent.ticket).at(-1).notified, true);

    for (const status of [401, 429, 500]) {
      global.fetch = async () => new Response('{}', { status });
      const failed = await changeTicketStatusAction(ticket.id, 'resolved', 'IT', { note: 'เพิ่มเติม', notifyLine: true });
      assert.equal(failed.success, true);
      assert.equal(failed.notify, 'failed');
      assert.equal(readStatusHistory(failed.ticket).at(-1).notified, false);
    }

    global.fetch = async () => { throw new Error('network failure'); };
    assert.equal((await changeTicketStatusAction(ticket.id, 'resolved', 'IT', { note, notifyLine: true })).notify, 'failed');
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    assert.equal((await changeTicketStatusAction(ticket.id, 'resolved', 'IT', { note, notifyLine: true })).notify, 'skipped_no_token');
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = originalToken;
  }
});

test('ผลส่ง LINE ต้องติดกับประวัติครั้งที่ส่ง แม้มีการแก้ไขระหว่างรอ LINE', async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
  const ticket = createTicket({
    type: 'it_service', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'test', repair_cost: null,
    meta: { line_user_id: 'U_test_requester' },
  });
  try {
    global.fetch = async () => {
      updateTicketStatus(ticket.id, 'closed', 'other', { note: 'another edit' });
      return new Response('{}', { status: 200 });
    };
    const saved = await changeTicketStatusAction(ticket.id, 'resolved', 'IT', { notifyLine: true });
    const history = readStatusHistory(saved.ticket);
    assert.equal(history[0].notified, true);
    assert.equal(history[1].notified, null);
    assert.equal(saved.ticket.status, 'closed');
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = originalToken;
  }
});
