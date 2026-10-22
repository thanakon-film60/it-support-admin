// คะแนนความพึงพอใจหลังทีม IT ปิดงาน (ต.ค. 2026) — การ์ดให้คะแนน · endpoint · ตัวอ่าน/สรุปคะแนน
//
// ทำไมต้องมีเทสต์ชุดนี้: คะแนนเฉลี่ยคือตัวเลขที่ทีม IT จะถูกวัดผล ถ้าปั่นได้ (คนอื่นกดแทน / กดรัวจนนับซ้ำ)
// หรืออ่านค่าเพี้ยน (JSON แก้มือ) ตัวเลขจะผิดแบบเงียบๆ — ไม่มี error ให้เห็น เห็นแค่กราฟที่ไม่ตรงความจริง
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-rating-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'true';
process.env.LINE_NOTIFY_STATUSES = '';
process.env.INTERNAL_API_KEY = 'test-internal-key';

const { createTicket, getTicketById, updateTicketStatus } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { listEventsForTicket } = require(path.join(root, 'src/lib/db/ticketEvents.ts'));
const feedback = require(path.join(root, 'src/lib/ticket-feedback.ts'));
const { readResolvedBy } = require(path.join(root, 'src/lib/ticket-confirmation.ts'));
const { buildCompletedRatingFlex, buildRatingPostbackData } = require(path.join(root, 'src/lib/line/rating-card.ts'));
const { buildStatusNotification } = require(path.join(root, 'src/lib/line/notify.ts'));
const { POST: rateRoute } = require(path.join(root, 'src/app/api/internal/tickets/rate/route.ts'));
const { toCsv } = require(path.join(root, 'src/lib/utils.ts'));

after(() => { process.chdir(root); fs.rmSync(tmp, { recursive: true, force: true }); });

const LINE_USER = 'U_requester_rate';

function newCompletedTicket(meta = { line_user_id: LINE_USER }) {
  const ticket = createTicket({
    type: 'repair', status: 'pending', company: 'central', location: 'สำนักงานใหญ่',
    requester_id: 'unused', equipment_id: null, description: 'ปริ้นเตอร์กระดาษติด', repair_cost: 350, meta,
  });
  updateTicketStatus(ticket.id, 'resolved', 'ช่างซี', { note: 'ล้างลูกยางดึงกระดาษแล้ว' });
  return getTicketById(ticket.id);
}

