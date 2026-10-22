// คลังไฟล์ (/files): อัปโหลดเป็นท่อน · ดาวน์โหลด · โฟลเดอร์ · สิทธิ์ · ความปลอดภัยของ path
//
// สิ่งที่กลัวที่สุดของหน้านี้คือ "ไฟล์เสียแต่บอกว่าสำเร็จ" (ท่อนซ้ำ/ท่อนหาย/ถูกตัด) กับ "ไฟล์หายแบบไม่ตั้งใจ"
// (ลบโฟลเดอร์ที่มีของ · JSON เสียแล้วถูกเขียนทับ) เทสต์จึงตรวจด้วยไบต์จริงและ SHA-256 ไม่ใช่แค่ดูสถานะ
// รัน route handler กับ Server Action ตัวจริงบนโฟลเดอร์ชั่วคราว ไม่แตะข้อมูลของเครื่องจริง
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
    return { redirect(url) { throw new Error(`redirect:${url}`); }, useRouter: () => ({ refresh() {} }) };
  }
  if (id === 'next/link') {
    const React = require('react');
    return { __esModule: true, default: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children) };
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-'));
process.chdir(tmp);
process.env.AUTH_DISABLED = 'true';
delete process.env.DRIVE_DIR;
delete process.env.DRIVE_QUOTA_GB;

const load = (file) => require(path.join(root, file));
const shared = load('src/lib/drive-shared.ts');
const http = load('src/lib/drive/http.ts');
const actions = load('src/app/actions/drive.ts');
const startRoute = load('src/app/api/drive/uploads/route.ts');
const chunkRoute = load('src/app/api/drive/uploads/[id]/route.ts');
const completeRoute = load('src/app/api/drive/uploads/[id]/complete/route.ts');
const fileRoute = load('src/app/api/drive/files/[id]/route.ts');

const dataFile = (name) => path.join(tmp, 'data', `${name}.json`);
const readData = (name) => JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
const driveDir = path.join(tmp, 'drive');
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const H = { 'x-drive-client': '1' };

const start = (body, headers = H) => startRoute.POST(new Request('http://localhost/api/drive/uploads', {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const put = (id, offset, bytes, declared = bytes.length) => chunkRoute.PUT(new Request(
  `http://localhost/api/drive/uploads/${id}?offset=${offset}`,
  { method: 'PUT', headers: { ...H, 'x-chunk-length': String(declared) }, body: bytes }
), ctx(id));
const complete = (id) => completeRoute.POST(new Request(`http://localhost/api/drive/uploads/${id}/complete`, { method: 'POST', headers: H }), ctx(id));
const download = (id, headers = {}) => fileRoute.GET(new Request(`http://localhost/api/drive/files/${id}`, { headers }), ctx(id));

/** อัปโหลดทั้งไฟล์ผ่าน API จริง ท่อนละ 8 MB แบบเดียวกับหน้าเว็บ */
async function uploadAll(name, bytes, folderId = null) {
  const res = await start({ name, size: bytes.length, type: 'application/x-msdownload', folderId });
  assert.equal(res.status, 201, await res.clone().text());
  const { uploadId, chunkSize } = await res.json();
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const r = await put(uploadId, offset, bytes.subarray(offset, offset + chunkSize));
    assert.equal(r.status, 200);
  }
  const done = await complete(uploadId);
  assert.equal(done.status, 200, await done.clone().text());
  return (await done.json()).fileId;
}

beforeEach(() => {
  fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true });
  fs.rmSync(driveDir, { recursive: true, force: true });
  delete process.env.DRIVE_QUOTA_GB;
});

