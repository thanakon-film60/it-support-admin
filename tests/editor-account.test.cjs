// ชื่อผู้แก้ไข = บัญชีที่ล็อกอินอยู่ (13 ต.ค. 2026) — ผู้ใช้ขอให้เอาชื่อ user ที่ login มาใส่แทนการพิมพ์ชื่อเอง
//
// ทำไมต้องมีเทสต์ชุดนี้: ชื่อในประวัติสถานะคือหลักฐานว่า "ใครแตะเรื่องนี้" ถ้า Server Action ยังเชื่อชื่อที่หน้าเว็บ
// ส่งมา ใครก็บันทึกในนามคนอื่นได้ (action ถูกเรียกตรงได้โดยไม่ผ่านหน้าเว็บ) และถ้าหน้าต่างอัปเดตสถานะกลับไปโชว์
// ช่องให้พิมพ์ ผู้ใช้จะพิมพ์ชื่อหนึ่งแต่ประวัติขึ้นอีกชื่อ — ทั้งสองอย่างไม่มี error ให้เห็นเลย
// รันโค้ดจริง (JWT จริง · ไฟล์จริงในโฟลเดอร์ชั่วคราว · เรนเดอร์หน้าต่างจริงด้วย react-dom/server) ไม่แตะ data/ ของเครื่องจริง
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

// cookie ของเบราว์เซอร์จำลอง — loginAs() เขียน token ลงไป, getSession() อ่าน (เหมือน cookies() ของ Next)
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-account-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'false';
process.env.SESSION_SECRET = 'test-session-secret-for-editor-account';
process.env.LINE_NOTIFY_STATUSES = '';
process.env.INTERNAL_API_KEY = 'test-internal-key';

// บัญชีทดสอบ — รหัสผ่านไม่ได้ใช้ (เข้าระบบด้วยการเซ็น cookie ตรงๆ แบบเดียวกับที่ signIn ทำ)
const NOW = new Date().toISOString();
const account = (over) => ({ password_hash: 'unused', role: 'admin', created_at: NOW, ...over });
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'data', 'staff_accounts.json'), JSON.stringify([
  account({ id: 'id-film', username: 'film', display_name: 'ธนากร (ฟิล์ม)' }),
  account({ id: 'id-helpdesk', username: 'helpdesk', display_name: '   ' }),
  account({ id: 'id-long', username: 'long', display_name: 'ก'.repeat(80) }),
]));

const { SignJWT } = require('jose');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { listTickets, readStatusHistory, createTicket } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { listEventsForTicket } = require(path.join(root, 'src/lib/db/ticketEvents.ts'));
const { changeTicketStatusAction } = require(path.join(root, 'src/app/actions/tickets.ts'));
const { setChatTakeoverAction } = require(path.join(root, 'src/app/actions/chat.ts'));
const { accountEditorName, MAX_EDITOR_NAME } = require(path.join(root, 'src/lib/editor-name.ts'));
const { CurrentEditorProvider } = require(path.join(root, 'src/components/auth/CurrentEditor.tsx'));
const { TicketStatusModal } = require(path.join(root, 'src/components/tickets/TicketStatusModal.tsx'));

const BOT = 'http://bot.test:8000';
const LINE_USER = 'U_requester_editor';
const originalFetch = global.fetch;

beforeEach(() => {
  jar.clear();
  process.env.LINE_BOT_INTERNAL_URL = `${BOT}/`;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
  // บอทรับคำสั่งหยุดตอบ · LINE push ส่งถึง — ไม่มีอะไรออกเน็ตจริง
  global.fetch = async (url) => (String(url).startsWith(BOT)
    ? new Response(JSON.stringify({ ok: true, active: true, until: 1_800_000_000, chat_mode: 'chat' }), { status: 200 })
    : new Response('{}', { status: 200 }));
});

