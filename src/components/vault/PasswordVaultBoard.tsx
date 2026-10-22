"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { deleteVaultEntryAction, exportVaultAction, lockVaultAction } from "@/app/actions/vault";
import type { VaultAuditView, VaultEntryView } from "@/lib/db/vault";
import type { VaultLockState } from "@/lib/vault/unlock";
import { VAULT_CATEGORIES, VAULT_CATEGORY_INFO, vaultDuplicateKey, type VaultCategory } from "@/lib/vault-shared";
import { todayKeyTH } from "@/lib/date-th";
import { SecretCell, SmallButton } from "./SecretCell";
import { VaultAuditList } from "./VaultAuditList";
import { VaultEntryModal, type VaultEditing } from "./VaultEntryModal";
import { VaultImportPanel } from "./VaultImportPanel";
import { VaultLockScreen } from "./VaultLockScreen";
import { CATEGORY_BADGE, CONTROL, OFFLINE, copyText, isLinkable } from "./vault-ui";

type Tab = "all" | VaultCategory;

function matches(entry: VaultEntryView, q: string): boolean {
  if (!q) return true;
  const hay = [entry.name, entry.username, entry.url, entry.location, entry.band, entry.note].join("\n").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function subscribeSecond(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000);
  return () => window.clearInterval(timer);
}

/** วินาทีที่เหลือก่อนล็อก — null ตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์/ก่อน hydrate
 *  ใช้ useSyncExternalStore แทน useState(Date.now()) เพราะเวลาเซิร์ฟเวอร์กับเบราว์เซอร์ไม่เท่ากันเป๊ะ
 *  ตัวเลขที่เรนเดอร์สองฝั่งจะต่างกันแล้ว React ฟ้อง hydration mismatch */
function useSecondsLeft(until: number): number | null {
  const nowSec = useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => null);
  return nowSec === null ? null : Math.max(0, Math.floor(until / 1000) - nowSec);
}

/** หน้า "รหัสผ่าน" — ล็อกอยู่โชว์หน้ายืนยันตัวตน · ปลดล็อกแล้วโชว์รายการ (รหัสเป็น •••• จนกว่าจะกดดูทีละช่อง) */
export function PasswordVaultBoard(props: {
  state: VaultLockState;
  counts: Record<VaultCategory, number> | null;
  entries: VaultEntryView[];
  audit: VaultAuditView[];
  loadError: string | null;
  unlockMinutes: number;
  maxFails: number;
}) {
  if (props.state.status !== "unlocked") {
    return (
      <VaultLockScreen
        state={props.state}
        counts={props.counts}
        loadError={props.loadError}
        unlockMinutes={props.unlockMinutes}
        maxFails={props.maxFails}
      />
    );
  }
  return <UnlockedVault {...props} until={props.state.until} />;
}

