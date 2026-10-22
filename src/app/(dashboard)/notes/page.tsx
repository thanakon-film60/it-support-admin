import { listNotes } from "@/lib/db/notes";
import { NotesBoard } from "@/components/notes/NotesBoard";
import type { Note } from "@/lib/types";
import { requireSession } from "@/lib/auth";

// ข้อความถูกเพิ่ม/แก้จากเครื่องอื่นได้ตลอด -> ห้าม prerender เป็น static
// (layout ของกลุ่ม dashboard ตั้งไว้แล้ว แต่ใส่ซ้ำให้ชัดเหมือนหน้าอื่นที่อ่านข้อมูลที่เปลี่ยนตลอด)
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  await requireSession("notes");
  let notes: Note[] = [];
  let loadError: string | null = null;
  try {
    notes = listNotes();
  } catch (err) {
    // ไฟล์เสีย -> บอกตรงๆ ห้ามแสดงเป็น "ยังไม่มีข้อความ" เพราะคนจะเข้าใจว่าข้อความหายแล้วเริ่มจดใหม่
    console.error("[notes] อ่านข้อความไม่สำเร็จ", err);
    loadError =
      "อ่านไฟล์ข้อความ (data/notes.json) ไม่ออก — ข้อความเก่ายังไม่ได้ถูกลบ แต่ต้องกู้ไฟล์จาก backup ก่อนจึงจะใช้หน้านี้ได้";
  }
  return <NotesBoard notes={notes} loadError={loadError} />;
}
