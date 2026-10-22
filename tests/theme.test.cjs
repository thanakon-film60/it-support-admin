// ธีมสว่าง/มืด + สีหลักที่เลือกได้ (ปุ่มลอย ThemeLauncher)
//
// ทำไมต้องมีเทสต์ทั้งที่เป็น "แค่สี": จุดพังของระบบนี้ไม่มีอะไรฟ้องเลย — tsc/eslint/next build ผ่านหมด
// แต่ผู้ใช้เจอ (1) ตัวหนังสือสีอ่อนหายบนพื้นขาว (2) กดเลือกสีเขียวแล้วครึ่งหน้ายังเป็นฟ้า
// (3) จอดำแวบทุกครั้งที่เปิดหน้า หรือ (4) กระดาษที่พิมพ์ออกมาสีเพี้ยนจากธีมบนจอ
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
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
const theme = require(path.join(root, 'src/lib/theme.ts'));
const { ThemeLauncher } = require(path.join(root, 'src/components/theme/ThemeLauncher.tsx'));

const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');

/** เนื้อในวงเล็บปีกกาของกฎแรกที่อยู่หลัง marker (นับวงเล็บซ้อน) */
function blockAfter(marker) {
  const at = css.indexOf(marker);
  assert.ok(at >= 0, `ไม่พบ "${marker}" ใน globals.css`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`วงเล็บของ "${marker}" ไม่ปิด`);
}

