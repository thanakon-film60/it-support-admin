// เจ้าหน้าที่รับแชทต่อเอง — หน้าแอดมินสั่งบอทให้เงียบกับผู้แจ้งคนหนึ่ง (ต.ค. 2026)
//
// ทำไมต้องมีเทสต์ชุดนี้: LINE ไม่ส่ง webhook ตอนเจ้าหน้าที่ตอบในแอป LINE OA บอทจึงรู้เองไม่ได้
// ถ้าคำสั่งจากฝั่งนี้พังเงียบๆ (ส่ง key ไม่ไป / user id หลุดไปอยู่ใน URL / ส่งตอน LINE ส่งไม่ถึง)
// อาการที่ผู้ใช้เห็นคือบอทตอบแทรกเจ้าหน้าที่ — ซึ่งเป็นสิ่งที่ฟีเจอร์นี้มีไว้กันพอดี
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
  if (id === 'next/navigation') return { redirect() { throw new Error('unexpected redirect'); } };
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText, filename);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-takeover-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'true';
process.env.LINE_NOTIFY_STATUSES = '';
process.env.INTERNAL_API_KEY = 'test-internal-key';

const { createTicket } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { listEventsForTicket } = require(path.join(root, 'src/lib/db/ticketEvents.ts'));
const { findOrCreateUserByName } = require(path.join(root, 'src/lib/db/users.ts'));
const { startBotHandoff, endBotHandoff, getBotHandoff } = require(path.join(root, 'src/lib/line/bot-handoff.ts'));
const { getChatTakeoverAction, setChatTakeoverAction } = require(path.join(root, 'src/app/actions/chat.ts'));
const { changeTicketStatusAction } = require(path.join(root, 'src/app/actions/tickets.ts'));

const BOT = 'http://bot.test:8000';
const LINE_USER = 'U_requester_chat';
const originalFetch = global.fetch;
let calls = [];
let botReply = () => new Response(JSON.stringify({ ok: true, active: true, until: 1_800_000_000, chat_mode: 'chat' }), { status: 200 });

beforeEach(() => {
  calls = [];
  process.env.LINE_BOT_INTERNAL_URL = `${BOT}/`;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-token';
  botReply = () => new Response(JSON.stringify({ ok: true, active: true, until: 1_800_000_000, chat_mode: 'chat' }), { status: 200 });
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith(BOT)) return botReply();
    return new Response('{}', { status: 200 }); // LINE push
  };
});