after(() => {
  process.chdir(root);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/* ───────────── กฎกลางที่หน้าเว็บกับเซิร์ฟเวอร์ใช้ร่วมกัน ───────────── */

test('ชื่อไฟล์: ตัวคั่น path กลายเป็นขีด · ตัวอักษรควบคุมถูกตัด · ชื่อว่าง/ยาวเกินถูกปฏิเสธ', () => {
  assert.deepEqual(shared.cleanDriveName('  ใบเสนอราคา 1/2.pdf '), { ok: true, name: 'ใบเสนอราคา 1-2.pdf' });
  assert.deepEqual(shared.cleanDriveName('..\\..\\evil.exe'), { ok: true, name: '..-..-evil.exe' });
  assert.equal(shared.cleanDriveName('a\u0000b\nc.txt').name, 'ab c.txt');
  for (const bad of ['', '   ', '.', '..', 'ก'.repeat(shared.DRIVE_NAME_MAX + 1), 42]) {
    assert.equal(shared.cleanDriveName(bad).ok, false, JSON.stringify(bad));
  }
});

test('ขนาด/ไอคอน/ค้นหา/เส้นทางโฟลเดอร์', () => {
  assert.equal(shared.formatBytes(0), '0 B');
  assert.equal(shared.formatBytes(1536), '1.5 KB');
  assert.equal(shared.formatBytes(shared.DRIVE_MAX_FILE_BYTES), '500 MB');
  assert.equal(shared.fileKind('Setup_Printer.EXE').label, 'โปรแกรม');
  assert.equal(shared.fileKind('ไม่มีนามสกุล').icon, '📎');
  assert.ok(shared.driveMatches({ name: 'Driver HP 682.zip', note: 'ใช้กับเครื่อง บัญชี' }, 'hp682'));
  assert.ok(shared.driveMatches({ name: 'x', note: 'ใช้กับเครื่อง บัญชี' }, 'เครื่องบัญชี'));
  const folders = [
    { id: 'a', name: 'โปรแกรม', parent_id: null },
    { id: 'b', name: 'ไดรเวอร์', parent_id: 'a' },
    { id: 'x', name: 'วน1', parent_id: 'y' }, { id: 'y', name: 'วน2', parent_id: 'x' },
  ];
  assert.equal(shared.folderLabel(folders, 'b'), 'โปรแกรม / ไดรเวอร์');
  assert.equal(shared.folderLabel(folders, null), 'คลังไฟล์');
  assert.ok(shared.folderTrail(folders, 'x').length <= 2, 'ข้อมูลวนต้องไม่ทำให้ค้าง');
});

test('ดาวน์โหลดชื่อไทยไม่เพี้ยน และช่วง Range ถูกต้อง', () => {
  const cd = http.contentDisposition('คู่มือ "ติดตั้ง".pdf');
  assert.match(cd, /^attachment; /);
  assert.match(cd, /filename\*=UTF-8''%E0%B8%84/);
  assert.ok(!/filename="[^"]*"[^;]*"/.test(cd), 'เครื่องหมายคำพูดในชื่อต้องไม่ทำให้ header แตก');
  assert.deepEqual(http.parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(http.parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(http.parseRange('bytes=-5', 100), { start: 95, end: 99 });
  assert.deepEqual(http.parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(http.parseRange('bytes=100-', 100), 'invalid');
  assert.equal(http.parseRange(null, 100), null);
  assert.equal(http.parseRange('bytes=1-2,5-6', 100), null, 'หลายช่วง = ส่งทั้งไฟล์');
});

/* ───────────── อัปโหลด ───────────── */

test('อัปโหลดไฟล์หลายท่อนแล้วได้ไฟล์ตรงทุกไบต์ + SHA-256 ถูกต้อง', async () => {
  const bytes = crypto.randomBytes(shared.DRIVE_CHUNK_BYTES * 2 + 12345);
  const fileId = await uploadAll('ติดตั้งโปรแกรมบัญชี.exe', bytes);

  const [row] = readData('drive_files');
  assert.equal(row.id, fileId);
  assert.equal(row.name, 'ติดตั้งโปรแกรมบัญชี.exe');
  assert.equal(row.size, bytes.length);
  assert.equal(row.uploaded_by, 'ผู้ใช้ทั่วไป');
  assert.equal(row.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.ok(fs.readFileSync(path.join(driveDir, 'blobs', fileId)).equals(bytes), 'ไฟล์บนดิสก์ต้องตรงทุกไบต์');
  assert.deepEqual(readData('drive_uploads'), [], 'จบแล้วต้องไม่เหลือรายการค้าง');
  assert.deepEqual(fs.readdirSync(path.join(driveDir, 'parts')), [], 'ต้องไม่เหลือไฟล์ท่อนค้าง');
});

test('ส่งท่อนเดิมซ้ำ (เน็ตหลุดแล้วลองใหม่) ต้องไม่ถูกเขียนสองรอบ · ข้ามตำแหน่งต้องได้ 409 พร้อมตำแหน่งจริง', async () => {
  const bytes = crypto.randomBytes(1000);
  const { uploadId } = await (await start({ name: 'a.bin', size: 1000 })).json();

  assert.equal((await (await put(uploadId, 0, bytes.subarray(0, 400))).json()).received, 400);
  const again = await put(uploadId, 0, bytes.subarray(0, 400));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).received, 400, 'ท่อนซ้ำต้องไม่ทำให้ไฟล์ยาวขึ้น');

  const skip = await put(uploadId, 700, bytes.subarray(700, 1000));
  assert.equal(skip.status, 409);
  assert.equal((await skip.json()).received, 400, 'ต้องบอกตำแหน่งจริงให้ส่งต่อถูกที่');

  const early = await complete(uploadId);
  assert.equal(early.status, 409, 'ยังไม่ครบห้ามขึ้นรายการ');
  assert.equal(fs.existsSync(dataFile('drive_files')) ? readData('drive_files').length : 0, 0);

  await put(uploadId, 400, bytes.subarray(400));
  assert.equal((await complete(uploadId)).status, 200);
  const [row] = readData('drive_files');
  assert.ok(fs.readFileSync(path.join(driveDir, 'blobs', row.id)).equals(bytes));
});

test('ท่อนที่มาไม่ครบ (ถูกตัดกลางทาง) ต้องถูกปฏิเสธให้ส่งใหม่ ไม่ใช่เขียนลงไฟล์', async () => {
  const { uploadId } = await (await start({ name: 'a.bin', size: 100 })).json();
  const res = await put(uploadId, 0, crypto.randomBytes(60), 100);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).retry, true);
  assert.equal(fs.statSync(path.join(driveDir, 'parts', `${uploadId}.part`)).size, 0);
});

test('ขนาด/ท่อนใหญ่เกิน · ไม่มี header ของหน้าคลังไฟล์ · โฟลเดอร์ไม่มีจริง → ปฏิเสธก่อนรับไฟล์', async () => {
  assert.equal((await start({ name: 'big.iso', size: shared.DRIVE_MAX_FILE_BYTES + 1 })).status, 413);
  assert.equal((await start({ name: 'ok.bin', size: shared.DRIVE_MAX_FILE_BYTES })).status, 201, 'พอดีเพดานต้องผ่าน');
  assert.equal((await start({ name: 'a.bin', size: 10 }, {})).status, 403, 'ไม่มี header = อาจเป็นเว็บอื่นแอบสั่ง');
  assert.equal((await start({ name: 'a.bin', size: 10, folderId: crypto.randomUUID() })).status, 404);
  assert.equal((await start({ name: '', size: 10 })).status, 400);
  assert.equal((await start({ name: 'a', size: -1 })).status, 400);

  const { uploadId } = await (await start({ name: 'a.bin', size: shared.DRIVE_CHUNK_BYTES * 2 })).json();
  assert.equal((await put(uploadId, 0, Buffer.alloc(shared.DRIVE_CHUNK_BYTES + 1))).status, 413);
});

test('โควตาเต็มต้องถูกปฏิเสธตั้งแต่ก่อนส่งไฟล์ และนับไฟล์ที่กำลังอัปโหลดอยู่ด้วย', async () => {
  process.env.DRIVE_QUOTA_GB = String(1000 / 1024 ** 3); // = 1000 ไบต์
  assert.equal((await start({ name: 'a.bin', size: 600 })).status, 201);
  const res = await start({ name: 'b.bin', size: 600 });
  assert.equal(res.status, 507, 'ไฟล์แรกยังส่งไม่เสร็จแต่ต้องนับพื้นที่ที่จองไว้แล้ว');
  assert.match((await res.json()).error, /เต็ม/);
});

test('ยกเลิกแล้วลบท่อนทิ้ง · การอัปโหลดที่ค้างเกิน 24 ชม. ถูกเก็บกวาดเอง', async () => {
  const { uploadId } = await (await start({ name: 'a.bin', size: 50 })).json();
  await put(uploadId, 0, crypto.randomBytes(20));
  const del = await chunkRoute.DELETE(new Request(`http://localhost/x`, { method: 'DELETE', headers: H }), ctx(uploadId));
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(path.join(driveDir, 'parts', `${uploadId}.part`)), false);
  assert.equal((await put(uploadId, 20, crypto.randomBytes(5))).status, 410);

  const old = await (await start({ name: 'old.bin', size: 50 })).json();
  const rows = readData('drive_uploads');
  rows[0].created_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  fs.writeFileSync(dataFile('drive_uploads'), JSON.stringify(rows));
  await start({ name: 'new.bin', size: 10 });
  assert.ok(!readData('drive_uploads').some((u) => u.id === old.uploadId));
  assert.equal(fs.existsSync(path.join(driveDir, 'parts', `${old.uploadId}.part`)), false);
});