function declarations(body) {
  const out = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** ตัวแปรสีของ Tailwind (เช่น --color-rose-300) ที่ถูกเปลี่ยนเป็นโทนอื่น */
function paletteRemap(decls) {
  return Object.fromEntries(Object.entries(decls).filter(([k]) => /^--color-[a-z]+-\d{2,3}$/.test(k)));
}

function runInit(store, { throws = false } = {}) {
  const attrs = {};
  const context = {
    document: { documentElement: { setAttribute: (name, value) => { attrs[name] = value; } } },
    localStorage: {
      getItem: (key) => {
        if (throws) throw new Error('SecurityError: The operation is insecure.');
        return Object.hasOwn(store, key) ? store[key] : null;
      },
    },
  };
  vm.runInNewContext(theme.themeInitScript(), context);
  return attrs;
}

test('สคริปต์ใน <head> ตั้งธีม/สีหลักตามที่เครื่องนี้เลือกไว้', () => {
  const attrs = runInit({ [theme.THEME_STORAGE_KEY]: 'light', [theme.ACCENT_STORAGE_KEY]: 'emerald' });
  assert.deepEqual(attrs, { 'data-theme': 'light', 'data-accent': 'emerald' });
});

test('ยังไม่เคยเลือก = ไม่ตั้ง attribute เลย (CSS ตั้งต้นคือธีมมืด + ฟ้า หน้าตาเดิม)', () => {
  assert.deepEqual(runInit({}), {});
});

test('ค่าแปลกปลอมใน localStorage ถูกข้าม — ไม่ได้หน้าเว็บที่ไม่มีสีหลักเลย', () => {
  const attrs = runInit({
    [theme.THEME_STORAGE_KEY]: 'blue',
    [theme.ACCENT_STORAGE_KEY]: '"><img src=x onerror=alert(1)>',
  });
  assert.deepEqual(attrs, {});
});

test('เบราว์เซอร์ที่ห้ามแตะ localStorage (โหมดส่วนตัว) ต้องไม่ทำให้สคริปต์ล้มทั้งหน้า', () => {
  assert.doesNotThrow(() => runInit({}, { throws: true }));
});

test('root layout ฝังสคริปต์ใน <head> + ยอมให้ attribute ของ <html> ต่างจาก server', () => {
  const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
  assert.match(layout, /themeInitScript\(\)/);
  assert.match(layout, /suppressHydrationWarning/);
  // ถ้า server ใส่ data-theme เอง ทุกครั้งที่หน้ารีเฟรชข้อมูล (router.refresh) React อาจตั้งกลับเป็นค่า server
  assert.doesNotMatch(layout, /data-theme=/, 'อย่าใส่ data-theme ตั้งต้นที่ <html> ฝั่ง server');
});

test('ธีมสว่างกับตอนพิมพ์เปลี่ยนสีตัวหนังสือโทนอ่อนชุดเดียวกันเป๊ะ', () => {
  const light = paletteRemap(declarations(blockAfter(':root[data-theme="light"]')));
  const print = paletteRemap(declarations(blockAfter('@media print')));
  assert.ok(Object.keys(light).length >= 10, 'ธีมสว่างต้องเปลี่ยนสีตัวหนังสือโทนอ่อน');
  // เพิ่มสีใหม่ที่เดียว = สีนั้นจางหายบนจอธีมสว่าง หรือบนกระดาษ (อีกที่หนึ่งที่ลืม)
  assert.deepEqual(light, print);
});

test('สีบนปุ่มเลือกในหน้าต่างตรงกับสีที่ทั้งเว็บใช้จริง (ทั้งเฉดพื้นมืดและพื้นสว่าง)', () => {
  for (const accent of theme.ACCENTS) {
    const marker = accent.id === theme.DEFAULT_ACCENT ? ':root {' : `:root[data-accent="${accent.id}"]`;
    const decls = declarations(blockAfter(marker));
    assert.equal(decls['--accent-d']?.toLowerCase(), accent.dark.toLowerCase(), `${accent.label} (พื้นมืด)`);
    assert.equal(decls['--accent-l']?.toLowerCase(), accent.light.toLowerCase(), `${accent.label} (พื้นสว่าง)`);
  }
});

test('ตอนพิมพ์ใช้สีหลักเฉดเข้มเสมอ และชนะบล็อกธีมสว่าง (กระดาษต้องขาวล้วน)', () => {
  const print = declarations(blockAfter('@media print'));
  assert.equal(print['--color-accent'], 'var(--accent-l)');
  assert.equal(print['--color-page'].toLowerCase(), '#ffffff');
  assert.ok(css.indexOf('@media print') > css.indexOf(':root[data-theme="light"]'), 'บล็อกพิมพ์ต้องอยู่หลังธีมสว่าง');
  assert.match(css, /@media print\s*\{[\s\S]*?:root,\s*:root\[data-theme\]\s*\{/);
});

function listTsx(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listTsx(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

test('คอมโพเนนต์ใช้สีหลักผ่านโทเคน accent — ไม่ hardcode ฟ้า/ครามที่ไม่เปลี่ยนตามที่ผู้ใช้เลือก', () => {
  // ฟ้าที่เหลือได้คือ "สีสถานะ" (กำลังดำเนินการ · ใช้งานอยู่ · ประวัติแก้ไข/นำเข้า) ซึ่งต้องคงความหมายเดิม
  // ไม่ว่าผู้ใช้เลือกสีหลักอะไร — ใช้ accent กับสถานะเมื่อไหร่ เลือกสีเขียวแล้วสถานะไปชนกับ "เสร็จแล้ว"
  const STATUS_COLOR_FILES = ['src/components/ui/Badge.tsx', 'src/components/vault/VaultAuditList.tsx'];
  const offenders = [];
  for (const file of listTsx(path.join(root, 'src'))) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    if (STATUS_COLOR_FILES.includes(rel)) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/\b(?:border|ring|bg|from|via|to|text|accent|shadow|outline|fill|stroke)-(?:cyan|indigo)-\d{2,3}\b/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'ใช้ border-accent / ring-accent / from-accent to-accent-2 แทน');
});

test('พื้นโปร่งแสงใช้ bg-ink/[…] ไม่ใช่ bg-white/[…] (ขาวโปร่งบนพื้นขาวมองไม่เห็นในธีมสว่าง)', () => {
  const offenders = listTsx(path.join(root, 'src'))
    .filter((file) => /\bbg-white\//.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));
  assert.deepEqual(offenders, []);
});

test('ปุ่มลอยเรนเดอร์ปิดอยู่ตอนแรก มีชื่อให้โปรแกรมอ่านหน้าจอ และไม่โผล่บนกระดาษที่พิมพ์', () => {
  const html = renderToStaticMarkup(React.createElement(ThemeLauncher));
  assert.ok(html.includes('aria-label="เปิดหน้าต่างตั้งค่าการแสดงผล"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('print:hidden'));
  // หน้าต่างยังไม่เปิด = ไม่มีปุ่มเลือกธีมใน HTML (server ไม่รู้ว่าเครื่องนี้เลือกอะไร จะวาดผิดปุ่ม)
  assert.ok(!html.includes('aria-pressed'));
});

test('ทุกหน้าในแดชบอร์ดมีปุ่มลอย', () => {
  const layout = fs.readFileSync(path.join(root, 'src/app/(dashboard)/layout.tsx'), 'utf8');
  assert.match(layout, /<ThemeLauncher \/>/);
});
