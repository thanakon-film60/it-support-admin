"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { changeTicketStatusAction, type StatusChangeResult } from "@/app/actions/tickets";
import { companyLabel } from "@/lib/companies";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { buildTicketStatusMessage } from "@/lib/line/status-message";
import type { StatusHistoryEntry } from "@/lib/db/tickets";
import type { Ticket, TicketStatus, TicketWithRelations } from "@/lib/types";
import { TICKET_STATUS_LABEL, TICKET_STATUS_ORDER, TicketStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import { formatBaht, formatThaiDateFull, formatThaiDateShort } from "@/lib/utils";
import { MAX_EDITOR_NAME, editorOptions as buildEditorOptions, rememberEditor } from "@/lib/editor-name";
import { useLastEditor } from "@/lib/use-last-editor";

type Props = {
  ticket: TicketWithRelations | null;
  editors?: string[];
  canNotify?: boolean;
  onClose: () => void;
  onSaved: (ticket: Ticket) => void;
};

export function TicketStatusModal({ ticket, ...props }: Props) {
  return ticket ? <TicketStatusEditor key={ticket.id} ticket={ticket} {...props} /> : null;
}

const NOTIFY_BY_DEFAULT: TicketStatus[] = ["resolved", "closed", "cancelled"];
const MAX_NOTE = 500;

function TicketStatusEditor({ ticket, editors = [], canNotify = false, onClose, onSaved }: Omit<Props, "ticket"> & { ticket: TicketWithRelations }) {
  const lastEditor = useLastEditor();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [editor, setEditor] = useState(lastEditor);
  const [note, setNote] = useState("");
  const [notifyLine, setNotifyLine] = useState(canNotify && NOTIFY_BY_DEFAULT.includes(ticket.status));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StatusChangeResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const submitting = useRef(false);
  const notificationChosen = useRef(false);
  const unchanged = status === ticket.status;
  const hasChanges = !unchanged || Boolean(note.trim());
  const options = useMemo(() => buildEditorOptions(editors, lastEditor), [editors, lastEditor]);
  const preview = buildTicketStatusMessage({ ...ticket, status }, note, ticket.equipment);
  const notifyFailed = result?.notify && !["sent", "not_requested"].includes(result.notify);

  const close = useCallback(() => {
    if (submitting.current) return;
    if (result?.ticket) onSaved(result.ticket);
    else onClose();
  }, [result, onSaved, onClose]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || result) return;
    if (!editor.trim() || !hasChanges) {
      setError(!editor.trim() ? "กรุณาระบุชื่อผู้แก้ไข" : "กรุณาเปลี่ยนสถานะหรือระบุหมายเหตุก่อนบันทึก");
      return;
    }
    submitting.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const saved = await changeTicketStatusAction(ticket.id, status, editor.trim(), {
          note: note.trim(),
          notifyLine: notifyLine && canNotify,
          expectedUpdatedAt: ticket.status_updated_at ?? null,
        });
        if (saved.error) setError(saved.error);
        else {
          rememberEditor(editor.trim());
          setResult(saved);
        }
      } catch {
        setError("ติดต่อระบบไม่สำเร็จ กรุณาปิดหน้าต่างและรีเฟรชเพื่อตรวจสอบผลก่อนบันทึกอีกครั้ง");
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <Modal
      open
      onClose={close}
      title={`อัปเดต Ticket · ${ticket.ticket_code}`}
      description="เลือกสถานะ ใส่หมายเหตุ และแจ้งความคืบหน้ากลับถึงผู้แจ้ง"
      size="lg"
      footer={result ? (
        <Button type="button" onClick={close} className="w-full sm:w-auto">เสร็จสิ้น</Button>
      ) : (
        <>
          <span className="my-auto mr-auto text-xs text-muted" role="status">
            {isPending ? (notifyLine ? "กำลังบันทึกและส่ง LINE…" : "กำลังบันทึก…") : hasChanges ? "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" : "เลือกสถานะใหม่หรือเพิ่มหมายเหตุ"}
          </span>
          <Button type="button" variant="outline" onClick={close} disabled={isPending} className="w-full sm:w-auto">ยกเลิก</Button>
          <Button type="submit" form="ticket-status-form" disabled={isPending || !hasChanges || !editor.trim()} className="w-full sm:w-auto">
            {isPending ? "กำลังบันทึก…" : notifyLine ? "บันทึกและส่ง LINE" : "บันทึก"}
          </Button>
        </>
      )}
    >
      {result ? (
        <div className="flex flex-col gap-4 py-3" role="status" aria-live="polite">
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-5">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-xl text-emerald-300" aria-hidden>✓</span>
            <h3 className="text-lg font-semibold text-ink">บันทึกเรียบร้อยแล้ว</h3>
            <p className="mt-1 text-sm text-muted">{ticket.ticket_code} · {TICKET_STATUS_LABEL[result.ticket?.status ?? status]}</p>
            {note.trim() && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink">{note.trim()}</p>}
          </div>
          <div className={`rounded-xl border p-4 text-sm leading-6 ${notifyFailed ? "border-amber-400/25 bg-amber-400/5 text-amber-200" : "border-line bg-page/40 text-muted"}`}>
            {result.notify === "sent" ? "ส่งข้อความให้ LINE OA แล้ว สามารถดูประวัติการแจ้งได้ใน Ticket นี้" :
              result.notify === "skipped_no_token" ? "บันทึกข้อมูลแล้ว แต่ยังส่ง LINE ไม่ได้ กรุณาตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ของ LINE OA" :
              result.notify === "skipped_no_line_user" ? "บันทึกข้อมูลแล้ว แต่ไม่พบ LINE ของผู้แจ้ง จึงยังไม่ได้ส่งข้อความ" :
              result.notify === "failed" ? "บันทึกข้อมูลแล้ว แต่ LINE ยังไม่ยืนยันการส่ง กรุณาตรวจสอบการเชื่อมต่อและประวัติแชทก่อนส่งอีกครั้ง" :
              "บันทึกหมายเหตุในประวัติแล้ว · ครั้งนี้ไม่ได้เลือกส่ง LINE"}
          </div>
        </div>
      ) : (
        <form id="ticket-status-form" onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={isPending}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-page/50 p-4">
            <div className="min-w-0">
              <p className="text-xs text-muted">ผู้แจ้ง</p>
              <p className="mt-1 break-words text-sm font-semibold text-ink">{ticket.requester?.display_name ?? "ไม่ระบุชื่อ"}</p>
              <p className="mt-1 text-xs text-muted">{TICKET_TYPE_LABEL[ticket.type]} · {ticket.location}</p>
            </div>
            <TicketStatusBadge status={ticket.status} />
          </div>

          <fieldset disabled={isPending} className="flex min-w-0 flex-col gap-5 disabled:opacity-60">
            <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
              <h3 className="mb-4 text-sm font-semibold text-ink"><span className="mr-2 text-cyan-300">01</span> อัปเดตการดำเนินงาน</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="สถานะ" required hint={unchanged ? "เพิ่มหมายเหตุได้โดยไม่ต้องเปลี่ยนสถานะ" : `จาก ${TICKET_STATUS_LABEL[ticket.status]} → ${TICKET_STATUS_LABEL[status]}`}>
                  <select name="status" value={status} onChange={(event) => {
                    const next = event.target.value as TicketStatus;
                    setStatus(next);
                    if (!notificationChosen.current) setNotifyLine(canNotify && NOTIFY_BY_DEFAULT.includes(next));
                    setError(null);
                  }} className={MODAL_INPUT}>
                    {TICKET_STATUS_ORDER.map((value) => {
                      // "สำเร็จแล้ว" ต้องมาจากผู้แจ้งกดยืนยันในไลน์เท่านั้น ถ้าแอดมินกดให้เองได้
                      // ตัวเลขงานที่ผู้ใช้ยืนยันแล้วจะไม่ต่างอะไรกับ "แก้ไขแล้ว" ที่มีอยู่แล้ว
                      // (ฝั่ง server action ก็ปฏิเสธอยู่แล้ว — ตรงนี้กันไม่ให้กดแล้วเจอ error งงๆ)
                      const requesterOnly = value === "completed" && ticket.status !== "completed";
                      return (
                        <option key={value} value={value} disabled={requesterOnly}>
                          {TICKET_STATUS_LABEL[value]}
                          {requesterOnly ? " — ผู้แจ้งกดยืนยันเองในไลน์เท่านั้น" : ""}
                        </option>
                      );
                    })}
                  </select>
                </Field>
                <Field label="ชื่อผู้แก้ไข" required hint="พิมพ์ชื่อ หรือเลือกจากชื่อที่เคยใช้">
                  <input name="updated_by" list="ticket-status-editors" required maxLength={MAX_EDITOR_NAME} value={editor} onChange={(event) => setEditor(event.target.value)} placeholder="เช่น ฟิล์ม (IT)" autoComplete="off" className={MODAL_INPUT} />
                </Field>
                <datalist id="ticket-status-editors">{options.map((name) => <option key={name} value={name} />)}</datalist>
                <Field label="หมายเหตุ / ผลการแก้ไข" hint={notifyLine ? "ข้อความนี้จะบันทึกในประวัติและส่งให้ผู้แจ้งทาง LINE" : "ข้อความนี้จะบันทึกในประวัติของ Ticket"} className="sm:col-span-2">
                  <textarea name="note" rows={3} maxLength={MAX_NOTE} value={note} onChange={(event) => setNote(event.target.value)} placeholder="เช่น เปลี่ยนสาย HDMI และทดสอบแล้ว สามารถใช้งานได้ตามปกติครับ" className={`${MODAL_INPUT} resize-y`} />
                </Field>
                <p className="-mt-2 text-right text-xs text-muted sm:col-span-2">{note.length}/{MAX_NOTE} ตัวอักษร</p>
              </div>
            </section>

            <section className={`overflow-hidden rounded-xl border ${notifyLine ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-line bg-page/30"}`}>
              <div className="flex items-start gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#06C755] text-[10px] font-black tracking-tight text-white" aria-hidden>LINE</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">02 · แจ้งกลับผ่าน LINE OA</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{canNotify ? `ส่งถึง ${ticket.requester?.display_name ?? "ผู้แจ้ง"} เมื่อกดบันทึก` : "ยังไม่มีบัญชี LINE ของผู้แจ้งผูกกับ Ticket นี้"}</p>
                </div>
                <input type="checkbox" role="switch" aria-label="แจ้งผู้แจ้งทาง LINE" checked={notifyLine} disabled={!canNotify} onChange={(event) => { notificationChosen.current = true; setNotifyLine(event.target.checked); }} className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-emerald-400 disabled:cursor-not-allowed" />
              </div>
              {notifyLine && canNotify ? (
                <div className="border-t border-emerald-400/15 p-4">
                  <p className="mb-3 text-xs font-medium text-emerald-300">ตัวอย่างข้อความที่จะส่ง</p>
                  <div className="rounded-2xl rounded-tl-sm border border-line bg-page/80 p-4 text-sm leading-6 text-ink shadow-sm">
                    <p className="whitespace-pre-wrap break-words">{preview}</p>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">ส่ง 1 ข้อความผ่าน LINE OA · การส่งสำเร็จไม่ได้ยืนยันว่าผู้แจ้งอ่านแล้ว</p>
                </div>
              ) : <p className="px-4 pb-4 text-xs text-muted">{canNotify ? "เปิดตัวเลือกนี้เพื่อส่งสถานะและหมายเหตุถึงผู้แจ้ง" : "ยังบันทึกสถานะและหมายเหตุในระบบได้ตามปกติ"}</p>}
            </section>
          </fieldset>

          {error && <p role="alert" className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-muted">รายละเอียดและประวัติของ Ticket</summary>
            <div className="mt-4"><ReadOnlyDetails ticket={ticket} /></div>
          </details>
        </form>
      )}
    </Modal>
  );
}

function ReadOnlyDetails({ ticket }: { ticket: TicketWithRelations }) {
  const imageUrls = Array.isArray(ticket.meta?.image_urls)
    ? (ticket.meta?.image_urls as unknown[]).filter((u): u is string => typeof u === "string")
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted">ข้อมูลของเรื่องนี้ (แก้ไขไม่ได้)</p>
        <TicketStatusBadge status={ticket.status} />
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-line bg-page/40 p-4 text-sm sm:grid-cols-2">
        <ReadOnlyRow label="เลขที่ตั๋ว" value={ticket.ticket_code} mono />
        <ReadOnlyRow label="ประเภท" value={TICKET_TYPE_LABEL[ticket.type]} />
        <ReadOnlyRow label="ผู้แจ้ง" value={ticket.requester?.display_name ?? "-"} />
        <ReadOnlyRow label="แผนก" value={ticket.requester?.department ?? "-"} />
        <ReadOnlyRow label="บริษัท" value={companyLabel(ticket.company)} />
        <ReadOnlyRow label="สาขา" value={ticket.location} />
        <ReadOnlyRow
          label="ทรัพย์สิน"
          value={
            ticket.equipment
              ? [ticket.equipment.asset_code, ticket.equipment.brand_model]
                  .filter(Boolean)
                  .join(" — ")
              : "-"
          }
          mono={Boolean(ticket.equipment)}
        />
        {ticket.type === "repair" && (
          <ReadOnlyRow
            label="ค่าซ่อม"
            value={ticket.repair_cost !== null ? `${formatBaht(ticket.repair_cost)} บาท` : "-"}
            mono
          />
        )}
        <ReadOnlyRow label="วันที่แจ้ง" value={formatThaiDateShort(ticket.created_at)} mono />
        <ReadOnlyRow
          label="วันที่ปิดงาน"
          value={ticket.resolved_at ? formatThaiDateShort(ticket.resolved_at) : "-"}
          mono={ticket.resolved_at !== null}
        />
      </dl>

      <StatusHistoryList entries={readHistory(ticket)} />

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted">รายละเอียดที่ผู้แจ้งส่งมา</p>
        <p className="whitespace-pre-wrap rounded-xl border border-line bg-page/40 p-3 text-sm text-ink">
          {ticket.description || "-"}
        </p>
      </div>

      {imageUrls.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">รูปที่แนบมา ({imageUrls.length})</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {imageUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-line transition hover:border-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="รูปที่ผู้แจ้งส่งมา" className="h-24 w-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** อ่านประวัติจาก meta โดยไม่ import lib/db (ไฟล์นี้เป็น client component)
 *  ชนิดข้อมูลยัง import แบบ `import type` ได้ เพราะ TypeScript ลบทิ้งตอนคอมไพล์ */
function readHistory(ticket: TicketWithRelations): StatusHistoryEntry[] {
  const raw = ticket.meta?.status_history;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is StatusHistoryEntry =>
      Boolean(e) && typeof e === "object" && typeof (e as StatusHistoryEntry).to === "string"
  );
}

/** ประวัติการอัปเดตสถานะ — เรียงใหม่สุดไว้บน
 *
 *  ตอบคำถามที่คนเปิดเรื่องเก่ามาถามจริง: "ใครแตะเรื่องนี้ไปบ้าง แจ้งผู้แจ้งหรือยัง บอกว่าอะไร"
 *  ซึ่งก่อนหน้านี้ไม่มีที่ไหนตอบได้เลย เพราะระบบเก็บแค่สถานะล่าสุดค่าเดียว */
function StatusHistoryList({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">
        ประวัติการอัปเดต ({entries.length} ครั้ง)
      </p>
      <ul className="flex flex-col gap-2 rounded-xl border border-line bg-page/40 p-3">
        {[...entries].reverse().map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            className="flex flex-col gap-1 border-b border-line/50 pb-2 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-num text-muted">{formatThaiDateFull(e.at)}</span>
              <span className="text-muted">·</span>
              <span className="text-ink">{e.by}</span>
              <span className="text-muted">
                {TICKET_STATUS_LABEL[e.from] ?? e.from} → {TICKET_STATUS_LABEL[e.to] ?? e.to}
              </span>
              {e.notified === true && (
                <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
                  ส่ง LINE แล้ว
                </span>
              )}
              {e.notified === false && (
                <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300 ring-1 ring-inset ring-rose-400/25">
                  ส่ง LINE ไม่สำเร็จ
                </span>
              )}
            </div>
            {e.note && (
              <p className="whitespace-pre-wrap text-xs leading-5 text-ink/90">📝 {e.note}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-ink ${mono ? "font-num" : ""}`}>{value}</dd>
    </div>
  );
}
