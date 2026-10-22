// หน้าฝากข้อความ (/notes): เก็บบนเซิร์ฟเวอร์ · ต้องล็อกอิน · ห้ามทำข้อความเก่าหาย
//
// ข้อความในหน้านี้คนพิมพ์เองทั้งหมด หายแล้วสร้างคืนไม่ได้ เทสต์ส่วนใหญ่จึงเฝ้า "ทางที่ข้อความจะหายเงียบๆ"
// ได้แก่ ไฟล์เสียแล้วถูกเขียนทับ · ลบ/แก้ผิดอัน · คนที่ไม่ได้ล็อกอินเขียนหรือลบได้
// ทุกข้อรันโค้ดจริงบนโฟลเดอร์ข้อมูลชั่วคราว ไม่แตะ data/ ของเครื่องจริง
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
  if (id === 'next/navigation') {
    return {
      // redirect จริงของ Next โยน error เพื่อหยุดการทำงาน — ตัวหลอกทำแบบเดียวกันและบอกปลายทาง
      redirect(url) { throw new Error(`redirect:${url}`); },
      useRouter: () => ({ refresh() {} }),
    };
  }
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
process.chdir(tmp);
// ปิดล็อกอิน = requireSession() คืน guest ("ผู้ใช้ทั่วไป") โดยไม่แตะ cookie
// ข้อสุดท้ายเปิดล็อกอินกลับเพื่อพิสูจน์ว่าคนไม่ได้ล็อกอินทำอะไรไม่ได้
process.env.AUTH_DISABLED = 'true';

const notesDb = require(path.join(root, 'src/lib/db/notes.ts'));
const { CollectionReadError } = require(path.join(root, 'src/lib/db/store.ts'));
const shared = require(path.join(root, 'src/lib/notes-shared.ts'));
const actions = require(path.join(root, 'src/app/actions/notes.ts'));

const dataDir = path.join(tmp, 'data');
const dataFile = path.join(dataDir, 'notes.json');
const readFile = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const writeRaw = (text) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, text);
};
const note = (over) => ({
  id: 'n', body: 'ข้อความ', author: 'ฟิล์ม', created_at: '2026-10-07T03:00:00.000Z',
  updated_at: null, updated_by: null, ...over,
});

beforeEach(() => {
  try { fs.unlinkSync(dataFile); } catch { /* ยังไม่มีไฟล์ = สะอาดอยู่แล้ว */ }
});

// ต้อง chdir กลับก่อนลบ — Windows ลบโฟลเดอร์ที่เป็น cwd ของโปรเซสอยู่ไม่ได้ (EPERM)
after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('ยังไม่เคยบันทึก = รายการว่าง และยังไม่สร้างไฟล์จนกว่าจะเขียนจริง', () => {
  assert.deepEqual(notesDb.listNotes(), []);
  assert.equal(fs.existsSync(dataFile), false);
});

test('บันทึกแล้วอยู่ในไฟล์บนเซิร์ฟเวอร์ — เปิดจากเครื่องไหนก็อ่านชุดเดียวกัน', async () => {
  const result = await actions.createNoteAction('  ซื้อเมาส์สำรอง 2 อัน\r\nให้สาขาศาลายา  ');
  assert.deepEqual(result, {});

  const rows = readFile();
  assert.equal(rows.length, 1);
  // ตัดช่องว่างหัวท้าย และขึ้นบรรทัดแบบ Windows กลายเป็น \n ให้เหมือนกันทุกเครื่อง
  assert.equal(rows[0].body, 'ซื้อเมาส์สำรอง 2 อัน\nให้สาขาศาลายา');
  assert.equal(rows[0].author, 'ผู้ใช้ทั่วไป', 'ต้องติดชื่อคนที่ล็อกอินอยู่');
  assert.equal(rows[0].updated_at, null);
  assert.ok(!Number.isNaN(Date.parse(rows[0].created_at)));
  assert.deepEqual(notesDb.listNotes(), rows, 'หน้าเว็บต้องอ่านได้ตรงกับที่อยู่ในไฟล์');
});

