// หน้า Tickets ที่รวม "แก้ไขปัญหาแล้ว" + "ประวัติซ่อม" เข้ามา (21 ต.ค. 2026) และไฟล์ส่งออก .xlsx
//
// ทำไมต้องเรนเดอร์จริงและเปิดไฟล์ที่สร้างอ่านกลับ: tsc ไม่รู้ว่าแท็บนับเลขถูกไหม ลิงก์เก่า (?type=repair)
// ยังกรองให้หรือเปล่า และไฟล์ Excel ที่ "สร้างได้" อาจมีวันที่เป็นข้อความ/เพี้ยน 7 ชั่วโมง/ค่าซ่อมรวมยอดไม่ได้
// — ทุกอย่างผ่าน build แต่คนที่เอาไฟล์ไปแนบรายงานเจอเอง
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  // Server Action ใช้จริงไม่ได้นอก request ของ Next.js — แทนด้วยตัวหลอก (หน้าต่างยังไม่เปิดตอนเรนเดอร์)
  if (id === '@/app/actions/tickets' || id === '@/app/actions/chat') return new Proxy({}, { get: () => async () => ({}) });
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

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const XLSX = require('xlsx');
const { TicketsBoard } = require(path.join(root, 'src/components/tickets/TicketsBoard.tsx'));
const {
  buildTicketWorkbook, ticketSheetRows, excelSerialTH, TICKET_EXPORT_HEADERS, ticketExportFileName,
} = require(path.join(root, 'src/lib/ticket-export.ts'));

const ticket = (over) => ({
  id: 'x', ticket_code: 'ITSR2026100001', type: 'repair', status: 'pending', location: 'สำนักงานใหญ่',
  requester_id: 'u1', equipment_id: null, description: 'จอไม่ติด', repair_cost: null,
  created_at: '2026-10-20T03:00:00.000Z', resolved_at: null, meta: null, company: 'central',
  company_label: 'ส่วนกลาง', status_updated_at: null, status_updated_by: null, equipment: null,
  requester: { id: 'u1', display_name: 'สมชาย ใจดี', department: 'บัญชี' },
  ...over,
});

const TICKETS = [
  ticket({ id: 'p1', ticket_code: 'ITSR2026100010', description: 'เครื่องพิมพ์กระดาษติด' }),
  ticket({ id: 'p2', ticket_code: 'ITSV2026100011', type: 'it_service', description: 'ขอสิทธิ์โฟลเดอร์' }),
  ticket({
    id: 'r1', ticket_code: 'ITSR2026100012', status: 'resolved', repair_cost: 1200,
    resolved_at: '2026-10-20T07:30:00.000Z',
    meta: {
      resolution_note: 'เปลี่ยนสายจอ', completed_at: '2026-10-20T07:30:00.000Z',
      rating: { score: 2, comment: 'รอนาน', by: 'สมชาย', line_user_id: 'U1', at: '2026-10-20T08:00:00.000Z' },
      status_history: [{ id: 'h', from: 'pending', to: 'resolved', by: 'ฟิล์ม (IT)', at: '2026-10-20T07:30:00.000Z', note: '', notified: true, role: 'admin' }],
    },
  }),
];

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(TicketsBoard, { initialTickets: TICKETS, ...props }));
}

test('แท็บสถานะ: ทั้งหมด · รอดำเนินการ · แก้ไขแล้ว · ยกเลิก พร้อมจำนวนที่ถูก', () => {
  const html = render();
  assert.ok(html.includes('ทั้งหมด (3)'));
  assert.ok(html.includes('รอดำเนินการ (2)'));
  assert.ok(html.includes('แก้ไขแล้ว (1)'));
  assert.ok(html.includes('ยกเลิก (0)'), 'แท็บยกเลิกต้องมีเสมอ แม้ยังไม่มีเรื่อง — ทีมต้องรู้ว่ามีที่ให้กดยกเลิก');
  for (const old of ['กำลังดำเนินการ (', 'ดำเนินการเสร็จสิ้น (', 'รอข้อมูล (', 'ปิดแล้ว (']) {
    assert.ok(!html.includes(old), `ต้องไม่มีแท็บ ${old}`);
  }
});