after(() => {
  global.fetch = originalFetch;
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function lineTicket() {
  return createTicket({
    type: 'it_service', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'อีเมลส่งไม่ออก', repair_cost: null,
    meta: { line_user_id: LINE_USER },
  });
}

/* ─────────────────────────────── ตัวเรียกบอท ─────────────────────────────── */

test('ส่ง key ไปกับทุกคำสั่ง และ user id อยู่ใน body ไม่ใช่ URL', async () => {
  const started = await startBotHandoff(LINE_USER);
  await endBotHandoff(LINE_USER);
  await getBotHandoff(LINE_USER);

  assert.deepEqual(calls.map((c) => c.url), [
    `${BOT}/internal/handoff`, `${BOT}/internal/handoff/end`, `${BOT}/internal/handoff/status`,
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['x-internal-key'], 'test-internal-key');
    assert.equal(call.body.line_user_id, LINE_USER);
    assert.ok(!call.url.includes(LINE_USER), 'user id ห้ามไปอยู่ใน URL (access log พิมพ์ออกมาเต็มๆ)');
    assert.ok(call.init.signal instanceof AbortSignal, 'ต้องมีเพดานเวลา ไม่งั้นหน้าเว็บค้างตอนบอทล่ม');
    assert.equal(call.init.redirect, 'error', 'ห้ามตาม redirect — key จะหลุดไปปลายทางอื่น');
  }
  assert.equal(started.ok, true);
  assert.equal(started.state.active, true);
  assert.equal(started.state.until, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(started.state.chatMode, 'chat');
});

test('ไม่ได้ตั้งค่าปลายทาง = ฟีเจอร์ปิด ไม่ยิงอะไรออกไป', async () => {
  delete process.env.LINE_BOT_INTERNAL_URL;
  assert.deepEqual(await startBotHandoff(LINE_USER), { ok: false, reason: 'not_configured' });
  assert.equal(calls.length, 0);
});

test('บอทตอบแบบต่างๆ แปลเป็นเหตุผลที่หน้าเว็บบอกคนได้', async () => {
  botReply = () => new Response(JSON.stringify({ ok: false, reason: 'chat_off' }), { status: 409 });
  assert.deepEqual(await startBotHandoff(LINE_USER), { ok: false, reason: 'chat_off' });

  botReply = () => new Response(JSON.stringify({ detail: 'unauthorized' }), { status: 401 });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await startBotHandoff(LINE_USER), { ok: false, reason: 'rejected' });
    global.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
    assert.deepEqual(await startBotHandoff(LINE_USER), { ok: false, reason: 'unreachable' });
  } finally {
    console.error = originalError;
  }
});

/* ─────────────────────────────── ปุ่มในหน้าแอดมิน ─────────────────────────────── */

test('กดรับแชทต่อ -> สั่งบอท + บันทึกไทม์ไลน์ว่าใครสั่ง · กดคืนให้บอท -> บันทึกเช่นกัน', async () => {
  const ticket = lineTicket();
  const taken = await setChatTakeoverAction(ticket.id, true, 'ฟิล์ม (IT)');
  assert.equal(taken.ok, true);
  assert.equal(calls.at(-1).url, `${BOT}/internal/handoff`);

  botReply = () => new Response(JSON.stringify({ ok: true, active: false, until: null, chat_mode: 'chat' }), { status: 200 });
  const released = await setChatTakeoverAction(ticket.id, false, 'ฟิล์ม (IT)');
  assert.equal(released.ok, true);
  assert.equal(calls.at(-1).url, `${BOT}/internal/handoff/end`);

  const notes = listEventsForTicket(ticket.id).filter((e) => e.type === 'note');
  assert.equal(notes.length, 2);
  assert.ok(notes.every((e) => e.actor === 'ฟิล์ม (IT)' && e.actor_role === 'admin'));
  assert.match(notes[0].note, /รับแชทต่อเอง/);
  assert.match(notes[1].note, /คืนแชทให้บอท/);
});

test('สั่งบอทไม่สำเร็จต้องไม่บันทึกว่าสำเร็จ', async () => {
  const ticket = lineTicket();
  botReply = () => new Response(JSON.stringify({ ok: false, reason: 'chat_off' }), { status: 409 });
  const result = await setChatTakeoverAction(ticket.id, true, 'ฟิล์ม');
  assert.deepEqual(result, { ok: false, reason: 'chat_off' });
  assert.equal(listEventsForTicket(ticket.id).filter((e) => e.type === 'note').length, 0);
});

test('ผู้แจ้งไม่ได้มาจาก LINE -> ไม่มีแชทให้รับต่อ และไม่ยิงหาบอทเลย', async () => {
  const walkIn = findOrCreateUserByName({ display_name: 'พนักงานเดินมาแจ้งเอง (แชท)' });
  const ticket = createTicket({
    type: 'repair', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: walkIn.id, equipment_id: null, description: 'แอดมินคีย์แทน', repair_cost: null, meta: null,
  });
  assert.deepEqual(await getChatTakeoverAction(ticket.id), { ok: false, reason: 'no_line_user' });
  assert.deepEqual(await setChatTakeoverAction(ticket.id, true), { ok: false, reason: 'no_line_user' });
  assert.deepEqual(await getChatTakeoverAction('ไม่มีจริง'), { ok: false, reason: 'not_found' });
  assert.equal(calls.length, 0);
});

/* ─────────────────────────────── เปลี่ยนสถานะไม่สั่งบอทเอง ─────────────────────────────── */

// เดิมสถานะ "รอข้อมูล" สั่งบอทเงียบให้อัตโนมัติ — ระบบเหลือ 2 สถานะ (21 ต.ค. 2026) จึงไม่มีจังหวะนั้นแล้ว
// ถ้าวันหนึ่งการเปลี่ยนสถานะเผลอไปสั่งบอท ผู้แจ้งที่แค่ได้แจ้งเตือน "แก้ไขแล้ว" จะคุยกับบอทไม่ได้อีก 24 ชม.
test('เปลี่ยนสถานะ (แม้ส่ง LINE) ไม่สั่งบอทเงียบเอง — ต้องกด "รับแชทต่อเอง" เท่านั้น', async () => {
  const ticket = lineTicket();
  const resolved = await changeTicketStatusAction(ticket.id, 'resolved', 'ฟิล์ม', { note: 'แก้แล้ว', notifyLine: true });
  assert.equal(resolved.notify, 'sent');
  assert.equal('handoff' in resolved, false);
  const reopened = await changeTicketStatusAction(ticket.id, 'pending', 'ฟิล์ม', { note: 'ขอรูปหน้าจอเพิ่ม', notifyLine: true });
  assert.equal(reopened.notify, 'sent');
  assert.ok(calls.every((c) => !c.url.startsWith(BOT)), 'ห้ามมีคำสั่งไปหาบอทจากการเปลี่ยนสถานะ');
});