test('ใหม่สุดอยู่บนเสมอ แม้ลำดับในไฟล์จะไม่เรียง', () => {
  writeRaw(JSON.stringify([
    note({ id: 'b', created_at: '2026-10-06T09:00:00.000Z' }),
    note({ id: 'c', created_at: '2026-10-07T01:00:00.000Z' }),
    note({ id: 'a', created_at: '2026-10-05T09:00:00.000Z' }),
  ]));
  assert.deepEqual(notesDb.listNotes().map((n) => n.id), ['c', 'b', 'a']);
});

test('แก้ไขเปลี่ยนเฉพาะอันที่เลือก และบอกได้ว่าใครแก้เมื่อไหร่', async () => {
  writeRaw(JSON.stringify([note({ id: 'x', body: 'เดิม x' }), note({ id: 'y', body: 'เดิม y' })]));

  assert.deepEqual(await actions.updateNoteAction('x', 'ใหม่ x'), {});
  const [x, y] = readFile();
  assert.equal(x.body, 'ใหม่ x');
  assert.equal(x.updated_by, 'ผู้ใช้ทั่วไป');
  assert.ok(x.updated_at);
  assert.equal(x.created_at, note().created_at, 'เวลาที่เขียนครั้งแรกต้องไม่เปลี่ยน');
  assert.deepEqual(y, note({ id: 'y', body: 'เดิม y' }), 'อันอื่นต้องไม่ถูกแตะ');

  // กดบันทึกโดยไม่ได้แก้อะไร = ไม่ติดป้าย "แก้ไขแล้ว" ซ้ำ
  const stamp = x.updated_at;
  await actions.updateNoteAction('x', 'ใหม่ x');
  assert.equal(readFile()[0].updated_at, stamp);
});

test('แก้ข้อความที่ถูกลบจากอีกเครื่องไปแล้ว ต้องบอกผู้ใช้ ไม่ใช่เงียบหรือสร้างใหม่เอง', async () => {
  writeRaw(JSON.stringify([note({ id: 'x' })]));
  const result = await actions.updateNoteAction('ไม่มีอยู่จริง', 'ข้อความ');
  assert.match(result.error, /ถูกลบไปแล้ว/);
  assert.equal(readFile().length, 1);
});

test('ลบเฉพาะอันที่เลือก · ลบอันที่หายไปแล้วซ้ำก็ไม่ error', async () => {
  writeRaw(JSON.stringify([note({ id: 'x' }), note({ id: 'y' })]));
  assert.deepEqual(await actions.deleteNoteAction('x'), {});
  assert.deepEqual(readFile().map((n) => n.id), ['y']);
  assert.deepEqual(await actions.deleteNoteAction('x'), {}, 'ผลที่ต้องการ (หายไป) เป็นจริงอยู่แล้ว');
  assert.deepEqual(readFile().map((n) => n.id), ['y']);
});

test('ข้อความว่าง / ยาวเกิน / ไม่ใช่ข้อความ ต้องไม่ถูกบันทึก', async () => {
  writeRaw(JSON.stringify([note({ id: 'x' })]));
  const before = fs.readFileSync(dataFile, 'utf8');
  for (const bad of ['', '   \n  ', 'ก'.repeat(shared.NOTE_MAX_LENGTH + 1), 123, null]) {
    const result = await actions.createNoteAction(bad);
    assert.ok(result.error, `ต้องปฏิเสธ ${JSON.stringify(String(bad).slice(0, 10))}`);
  }
  assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  // ยาวพอดีเพดานต้องผ่าน — กันเผลอเขียนเงื่อนไขเป็น >= แล้วปฏิเสธข้อความที่ถูกต้อง
  assert.deepEqual(await actions.createNoteAction('ก'.repeat(shared.NOTE_MAX_LENGTH)), {});
});