test('เรื่องที่ยกเลิก: อยู่แท็บของตัวเอง ป้ายแดง บอกวันที่ยกเลิก และไม่ถูกนับในสรุปคะแนน/งานที่แก้เสร็จ', () => {
  const cancelled = ticket({
    id: 'c1', ticket_code: 'ITSR2026100013', status: 'cancelled', description: 'แจ้งซ้ำ',
    meta: { resolution_note: 'แจ้งซ้ำกับ ITSR2026100010', status_history: [
      { id: 'hc', from: 'pending', to: 'cancelled', by: 'ฟิล์ม (IT)', at: '2026-10-20T05:00:00.000Z', note: 'แจ้งซ้ำ', notified: null, role: 'admin' },
    ] },
  });
  const all = [...TICKETS, cancelled];
  const html = renderToStaticMarkup(React.createElement(TicketsBoard, { initialTickets: all }));
  assert.ok(html.includes('ยกเลิก (1)'));
  assert.ok(html.includes('ตอบแบบประเมิน'), 'แท็บทั้งหมดยังมีสรุปคะแนน');
  // ตอบแบบประเมินนับจากเรื่องที่แก้ไขแล้วเท่านั้น (1 เรื่อง) — ถ้านับยกเลิกด้วย อัตราการตอบจะดูต่ำกว่าความจริง
  assert.match(html, /ตอบแบบประเมิน<\/p><p[^>]*>1 \/ 1</);

  const tab = renderToStaticMarkup(React.createElement(TicketsBoard, { initialTickets: all, initialStatus: 'cancelled' }));
  assert.ok(tab.includes('ITSR2026100013'));
  assert.ok(!tab.includes('ITSR2026100012'), 'เรื่องที่แก้ไขแล้วต้องไม่อยู่ในแท็บยกเลิก');
  assert.ok(!tab.includes('คะแนนเฉลี่ย'), 'แท็บยกเลิกไม่มีอะไรให้คะแนน');
  assert.ok(tab.includes('text-rose-300'), 'ป้ายยกเลิกต้องเป็นสีแดง แยกจากเขียวของแก้ไขแล้ว');
  assert.match(tab, /ยกเลิก 20 ต\.ค\. 69/);
  assert.ok(!tab.includes('ใช้เวลา'), 'ยกเลิกไม่มีระยะเวลาที่ใช้ — ไม่ใช่งานที่ทำเสร็จ');

  const book = buildTicketWorkbook(XLSX, all.map((t) => ({ ticket: t, parts: [], views: 0 })), { filters: '' });
  const summary = XLSX.utils.sheet_to_json(book.Sheets['สรุป'], { header: 1, raw: true });
  const value = (label) => summary.find((r) => r[0] === label)?.[1];
  assert.equal(value('รอดำเนินการ'), 2, 'ยกเลิกต้องไม่ถูกนับเป็นรอดำเนินการ');
  assert.equal(value('แก้ไขแล้ว'), 1);
  assert.equal(value('ยกเลิก'), 1);
  assert.equal(book.Sheets['สรุป'][XLSX.utils.encode_cell({ r: summary.findIndex((r) => r[0] === 'ค่าซ่อมรวม (บาท)'), c: 1 })].z, '#,##0.00');
});