test('id ที่ไม่ใช่ UUID (เช่น ../) ถูกปฏิเสธก่อนแตะดิสก์', async () => {
  for (const id of ['../../etc/passwd', '..', 'abc', '']) {
    assert.equal((await put(id, 0, Buffer.from('x'))).status, 400, id);
    assert.equal((await download(id)).status, 400, id);
  }
});

/* ───────────── ดาวน์โหลด ───────────── */

test('ดาวน์โหลดได้ทั้งไฟล์และต่อจากที่ค้าง (Range) · ส่งเป็นไฟล์แนบเสมอ', async () => {
  const bytes = Buffer.from('0123456789ABCDEF');
  const id = await uploadAll('<script>.html', bytes);

  const full = await download(id);
  assert.equal(full.status, 200);
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(bytes));
  assert.equal(full.headers.get('content-type'), 'application/octet-stream', 'ห้ามให้เบราว์เซอร์เปิด HTML ที่อัปโหลดมา');
  assert.match(full.headers.get('content-disposition'), /^attachment;/);
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');

  const part = await download(id, { range: 'bytes=4-9' });
  assert.equal(part.status, 206);
  assert.equal(Buffer.from(await part.arrayBuffer()).toString(), '456789');
  assert.equal(part.headers.get('content-range'), 'bytes 4-9/16');

  assert.equal((await download(id, { range: 'bytes=99-' })).status, 416);
  assert.equal((await download(crypto.randomUUID())).status, 404);

  fs.unlinkSync(path.join(driveDir, 'blobs', id));
  const gone = await download(id);
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /หาย/);
});