test('ไฟล์เสียต้องไม่ถูกเขียนทับ — ข้อความเก่าต้องยังอยู่ให้กู้ได้', async () => {
  // อาการที่กลัวที่สุด: อ่านไม่ออก -> เห็นว่าว่าง -> บันทึกใหม่ทับ -> ข้อความเก่าหายทั้งไฟล์
  const broken = '[{"id":"x","body":"ข้อความสำคัญที่ห้ามหาย"';
  writeRaw(broken);

  assert.throws(() => notesDb.listNotes(), CollectionReadError);
  // action เขียน log ลง console.error ตามปกติ — ปิดไว้เฉพาะข้อนี้ คนดูผลเทสต์จะได้ไม่ตกใจ
  const logError = console.error;
  console.error = () => {};
  try {
    for (const run of [
      () => actions.createNoteAction('ข้อความใหม่'),
      () => actions.updateNoteAction('x', 'แก้'),
      () => actions.deleteNoteAction('x'),
    ]) {
      const result = await run();
      assert.match(result.error, /ไม่ออก/);
    }
  } finally {
    console.error = logError;
  }
  assert.equal(fs.readFileSync(dataFile, 'utf8'), broken, 'ไฟล์ต้องเหมือนเดิมทุกไบต์');

  writeRaw('');
  assert.throws(() => notesDb.listNotes(), CollectionReadError, 'ไฟล์ 0 ไบต์ก็ถือว่าเสีย');
});

