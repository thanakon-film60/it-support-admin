"use client";

import { createContext, useContext, type ReactNode } from "react";

/* ชื่อ "ผู้แก้ไข" ของบัญชีที่ล็อกอินอยู่ — layout ของกลุ่ม (dashboard) ส่งลงมาครั้งเดียว
 * ฟอร์มที่ต้องบันทึกว่าใครทำ (หน้าต่างอัปเดตสถานะ · การ์ดรับแชทต่อ) อ่านจากที่นี่แทนการให้พิมพ์ชื่อเอง
 * (ผู้ใช้ขอ 13 ต.ค. 2026 ให้เอาชื่อ user ที่ login มาใส่แทน)
 *
 * ทำไมใช้ context ไม่ส่งเป็น prop: หน้าต่างอัปเดตสถานะเปิดได้จากหลายหน้า (Tickets · ประวัติซ่อม)
 * ส่ง prop ไล่ลงทุกหน้าทุกบอร์ด วันหนึ่งจะมีหน้าที่ลืมส่ง แล้วหน้านั้นกลับไปให้พิมพ์ชื่อเองเงียบๆ
 *
 * null = ปิดล็อกอินอยู่ (AUTH_DISABLED) ไม่มีตัวตนให้ใช้ → ฟอร์มกลับไปให้พิมพ์ชื่อแบบเดิม
 *        (ค่าเริ่มต้นของ context ก็เป็น null — ไม่มี provider ครอบ ฟอร์มยังใช้ได้ แค่ต้องพิมพ์ชื่อ)
 * ค่านี้มีไว้ "แสดง" เท่านั้น — Server Action อ่านชื่อจาก session เองเสมอ (lib/editor-name.ts) */
const CurrentEditorContext = createContext<string | null>(null);

export function CurrentEditorProvider({ name, children }: { name: string | null; children: ReactNode }) {
  return <CurrentEditorContext.Provider value={name}>{children}</CurrentEditorContext.Provider>;
}

export function useCurrentEditor(): string | null {
  return useContext(CurrentEditorContext);
}
