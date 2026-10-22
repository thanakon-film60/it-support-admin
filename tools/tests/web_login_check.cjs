// ตัวช่วยของ tools/tests/test_staff_admin.py — พิสูจน์ว่าบัญชีที่โปรแกรม .py สร้าง/แก้
// ใช้กับ "โค้ดเว็บตัวจริง" ได้ (src/lib/auth.ts: bcryptjs + JWT + อ่านไฟล์บัญชีทุก request)
//
// ใช้:  node web_login_check.cjs <โฟลเดอร์ที่มี data/> login <username> <password>
//       node web_login_check.cjs <โฟลเดอร์ที่มี data/> session <token>
// พิมพ์ JSON บรรทัดเดียวออก stdout — รหัสผ่านรับทาง argv เพราะเป็นรหัสทดสอบในโฟลเดอร์ชั่วคราวเท่านั้น
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..', '..');
const jar = new Map();
const cookieStore = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  set: (name, value) => { jar.set(name, value); },
  delete: (name) => { jar.delete(name); },
};
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'next/headers') return { cookies: async () => cookieStore };
  if (id === 'next/navigation') return { redirect(url) { throw new Error(`redirect:${url}`); } };
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);

const [, , workdir, mode, a, b] = process.argv;
process.chdir(workdir);
process.env.AUTH_DISABLED = 'false';
process.env.SESSION_SECRET = 'staff-admin-web-check';
const auth = require(path.join(root, 'src/lib/auth.ts'));

(async () => {
  let out;
  if (mode === 'login') {
    const result = await auth.signIn(a, b);
    const session = result.ok ? await auth.getSession() : null;
    out = { ok: result.ok, error: result.ok ? null : result.error, session, token: jar.get('itadmin_session') ?? null };
  } else if (mode === 'session') {
    jar.set('itadmin_session', a);
    out = { session: await auth.getSession() };
  } else {
    throw new Error(`mode ไม่รู้จัก: ${mode}`);
  }
  process.stdout.write(JSON.stringify(out));
})().catch((err) => {
  process.stderr.write(String(err && err.stack || err));
  process.exit(1);
});