test('เรื่องที่แก้ไขแล้วอยู่ในหน้านี้ด้วย พร้อมค่าซ่อม คะแนน และระยะเวลา (เดิมต้องไปดูหน้าแยก)', () => {
  const html = render();
  assert.ok(html.includes('ITSR2026100012'));
  assert.ok(html.includes('1,200.00 บ.') || html.includes('1,200 บ.'), 'ค่าซ่อมต้องขึ้นในตาราง');
  assert.ok(html.includes('★★☆☆☆'), 'คะแนนต้องขึ้นในตาราง');
  assert.ok(html.includes('ใช้เวลา 4 ชม. 30 นาที'));
  // สรุปคะแนนจากหน้าแก้ไขปัญหาแล้วเดิม — การ์ด "ต้องปรับปรุง" ต้องนับเรื่อง 2 ดาว
  assert.ok(html.includes('คะแนนเฉลี่ย'));
  assert.match(html, /ต้องปรับปรุง \(1–3 ดาว\)<\/p><p[^>]*>1 เรื่อง/);
  assert.ok(html.includes('Export Excel (3)'));
});

test('ลิงก์เก่าของหน้าประวัติซ่อม (?type=repair) และหน้าแก้ไขปัญหาแล้ว (?status=resolved) ยังกรองให้ถูก', () => {
  const repair = render({ initialType: 'repair' });
  assert.ok(!repair.includes('ITSV2026100011'), 'บริการ IT ต้องไม่อยู่ในประวัติซ่อม');
  assert.ok(repair.includes('ITSR2026100010') && repair.includes('ITSR2026100012'));

  const resolved = render({ initialStatus: 'resolved' });
  assert.ok(resolved.includes('ITSR2026100012'));
  assert.ok(!resolved.includes('ITSR2026100010'));
  assert.ok(resolved.includes('คะแนนจากผู้แจ้ง'), 'ตัวกรองคะแนนต้องมีในแท็บแก้ไขแล้ว');

  // แท็บรอดำเนินการไม่มีคะแนนให้กรอง — ถ้าโชว์ คนเลือก "ยังไม่ให้คะแนน" แล้วได้ตารางว่างโดยไม่รู้ว่าทำไม
  const pending = render({ initialStatus: 'pending' });
  assert.ok(!pending.includes('คะแนนเฉลี่ย'));
});

test('ไฟล์ Excel: หัวตารางครบ วันที่เป็นวันที่จริงตามเวลาไทย ค่าซ่อม/คะแนนเป็นตัวเลข', () => {
  const rows = TICKETS.map((t) => ({ ticket: t, parts: t.id === 'r1' ? [{ name: 'สาย HDMI', qty: 1, unit: 'เส้น' }] : [], views: 2 }));
  const book = buildTicketWorkbook(XLSX, rows, { filters: 'สถานะ: แก้ไขแล้ว', exportedAt: '2026-10-21T05:00:00.000Z' });
  // เขียนเป็นไฟล์จริงแล้วเปิดอ่านกลับ — ยืนยันว่าไฟล์เปิดได้ ไม่ใช่แค่ object ในหน่วยความจำ
  const reread = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.deepEqual(reread.SheetNames, ['Tickets', 'สรุป']);

  const sheet = reread.Sheets.Tickets;
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  assert.deepEqual(grid[0], TICKET_EXPORT_HEADERS);
  assert.equal(grid.length, 4);

  const col = (name) => TICKET_EXPORT_HEADERS.indexOf(name);
  const resolvedRow = grid.find((r) => r[0] === 'ITSR2026100012');
  // 2026-10-20T03:00Z = 10:00 น. ไทย · วันที่ 20 ต.ค. 2026 (Excel serial 46315)
  const created = sheet[XLSX.utils.encode_cell({ r: grid.indexOf(resolvedRow), c: col('วันที่แจ้ง') })];
  assert.equal(created.t, 'n', 'วันที่ต้องเป็นตัวเลขวันที่ ไม่ใช่ข้อความ');
  assert.equal(Math.floor(created.v), 46315);
  assert.ok(Math.abs((created.v % 1) * 24 - 10) < 1e-6, 'ต้องเป็น 10:00 ตามเวลาไทย ไม่ใช่ 03:00 UTC');
  assert.equal(resolvedRow[col('ค่าซ่อม (บาท)')], 1200);
  assert.equal(resolvedRow[col('คะแนน (1-5)')], 2);
  assert.equal(resolvedRow[col('ระยะเวลา (ชม.)')], 4.5);
  assert.equal(resolvedRow[col('สถานะ')], 'แก้ไขแล้ว');
  assert.equal(resolvedRow[col('อะไหล่ที่เบิก')], 'สาย HDMI x1 เส้น');
  assert.equal(resolvedRow[col('ผู้ปิดงาน')], 'ฟิล์ม (IT)');
  // เรื่องที่ยังไม่ปิดต้องไม่มีวันปิดงาน/คะแนน (ช่องว่าง ไม่ใช่ 0 ที่ทำให้ค่าเฉลี่ยผิด)
  const pendingRow = grid.find((r) => r[0] === 'ITSR2026100010');
  assert.equal(pendingRow[col('วันที่ปิดงาน')], undefined);
  assert.equal(pendingRow[col('คะแนน (1-5)')], undefined);

  const summary = XLSX.utils.sheet_to_json(reread.Sheets['สรุป'], { header: 1, raw: true });
  const value = (label) => summary.find((r) => r[0] === label)?.[1];
  assert.equal(value('ตัวกรองที่ใช้'), 'สถานะ: แก้ไขแล้ว');
  assert.equal(value('จำนวนเรื่องทั้งหมด'), 3);
  assert.equal(value('รอดำเนินการ'), 2);
  assert.equal(value('แก้ไขแล้ว'), 1);
  assert.equal(value('ค่าซ่อมรวม (บาท)'), 1200);
  assert.equal(value('ต้องปรับปรุง (1-3 ดาว)'), 1);
});

