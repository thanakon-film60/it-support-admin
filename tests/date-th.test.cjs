// ตัวช่วยวันที่ "เวลาประเทศไทย" — ตรรกะที่พลาดแล้วไม่มีใครเห็นจนกว่าจะถึงตี 1
//
// ทำไมต้องมีเทสต์ชุดนี้: container รันเป็น UTC ส่วนคนใช้อยู่ UTC+7 ช่วง 00:00–07:00
// ตามเวลาไทยจึงเป็น "เมื่อวาน" ในสายตาเซิร์ฟเวอร์ ถ้าคำนวณผิด ปฏิทินหน้าแรกจะบอกว่า
// เคสที่เพิ่งแจ้งตอนตี 1 เป็นของเมื่อวาน และตัวเลข "แจ้งเข้ามาวันนี้" จะเป็น 0 ทั้งที่มีงานเข้า
// อาการแบบนี้เกิดแค่วันละ 7 ชั่วโมงและไม่มี error ใดๆ — ไล่จับด้วยมือแทบเป็นไปไม่ได้

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText, filename);

const d = require(path.join(root, 'src/lib/date-th.ts'));
const { formatThaiDateShort, formatThaiDateFull } = require(path.join(root, 'src/lib/utils.ts'));

test('table dates use Bangkok time consistently across server and browser time zones', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Bangkok', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      const iso = '2026-09-21T18:02:03.000Z';
      assert.equal(formatThaiDateShort(iso), '22 ก.ย. 69 01:02');
      assert.equal(formatThaiDateFull(iso), '22/9/2569 01:02:03');
    }
    assert.equal(formatThaiDateShort('invalid'), '-');
    assert.equal(formatThaiDateFull('invalid'), '-');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('แปลงเวลาเป็นวันตามเวลาไทย ไม่ใช่เวลาเครื่องที่รัน', () => {
  // 17 ก.ย. 18:30 UTC = 18 ก.ย. 01:30 ที่ไทย — ต้องได้วันที่ 18 ไม่ใช่ 17
  assert.equal(d.dayKeyTH('2026-09-17T18:30:00.000Z'), '2026-09-18');
  assert.equal(d.timeKeyTH('2026-09-17T18:30:00.000Z'), '01:30');

  // 17 ก.ย. 16:59 UTC = 17 ก.ย. 23:59 ที่ไทย — ยังเป็นวันที่ 17 อยู่
  assert.equal(d.dayKeyTH('2026-09-17T16:59:00.000Z'), '2026-09-17');
  assert.equal(d.timeKeyTH('2026-09-17T16:59:00.000Z'), '23:59');

  // เที่ยงคืนตรงตามเวลาไทย = 17:00 UTC ของวันก่อนหน้า
  assert.equal(d.dayKeyTH('2026-09-17T17:00:00.000Z'), '2026-09-18');
  assert.equal(d.timeKeyTH('2026-09-17T17:00:00.000Z'), '00:00');
});

test('ค่าที่แปลงไม่ได้ต้องไม่ทำให้พัง', () => {
  assert.equal(d.dayKeyTH('ไม่ใช่วันที่'), '');
  assert.equal(d.timeKeyTH(''), '');
});

test('เลื่อนเดือนข้ามปีได้ถูกต้อง', () => {
  assert.equal(d.shiftMonth('2026-09', 1), '2026-10');
  assert.equal(d.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(d.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(d.shiftMonth('2026-09', -12), '2025-09');
});

test('จำนวนวันในเดือนและวันเริ่มต้นของเดือนต้องไม่ขึ้นกับ time zone ของเครื่อง', () => {
  assert.equal(d.daysInMonth('2026-02'), 28);
  assert.equal(d.daysInMonth('2028-02'), 29, 'ปีอธิกสุรทิน');
  assert.equal(d.daysInMonth('2026-09'), 30);
  assert.equal(d.daysInMonth('2026-12'), 31);

  // 1 ก.ย. 2026 ตรงกับวันอังคาร (0 = อาทิตย์)
  assert.equal(d.firstWeekdayOfMonth('2026-09'), 2);
  // 1 ก.พ. 2026 ตรงกับวันอาทิตย์
  assert.equal(d.firstWeekdayOfMonth('2026-02'), 0);
});

test('นับอายุเป็นวันเต็ม ข้ามเดือนข้ามปีได้', () => {
  assert.equal(d.daysBetween('2026-09-17', '2026-09-17'), 0);
  assert.equal(d.daysBetween('2026-09-17', '2026-09-24'), 7);
  assert.equal(d.daysBetween('2026-08-31', '2026-09-01'), 1);
  assert.equal(d.daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(d.daysBetween('2026-09-24', '2026-09-17'), -7);
});

test('ป้ายเดือน/วันเป็นภาษาไทยและปี พ.ศ.', () => {
  assert.equal(d.thaiMonthLabel('2026-09'), 'กันยายน 2569');
  assert.equal(d.thaiMonthLabel('2026-01'), 'มกราคม 2569');
  // ตัวย่อเดือนไทยไม่ได้ตัดตามจำนวนตัวอักษร — ต้องได้ "ก.ย." ไม่ใช่ "กัน"
  assert.equal(d.thaiDayLabel('2026-09-17'), '17 ก.ย.');
  assert.equal(d.thaiDayLabel('2026-04-01'), '1 เม.ย.');
  assert.equal(d.monthKeyOf('2026-09-17'), '2026-09');
  assert.equal(d.makeDayKey(2026, 9, 7), '2026-09-07');
});