function UnlockedVault({
  entries,
  audit,
  loadError,
  until,
}: {
  entries: VaultEntryView[];
  audit: VaultAuditView[];
  loadError: string | null;
  until: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<VaultEditing>(null);
  const [deleting, setDeleting] = useState<VaultEntryView | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const left = useSecondsLeft(until);
  const refreshedFor = useRef<number | null>(null);

  // หมดเวลาปลดล็อก → ขอหน้าใหม่จากเซิร์ฟเวอร์ (จะได้หน้าล็อก และรายการทั้งหมดหายจากหน้าเว็บ)
  // ครั้งเดียวต่อรอบปลดล็อก + ลองซ้ำอีกครั้งใน 5 วินาที เผื่อนาฬิกาเครื่องนี้เร็วกว่าเซิร์ฟเวอร์เล็กน้อย
  // (เซิร์ฟเวอร์ยังถือว่าปลดล็อกอยู่) — ไม่วนรีเฟรชถี่ๆ
  useEffect(() => {
    if (left !== 0 || refreshedFor.current === until) return;
    refreshedFor.current = until;
    router.refresh();
    const retry = window.setTimeout(() => router.refresh(), 5000);
    return () => window.clearTimeout(retry);
  }, [left, until, router]);

  const counts = useMemo(() => {
    const map: Record<Tab, number> = { all: entries.length, account: 0, network: 0, wifi: 0, apple_id: 0 };
    for (const e of entries) map[e.category]++;
    return map;
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => (tab === "all" || e.category === tab) && matches(e, q))
      .sort((a, b) =>
        tab === "all" && a.category !== b.category
          ? VAULT_CATEGORIES.indexOf(a.category) - VAULT_CATEGORIES.indexOf(b.category)
          : a.name.localeCompare(b.name, "th")
      );
  }, [entries, tab, search]);
  const pager = usePaginated(visible, { storageKey: "passwords", resetOn: `${tab}:${search}` });
  const existingKeys = useMemo(() => new Set(entries.map((e) => vaultDuplicateKey(e))), [entries]);

  const onLocked = () => router.refresh();
  const say = (message: string) => {
    setError(null);
    setNotice(message);
  };
  const fail = (message: string) => {
    setNotice(null);
    setError(message);
  };

  function lockNow() {
    startTransition(async () => {
      try {
        await lockVaultAction();
      } finally {
        router.refresh();
      }
    });
  }

  function remove(entry: VaultEntryView) {
    startTransition(async () => {
      let result;
      try {
        result = await deleteVaultEntryAction(entry.id);
      } catch {
        result = { error: OFFLINE };
      }
      setDeleting(null);
      if (result.locked) return onLocked();
      if (result.error) return fail(result.error);
      say(`ลบ "${entry.name}" แล้ว`);
      router.refresh();
    });
  }

  function exportExcel() {
    startTransition(async () => {
      let result;
      try {
        result = await exportVaultAction();
      } catch {
        result = { error: OFFLINE };
      }
      setExporting(false);
      if (result.locked) return onLocked();
      if (result.error || !result.grids) return fail(result.error ?? "ส่งออกไม่สำเร็จ");
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();
        for (const grid of result.grids) {
          const ws = XLSX.utils.aoa_to_sheet(grid.rows);
          ws["!cols"] = grid.rows[1]?.map((h, i) => ({ wch: i === 0 ? 8 : Math.max(14, Math.min(40, h.length + 12)) }));
          XLSX.utils.book_append_sheet(wb, ws, grid.name.slice(0, 31));
        }
        XLSX.writeFile(wb, `passwords-${todayKeyTH()}.xlsx`);
        say(`ส่งออก ${result.count ?? 0} รายการแล้ว — ไฟล์ไม่ได้เข้ารหัส เก็บในที่ปลอดภัยและลบทิ้งเมื่อใช้เสร็จ`);
        router.refresh(); // ให้ประวัติการเข้าถึงขึ้นรายการ "ส่งออก" ทันที
      } catch {
        fail("สร้างไฟล์ Excel ไม่สำเร็จ");
      }
    });
  }

  async function copyUsername(entry: VaultEntryView) {
    if (await copyText(entry.username)) say(`คัดลอกชื่อผู้ใช้ของ "${entry.name}" แล้ว`);
    else fail("คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ — เลือกข้อความแล้วคัดลอกเอง");
  }

  const mm = left === null ? "--" : String(Math.floor(left / 60)).padStart(2, "0");
  const ss = left === null ? "--" : String(left % 60).padStart(2, "0");
  const showCategory = tab === "all";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="รหัสผ่าน"
        description="บัญชีและรหัสผ่านของระบบ · Network & Server · Wi-Fi · Apple ID — ทุกการดู/คัดลอกรหัสถูกบันทึก"
        actions={
          <>
            <Button onClick={() => setEditing({ mode: "new", category: tab === "all" ? "account" : tab })}>+ เพิ่มรายการ</Button>
            <Button variant="outline" onClick={() => setImporting((v) => !v)}>
              นำเข้า CSV / Excel
            </Button>
            <Button variant="outline" onClick={() => setExporting(true)} disabled={entries.length === 0}>
              ส่งออก Excel
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-sm">
        <span className="text-amber-100">
          🔓 ปลดล็อกอยู่ · ล็อกเองใน <span className="font-num font-semibold">{mm}:{ss}</span>
        </span>
        <Button variant="outline" onClick={lockNow} disabled={isPending}>
          ล็อกตอนนี้
        </Button>
      </div>

      {loadError && <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{loadError}</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{notice}</p>}

      {importing && (
        <VaultImportPanel
          existingKeys={existingKeys}
          onClose={() => setImporting(false)}
          onLocked={onLocked}
          onDone={(message) => {
            setImporting(false);
            say(message);
            router.refresh();
          }}
        />
      )}

      <div role="tablist" aria-label="หมวด" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
        {(["all", ...VAULT_CATEGORIES] as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
              tab === key ? "bg-accent-bg text-accent ring-1 ring-inset ring-accent/30" : "text-muted hover:bg-ink/[0.04] hover:text-ink"
            }`}
          >
            {key === "all" ? "ทั้งหมด" : VAULT_CATEGORY_INFO[key].label}
            <span className="font-num text-xs opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหาชื่อรายการ, ชื่อผู้ใช้, URL/IP, Location, หมายเหตุ..."
        aria-label="ค้นหา"
        className={`${CONTROL} w-full sm:w-96`}
        autoComplete="off"
      />

      {/* มือถือ = การ์ด · จอใหญ่ = ตาราง (เหตุผลเดียวกับหน้าสาขา: ปุ่มอยู่ขวาสุด ปัดตารางบนมือถือแล้วกดยาก) */}
      <div className="flex flex-col gap-2 lg:hidden">
        {pager.items.map((e) => (
          <div key={e.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium text-ink">{e.name}</p>
                {showCategory && <CategoryBadge category={e.category} />}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <SmallButton onClick={() => setEditing({ mode: "edit", entry: e })} disabled={isPending}>แก้ไข</SmallButton>
                <SmallButton onClick={() => setDeleting(e)} disabled={isPending} danger>ลบ</SmallButton>
              </div>
            </div>
            <dl className="mt-3 grid gap-2 text-sm">
              {e.username && (
                <Row label="ชื่อผู้ใช้">
                  <span className="break-all text-ink">{e.username}</span>{" "}
                  <SmallButton onClick={() => void copyUsername(e)} label="คัดลอกชื่อผู้ใช้">คัดลอก</SmallButton>
                </Row>
              )}
              <Row label="รหัสผ่าน">
                <SecretCell entryId={e.id} hasSecret={e.has_secret} onLocked={onLocked} onError={fail} />
              </Row>
              {e.url && <Row label="URL / IP"><UrlText url={e.url} /></Row>}
              {(e.band || e.location) && <Row label="GHz / Location"><span className="text-muted">{[e.band, e.location].filter(Boolean).join(" · ")}</span></Row>}
              {e.note && <Row label="หมายเหตุ"><span className="whitespace-pre-wrap break-words text-muted">{e.note}</span></Row>}
            </dl>
          </div>
        ))}
        {visible.length === 0 && <Empty hasAny={entries.length > 0} />}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface lg:block">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3">ชื่อรายการ</th>
              <th className="px-4 py-3">ชื่อผู้ใช้</th>
              <th className="px-4 py-3">รหัสผ่าน</th>
              <th className="px-4 py-3">URL / IP</th>
              <th className="px-4 py-3">รายละเอียด</th>
              <th className="px-4 py-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((e) => (
              <tr key={e.id} className="border-b border-line/60 align-top last:border-0">
                <td className="px-4 py-3">
                  <span className="block break-words font-medium text-ink">{e.name}</span>
                  {showCategory && <CategoryBadge category={e.category} />}
                </td>
                <td className="px-4 py-3">
                  {e.username ? (
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 break-all text-ink">{e.username}</span>
                      <SmallButton onClick={() => void copyUsername(e)} label="คัดลอกชื่อผู้ใช้">คัดลอก</SmallButton>
                    </div>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <SecretCell entryId={e.id} hasSecret={e.has_secret} onLocked={onLocked} onError={fail} />
                </td>
                <td className="max-w-[16rem] px-4 py-3">{e.url ? <UrlText url={e.url} /> : <span className="text-muted">-</span>}</td>
                <td className="max-w-[18rem] px-4 py-3 text-xs text-muted">
                  {[e.band, e.location].filter(Boolean).join(" · ")}
                  {e.note && <span className="mt-0.5 block whitespace-pre-wrap break-words">{e.note}</span>}
                  {!e.band && !e.location && !e.note && "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="inline-flex gap-1.5">
                    <SmallButton onClick={() => setEditing({ mode: "edit", entry: e })} disabled={isPending}>แก้ไข</SmallButton>
                    <SmallButton onClick={() => setDeleting(e)} disabled={isPending} danger>ลบ</SmallButton>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {entries.length > 0 ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : "ยังไม่มีรายการ — กด \"นำเข้า CSV / Excel\" หรือ \"+ เพิ่มรายการ\""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="รายการ" />

      <VaultAuditList rows={audit} />

      <VaultEntryModal
        editing={editing}
        onClose={() => setEditing(null)}
        onLocked={onLocked}
        onSaved={(message) => {
          setEditing(null);
          say(message);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
        pending={isPending}
        title="ลบรายการ"
        message={
          deleting ? (
            <>
              ลบ <span className="font-semibold">{deleting.name}</span> ({VAULT_CATEGORY_INFO[deleting.category].label}) ถาวรใช่ไหม —
              รหัสที่บันทึกไว้จะหายไปด้วย (ประวัติว่าใครเคยเปิดดูยังอยู่)
            </>
          ) : null
        }
      />

      {/* ไม่ใช้ ConfirmDialog เพราะกล่องนั้นมีข้อความ "การลบย้อนกลับไม่ได้" ติดมาเสมอ ซึ่งผิดความหมายตรงนี้ */}
      <Modal
        open={exporting}
        onClose={() => setExporting(false)}
        size="sm"
        title="ส่งออกเป็น Excel"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setExporting(false)} className="w-full sm:w-auto">
              ยกเลิก
            </Button>
            <Button type="button" variant="danger" onClick={exportExcel} disabled={isPending} className="w-full sm:w-auto">
              {isPending ? "กำลังส่งออก..." : "ส่งออก"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink">
          ไฟล์ที่ได้ <span className="font-semibold text-rose-300">ไม่มีการเข้ารหัส</span> — มีรหัสผ่านทุกตัวเป็นตัวอักษรธรรมดา
          เก็บในที่ปลอดภัย ห้ามส่งทางแชท/อีเมล และลบทิ้งเมื่อใช้เสร็จ · การส่งออกครั้งนี้จะถูกบันทึกในประวัติ
        </p>
      </Modal>
    </div>
  );
}

function CategoryBadge({ category }: { category: VaultCategory }) {
  return (
    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[0.7rem] ring-1 ring-inset ${CATEGORY_BADGE[category]}`}>
      {VAULT_CATEGORY_INFO[category].label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-2">
      <dt className="pt-1.5 text-xs text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function UrlText({ url }: { url: string }) {
  // ลิงก์เปิดแท็บใหม่แบบไม่ส่ง referrer/opener — หน้าแอดมินของอุปกรณ์ไม่ควรรู้ว่าเปิดมาจากระบบเรา
  return isLinkable(url) ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
      {url}
    </a>
  ) : (
    <span className="break-all text-muted">{url}</span>
  );
}

function Empty({ hasAny }: { hasAny: boolean }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
      {hasAny ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : "ยังไม่มีรายการ — กด \"นำเข้า CSV / Excel\" หรือ \"+ เพิ่มรายการ\""}
    </p>
  );
}
