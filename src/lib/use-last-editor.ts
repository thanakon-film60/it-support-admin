"use client";

import { useSyncExternalStore } from "react";
import { readLastEditor } from "@/lib/editor-name";

/* อ่านชื่อผู้แก้ไขที่จำไว้ในเครื่อง — แยกไฟล์จาก editor-name.ts โดยตั้งใจ
 *
 * editor-name.ts ถูก import จาก Server Action ด้วย (เพื่อใช้เกณฑ์ตรวจชุดเดียวกัน)
 * ถ้า hook อยู่ไฟล์เดียวกัน react จะถูกลากเข้ากราฟของ Server Component แล้ว next build ล้ม
 *
 * ใช้ useSyncExternalStore ไม่ใช่ useEffect + setState ด้วยเหตุผลเดียวกับ SortControl.tsx:
 * ค่าที่จำไว้ต้องไม่ถูกใช้ตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์ (HTML สองฝั่งจะไม่ตรงกัน) และ
 * useEffect + setState ก็ไปชนกฎ react-hooks/set-state-in-effect ของ eslint ชุดนี้
 * useSyncExternalStore แก้ได้ทั้งสองข้อ เพราะมี getServerSnapshot แยกไว้ให้อยู่แล้ว */

/** ไม่ต้องรับสัญญาณจากที่อื่น — ค่านี้ถูกเขียนตอนบันทึกสำเร็จเท่านั้น และหน้าจะรีเฟรชอยู่แล้ว */
const subscribeNoop = () => () => {};

export function useLastEditor(): string {
  return useSyncExternalStore(subscribeNoop, readLastEditor, () => "");
}
