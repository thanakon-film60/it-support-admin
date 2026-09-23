import type { ReactNode } from "react";
import { AUTH_DISABLED, requireSession } from "@/lib/auth";
import { TopNav } from "@/components/nav/TopNav";
import { BlockDevTools } from "@/components/security/BlockDevTools";
import { SECURITY_FLAGS } from "@/lib/security";
import { DashboardRefresh } from "@/components/dashboard/DashboardRefresh";

/** ห้าม Next prerender หน้าพวกนี้ตอน build เด็ดขาด
 *
 *  ข้อมูลทั้งหมดอ่านจากไฟล์ JSON ใน /app/data ตอน runtime ซึ่งยังไม่มีอยู่ตอน `npm run build`
 *  (ตอน build จะได้ seed 24 รายการ) เดิมหน้าพวกนี้เป็น dynamic อัตโนมัติเพราะ requireSession()
 *  เรียก cookies() — พอปิดล็อกอิน (AUTH_DISABLED) getSession() คืนค่าก่อนแตะ cookies() เลย
 *  Next เลยถือว่าเป็นหน้า static แล้ว prerender ข้อมูล seed ฝังลง HTML ตั้งแต่ตอน build
 *  ผลคือหน้าเว็บโชว์ 24 รายการค้างอยู่ทั้งที่ในฐานข้อมูลมี 251 (เจอจริงเมื่อ 2026-09-15)
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const updatedAt = new Date();

  return (
    <div className="min-h-screen">
      {/* กันการกด Inspect/ดูซอร์สแบบผ่านๆ — กันคนที่ตั้งใจจริงไม่ได้ ดูคอมเมนต์ในคอมโพเนนต์
          ใส่เฉพาะกลุ่ม (dashboard) เพราะข้อมูลพนักงาน/ทรัพย์สิน/ค่าซ่อม อยู่แค่ในนี้
          ส่วนหน้า /liff ที่พนักงานใช้แจ้งเรื่อง ปล่อยไว้ตามปกติ จะได้ไม่ไปกวนใน LINE */}
      {SECURITY_FLAGS.blockDevTools && (
        <BlockDevTools
          blockContextMenu={SECURITY_FLAGS.blockContextMenu}
          detectOpen={SECURITY_FLAGS.detectDevToolsOpen}
        />
      )}
      <TopNav displayName={session.displayName} showLogout={!AUTH_DISABLED} />
      {/* ระยะขอบไล่ตามจอ: มือถือชิดขอบมากขึ้นเพื่อให้ตารางได้พื้นที่ ส่วนจอใหญ่คุมความกว้างไว้ที่ 7xl */}
      <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-4 sm:py-6 lg:px-6">
        <DashboardRefresh
          updatedAt={updatedAt.toISOString()}
          updatedTime={updatedAt.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour12: false })}
        />
        {children}
      </main>
    </div>
  );
}
