import { requireSession } from "@/lib/auth";
import { countVaultEntries, listVaultAudit, listVaultEntries, type VaultAuditView, type VaultEntryView } from "@/lib/db/vault";
import { CollectionReadError } from "@/lib/db/store";
import { VaultDecryptError } from "@/lib/vault/crypto";
import { vaultLockState, VAULT_MAX_FAILS, VAULT_UNLOCK_MINUTES } from "@/lib/vault/unlock";
import { PasswordVaultBoard } from "@/components/vault/PasswordVaultBoard";
import type { VaultCategory } from "@/lib/vault-shared";

// ข้อมูลเปลี่ยนจากเครื่องอื่นได้ตลอด และสถานะล็อก/ปลดล็อกขึ้นกับ cookie ของแต่ละคน → ห้าม prerender
export const dynamic = "force-dynamic";

function loadErrorOf(err: unknown): string {
  if (err instanceof VaultDecryptError) {
    return "ถอดรหัสข้อมูลไม่ได้ — VAULT_KEY ใน .env ไม่ตรงกับกุญแจที่ใช้ตอนบันทึก ข้อมูลยังอยู่ครบ ใส่กุญแจเดิมกลับแล้ว deploy ใหม่";
  }
  if (err instanceof CollectionReadError) {
    return "อ่านไฟล์ข้อมูลรหัสผ่าน (data/vault.json) ไม่ออก — ข้อมูลยังไม่ได้ถูกลบ แต่ต้องกู้ไฟล์จาก backup ก่อนจึงจะใช้หน้านี้ได้";
  }
  return "เปิดข้อมูลรหัสผ่านไม่สำเร็จ — ลองรีเฟรชอีกครั้ง";
}

export default async function PasswordsPage() {
  const session = await requireSession("passwords");
  const state = await vaultLockState(session);

  // ล็อกอยู่ = ไม่ถอดรหัสอะไรเลยแม้แต่ชื่อรายการ — ส่งไปแค่จำนวนต่อหมวดให้รู้ว่ามีข้อมูลอยู่
  let counts: Record<VaultCategory, number> | null = null;
  let entries: VaultEntryView[] = [];
  let audit: VaultAuditView[] = [];
  let loadError: string | null = null;
  try {
    if (state.status === "unlocked") {
      entries = listVaultEntries();
      audit = listVaultAudit(150);
    } else if (state.status === "locked") {
      counts = countVaultEntries();
    }
  } catch (err) {
    console.error("[vault] เปิดหน้ารหัสผ่านไม่สำเร็จ", err instanceof Error ? err.name : typeof err);
    loadError = loadErrorOf(err);
  }

  return (
    <PasswordVaultBoard
      state={state}
      counts={counts}
      entries={entries}
      audit={audit}
      loadError={loadError}
      unlockMinutes={VAULT_UNLOCK_MINUTES}
      maxFails={VAULT_MAX_FAILS}
    />
  );
}
