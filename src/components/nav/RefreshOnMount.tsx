"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** รีเฟรชข้อมูลฝั่งเซิร์ฟเวอร์ 1 ครั้งตอนเปิดหน้า — ใช้ในหน้า "ไม่มีสิทธิ์"
 *
 *  หน้านี้ถูกเปิดได้สองทาง: พิมพ์ URL เอง (โหลดทั้งหน้า เมนูถูกต้องอยู่แล้ว) หรือ Server Action เด้งมา
 *  หลังถูกถอนสิทธิ์ระหว่างใช้งาน ทางหลังเป็นการนำทางฝั่งเบราว์เซอร์ ซึ่ง Next.js ไม่โหลด layout ซ้ำ
 *  เมนูด้านบนจึงยังโชว์หน้าที่เพิ่งถูกถอนสิทธิ์ (กดไปก็เจอหน้านี้อีก) — รีเฟรชแล้วเมนูตรงกับสิทธิ์ปัจจุบัน
 *  useEffect รอบเดียว: refresh ไม่ได้ทำให้คอมโพเนนต์นี้ mount ใหม่ จึงไม่วนรีเฟรชซ้ำ */
export function RefreshOnMount() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