function rate(body, key = 'test-internal-key') {
  return rateRoute(new Request('http://localhost/api/internal/tickets/rate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

/* ─────────────────────────────── การ์ดใน LINE ─────────────────────────────── */

test('การ์ดปิดงานมีดาว 5 ดวงที่กดได้ และทุก action อยู่ในขีดจำกัดของ LINE', () => {
  const ticket = newCompletedTicket();
  const card = buildCompletedRatingFlex(ticket, 'ล้างลูกยางดึงกระดาษแล้ว', null);

  assert.equal(card.type, 'flex');
  assert.ok(card.altText.length <= 400);
  assert.match(card.altText, /ให้คะแนน/, 'คนที่เห็นแค่แจ้งเตือนต้องรู้ว่ามีอะไรให้กดในการ์ด');
  assert.match(card.contents.header.contents[0].text, /แก้ไขเรียบร้อย/);

  const stars = card.contents.body.contents.at(-1).contents;
  assert.equal(stars.length, 5);
  stars.forEach((box, i) => {
    const score = i + 1;
    assert.equal(box.action.type, 'postback');
    assert.equal(box.action.data, buildRatingPostbackData(ticket.ticket_code, score));
    assert.ok(box.action.label.length <= 20, box.action.label);
    assert.ok(Buffer.byteLength(box.action.data) <= 300, 'postback data ต้องไม่เกิน 300 ไบต์');
    // ข้อความที่โผล่ในแชทต้องบอกจำนวนดาว ผู้ใช้จะได้รู้ทันทีว่ากดผิดดวงไหม
    assert.ok(box.action.displayText.includes(`${score}/5`), box.action.displayText);
  });

  const [reopen, hint] = card.contents.footer.contents;
  assert.equal(reopen.action.data, `a=confirm&code=${ticket.ticket_code}&v=0`);
  assert.ok(reopen.action.label.length <= 20, reopen.action.label);
  assert.ok(hint.text.includes(String(feedback.REOPEN_WINDOW_DAYS)), 'ต้องบอกเพดานเวลาเปิดเรื่องกลับ');
});

test('เลือกหน้าตาข้อความตามสถานะ: แก้ไขแล้ว = การ์ดให้คะแนน · รอดำเนินการ = ข้อความธรรมดา', () => {
  const ticket = newCompletedTicket();
  const rating = buildStatusNotification(ticket, null, null);
  assert.equal(rating.type, 'flex');
  assert.match(JSON.stringify(rating.contents), /a=rate&code=/);
  // ไม่มีการ์ดยืนยันรุ่นเก่า (ปุ่ม v=1) แล้ว — ส่งไปเมื่อไหร่ผู้แจ้งจะได้ปุ่ม "เรียบร้อยแล้ว" ที่กดแล้วไม่เกิดอะไร
  assert.doesNotMatch(JSON.stringify(rating.contents), /a=confirm&code=.*&v=1/);

  assert.equal(buildStatusNotification({ ...ticket, status: 'pending' }, null, null).type, 'text');
});

/* ─────────────────────────────── endpoint ─────────────────────────────── */

test('ไม่มี key ที่ถูกต้อง = 401 และไม่แตะข้อมูล', async () => {
  const ticket = newCompletedTicket();
  const res = await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, score: 5 }, 'wrong');
  assert.equal(res.status, 401);
  assert.equal(feedback.readRating(getTicketById(ticket.id)), null);
});

test('payload เพี้ยนถูกปฏิเสธด้วย 400 ทุกแบบ', async () => {
  const ticket = newCompletedTicket();
  const base = { ticket_code: ticket.ticket_code, line_user_id: LINE_USER };
  const bad = [
    '{not json',
    { line_user_id: LINE_USER, score: 3 },
    { ...base },                                   // ไม่มีทั้งคะแนนและความเห็น
    { ...base, score: 0 }, { ...base, score: 6 }, { ...base, score: 2.5 }, { ...base, score: '3' },
    { ...base, comment: 42 },
    { ...base, comment: '   ' },                   // ช่องว่างล้วนไม่นับเป็นความเห็น
    { ...base, score: 3, comment: 'ก'.repeat(feedback.MAX_RATING_COMMENT + 1) },
    { ...base, score: 3, line_user_id: 123 },
  ];
  for (const body of bad) {
    assert.equal((await rate(body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(feedback.readRating(getTicketById(ticket.id)), null);
});

test('คนอื่นให้คะแนนแทนไม่ได้ แม้จะรู้เลขที่ตั๋ว', async () => {
  const ticket = newCompletedTicket();
  for (const lineUserId of ['U_someone_else', undefined, '']) {
    const res = await rate({ ticket_code: ticket.ticket_code, line_user_id: lineUserId, score: 1 });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'not_owner');
  }
  assert.equal(feedback.readRating(getTicketById(ticket.id)), null, 'คะแนนต้องไม่ถูกปั่นจากคนนอก');
  assert.equal((await rate({ ticket_code: 'ITRQ0000000000', line_user_id: LINE_USER, score: 5 })).status, 404);
});

test('ให้ 4–5 ดาว -> บันทึกแล้วไม่ถามต่อ · ให้ 1–3 ดาว -> ขอความเห็นต่อ', async () => {
  const good = newCompletedTicket();
  const goodRes = await (await rate({ ticket_code: good.ticket_code, line_user_id: LINE_USER, score: 5, viewer_name: 'Film' })).json();
  assert.equal(goodRes.ok, true);
  assert.equal(goodRes.score, 5);
  assert.equal(goodRes.ask_comment, false);
  const stored = feedback.readRating(getTicketById(good.id));
  assert.equal(stored.score, 5);
  assert.equal(stored.by, 'Film');
  assert.equal(stored.line_user_id, LINE_USER);

  for (const score of [1, 2, 3]) {
    const low = newCompletedTicket();
    const body = await (await rate({ ticket_code: low.ticket_code, line_user_id: LINE_USER, score })).json();
    assert.equal(body.ask_comment, true, `${score} ดาวต้องถามต่อว่าควรปรับปรุงตรงไหน`);
  }
});

test('ความเห็นที่พิมพ์ตามหลังดาวต่ำ ติดไปกับคะแนนเดิม และไม่ถามซ้ำ', async () => {
  const ticket = newCompletedTicket();
  await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, score: 2 });
  const res = await (await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, comment: '  รอนานเกินไป  ' })).json();
  assert.equal(res.ok, true);
  assert.equal(res.score, 2);
  assert.equal(res.comment, 'รอนานเกินไป');
  assert.equal(res.ask_comment, false);

  // กดดาวใหม่ (เช่นกดผิดดวง) — ความเห็นที่เขียนไว้ต้องไม่หายเงียบๆ
  await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, score: 3 });
  const rating = feedback.readRating(getTicketById(ticket.id));
  assert.equal(rating.score, 3);
  assert.equal(rating.comment, 'รอนานเกินไป');

  const notes = listEventsForTicket(ticket.id).filter((e) => e.type === 'rated').map((e) => e.note);
  assert.deepEqual(notes, ['ให้คะแนน 2/5', 'ความเห็น: รอนานเกินไป', 'ให้คะแนน 3/5']);
});

