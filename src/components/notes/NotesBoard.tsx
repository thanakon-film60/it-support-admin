"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { ConfirmDialog, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import {
  createNoteAction,
  deleteNoteAction,
  updateNoteAction,
  type NoteActionResult,
} from "@/app/actions/notes";
import {
  NOTE_MAX_LENGTH,
  checkNoteBody,
  noteMatches,
  noteStamp,
  notesFileName,
  notesToText,
} from "@/lib/notes-shared";

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

const OFFLINE =
  "ติดต่อเซิร์ฟเวอร์ไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่ (ข้อความที่พิมพ์ยังอยู่ ไม่หาย)";

/* ───────────── ร่างข้อความที่ยังไม่ได้บันทึก — เก็บในเครื่องนี้ (localStorage) ─────────────
 *
 * ตัวข้อความจริงอยู่บนเซิร์ฟเวอร์เสมอ ส่วนนี้แค่กัน "พิมพ์ยาวแล้วหาย" ก่อนกดบันทึก:
 * session หมดอายุแล้วถูกพาไปหน้า login · มือถือปิดแท็บทิ้งเองตอนสลับแอป · กดรีเฟรชพลาด
 * ใช้ useSyncExternalStore ไม่ใช่ useEffect+setState: เซิร์ฟเวอร์ไม่มี localStorage จึงต้องเรนเดอร์
 * ช่องว่างก่อนแล้วค่อยเติมร่างหลังโหลด ซึ่ง hook นี้ทำให้โดยไม่เกิด hydration mismatch
 * (และไม่ชนกฎ react-hooks/set-state-in-effect ที่ eslint ของโปรเจกต์บังคับ)
 * อ่าน/เขียน localStorage ห่อ try/catch เสมอ — โหมดไม่ระบุตัวตนบางเบราว์เซอร์โยน error ใส่ */
const DRAFT_KEY = "itadmin:notes:draft";
let draftCache: string | null = null;
const draftListeners = new Set<() => void>();

function readDraft(): string {
  if (draftCache === null) {
    try {
      draftCache = window.localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      draftCache = "";
    }
  }
  return draftCache;
}

function writeDraft(value: string) {
  draftCache = value;
  try {
    if (value) window.localStorage.setItem(DRAFT_KEY, value);
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // เก็บร่างไม่ได้ก็ยังพิมพ์และบันทึกได้ตามปกติ แค่ไม่มีตัวกันหายเท่านั้น
  }
  draftListeners.forEach((listener) => listener());
}

function subscribeDraft(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

/** Ctrl+Enter (หรือ ⌘+Enter บน Mac) = บันทึก — คนพิมพ์ยาวจะได้ไม่ต้องละมือไปหาเมาส์ */
function isSubmitShortcut(e: React.KeyboardEvent) {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey);
}

