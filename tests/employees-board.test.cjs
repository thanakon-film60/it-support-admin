// เรนเดอร์หน้าทะเบียนพนักงานจริงด้วย react-dom/server แล้วตรวจสิ่งที่ต้องเห็นบนจอ
//
// ทำไมต้องเรนเดอร์จริง ไม่เช็คแค่ tsc: หน้านี้มี logic การกรอง/นับที่ tsc มองไม่เห็นเลย
// (คนที่ปิดใช้งานต้องถูกซ่อน · คนที่ HR ยังไม่จัดฝ่ายต้องขึ้น "อื่นๆ" ไม่ใช่ช่องว่าง ·
// ตัวเลขสรุปต้องนับเฉพาะคนที่ยังใช้งานอยู่) พลาดข้อไหนก็ยัง build ผ่านและ deploy ขึ้นได้
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  // next/navigation กับ server action ใช้จริงไม่ได้นอก request ของ Next.js — แทนด้วยตัวหลอก
  if (id === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  if (id === '@/app/actions/employees') return new Proxy({}, { get: () => async () => ({}) });
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
const { EmployeesBoard } = require(path.join(root, 'src/components/employees/EmployeesBoard.tsx'));
const { COMPANIES } = require(path.join(root, 'src/lib/companies.ts'));

const person = (over) => ({
  id: 'x', display_name: 'ไม่มีชื่อ', employee_id: null, department: null, line_user_id: null,
  email: null, created_at: '2026-09-26T00:00:00.000Z', title: null, nickname: null,
  position: null, level: null, company: null, active: true, ...over,
});

const EMPLOYEES = [
  person({ id: 'u1', display_name: 'ธนากร โฮงทอง', employee_id: 'A69048', title: 'นาย',
    nickname: 'ฟิล์ม', department: 'ฝ่ายเทคโนโลยีสารสนเทศ', position: 'IT Software/Network',
    level: 'SF-2', company: 'motta', line_user_id: 'U_film' }),
  person({ id: 'u2', display_name: 'จินตนา กาเรือง', employee_id: 'A68025', title: 'นางสาว',
    nickname: 'เอ๋', company: 'motta' }),
  person({ id: 'u3', display_name: 'ลาออกแล้ว ทดสอบ', employee_id: 'A00001',
    department: 'ฝ่ายขาย', company: 'montipa', active: false }),
];

function render(over = {}) {
  return renderToStaticMarkup(
    React.createElement(EmployeesBoard, {
      employees: EMPLOYEES,
      companies: COMPANIES,
      departments: ['ฝ่ายขาย', 'ฝ่ายเทคโนโลยีสารสนเทศ', 'อื่นๆ'],
      otherDepartment: 'อื่นๆ',
      ticketCounts: { u1: 3 },
      assetCounts: { u1: 1 },
      ...over,
    })
  );
}

test('แสดงชื่อ ชื่อเล่น รหัส และฝ่ายของพนักงานที่ใช้งานอยู่', () => {
  const html = render();
  for (const text of ['ธนากร โฮงทอง', '(ฟิล์ม)', 'A69048', 'ฝ่ายเทคโนโลยีสารสนเทศ']) {
    assert.ok(html.includes(text), `ไม่เห็น "${text}" บนหน้าจอ`);
  }
});

test('คนที่ HR ยังไม่จัดฝ่ายต้องขึ้น "อื่นๆ" ไม่ใช่ช่องว่าง', () => {
  // 56 คนจากทะเบียนอยู่กลุ่มนี้ — ถ้าปล่อยเป็นช่องว่างจะดูเหมือนข้อมูลหาย
  // แล้วแอดมินจะไปไล่แก้ทีละคนทั้งที่ระบบตั้งใจให้เป็นแบบนั้น
  const html = render();
  assert.ok(html.includes('จินตนา กาเรือง'));
  assert.ok(html.includes('อื่นๆ'));
});

test('คนที่ปิดใช้งานถูกซ่อนไว้จนกว่าจะติ๊กแสดง', () => {
  assert.ok(!render().includes('ลาออกแล้ว ทดสอบ'));
});

test('ตัวเลขสรุปนับเฉพาะคนที่ยังใช้งานอยู่', () => {
  // คนที่ลาออกแล้วไม่ควรถูกนับรวม ไม่งั้นตัวเลข "พนักงานทั้งหมด" จะโตขึ้นเรื่อยๆ
  // จนใช้เทียบกับกำลังคนจริงไม่ได้
  const html = render();
  const pick = (label) => {
    const at = html.indexOf(label);
    assert.notEqual(at, -1, `ไม่เจอป้าย "${label}"`);
    const m = html.slice(at, at + 200).match(/>(\d+)</);
    return m ? Number(m[1]) : null;
  };
  assert.equal(pick('พนักงานทั้งหมด'), 2);
  assert.equal(pick('ผูกบัญชี LINE แล้ว'), 1);
  assert.equal(pick('ยังไม่ระบุฝ่าย'), 1);
});

test('ปุ่ม "ถอด LINE" โผล่เฉพาะคนที่ผูกบัญชีไว้แล้ว', () => {
  const html = render();
  assert.equal((html.match(/ถอด LINE/g) ?? []).length, 2, 'ต้องมี 2 ที่ (การ์ดมือถือ + ตารางจอใหญ่)');
  assert.ok(html.includes('ผูกแล้ว'));
});

test('ตัวกรองฝ่ายมีครบทุกฝ่ายที่ส่งเข้ามา', () => {
  const html = render();
  for (const d of ['ทุกฝ่าย', 'ฝ่ายขาย', 'ฝ่ายเทคโนโลยีสารสนเทศ']) {
    assert.ok(html.includes(d), `ตัวกรองไม่มี "${d}"`);
  }
});

test('ไม่มีพนักงานเลยต้องขึ้นข้อความบอก ไม่ใช่ตารางว่างเปล่า', () => {
  const html = render({ employees: [], ticketCounts: {}, assetCounts: {} });
  assert.ok(html.includes('ไม่พบพนักงานที่ตรงกับเงื่อนไข'));
});

test('020: มีปุ่มนำเข้าทะเบียน HR และนับคนที่เป็นสถานะ 0 แยกไว้', () => {
  const html = render();
  assert.ok(html.includes('นำเข้าทะเบียน HR (.xlsx)'));
  const at = html.indexOf('ปิดใช้งาน (สถานะ 0)');
  assert.notEqual(at, -1, 'ไม่เจอป้ายนับสถานะ 0');
  assert.equal(Number(html.slice(at, at + 200).match(/>(\d+)</)[1]), 1);
});