test('ส่งความเห็นมาก่อนจะมีคะแนน = no_rating ไม่ใช่สร้างคะแนนขึ้นมาเอง', async () => {
  const ticket = newCompletedTicket();
  const body = await (await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, comment: 'ดีมาก' })).json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'no_rating');
  assert.equal(feedback.readRating(getTicketById(ticket.id)), null);
});

test('กดดาวเดิมซ้ำ (กดรัวเพราะไม่แน่ใจว่าติด) ไม่บันทึกซ้ำในไทม์ไลน์', async () => {
  const ticket = newCompletedTicket();
  await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, score: 4 });
  const again = await (await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, score: 4 })).json();
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(listEventsForTicket(ticket.id).filter((e) => e.type === 'rated').length, 1);
});

test('เรื่องที่ยังไม่ปิด (เช่นเพิ่งกดยังมีปัญหา) ให้คะแนนไม่ได้ และบอกสถานะปัจจุบัน', async () => {
  const ticket = newCompletedTicket();
  updateTicketStatus(ticket.id, 'pending', 'ช่างซี');
  const res = await rate({ ticket_code: ticket.ticket_code, line_user_id: LINE_USER, score: 5 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'not_completed');
  assert.equal(body.status, 'pending');
});

/* ─────────────────────────────── ตัวอ่าน / สรุป ─────────────────────────────── */

test('readRating กันค่าเพี้ยนจาก JSON ที่แก้ด้วยมือ', () => {
  const at = '2026-10-12T03:00:00.000Z';
  assert.equal(feedback.readRating({ meta: null }), null);
  assert.equal(feedback.readRating({ meta: { rating: 'ห้าดาว' } }), null);
  assert.equal(feedback.readRating({ meta: { rating: { score: 7, at } } }), null);
  assert.equal(feedback.readRating({ meta: { rating: { score: '5', at } } }), null);
  assert.equal(feedback.readRating({ meta: { rating: { score: 5 } } }), null, 'ไม่มีเวลา = ข้อมูลไม่ครบ');
  assert.deepEqual(feedback.readRating({ meta: { rating: { score: 4, at, comment: '   ', by: '' } } }), {
    score: 4, comment: null, by: 'ผู้แจ้ง', line_user_id: null, at,
  });
});

test('สรุปคะแนนไม่นับเรื่องที่ยังไม่ให้คะแนนเป็นศูนย์ดาว', () => {
  const at = '2026-10-12T03:00:00.000Z';
  const withScore = (score) => ({ meta: { rating: { score, at } } });
  const summary = feedback.summarizeRatings([withScore(5), withScore(4), withScore(2), { meta: null }]);
  assert.equal(summary.total, 4);
  assert.equal(summary.rated, 3);
  assert.equal(summary.average, 11 / 3);
  assert.equal(Math.round(summary.csat), 67);
  assert.equal(summary.low, 1);
  assert.deepEqual(summary.distribution, [0, 1, 0, 1, 1]);

  const empty = feedback.summarizeRatings([{ meta: null }]);
  assert.equal(empty.average, null);
  assert.equal(empty.csat, null);
});

test('เพดานเวลาเปิดเรื่องกลับ — ไม่รู้ว่าปิดเมื่อไหร่ให้ผ่าน', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
  assert.equal(feedback.canReopen({ meta: { completed_at: daysAgo(1) }, resolved_at: null }, now), true);
  assert.equal(feedback.canReopen({ meta: { completed_at: daysAgo(feedback.REOPEN_WINDOW_DAYS + 1) }, resolved_at: null }, now), false);
  assert.equal(feedback.canReopen({ meta: null, resolved_at: daysAgo(feedback.REOPEN_WINDOW_DAYS + 3) }, now), false);
  assert.equal(feedback.canReopen({ meta: null, resolved_at: null }, now), true);
  assert.equal(feedback.canReopen({ meta: { completed_at: 'ไม่ใช่วันที่' }, resolved_at: null }, now), true);
});

