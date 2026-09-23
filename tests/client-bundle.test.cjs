// กัน client component ลากโมดูลฝั่งเซิร์ฟเวอร์ (node:fs ฯลฯ) เข้า bundle ของเบราว์เซอร์
//
// ทำไมต้องมีเทสต์นี้: บั๊กประเภทนี้ tsc และ eslint จับไม่ได้เลย (มันถูกต้องทุกอย่างในเชิงชนิดข้อมูล)
// จะรู้ตัวก็ตอน `next build` ล้มด้วยข้อความที่ชี้ไปผิดจุด —
//   "Failed to write app endpoint /(dashboard)/tickets/page
//    Caused by: the chunking context does not support external modules (request: node:fs)"
// ซึ่งบอกชื่อ "หน้า" ที่พัง แต่ไม่บอกว่า import ตัวไหนเป็นต้นเหตุ และ build ใช้เวลาเป็นนาที
// เจอจริงตอน 2026-09-17: TicketsBoard.tsx (client) import COMPANIES จาก lib/db/branches.ts
// ซึ่งเรียกผ่าน lib/db/store.ts ที่ import node:fs — แก้โดยย้ายค่าคงที่ไป lib/companies.ts
//
// เทสต์นี้เดินตาม import ของจริงทีละชั้น และ **ข้าม `import type`** เพราะ TypeScript ลบทิ้ง
// ตอนคอมไพล์ ไม่ได้ติดไปกับ bundle (นี่คือเหตุผลที่ import type จาก lib/db ยังใช้ได้ตามปกติ)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');

// เฉพาะโมดูลที่ bundler "ไม่มีตัวแทนฝั่งเบราว์เซอร์ให้" จริงๆ เท่านั้น
//
// จงใจไม่ใส่ node:crypto / node:path: Turbopack มี shim ให้ทั้งคู่ และโค้ดชุดนี้ก็ใช้อยู่แล้ว
// (lib/utils.ts เรียก node:crypto และถูก client component หลายตัว import มาตั้งแต่ก่อนหน้านี้
// โดย build ผ่านปกติ) ถ้าดักกว้างเกินไป เทสต์จะฟ้องของที่ใช้งานได้จริงจนไม่มีใครเชื่อมันอีก
const SERVER_ONLY_MODULES = [
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'child_process', 'node:child_process',
  'net', 'node:net', 'dns', 'node:dns',
  'server-only',
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** import ที่ "ติดไปกับ bundle จริง" — ตัด `import type` และ `export type` ทิ้ง */
function runtimeImports(file) {
  const code = fs.readFileSync(file, 'utf8');
  const specs = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (/^\s*type\s/.test(m[1])) continue; // import type { X } from '...'
    specs.push(m[2]);
  }
  // `import 'x'` แบบไม่มี from (side-effect import) ก็ติดไปด้วย
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = bare.exec(code)) !== null) specs.push(m[1]);
  return specs;
}

function resolveLocal(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(srcDir, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // แพ็กเกจจาก node_modules — ไม่ใช่โค้ดของเรา ไม่ต้องเดินต่อ
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** เดินตาม import ไปจนสุด แล้วคืนเส้นทางแรกที่ไปโดนโมดูลฝั่งเซิร์ฟเวอร์ (ถ้ามี) */
function findServerOnlyPath(entry) {
  const queue = [[entry]];
  const seen = new Set([entry]);
  while (queue.length > 0) {
    const trail = queue.shift();
    const file = trail[trail.length - 1];
    for (const spec of runtimeImports(file)) {
      if (SERVER_ONLY_MODULES.includes(spec)) return [...trail, spec];
      const next = resolveLocal(spec, file);
      if (!next || seen.has(next)) continue;
      // Server Action ("use server") ถูกแปลงเป็นการเรียกข้ามเครือข่าย ไม่ได้ bundle เข้าเบราว์เซอร์
      if (/^\s*["']use server["']/m.test(fs.readFileSync(next, 'utf8'))) continue;
      seen.add(next);
      queue.push([...trail, next]);
    }
  }
  return null;
}

test('client components ต้องไม่ลากโมดูลฝั่งเซิร์ฟเวอร์เข้า bundle', () => {
  const clientFiles = walk(srcDir).filter((f) =>
    /^\s*["']use client["']/m.test(fs.readFileSync(f, 'utf8'))
  );
  assert.ok(clientFiles.length > 0, 'ไม่พบ client component เลย — เทสต์นี้คงหาไฟล์ผิดที่');

  const offenders = [];
  for (const file of clientFiles) {
    const trail = findServerOnlyPath(file);
    if (trail) offenders.push(trail.map((p) => (p.startsWith('/') ? path.relative(root, p) : p)).join('\n      -> '));
  }

  assert.deepEqual(
    offenders,
    [],
    `client component ลากโมดูลฝั่งเซิร์ฟเวอร์เข้ามา (next build จะล้ม):\n\n   ${offenders.join('\n\n   ')}\n`
  );
});