test('เขียนไฟล์แบบ atomic — ไม่มีไฟล์ชั่วคราวค้างหลังบันทึก', async () => {
  await actions.createNoteAction('หนึ่ง');
  await actions.createNoteAction('สอง');
  const leftovers = fs.readdirSync(dataDir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.equal(readFile().length, 2);
});

test('เวลาที่แสดงเป็นเวลาไทยเสมอ ไม่ขึ้นกับเวลาเครื่องเซิร์ฟเวอร์', () => {
  // 20:30 UTC = 03:30 ของวันถัดไปตามเวลาไทย — container รัน UTC ถ้าใช้เวลาเครื่องจะได้วันผิด
  assert.equal(shared.noteStamp('2026-10-06T20:30:00.000Z'), '7 ต.ค. 2569 · 03:30');
  assert.equal(shared.noteStamp(null), '-');
  assert.equal(shared.notesFileName('2026-10-06T20:30:00.000Z'), 'notes-2026-10-07.txt');
});

test('ไฟล์ .txt ที่ดาวน์โหลด: เปิดใน Notepad ได้ และมีครบทุกข้อความ', () => {
  const text = shared.notesToText([
    note({ id: 'b', body: 'บรรทัดแรก\nบรรทัดสอง', created_at: '2026-10-07T03:00:00.000Z',
      updated_at: '2026-10-07T04:15:00.000Z', updated_by: 'เดียร์' }),
    note({ id: 'a', body: 'ข้อความเก่า', author: 'แพรว', created_at: '2026-10-06T02:00:00.000Z' }),
  ], '2026-10-07T05:00:00.000Z');

  assert.ok(text.startsWith('﻿'), 'ต้องมี BOM ไม่งั้น Notepad รุ่นเก่าอ่านภาษาไทยไม่ออก');
  assert.ok(!/[^\r]\n/.test(text), 'ทุกบรรทัดต้องขึ้นด้วย \\r\\n');
  assert.match(text, /ทั้งหมด 2 ข้อความ/);
  assert.match(text, /\[7 ต\.ค\. 2569 · 10:00\] ฟิล์ม\r\nบรรทัดแรก\r\nบรรทัดสอง/);
  assert.match(text, /\(แก้ไขล่าสุด 7 ต\.ค\. 2569 · 11:15 โดย เดียร์\)/);
  assert.match(text, /\[6 ต\.ค\. 2569 · 09:00\] แพรว\r\nข้อความเก่า/);
  assert.ok(text.indexOf('บรรทัดแรก') < text.indexOf('ข้อความเก่า'), 'เรียงตามที่ส่งมา (ใหม่สุดก่อน)');
});

test('ค้นหาไม่สนช่องว่างและตัวพิมพ์ และค้นชื่อคนเขียนได้', () => {
  const n = note({ body: 'ตั้งค่า Printer ห้องบัญชี', author: 'ฟิล์ม' });
  assert.ok(shared.noteMatches(n, 'printer ห้อง บัญชี'));
  assert.ok(shared.noteMatches(n, 'ฟิล์ม'));
  assert.ok(!shared.noteMatches(n, 'สแกนเนอร์'));
  assert.ok(shared.noteMatches(n, '   '), 'ช่องค้นหาว่าง = แสดงทั้งหมด');
});

test('หน้าเว็บแสดงข้อความ คนเขียน เวลาไทย และป้ายแก้ไขแล้ว', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NotesBoard } = require(path.join(root, 'src/components/notes/NotesBoard.tsx'));
  const render = (props) => renderToStaticMarkup(React.createElement(NotesBoard, props));

  const html = render({
    notes: [
      note({ id: 'b', body: 'โทรหาช่างแอร์\nพรุ่งนี้ 9 โมง', author: 'ฟิล์ม',
        updated_at: '2026-10-07T04:00:00.000Z', updated_by: 'ฟิล์ม' }),
      note({ id: 'a', body: 'สต็อกหมึกเหลือ 2 ตลับ', author: 'แพรว', created_at: '2026-10-06T02:00:00.000Z' }),
    ],
    loadError: null,
  });
  for (const text of ['ฝากข้อความ', 'โทรหาช่างแอร์', 'สต็อกหมึกเหลือ 2 ตลับ', 'แพรว',
    '7 ต.ค. 2569 · 10:00', '6 ต.ค. 2569 · 09:00', 'แก้ไขแล้ว', 'ดาวน์โหลด .txt']) {
    assert.ok(html.includes(text), `ไม่เห็น "${text}" บนหน้าจอ`);
  }
  assert.ok(html.includes('whitespace-pre-wrap'), 'ต้องขึ้นบรรทัดตามที่พิมพ์ไว้');

  const empty = render({ notes: [], loadError: null });
  assert.ok(empty.includes('ยังไม่มีข้อความ'));

  // ไฟล์เสีย: ต้องบอกตรงๆ และปิดช่องพิมพ์ ห้ามหลอกว่า "ยังไม่มีข้อความ" จนคนเริ่มจดใหม่ทับ
  const broken = render({ notes: [], loadError: 'อ่านไฟล์ข้อความไม่ออก' });
  assert.ok(broken.includes('อ่านไฟล์ข้อความไม่ออก'));
  assert.ok(!broken.includes('ยังไม่มีข้อความ'));
  assert.match(broken, /<textarea[^>]*disabled/);
});

test('ไม่ได้ล็อกอิน = เขียน แก้ และลบไม่ได้เลย', async () => {
  writeRaw(JSON.stringify([note({ id: 'x', body: 'ของเดิม' })]));
  const before = fs.readFileSync(dataFile, 'utf8');

  // AUTH_DISABLED ถูกอ่านตอนโหลดโมดูล จึงต้องโหลด auth กับ actions ใหม่หลังเปิดล็อกอิน
  process.env.AUTH_DISABLED = 'false';
  for (const file of ['src/lib/auth.ts', 'src/app/actions/notes.ts']) {
    delete require.cache[path.join(root, file)];
  }
  const guarded = require(path.join(root, 'src/app/actions/notes.ts'));
  try {
    await assert.rejects(() => guarded.createNoteAction('แอบเขียน'), /redirect:\/login/);
    await assert.rejects(() => guarded.updateNoteAction('x', 'แอบแก้'), /redirect:\/login/);
    await assert.rejects(() => guarded.deleteNoteAction('x'), /redirect:\/login/);
  } finally {
    process.env.AUTH_DISABLED = 'true';
  }
  assert.equal(fs.readFileSync(dataFile, 'utf8'), before, 'ไฟล์ต้องไม่ถูกแตะเลย');
});