after(() => {
  global.fetch = originalFetch;
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function loginAs(staffId) {
  const token = await new SignJWT({ staffId, sv: 0 }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  jar.set('itadmin_session', token);
}

const byId = (id) => listTickets().find((t) => t.id === id);
const history = (id) => readStatusHistory(byId(id));
const lastBy = (id) => history(id).at(-1).by;

function lineTicket() {
  return createTicket({
    type: 'it_service', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'อีเมลส่งไม่ออก', repair_cost: null,
    meta: { line_user_id: LINE_USER },
  });
}

/* ─────────────────────────────── Server Action ─────────────────────────────── */

test('ล็อกอินอยู่: บันทึกสถานะในนามบัญชีที่ล็อกอิน โดยไม่ต้องส่งชื่อมา', async () => {
  await loginAs('id-film');
  const target = listTickets()[0];
  const next = target.status === 'resolved' ? 'pending' : 'resolved';
  const saved = await changeTicketStatusAction(target.id, next);
  assert.equal(saved.success, true, saved.error);
  assert.equal(byId(target.id).status_updated_by, 'ธนากร (ฟิล์ม)');
  assert.equal(lastBy(target.id), 'ธนากร (ฟิล์ม)');
});

test('ชื่อที่หน้าเว็บส่งมาไม่มีผลตอนล็อกอิน — ส่งชื่อคนอื่น/ชื่อยาวเกิน/ช่องว่างมา ก็ยังบันทึกเป็นบัญชีที่ล็อกอิน', async () => {
  await loginAs('id-film');
  const target = listTickets()[1];
  for (const typed of ['คนอื่น', 'ก'.repeat(MAX_EDITOR_NAME + 1), '   ']) {
    const saved = await changeTicketStatusAction(target.id, target.status, typed, { note: `ลองส่งชื่อ ${typed.length} ตัว` });
    assert.equal(saved.success, true, saved.error);
    assert.equal(lastBy(target.id), 'ธนากร (ฟิล์ม)');
  }
});

test('บัญชีไม่มีชื่อที่แสดง → ใช้ชื่อผู้ใช้ · ชื่อยาวเกินเพดาน → ตัดให้ ไม่ปฏิเสธการบันทึก', async () => {
  const target = listTickets()[2];
  await loginAs('id-helpdesk');
  assert.equal((await changeTicketStatusAction(target.id, target.status, undefined, { note: 'หนึ่ง' })).success, true);
  assert.equal(lastBy(target.id), 'helpdesk');

  await loginAs('id-long');
  assert.equal((await changeTicketStatusAction(target.id, target.status, undefined, { note: 'สอง' })).success, true);
  assert.equal(lastBy(target.id), 'ก'.repeat(MAX_EDITOR_NAME));
});

test('ไม่ได้ล็อกอิน → เด้งไปหน้า login ก่อนแตะข้อมูล', async () => {
  const target = listTickets()[3];
  const before = history(target.id).length;
  await assert.rejects(changeTicketStatusAction(target.id, target.status, 'ฟิล์ม', { note: 'x' }), /redirect:\/login/);
  assert.equal(history(target.id).length, before);
});

test('รับแชทต่อเอง: ไทม์ไลน์บันทึกชื่อบัญชี ไม่ใช่ชื่อที่เคยพิมพ์จำไว้ในเครื่อง', async () => {
  await loginAs('id-film');
  const ticket = lineTicket();
  const taken = await setChatTakeoverAction(ticket.id, true, 'ชื่อเก่าที่จำไว้ในเครื่อง');
  assert.equal(taken.ok, true);
  const notes = listEventsForTicket(ticket.id).filter((e) => e.type === 'note');
  assert.deepEqual(notes.map((e) => e.actor), ['ธนากร (ฟิล์ม)']);
});

test('ปิดงานพร้อมส่งการ์ดให้คะแนนทาง LINE: ประวัติสถานะและไทม์ไลน์เป็นชื่อบัญชี ไม่ใช่ชื่อที่หน้าเว็บส่งมา', async () => {
  await loginAs('id-film');
  const ticket = lineTicket();
  const saved = await changeTicketStatusAction(ticket.id, 'resolved', 'คนอื่น', {
    note: 'เปลี่ยนสายแลนแล้ว', notifyLine: true,
  });
  assert.equal(saved.notify, 'sent');
  assert.equal(lastBy(ticket.id), 'ธนากร (ฟิล์ม)');
  const statusEvents = listEventsForTicket(ticket.id).filter((e) => e.type === 'status');
  assert.deepEqual(statusEvents.map((e) => e.actor), ['ธนากร (ฟิล์ม)']);
});

test('accountEditorName: ชื่อที่แสดง > ชื่อผู้ใช้ · ตัดช่องว่างหัวท้าย · ไม่เกินเพดาน', () => {
  assert.equal(accountEditorName({ displayName: '  ธนากร (ฟิล์ม)  ', username: 'film' }), 'ธนากร (ฟิล์ม)');
  assert.equal(accountEditorName({ displayName: '', username: 'film' }), 'film');
  assert.equal(accountEditorName({ displayName: null, username: ' film ' }), 'film');
  assert.equal(accountEditorName({ displayName: 'ก'.repeat(99), username: 'x' }), 'ก'.repeat(MAX_EDITOR_NAME));
});

/* ─────────────────────────────── หน้าต่างอัปเดตสถานะ ─────────────────────────────── */

const TICKET = {
  id: 't-ui', ticket_code: 'ITRP2026100001', type: 'repair', status: 'pending', location: 'สำนักงานใหญ่',
  requester_id: 'u1', equipment_id: null, description: 'เครื่องพิมพ์ไม่ออก', repair_cost: null,
  created_at: NOW, resolved_at: null, meta: {}, company: 'central', company_label: 'ส่วนกลาง',
  status_updated_at: null, status_updated_by: null, equipment: null,
  requester: { id: 'u1', display_name: 'ผู้แจ้ง ทดสอบ', department: null },
};

/** name = ชื่อบัญชีที่ layout ส่งลงมา · undefined = ไม่มี provider ครอบเลย */
function renderModal(name) {
  const modal = React.createElement(TicketStatusModal, {
    ticket: TICKET, editors: ['ชื่อที่เคยใช้'], onClose() {}, onSaved() {},
  });
  return renderToStaticMarkup(name === undefined ? modal : React.createElement(CurrentEditorProvider, { name }, modal));
}

test('หน้าต่างอัปเดตสถานะ: ล็อกอินอยู่ = โชว์ชื่อบัญชีแบบแก้ไม่ได้ ไม่มีช่องให้พิมพ์ชื่อ', () => {
  const html = renderModal('ธนากร (ฟิล์ม)');
  const field = html.match(/<input[^>]*value="ธนากร \(ฟิล์ม\)"[^>]*>/);
  assert.ok(field, 'ต้องเห็นชื่อบัญชีในช่องผู้แก้ไข');
  assert.match(field[0], /readonly/i, 'ช่องชื่อต้องแก้ไม่ได้');
  assert.doesNotMatch(html, /name="updated_by"/, 'ต้องไม่มีช่องให้พิมพ์ชื่อเอง');
  assert.doesNotMatch(html, /<datalist/);
  assert.match(html, /ใช้ชื่อบัญชีที่เข้าสู่ระบบ/);
});

test('หน้าต่างอัปเดตสถานะ: ปิดล็อกอิน (ไม่มีชื่อบัญชี) = กลับไปให้พิมพ์ชื่อ + เลือกจากชื่อที่เคยใช้แบบเดิม', () => {
  for (const html of [renderModal(null), renderModal(undefined)]) {
    assert.match(html, /<input[^>]*name="updated_by"/);
    assert.match(html, /<datalist[^>]*>.*ชื่อที่เคยใช้/s);
  }
});

test('layout ส่งชื่อบัญชีลงไปให้ทุกฟอร์มในหน้าแอดมิน (ปิดล็อกอิน = null)', () => {
  const code = fs.readFileSync(path.join(root, 'src/app/(dashboard)/layout.tsx'), 'utf8');
  assert.match(code, /<CurrentEditorProvider name=\{AUTH_DISABLED \? null : accountEditorName\(session\)\}>/);
});
