import { listFiles, listFolders } from "@/lib/db/drive";
import { freeBytes, quotaBytes } from "@/lib/drive/storage";
import { DriveBoard } from "@/components/drive/DriveBoard";
import type { DriveFile, DriveFolder } from "@/lib/types";
import { requireSession } from "@/lib/auth";

// ไฟล์ถูกเพิ่ม/ลบจากเครื่องอื่นได้ตลอด -> ห้าม prerender
export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string | string[] }>;
}) {
  await requireSession("files");
  const { f } = await searchParams;
  let folders: DriveFolder[] = [];
  let files: DriveFile[] = [];
  let loadError: string | null = null;
  try {
    folders = listFolders();
    files = listFiles();
  } catch (err) {
    // ไฟล์ JSON เสีย -> บอกตรงๆ ห้ามแสดงเป็น "คลังว่าง" เพราะคนจะเข้าใจว่าไฟล์หายแล้วอัปโหลดซ้ำทับ
    console.error("[drive] อ่านข้อมูลคลังไฟล์ไม่สำเร็จ", err);
    loadError =
      "อ่านข้อมูลคลังไฟล์ไม่ออก (data/drive_*.json เสีย) — ตัวไฟล์ยังอยู่บนดิสก์ แต่ต้องกู้ไฟล์ข้อมูลจาก backup ก่อนจึงจะใช้หน้านี้ได้";
  }

  // ลิงก์ไปโฟลเดอร์ที่ถูกลบไปแล้ว (บุ๊กมาร์กเก่า) -> กลับไปชั้นบนสุด ดีกว่าโชว์หน้าว่างที่ดูเหมือนไฟล์หาย
  const wanted = Array.isArray(f) ? f[0] : f;
  const currentFolderId = wanted && folders.some((x) => x.id === wanted) ? wanted : null;

  return (
    <DriveBoard
      folders={folders}
      files={files}
      currentFolderId={currentFolderId}
      usage={{ used: files.reduce((sum, x) => sum + x.size, 0), quota: quotaBytes(), free: freeBytes() }}
      loadError={loadError}
    />
  );
}