test('ข้อความที่ขึ้นต้นด้วย = + - @ ถูกเก็บเป็นข้อความ ไม่กลายเป็นสูตรใน Excel', () => {
  const evil = ticket({ id: 'e', description: '=HYPERLINK("http://evil.example","คลิก")' });
  const book = buildTicketWorkbook(XLSX, [{ ticket: evil, parts: [], views: 0 }], { filters: '' });
  const sheet = book.Sheets.Tickets;
  const c = TICKET_EXPORT_HEADERS.indexOf('อาการ / รายละเอียด');
  const cell = sheet[XLSX.utils.encode_cell({ r: 1, c })];
  assert.equal(cell.t, 's');
  assert.equal(cell.f, undefined, 'ต้องไม่มีสูตรติดไปกับช่อง');
});

test('วันที่ใน Excel ไม่ขึ้นกับเขตเวลาของเครื่องที่กดส่งออก และชื่อไฟล์เป็นวันที่ไทย', () => {
  // 17:30 UTC = 00:30 ของวันถัดไปตามเวลาไทย — เครื่องที่ตั้งเวลา UTC ต้องได้วันเดียวกับเครื่องในไทย
  assert.equal(Math.floor(excelSerialTH('2026-10-20T17:30:00.000Z')), 46316);
  assert.equal(excelSerialTH(null), null);
  assert.equal(excelSerialTH('ไม่ใช่วันที่'), null);
  assert.equal(ticketExportFileName('2026-10-21'), 'tickets-2026-10-21.xlsx');
  assert.equal(ticketSheetRows([]).length, 1, 'ไม่มีข้อมูลก็ยังต้องมีหัวตาราง');
});

test('เมนูไม่มีแท็บ "แก้ไขปัญหาแล้ว" กับ "ประวัติซ่อม" แล้ว แต่ลิงก์เก่ายังเด้งมาหน้า Tickets', () => {
  const pages = require(path.join(root, 'src/lib/pages.json'));
  assert.ok(!pages.some((p) => p.key === 'resolved' || p.key === 'repair-history'));
  const read = (r) => fs.readFileSync(path.join(root, 'src/app/(dashboard)', r, 'page.tsx'), 'utf8');
  assert.match(read('resolved'), /redirect\("\/tickets\?status=resolved"\)/);
  assert.match(read('repair-history'), /redirect\("\/tickets\?type=repair"\)/);
});