/* ───────────── โฟลเดอร์และการจัดการไฟล์ ───────────── */

test('โฟลเดอร์ซ้อนได้ · ชื่อซ้ำในชั้นเดียวกันไม่ได้ (ไม่สนตัวพิมพ์) · ต่างชั้นซ้ำได้', async () => {
  assert.deepEqual(await actions.createFolderAction(null, 'Drivers'), {});
  const [top] = readData('drive_folders');
  assert.match((await actions.createFolderAction(null, ' drivers ')).error, /มีโฟลเดอร์ชื่อ/);
  assert.deepEqual(await actions.createFolderAction(top.id, 'Drivers'), {});
  assert.match((await actions.createFolderAction(crypto.randomUUID(), 'x')).error, /ไม่พบ/);
  assert.match((await actions.createFolderAction(null, '   ')).error, /ตั้งชื่อ/);

  assert.deepEqual(await actions.renameFolderAction(top.id, 'ไดรเวอร์'), {});
  assert.equal(readData('drive_folders').find((f) => f.id === top.id).name, 'ไดรเวอร์');
});

test('ลบโฟลเดอร์ได้เฉพาะตอนว่าง — มีไฟล์ / โฟลเดอร์ย่อย / กำลังอัปโหลดเข้า = ลบไม่ได้', async () => {
  await actions.createFolderAction(null, 'A');
  const a = readData('drive_folders')[0];
  const fileId = await uploadAll('x.txt', Buffer.from('hello'), a.id);
  assert.match((await actions.deleteFolderAction(a.id)).error, /ยังมีไฟล์/);

  await actions.moveFileAction(fileId, null);
  assert.equal(readData('drive_files')[0].folder_id, null);
  await actions.createFolderAction(a.id, 'B');
  assert.match((await actions.deleteFolderAction(a.id)).error, /โฟลเดอร์ย่อย/);

  const b = readData('drive_folders').find((f) => f.name === 'B');
  await start({ name: 'pending.bin', size: 10, folderId: b.id });
  assert.match((await actions.deleteFolderAction(b.id)).error, /กำลังอัปโหลด/);
});