/** หน้าฝากข้อความ — จดไว้ที่นี่แล้วเปิดจากเครื่องไหนก็เห็นชุดเดียวกัน */
export function NotesBoard({ notes, loadError }: { notes: Note[]; loadError: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const draft = useSyncExternalStore(subscribeDraft, readDraft, () => "");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visible = useMemo(() => notes.filter((n) => noteMatches(n, search)), [notes, search]);
  const pager = usePaginated(visible, { storageKey: "notes", resetOn: search });

  const draftCheck = checkNoteBody(draft);
  const draftLength = draft.replace(/\r\n?/g, "\n").trim().length;
  const blocked = Boolean(loadError);

  /** เรียก Server Action แล้วรีเฟรชข้อมูลจากเซิร์ฟเวอร์ — ข้อความจากเครื่องอื่นจะมาพร้อมกันในรอบนี้ด้วย
   *  เน็ตหลุดตอนเรียก = action โยน error มาที่นี่ ต้องจับไว้ ไม่งั้นร่างจะถูกล้างทั้งที่ยังไม่ได้บันทึก */
  function run(
    fn: () => Promise<NoteActionResult>,
    { onSuccess, onFailure }: { onSuccess?: () => void; onFailure?: (message: string) => void } = {}
  ) {
    setError(null);
    startTransition(async () => {
      let result: NoteActionResult;
      try {
        result = await fn();
      } catch {
        result = { error: OFFLINE };
      }
      if (result.error) {
        if (onFailure) onFailure(result.error);
        else setError(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  function save() {
    if (!draftCheck.ok) {
      setError(draftCheck.error);
      return;
    }
    if (isPending || blocked) return;
    // ล้างร่างเฉพาะตอนบันทึกสำเร็จเท่านั้น — ล้มเมื่อไหร่ข้อความต้องยังอยู่ในช่องให้กดใหม่ได้
    run(() => createNoteAction(draft), { onSuccess: () => writeDraft("") });
  }

  function saveEdit(text: string) {
    if (!editing) return;
    const check = checkNoteBody(text);
    if (!check.ok) {
      setEditError(check.error);
      return;
    }
    setEditError(null);
    run(() => updateNoteAction(editing.id, text), {
      onSuccess: () => setEditing(null),
      // error ต้องขึ้นในกล่องแก้ไข — แถบ error ของหน้าอยู่ข้างหลัง modal มองไม่เห็น
      onFailure: (message) => setEditError(message),
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    const id = deleting.id;
    // ปิดกล่องยืนยันทั้งตอนสำเร็จและตอนล้ม ข้อความ error จะได้ไปขึ้นที่แถบบนหน้าซึ่งมองเห็นได้
    run(() => deleteNoteAction(id), {
      onSuccess: () => setDeleting(null),
      onFailure: (message) => {
        setDeleting(null);
        setError(message);
      },
    });
  }

  async function copy(note: Note) {
    try {
      await navigator.clipboard.writeText(note.body);
      setCopiedId(note.id);
      setTimeout(() => setCopiedId((current) => (current === note.id ? null : current)), 2000);
    } catch {
      setError("คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ — กดค้างที่ข้อความแล้วเลือกคัดลอกแทน");
    }
  }

  /** ดาวน์โหลดข้อความ "ทั้งหมด" เป็น .txt — ไม่ใช่เฉพาะที่ค้นเจอ
   *  ปุ่มนี้มีไว้เก็บสำรอง/ส่งต่อ ถ้าได้ไฟล์ไม่ครบเพราะลืมว่าพิมพ์คำค้นค้างไว้ จะเสียหายตอนที่ต้องใช้จริง */
  function download() {
    const now = new Date().toISOString();
    const blob = new Blob([notesToText(notes, now)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = notesFileName(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ฝากข้อความ"
        description="จดไว้ที่นี่ เปิดจากมือถือหรือคอมเครื่องไหนก็เห็นชุดเดียวกัน — ข้อความเก็บบนเซิร์ฟเวอร์ ไม่ได้อยู่ในเครื่องใดเครื่องหนึ่ง"
        actions={
          <Button variant="ghost" onClick={download} disabled={notes.length === 0}>
            ⬇ ดาวน์โหลด .txt
          </Button>
        }
      />

      {loadError && (
        <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {loadError}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <label htmlFor="note-draft" className="text-sm text-muted">
          ข้อความใหม่
        </label>
        <textarea
          id="note-draft"
          value={draft}
          onChange={(e) => writeDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitShortcut(e)) {
              e.preventDefault();
              save();
            }
          }}
          readOnly={isPending}
          disabled={blocked}
          rows={4}
          placeholder="พิมพ์ข้อความที่อยากจดไว้..."
          className={`${MODAL_INPUT} mt-1.5 min-h-[7rem] resize-y leading-6`}
        />
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            <span className={draftLength > NOTE_MAX_LENGTH ? "text-rose-300" : ""}>
              <span className="font-num">{draftLength.toLocaleString("en-US")}</span> /{" "}
              <span className="font-num">{NOTE_MAX_LENGTH.toLocaleString("en-US")}</span> ตัวอักษร
            </span>
            <span className="hidden sm:inline"> · Ctrl+Enter เพื่อบันทึก</span>
            {draft ? <span> · ร่างนี้ถูกเก็บในเครื่องนี้จนกว่าจะกดบันทึก</span> : null}
          </p>
          <Button
            onClick={save}
            disabled={!draftCheck.ok || isPending || blocked}
            className="w-full sm:w-auto"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึกข้อความ"}
          </Button>
        </div>
      </section>

      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาในข้อความ..."
            aria-label="ค้นหาในข้อความ"
            className={`${CONTROL} w-full sm:w-80`}
          />
          <span className="text-sm text-muted">
            ทั้งหมด <span className="font-num text-ink">{notes.length}</span> ข้อความ
            {search.trim() ? (
              <>
                {" "}· ตรงกับคำค้น <span className="font-num text-ink">{visible.length}</span>
              </>
            ) : null}
          </span>
        </div>
      )}

      {pager.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pager.items.map((note) => (
            <li key={note.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
                <span className="font-medium text-ink">{note.author}</span>
                <span>· {noteStamp(note.created_at)}</span>
                {note.updated_at ? (
                  <span
                    title={`แก้ไขล่าสุด ${noteStamp(note.updated_at)}${note.updated_by ? ` โดย ${note.updated_by}` : ""}`}
                  >
                    · แก้ไขแล้ว
                  </span>
                ) : null}
              </div>
              {/* pre-wrap = ขึ้นบรรทัดตามที่พิมพ์ · overflow-wrap:anywhere = ลิงก์ยาวๆ ไม่ดันการ์ดล้นจอมือถือ */}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink [overflow-wrap:anywhere]">
                {note.body}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <RowButton onClick={() => copy(note)}>
                  {copiedId === note.id ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                </RowButton>
                <RowButton
                  onClick={() => {
                    setEditError(null);
                    setEditing(note);
                  }}
                  disabled={isPending || blocked}
                >
                  แก้ไข
                </RowButton>
                <RowButton onClick={() => setDeleting(note)} disabled={isPending || blocked} danger>
                  ลบ
                </RowButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          {notes.length === 0
            ? blocked
              ? "แสดงข้อความไม่ได้จนกว่าจะกู้ไฟล์ข้อมูล"
              : "ยังไม่มีข้อความ — พิมพ์ในช่องด้านบนแล้วกดบันทึก"
            : `ไม่พบข้อความที่ตรงกับ "${search.trim()}"`}
        </p>
      )}

      <Pagination pager={pager} unitLabel="ข้อความ" />

      {/* key = id ของข้อความ -> เปิดแก้อันใหม่เมื่อไหร่ ช่องพิมพ์เริ่มจากเนื้อหาของอันนั้นเสมอ
          ไม่ต้องใช้ useEffect คอยรีเซ็ต state (และไม่เห็นข้อความของอันที่แก้ก่อนหน้าค้างอยู่) */}
      <EditNoteModal
        key={editing?.id ?? "closed"}
        note={editing}
        pending={isPending}
        error={editError}
        onClose={() => {
          setEditing(null);
          setEditError(null);
        }}
        onSave={saveEdit}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        pending={isPending}
        title="ลบข้อความนี้?"
        message={
          deleting ? (
            <span className="block whitespace-pre-wrap rounded-lg bg-ink/[0.03] px-3 py-2 text-sm text-ink [overflow-wrap:anywhere]">
              {deleting.body.length > 200 ? `${deleting.body.slice(0, 200)}…` : deleting.body}
            </span>
          ) : null
        }
        confirmLabel="ลบข้อความ"
      />
    </div>
  );
}

function EditNoteModal({
  note,
  pending,
  error,
  onClose,
  onSave,
}: {
  note: Note | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(note?.body ?? "");
  const length = text.replace(/\r\n?/g, "\n").trim().length;

  return (
    <Modal
      open={note !== null}
      onClose={onClose}
      title="แก้ไขข้อความ"
      description={note ? `เขียนเมื่อ ${noteStamp(note.created_at)} โดย ${note.author}` : undefined}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onSave(text)}
            disabled={pending || length === 0 || length > NOTE_MAX_LENGTH}
            className="w-full sm:w-auto"
          >
            {pending ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        <textarea
          aria-label="ข้อความ"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitShortcut(e)) {
              e.preventDefault();
              onSave(text);
            }
          }}
          readOnly={pending}
          rows={8}
          className={`${MODAL_INPUT} min-h-[10rem] resize-y leading-6`}
        />
        <p className={`text-xs ${length > NOTE_MAX_LENGTH ? "text-rose-300" : "text-muted"}`}>
          <span className="font-num">{length.toLocaleString("en-US")}</span> /{" "}
          <span className="font-num">{NOTE_MAX_LENGTH.toLocaleString("en-US")}</span> ตัวอักษร
        </p>
      </div>
    </Modal>
  );
}

/** ปุ่มจัดการต่อแถว — หน้าตาเดียวกับหน้าพนักงาน (RowButton ใน EmployeesBoard) */
function RowButton({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[2.25rem] rounded-lg border border-line px-3 text-xs text-muted transition disabled:opacity-40 ${
        danger
          ? "hover:border-rose-400/40 hover:text-rose-300"
          : "hover:border-accent/40 hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
