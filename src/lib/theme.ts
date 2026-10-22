// ธีมของหน้าแอดมิน (สว่าง/มืด) + สีหลักที่เลือกได้ — ใช้ได้ทั้งฝั่ง server และ client (ไม่แตะ db)
//
// เก็บใน localStorage ของ "เครื่องนั้น" ไม่ผูกกับบัญชีโดยตั้งใจ: คนเดียวกันอาจอยากได้ธีมมืดบนจอออฟฟิศ
// แต่ธีมสว่างบนมือถือกลางแดด และถ้าเก็บในไฟล์บัญชี หน้าเว็บต้องรอถามเซิร์ฟเวอร์ก่อนรู้ว่าจะวาดสีอะไร
// → จอกะพริบเป็นธีมมืดทุกครั้งที่เปิดหน้า (สคริปต์ใน <head> อ่าน localStorage ได้ทันทีก่อนวาดจอ)

export type ThemeMode = "dark" | "light";
export type AccentId = "cyan" | "indigo" | "emerald" | "amber";

export const THEME_STORAGE_KEY = "it-admin-theme";
export const ACCENT_STORAGE_KEY = "it-admin-accent";

// ค่าตั้งต้น = หน้าตาเดิมก่อนมีตัวเลือก คนที่ไม่เคยกดอะไรจะไม่เห็นอะไรเปลี่ยน
export const DEFAULT_THEME: ThemeMode = "dark";
export const DEFAULT_ACCENT: AccentId = "cyan";

export const THEMES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "สว่าง" },
  { id: "dark", label: "มืด" },
];

/** สีที่โชว์บนปุ่มเลือก — dark/light ต้องตรงกับ --accent-d / --accent-l ใน globals.css
 *  (tests/theme.test.cjs ตรวจ) ไม่งั้นกดสีหนึ่งแล้วทั้งเว็บออกมาอีกเฉดหนึ่ง */
export const ACCENTS: { id: AccentId; label: string; dark: string; light: string }[] = [
  { id: "cyan", label: "ฟ้า", dark: "#22d3ee", light: "#0e7490" },
  { id: "indigo", label: "คราม", dark: "#7c8cff", light: "#4338ca" },
  { id: "emerald", label: "เขียว", dark: "#34d399", light: "#047857" },
  { id: "amber", label: "ส้ม", dark: "#fbbf24", light: "#b45309" },
];

/** สีพื้นของแต่ละธีม — ใช้กับ <meta name="theme-color"> ให้แถบ address bar บนมือถือกลืนกับหน้าเว็บ */
export const THEME_PAGE_COLOR: Record<ThemeMode, string> = {
  dark: "#060910",
  light: "#f4f6fa",
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEMES.some((t) => t.id === value);
}

export function isAccentId(value: unknown): value is AccentId {
  return ACCENTS.some((a) => a.id === value);
}

/** สคริปต์ที่ฝังใน <head> — รันระหว่างเบราว์เซอร์อ่าน HTML ก่อนวาดจอครั้งแรก
 *
 *  ถ้าไปตั้งธีมใน useEffect ของ React แทน คนที่เลือกธีมสว่างจะเห็นจอดำแวบหนึ่งทุกครั้งที่เปิดหน้า
 *  (HTML จากเซิร์ฟเวอร์ไม่รู้ว่าเครื่องนี้เลือกอะไร) · รับเฉพาะค่าที่รู้จัก — ค่าแปลกปลอมใน localStorage
 *  ถูกข้ามไป ได้ธีมตั้งต้นแทนที่จะได้หน้าเว็บที่ไม่มีสีหลักเลย · try/catch เพราะบางเบราว์เซอร์
 *  (โหมดส่วนตัว / ปิดคุกกี้) โยน error ทันทีที่แตะ localStorage */
export function themeInitScript(): string {
  const themes = JSON.stringify(THEMES.map((t) => t.id));
  const accents = JSON.stringify(ACCENTS.map((a) => a.id));
  return (
    "(function(){try{var d=document.documentElement," +
    `t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),` +
    `a=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});` +
    `if(${themes}.indexOf(t)>=0)d.setAttribute("data-theme",t);` +
    `if(${accents}.indexOf(a)>=0)d.setAttribute("data-accent",a)` +
    "}catch(e){}})()"
  );
}