test('แก้ชื่อ/ข้อความกำกับ · ย้ายไปโฟลเดอร์ที่ไม่มีจริงไม่ได้ · ลบแล้วไฟล์บนดิสก์หายด้วย', async () => {
  const id = await uploadAll('setup.exe', Buffer.from('MZ....'));
  assert.deepEqual(await actions.updateFileAction(id, { name: 'Setup v2.exe', note: '  ใช้กับ Windows 11\r\nรหัสอยู่ที่พี่แชมป์  ' }), {});
  const row = readData('drive_files')[0];
  assert.equal(row.name, 'Setup v2.exe');
  assert.equal(row.note, 'ใช้กับ Windows 11\nรหัสอยู่ที่พี่แชมป์');
  assert.equal(row.updated_by, 'ผู้ใช้ทั่วไป');
  assert.match((await actions.updateFileAction(id, { name: 'x', note: 'ก'.repeat(shared.DRIVE_NOTE_MAX + 1) })).error, /ยาวเกิน/);
  assert.match((await actions.moveFileAction(id, crypto.randomUUID())).error, /ไม่พบโฟลเดอร์/);

  assert.deepEqual(await actions.deleteFileAction(id), {});
  assert.deepEqual(readData('drive_files'), []);
  assert.equal(fs.existsSync(path.join(driveDir, 'blobs', id)), false);
  assert.deepEqual(await actions.deleteFileAction(id), {}, 'ลบซ้ำ = หายอยู่แล้ว ไม่ error');
});

test('ไฟล์ข้อมูลเสียต้องไม่ถูกเขียนทับ — รายการไฟล์เดิมต้องยังกู้ได้', async () => {
  // ส่งครบทุกท่อนก่อน แล้วไฟล์รายการเสียตอนจะปิดท้าย = จังหวะที่เสี่ยงทิ้งไฟล์กำพร้าไว้บนดิสก์มากที่สุด
  const { uploadId } = await (await start({ name: 'a.bin', size: 3 })).json();
  await put(uploadId, 0, Buffer.from('abc'));
  const broken = '[{"id":"x","name":"ไฟล์สำคัญ.xlsx"';
  fs.writeFileSync(dataFile('drive_files'), broken);

  const logError = console.error;
  console.error = () => {};
  try {
    assert.equal((await complete(uploadId)).status, 500);
    const again = await start({ name: 'b.bin', size: 3 });
    assert.equal(again.status, 500, 'ไฟล์รายการเสีย = ไม่รับไฟล์ใหม่จนกว่าจะกู้');
    assert.match((await again.json()).error, /ไม่ออก/);
    await actions.createFolderAction(null, 'A');
    const folder = readData('drive_folders')[0];
    assert.match((await actions.deleteFolderAction(folder.id)).error, /ไม่ออก/, 'ตรวจว่าโฟลเดอร์ว่างไม่ได้ = ห้ามลบ');
    assert.match((await actions.updateFileAction(crypto.randomUUID(), { name: 'x', note: '' })).error, /ไม่ออก/);
  } finally {
    console.error = logError;
  }
  assert.equal(fs.readFileSync(dataFile('drive_files'), 'utf8'), broken, 'ไฟล์เดิมต้องเหมือนเดิมทุกไบต์');
  assert.deepEqual(fs.readdirSync(path.join(driveDir, 'blobs')), [], 'ไฟล์ที่บันทึกรายการไม่ได้ต้องไม่ค้างเป็นของกำพร้า');
});

/* ───────────── สิทธิ์ ───────────── */

test('ไม่ได้ล็อกอิน: API ตอบ 401 · ลิงก์ดาวน์โหลดพาไปหน้า login · Action ทำอะไรไม่ได้', async () => {
  const id = await uploadAll('secret.pdf', Buffer.from('%PDF'));
  process.env.AUTH_DISABLED = 'false';
  for (const file of ['src/lib/auth.ts', 'src/lib/drive/http.ts', 'src/app/api/drive/uploads/route.ts',
    'src/app/api/drive/files/[id]/route.ts', 'src/app/actions/drive.ts']) {
    delete require.cache[path.join(root, file)];
  }
  try {
    const guardedStart = load('src/app/api/drive/uploads/route.ts');
    const res = await guardedStart.POST(new Request('http://localhost/api/drive/uploads', {
      method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'a', size: 1 }),
    }));
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /ล็อกอิน/);

    const guardedFile = load('src/app/api/drive/files/[id]/route.ts');
    const dl = await guardedFile.GET(new Request(`http://localhost/api/drive/files/${id}`), ctx(id));
    assert.equal(dl.status, 307);
    assert.match(dl.headers.get('location'), /\/login/);

    const guardedActions = load('src/app/actions/drive.ts');
    await assert.rejects(() => guardedActions.deleteFileAction(id), /redirect:\/login/);
    await assert.rejects(() => guardedActions.createFolderAction(null, 'x'), /redirect:\/login/);
  } finally {
    process.env.AUTH_DISABLED = 'true';
  }
  assert.equal(readData('drive_files').length, 1, 'ต้องไม่มีอะไรถูกลบ');
});