test('starText ได้ดาวครบ 5 ช่องเสมอ', () => {
  assert.equal(feedback.starText(3), '★★★☆☆');
  assert.equal(feedback.starText(4.4), '★★★★☆');
  assert.equal(feedback.starText(9), '★★★★★');
});

test('ชื่อคนปิดงาน: ทีม IT ปิดเองนับ · ผู้แจ้งกดยืนยัน (ข้อมูลเก่า ไม่มี role) ไม่นับ', () => {
  const ticket = newCompletedTicket();
  assert.equal(readResolvedBy(ticket).by, 'ช่างซี');

  // ข้อมูลก่อน ต.ค. 2026: completed มาจากผู้แจ้งเท่านั้น และรายการไม่มี role
  const legacy = { meta: { status_history: [
    { id: '1', from: 'in_progress', to: 'resolved', by: 'ช่างเก่า', at: '2026-09-01T00:00:00.000Z', note: '', notified: true },
    { id: '2', from: 'resolved', to: 'completed', by: 'ลูกค้า', at: '2026-09-02T00:00:00.000Z', note: '', notified: null },
  ] } };
  assert.equal(readResolvedBy(legacy).by, 'ช่างเก่า', 'ชื่อลูกค้าต้องไม่ขึ้นเป็นคนแก้งาน');
});

/* ─────────────────────────────── CSV ─────────────────────────────── */

test('CSV กันสูตร Excel ที่ฝังมากับข้อความจากแชท แต่ไม่แตะตัวเลขและ "-"', () => {
  const csv = toCsv(
    [{ comment: '=HYPERLINK("http://evil","x")', plus: '+66812345678', dash: '-', qty: -5, ok: 'ปกติ' }],
    [{ key: 'comment', header: 'c' }, { key: 'plus', header: 'p' }, { key: 'dash', header: 'd' }, { key: 'qty', header: 'q' }, { key: 'ok', header: 'o' }]
  );
  const line = csv.split('\n')[1];
  assert.ok(line.startsWith(`"'=HYPERLINK(""http://evil"",""x"")"`), line);
  assert.ok(line.includes(",'+66812345678,"), line);
  assert.ok(line.endsWith(',-,-5,ปกติ'), line);
});