/* ───────────── หน้าเว็บ ───────────── */

test('หน้าคลังไฟล์แสดงโฟลเดอร์ ไฟล์ ข้อความกำกับ และพื้นที่ที่ใช้', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { DriveBoard } = load('src/components/drive/DriveBoard.tsx');
  const folders = [
    { id: 'f1', name: 'โปรแกรมติดตั้ง', parent_id: null, created_at: '2026-10-07T03:00:00.000Z', created_by: 'IT' },
    { id: 'f2', name: 'ไดรเวอร์', parent_id: 'f1', created_at: '2026-10-07T03:00:00.000Z', created_by: 'IT' },
  ];
  const files = [
    { id: 'a', folder_id: 'f1', name: 'AnyDesk.exe', size: 5 * 1024 * 1024, mime: '', note: 'เวอร์ชันล่าสุด ใช้รีโมตช่วยสาขา',
      sha256: null, uploaded_at: '2026-10-07T03:00:00.000Z', uploaded_by: 'ผู้ดูแลระบบ IT', updated_at: null, updated_by: null },
    { id: 'b', folder_id: null, name: 'ระเบียบการใช้คอม.pdf', size: 1200, mime: '', note: null,
      sha256: null, uploaded_at: '2026-10-06T03:00:00.000Z', uploaded_by: 'แพรว', updated_at: null, updated_by: null },
  ];
  const render = (props) => renderToStaticMarkup(React.createElement(DriveBoard, {
    folders, files, currentFolderId: null, usage: { used: 5 * 1024 * 1024, quota: 20 * 1024 ** 3, free: 50 * 1024 ** 3 }, loadError: null, ...props,
  }));

  const rootHtml = render();
  for (const text of ['คลังไฟล์', 'โปรแกรมติดตั้ง', 'ระเบียบการใช้คอม.pdf', 'ใช้ไป', '5.0 MB', '20.0 GB', 'อัปโหลดไฟล์']) {
    assert.ok(rootHtml.includes(text), `ไม่เห็น "${text}" ที่ชั้นบนสุด`);
  }
  assert.ok(!rootHtml.includes('AnyDesk.exe'), 'ไฟล์ในโฟลเดอร์ย่อยต้องไม่โผล่ที่ชั้นบนสุด');

  const inside = render({ currentFolderId: 'f1' });
  for (const text of ['AnyDesk.exe', 'เวอร์ชันล่าสุด ใช้รีโมตช่วยสาขา', 'ไดรเวอร์', '/api/drive/files/a', '7 ต.ค. 2569 · 10:00']) {
    assert.ok(inside.includes(text), `ไม่เห็น "${text}" ในโฟลเดอร์`);
  }

  const broken = render({ folders: [], files: [], loadError: 'อ่านข้อมูลคลังไฟล์ไม่ออก' });
  assert.ok(broken.includes('อ่านข้อมูลคลังไฟล์ไม่ออก'));
  assert.ok(broken.includes('แสดงไฟล์ไม่ได้จนกว่าจะกู้ไฟล์ข้อมูล'));
});

test('/api/health บอก deploy.ps1 ได้ว่าคลังไฟล์เขียนได้ไหม — volume ไม่ได้ mount ต้องรายงาน false ไม่ใช่เงียบ', async () => {
  const health = load('src/app/api/health/route.ts');
  fs.mkdirSync(driveDir, { recursive: true });
  let storage = (await (await health.GET()).json()).storage;
  assert.equal(storage.drive_writable, true);
  assert.equal(storage.drive_quota_gb, 20, 'ไม่ตั้ง DRIVE_QUOTA_GB = ค่าตั้งต้น 20');

  process.env.DRIVE_DIR = path.join(tmp, 'ไม่มีโฟลเดอร์นี้');
  process.env.DRIVE_QUOTA_GB = '50';
  try {
    storage = (await (await health.GET()).json()).storage;
    assert.equal(storage.drive_writable, false, 'อัปโหลดจะล้มทุกไฟล์ — deploy.ps1 ต้องเห็นเพื่อฟ้อง');
    assert.equal(storage.drive_quota_gb, 50);
  } finally {
    delete process.env.DRIVE_DIR;
  }
});
