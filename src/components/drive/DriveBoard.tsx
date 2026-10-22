"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DriveFile, DriveFolder } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { ConfirmDialog, Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import {
  createFolderAction,
  deleteFileAction,
  deleteFolderAction,
  moveFileAction,
  renameFolderAction,
  updateFileAction,
  type DriveActionResult,
} from "@/app/actions/drive";
import {
  DRIVE_CHUNK_BYTES,
  DRIVE_HEADER,
  DRIVE_MAX_FILE_BYTES,
  DRIVE_NAME_MAX,
  DRIVE_NOTE_MAX,
  driveMatches,
  fileKind,
  folderLabel,
  folderTrail,
  formatBytes,
} from "@/lib/drive-shared";
import { stampTH } from "@/lib/date-th";

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const ROW_BUTTON =
  "inline-flex min-h-[2.25rem] items-center rounded-lg border border-line px-3 text-xs text-muted transition hover:border-accent/40 hover:text-accent";

/* ───────────────────────────── ส่งไฟล์ขึ้นเซิร์ฟเวอร์ ─────────────────────────────
 *
 * ไฟล์ถูกส่งเป็นท่อนละ 8 MB ทีละท่อน (เหตุผลอยู่ที่ DRIVE_CHUNK_BYTES ใน lib/drive-shared.ts)
 * ใช้ XMLHttpRequest ไม่ใช้ fetch เพราะ fetch ยังบอกความคืบหน้าขาส่งไม่ได้ — ไฟล์ 500 MB ที่ไม่มีแถบ
 * ความคืบหน้าดูเหมือนค้าง คนจะปิดหน้าทิ้งกลางทาง */

type ApiReply = { status: number; body: Record<string, unknown> };

class UploadStopped extends Error {}

async function callApi(method: string, url: string, body?: unknown): Promise<ApiReply> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        [DRIVE_HEADER]: "1",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { status: 0, body: {} };
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = await res.json();
  } catch {
    // ไม่ใช่ JSON (เช่นหน้า error ของตัวกลาง) — ใช้ข้อความตาม status แทน
  }
  return { status: res.status, body: parsed };
}

function putChunk(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  register: (xhr: XMLHttpRequest) => void
): Promise<ApiReply> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("PUT", url);
    xhr.setRequestHeader(DRIVE_HEADER, "1");
    xhr.setRequestHeader("x-chunk-length", String(blob.size));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ไม่ใช่ JSON
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: {} });
    xhr.ontimeout = () => resolve({ status: 0, body: {} });
    xhr.onabort = () => resolve({ status: -1, body: {} });
    xhr.send(blob);
  });
}

function messageOf(reply: ApiReply, fallback: string): string {
  if (typeof reply.body.error === "string") return reply.body.error;
  if (reply.status === 0) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — เช็กอินเทอร์เน็ตแล้วกดลองใหม่ (ส่งต่อจากที่ค้างได้)";
  if (reply.status === 401) return "ล็อกอินหมดอายุ — ล็อกอินใหม่แล้วกดลองใหม่";
  return `${fallback} (HTTP ${reply.status})`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type JobStatus = "queued" | "uploading" | "finishing" | "done" | "error" | "canceled";

interface UploadJob {
  key: string;
  file: File;
  folderId: string | null;
  folderName: string;
  status: JobStatus;
  sent: number;
  error: string | null;
  /** เก็บไว้หลังล้ม — กดลองใหม่แล้วส่งต่อจากท่อนที่ค้าง ไม่ต้องเริ่มไฟล์ 500 MB ใหม่จากศูนย์ */
  uploadId: string | null;
}

const ACTIVE: JobStatus[] = ["queued", "uploading", "finishing"];
let jobSeq = 0;

type SortKey = "new" | "name" | "size";

function sortFiles(list: DriveFile[], sort: SortKey): DriveFile[] {
  const copy = [...list];
  if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "th", { numeric: true }));
  else if (sort === "size") copy.sort((a, b) => b.size - a.size);
  else copy.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  return copy;
}

/** โฟลเดอร์ที่ลากมาทั้งก้อนอ่านเป็นไฟล์ไม่ได้ — แยกออกมานับ ไว้บอกผู้ใช้ แทนที่จะอัปโหลดล้มทีละอันแบบงงๆ */
function readDrop(data: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  const items = Array.from(data.items ?? []);
  if (!items.length) return { files: Array.from(data.files), folders };
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      folders += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, folders };
}

const carriesFiles = (event: React.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** หน้าคลังไฟล์ — โฟลเดอร์ซ้อนกันได้ อัปโหลดได้ถึง 500 MB ต่อไฟล์ เปิดจากเครื่องไหนก็ดาวน์โหลดได้ */
export function DriveBoard({
  folders,
  files,
  currentFolderId,
  usage,
  loadError,
}: {
  folders: DriveFolder[];
  files: DriveFile[];
  currentFolderId: string | null;
  usage: { used: number; quota: number; free: number | null };
  loadError: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("new");
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const jobsRef = useRef<UploadJob[]>([]);
  const running = useRef(false);
  const stoppers = useRef(new Map<string, () => void>());
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renaming, setRenaming] = useState<DriveFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<DriveFolder | null>(null);
  const [editing, setEditing] = useState<DriveFile | null>(null);
  const [moving, setMoving] = useState<DriveFile | null>(null);
  const [deletingFile, setDeletingFile] = useState<DriveFile | null>(null);

  const blocked = Boolean(loadError);
  const trail = useMemo(() => folderTrail(folders, currentFolderId), [folders, currentFolderId]);
  const currentName = trail.length ? trail[trail.length - 1].name : "คลังไฟล์";

  const counts = useMemo(() => {
    const map = new Map<string, { files: number; folders: number }>();
    const bump = (id: string | null, key: "files" | "folders") => {
      if (!id) return;
      const entry = map.get(id) ?? { files: 0, folders: 0 };
      entry[key] += 1;
      map.set(id, entry);
    };
    for (const f of folders) bump(f.parent_id, "folders");
    for (const f of files) bump(f.folder_id, "files");
    return map;
  }, [folders, files]);

  const searching = query.trim().length > 0;
  const shownFolders = useMemo(
    () =>
      (searching
        ? folders.filter((f) => driveMatches({ name: f.name, note: null }, query))
        : folders.filter((f) => f.parent_id === currentFolderId)
      ).sort((a, b) => a.name.localeCompare(b.name, "th", { numeric: true })),
    [folders, currentFolderId, searching, query]
  );
  const shownFiles = useMemo(
    () =>
      sortFiles(
        searching ? files.filter((f) => driveMatches(f, query)) : files.filter((f) => f.folder_id === currentFolderId),
        sort
      ),
    [files, currentFolderId, searching, query, sort]
  );

  const uploading = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    if (!uploading) return;
    // ปิดแท็บ/รีเฟรชระหว่างอัปโหลด = ไฟล์ที่เหลือไม่ถูกส่ง เบราว์เซอร์จะถามยืนยันก่อน
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  /* ───────────── คิวอัปโหลด ───────────── */

  function setJobList(next: UploadJob[]) {
    jobsRef.current = next;
    setJobs(next);
  }

  function patchJob(key: string, patch: Partial<UploadJob>) {
    setJobList(jobsRef.current.map((job) => (job.key === key ? { ...job, ...patch } : job)));
  }

  function enqueue(list: File[], skippedFolders = 0) {
    if (blocked) return;
    if (skippedFolders) {
      setError(
        `ข้ามโฟลเดอร์ที่ลากมา ${skippedFolders} โฟลเดอร์ — สร้างโฟลเดอร์ในคลังก่อน แล้วลากไฟล์ข้างในเข้าไปแทน`
      );
    }
    if (!list.length) return;
    const added = list.map((file): UploadJob => {
      const tooBig = file.size > DRIVE_MAX_FILE_BYTES;
      jobSeq += 1;
      return {
        key: `job-${jobSeq}`,
        file,
        folderId: currentFolderId,
        folderName: currentName,
        status: tooBig ? "error" : "queued",
        sent: 0,
        error: tooBig
          ? `ใหญ่ ${formatBytes(file.size)} เกินเพดาน ${formatBytes(DRIVE_MAX_FILE_BYTES)} ต่อไฟล์`
          : null,
        uploadId: null,
      };
    });
    setJobList([...jobsRef.current, ...added]);
    void pump();
  }

  async function pump() {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = jobsRef.current.find((job) => job.status === "queued");
        if (!next) break;
        await uploadOne(next);
      }
    } finally {
      running.current = false;
    }
  }

  async function uploadOne(job: UploadJob) {
    let stopped = false;
    let xhr: XMLHttpRequest | null = null;
    stoppers.current.set(job.key, () => {
      stopped = true;
      xhr?.abort();
    });
    let uploadId = job.uploadId;
    let lastPaint = 0;
    const paint = (sent: number) => {
      const now = Date.now();
      if (now - lastPaint < 200) return;
      lastPaint = now;
      patchJob(job.key, { sent });
    };
    patchJob(job.key, { status: "uploading", error: null });

    try {
      let offset = 0;
      if (uploadId) {
        // ลองใหม่หลังล้ม: ถามเซิร์ฟเวอร์ว่าได้ไปแล้วเท่าไหร่ แล้วส่งต่อจากตรงนั้น
        const status = await callApi("GET", `/api/drive/uploads/${uploadId}`);
        if (status.status === 200) offset = Number(status.body.received) || 0;
        else uploadId = null;
      }
      if (!uploadId) {
        const start = await callApi("POST", "/api/drive/uploads", {
          name: job.file.name,
          size: job.file.size,
          type: job.file.type,
          folderId: job.folderId,
        });
        if (start.status !== 201) throw new Error(messageOf(start, "เริ่มอัปโหลดไม่สำเร็จ"));
        uploadId = String(start.body.uploadId);
        patchJob(job.key, { uploadId });
      }
      patchJob(job.key, { sent: offset });

      while (offset < job.file.size) {
        if (stopped) throw new UploadStopped();
        const base = offset;
        const blob = job.file.slice(base, Math.min(base + DRIVE_CHUNK_BYTES, job.file.size));
        let reply: ApiReply = { status: 0, body: {} };
        // เน็ตหลุด / เซิร์ฟเวอร์สะดุด / ท่อนมาไม่ครบ -> ส่งท่อนเดิมซ้ำ (รอ 1, 2, 4, 8 วินาที)
        // เซิร์ฟเวอร์รับท่อนซ้ำได้โดยไม่เขียนสองรอบ จึงส่งซ้ำได้อย่างปลอดภัยเสมอ
        for (let attempt = 0; ; attempt += 1) {
          reply = await putChunk(
            `/api/drive/uploads/${uploadId}?offset=${base}`,
            blob,
            (loaded) => paint(base + loaded),
            (x) => {
              xhr = x;
            }
          );
          if (stopped || reply.status === -1) throw new UploadStopped();
          const retryable = reply.status === 0 || reply.status >= 500 || reply.body.retry === true;
          if (!retryable || attempt >= 4) break;
          await sleep(1000 * 2 ** attempt);
        }
        const synced = reply.status === 200 || (reply.status === 409 && typeof reply.body.received === "number");
        if (!synced) throw new Error(messageOf(reply, "ส่งไฟล์ไม่สำเร็จ"));
        offset = Number(reply.body.received);
        patchJob(job.key, { sent: offset });
      }

      patchJob(job.key, { status: "finishing", sent: job.file.size });
      const done = await callApi("POST", `/api/drive/uploads/${uploadId}/complete`);
      if (done.status !== 200) throw new Error(messageOf(done, "บันทึกไฟล์ไม่สำเร็จ"));
      patchJob(job.key, { status: "done", uploadId: null });
      router.refresh();
    } catch (err) {
      if (stopped || err instanceof UploadStopped) {
        patchJob(job.key, { status: "canceled", uploadId: null });
        // ยกเลิกเอง = ไม่ต้องการไฟล์นี้แล้ว ทิ้งท่อนที่ส่งไปทันที ไม่ต้องรอเก็บกวาด 24 ชั่วโมง
        if (uploadId) void callApi("DELETE", `/api/drive/uploads/${uploadId}`);
      } else {
        patchJob(job.key, {
          status: "error",
          error: err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ",
          uploadId,
        });
      }
    } finally {
      stoppers.current.delete(job.key);
    }
  }

  function cancelJob(job: UploadJob) {
    if (job.status === "queued") patchJob(job.key, { status: "canceled" });
    else stoppers.current.get(job.key)?.();
  }

  function retryJob(job: UploadJob) {
    if (job.file.size > DRIVE_MAX_FILE_BYTES) return;
    patchJob(job.key, { status: "queued", error: null });
    void pump();
  }

  function clearFinished() {
    for (const job of jobsRef.current) {
      if (job.status === "error" && job.uploadId) void callApi("DELETE", `/api/drive/uploads/${job.uploadId}`);
    }
    setJobList(jobsRef.current.filter((job) => ACTIVE.includes(job.status)));
  }

  /* ───────────── ลากไฟล์มาวาง ───────────── */

  function onDragEnter(event: React.DragEvent) {
    if (!carriesFiles(event) || blocked) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragOver(event: React.DragEvent) {
    if (!carriesFiles(event) || blocked) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(event: React.DragEvent) {
    if (!carriesFiles(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }
  function onDrop(event: React.DragEvent) {
    if (!carriesFiles(event) || blocked) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const { files: dropped, folders: skipped } = readDrop(event.dataTransfer);
    enqueue(dropped, skipped);
  }

  /* ───────────── โฟลเดอร์ / แก้ไขไฟล์ ───────────── */

  function run(
    fn: () => Promise<DriveActionResult>,
    { onSuccess, inDialog = false, onFailure }: { onSuccess?: () => void; inDialog?: boolean; onFailure?: () => void } = {}
  ) {
    setError(null);
    setDialogError(null);
    startTransition(async () => {
      let result: DriveActionResult;
      try {
        result = await fn();
      } catch {
        result = { error: "ติดต่อเซิร์ฟเวอร์ไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่" };
      }
      if (result.error) {
        onFailure?.();
        if (inDialog) setDialogError(result.error);
        else setError(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  const openDialog = (open: () => void) => {
    setDialogError(null);
    open();
  };

  const folderOptions = useMemo(
    () =>
      folders
        .map((f) => ({ id: f.id, label: folderLabel(folders, f.id) }))
        .sort((a, b) => a.label.localeCompare(b.label, "th", { numeric: true })),
    [folders]
  );

  const emptyText = blocked
    ? "แสดงไฟล์ไม่ได้จนกว่าจะกู้ไฟล์ข้อมูล"
    : searching
      ? `ไม่พบไฟล์หรือโฟลเดอร์ที่ตรงกับ "${query.trim()}"`
      : "โฟลเดอร์นี้ยังว่าง — ลากไฟล์มาวางที่นี่ หรือกดปุ่ม ⬆ อัปโหลดไฟล์";

  return (
    <div
      className="flex flex-col gap-5"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-page/80 p-6 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent/60 bg-surface/80 px-8 py-10 text-center">
            <p className="text-3xl" aria-hidden>
              ⬆
            </p>
            <p className="mt-2 text-base font-semibold text-ink">ปล่อยไฟล์เพื่ออัปโหลด</p>
            <p className="mt-1 text-sm text-muted">เข้าโฟลเดอร์ “{currentName}” · สูงสุด {formatBytes(DRIVE_MAX_FILE_BYTES)} ต่อไฟล์</p>
          </div>
        </div>
      )}

      <PageHeader
        title="คลังไฟล์"
        description="เก็บไฟล์ โปรแกรม และเอกสารไว้ที่เดียว เปิดจากเครื่องไหนก็ดาวน์โหลดได้ — สูงสุด 500 MB ต่อไฟล์"
        actions={
          <>
            <Button variant="outline" onClick={() => openDialog(() => setCreatingFolder(true))} disabled={blocked}>
              ＋ โฟลเดอร์ใหม่
            </Button>
            <Button onClick={() => inputRef.current?.click()} disabled={blocked}>
              ⬆ อัปโหลดไฟล์
            </Button>
          </>
        }
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          enqueue(Array.from(event.target.files ?? []));
          // ล้างค่าเพื่อให้เลือกไฟล์ชื่อเดิมซ้ำได้ (เช่นอัปโหลดใหม่หลังลบ)
          event.target.value = "";
        }}
      />

      <UsageBar usage={usage} />

      {loadError && <Alert>{loadError}</Alert>}
      {error && <Alert>{error}</Alert>}

      {jobs.length > 0 && (
        <UploadPanel jobs={jobs} onCancel={cancelJob} onRetry={retryJob} onClear={clearFinished} />
      )}

      <nav aria-label="ตำแหน่งโฟลเดอร์" className="flex flex-wrap items-center gap-1 text-sm">
        {trail.length === 0 && !searching ? (
          <span className="font-medium text-ink">🗂️ คลังไฟล์</span>
        ) : (
          <Link href="/files" className="text-muted hover:text-accent">
            🗂️ คลังไฟล์
          </Link>
        )}
        {!searching &&
          trail.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1">
              <span className="text-muted/60">/</span>
              {index === trail.length - 1 ? (
                <span className="font-medium text-ink [overflow-wrap:anywhere]">{folder.name}</span>
              ) : (
                <Link href={`/files?f=${folder.id}`} className="text-muted hover:text-accent [overflow-wrap:anywhere]">
                  {folder.name}
                </Link>
              )}
            </span>
          ))}
        {searching && <span className="text-muted">/ ผลการค้นหาทุกโฟลเดอร์</span>}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ค้นหาชื่อไฟล์หรือข้อความกำกับ (ทุกโฟลเดอร์)..."
          aria-label="ค้นหาไฟล์"
          className={`${CONTROL} w-full sm:w-96`}
        />
        <select
          aria-label="เรียงไฟล์"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className={CONTROL}
        >
          <option value="new">ใหม่สุดก่อน</option>
          <option value="name">ชื่อ ก–ฮ / A–Z</option>
          <option value="size">ขนาดใหญ่สุดก่อน</option>
        </select>
        <span className="text-sm text-muted">
          <span className="font-num text-ink">{shownFolders.length}</span> โฟลเดอร์ ·{" "}
          <span className="font-num text-ink">{shownFiles.length}</span> ไฟล์
        </span>
      </div>

      {shownFolders.length + shownFiles.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="โฟลเดอร์และไฟล์">
          {shownFolders.map((folder) => {
            const inside = counts.get(folder.id) ?? { files: 0, folders: 0 };
            return (
              <li key={folder.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none" aria-hidden>
                    📁
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/files?f=${folder.id}`}
                      className="font-medium text-ink hover:text-accent [overflow-wrap:anywhere]"
                    >
                      {folder.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-num">{inside.files}</span> ไฟล์ · <span className="font-num">{inside.folders}</span>{" "}
                      โฟลเดอร์ย่อย
                      {searching ? ` · อยู่ใน ${folderLabel(folders, folder.parent_id)}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/files?f=${folder.id}`} className={ROW_BUTTON}>
                        เปิด
                      </Link>
                      <RowButton onClick={() => openDialog(() => setRenaming(folder))} disabled={isPending || blocked}>
                        เปลี่ยนชื่อ
                      </RowButton>
                      <RowButton onClick={() => setDeletingFolder(folder)} disabled={isPending || blocked} danger>
                        ลบ
                      </RowButton>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
          {shownFiles.map((file) => {
            const kind = fileKind(file.name);
            const href = `/api/drive/files/${file.id}`;
            return (
              <li key={file.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none" aria-hidden title={kind.label}>
                    {kind.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a href={href} download className="font-medium text-ink hover:text-accent [overflow-wrap:anywhere]">
                      {file.name}
                    </a>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-num text-ink">{formatBytes(file.size)}</span> · {stampTH(file.uploaded_at)} ·{" "}
                      {file.uploaded_by}
                      {file.updated_at ? " · แก้ไขแล้ว" : ""}
                      {searching ? ` · 📁 ${folderLabel(folders, file.folder_id)}` : ""}
                    </p>
                    {file.note ? (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-ink/[0.03] px-3 py-2 text-sm leading-6 text-ink [overflow-wrap:anywhere]">
                        {file.note}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={href} download className={ROW_BUTTON}>
                        ⬇ ดาวน์โหลด
                      </a>
                      <RowButton onClick={() => openDialog(() => setEditing(file))} disabled={isPending || blocked}>
                        แก้ไข / ข้อความ
                      </RowButton>
                      <RowButton onClick={() => openDialog(() => setMoving(file))} disabled={isPending || blocked}>
                        ย้าย
                      </RowButton>
                      <RowButton onClick={() => setDeletingFile(file)} disabled={isPending || blocked} danger>
                        ลบ
                      </RowButton>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-sm text-muted">
          {emptyText}
        </p>
      )}

      <NameModal
        key={creatingFolder ? "new-open" : "new-closed"}
        open={creatingFolder}
        title="สร้างโฟลเดอร์ใหม่"
        description={`สร้างไว้ใน “${currentName}”`}
        initial=""
        submitLabel="สร้างโฟลเดอร์"
        pending={isPending}
        error={dialogError}
        onClose={() => setCreatingFolder(false)}
        onSubmit={(name) =>
          run(() => createFolderAction(currentFolderId, name), {
            inDialog: true,
            onSuccess: () => setCreatingFolder(false),
          })
        }
      />

      <NameModal
        key={renaming?.id ?? "rename-closed"}
        open={renaming !== null}
        title="เปลี่ยนชื่อโฟลเดอร์"
        initial={renaming?.name ?? ""}
        submitLabel="บันทึกชื่อ"
        pending={isPending}
        error={dialogError}
        onClose={() => setRenaming(null)}
        onSubmit={(name) =>
          renaming &&
          run(() => renameFolderAction(renaming.id, name), { inDialog: true, onSuccess: () => setRenaming(null) })
        }
      />

      <EditFileModal
        key={editing?.id ?? "edit-closed"}
        file={editing}
        pending={isPending}
        error={dialogError}
        onClose={() => setEditing(null)}
        onSave={(input) =>
          editing &&
          run(() => updateFileAction(editing.id, input), { inDialog: true, onSuccess: () => setEditing(null) })
        }
      />

      <MoveFileModal
        key={moving?.id ?? "move-closed"}
        file={moving}
        options={folderOptions}
        pending={isPending}
        error={dialogError}
        onClose={() => setMoving(null)}
        onMove={(folderId) =>
          moving && run(() => moveFileAction(moving.id, folderId), { inDialog: true, onSuccess: () => setMoving(null) })
        }
      />

      <ConfirmDialog
        open={deletingFolder !== null}
        onClose={() => setDeletingFolder(null)}
        onConfirm={() =>
          deletingFolder &&
          run(() => deleteFolderAction(deletingFolder.id), {
            onSuccess: () => setDeletingFolder(null),
            onFailure: () => setDeletingFolder(null),
          })
        }
        pending={isPending}
        title="ลบโฟลเดอร์?"
        message={<span className="[overflow-wrap:anywhere]">📁 {deletingFolder?.name}</span>}
        confirmLabel="ลบโฟลเดอร์"
        blockedReason={
          deletingFolder && (counts.get(deletingFolder.id)?.files || counts.get(deletingFolder.id)?.folders)
            ? "ลบได้เฉพาะโฟลเดอร์ว่าง — ย้ายหรือลบไฟล์และโฟลเดอร์ย่อยข้างในก่อน (กันกดพลาดแล้วไฟล์หายทั้งโฟลเดอร์)"
            : null
        }
      />

      <ConfirmDialog
        open={deletingFile !== null}
        onClose={() => setDeletingFile(null)}
        onConfirm={() =>
          deletingFile &&
          run(() => deleteFileAction(deletingFile.id), {
            onSuccess: () => setDeletingFile(null),
            onFailure: () => setDeletingFile(null),
          })
        }
        pending={isPending}
        title="ลบไฟล์นี้?"
        message={
          deletingFile ? (
            <span className="block [overflow-wrap:anywhere]">
              {fileKind(deletingFile.name).icon} {deletingFile.name}
              <span className="block text-xs text-muted">{formatBytes(deletingFile.size)} — ลบแล้วกู้คืนไม่ได้</span>
            </span>
          ) : null
        }
        confirmLabel="ลบไฟล์"
      />
    </div>
  );
}

/* ───────────────────────────── ชิ้นส่วนย่อย ───────────────────────────── */

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
      {children}
    </p>
  );
}

function UsageBar({ usage }: { usage: { used: number; quota: number; free: number | null } }) {
  const percent = usage.quota > 0 ? Math.min(100, Math.round((usage.used / usage.quota) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          ใช้ไป <span className="font-num text-ink">{formatBytes(usage.used)}</span> จาก{" "}
          <span className="font-num">{formatBytes(usage.quota)}</span>
        </span>
        {usage.free !== null && (
          <span>
            ดิสก์เซิร์ฟเวอร์ว่าง <span className="font-num">{formatBytes(usage.free)}</span>
          </span>
        )}
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]"
        role="progressbar"
        aria-label="พื้นที่คลังไฟล์ที่ใช้ไป"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full rounded-full ${percent >= 90 ? "bg-rose-400" : "bg-gradient-to-r from-accent to-accent-2"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

const JOB_TEXT: Record<JobStatus, string> = {
  queued: "รอคิว",
  uploading: "กำลังอัปโหลด",
  finishing: "กำลังตรวจไฟล์...",
  done: "เสร็จแล้ว ✓",
  error: "ไม่สำเร็จ",
  canceled: "ยกเลิกแล้ว",
};

function UploadPanel({
  jobs,
  onCancel,
  onRetry,
  onClear,
}: {
  jobs: UploadJob[];
  onCancel: (job: UploadJob) => void;
  onRetry: (job: UploadJob) => void;
  onClear: () => void;
}) {
  const finished = jobs.filter((job) => !ACTIVE.includes(job.status)).length;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label="การอัปโหลด">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">การอัปโหลด</h2>
        {finished > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-muted hover:text-accent">
            ล้างรายการที่จบแล้ว
          </button>
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {jobs.map((job) => {
          const percent = job.file.size ? Math.floor((job.sent / job.file.size) * 100) : job.status === "done" ? 100 : 0;
          return (
            <li key={job.key} className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 text-ink [overflow-wrap:anywhere]">
                  {fileKind(job.file.name).icon} {job.file.name}
                </span>
                <span className="flex shrink-0 gap-2">
                  {ACTIVE.includes(job.status) && job.status !== "finishing" && (
                    <button type="button" onClick={() => onCancel(job)} className="text-xs text-muted hover:text-rose-300">
                      ยกเลิก
                    </button>
                  )}
                  {job.status === "error" && job.file.size <= DRIVE_MAX_FILE_BYTES && (
                    <button type="button" onClick={() => onRetry(job)} className="text-xs text-accent hover:underline">
                      ลองใหม่
                    </button>
                  )}
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]"
                role="progressbar"
                aria-label={`ความคืบหน้า ${job.file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className={`h-full rounded-full transition-[width] ${
                    job.status === "error" ? "bg-rose-400" : job.status === "done" ? "bg-emerald-400" : "bg-accent"
                  }`}
                  style={{ width: `${job.status === "done" ? 100 : percent}%` }}
                />
              </div>
              <p className={`text-xs ${job.status === "error" ? "text-rose-300" : "text-muted"}`}>
                {JOB_TEXT[job.status]}
                {job.status === "uploading" && (
                  <>
                    {" "}
                    <span className="font-num">
                      {formatBytes(job.sent)} / {formatBytes(job.file.size)} ({percent}%)
                    </span>
                  </>
                )}
                {job.status === "done" && ` → ${job.folderName}`}
                {job.error ? ` — ${job.error}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NameModal({
  open,
  title,
  description,
  initial,
  submitLabel,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  initial: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(name)}
            disabled={pending || !name.trim()}
            className="w-full sm:w-auto"
          >
            {pending ? "กำลังบันทึก..." : submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        <Field label="ชื่อโฟลเดอร์" required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim() && !pending) {
                event.preventDefault();
                onSubmit(name);
              }
            }}
            maxLength={DRIVE_NAME_MAX}
            placeholder="เช่น โปรแกรมติดตั้ง, ไดรเวอร์ปริ้นเตอร์"
            className={MODAL_INPUT}
          />
        </Field>
      </div>
    </Modal>
  );
}

function EditFileModal({
  file,
  pending,
  error,
  onClose,
  onSave,
}: {
  file: DriveFile | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: { name: string; note: string }) => void;
}) {
  const [name, setName] = useState(file?.name ?? "");
  const [note, setNote] = useState(file?.note ?? "");
  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title="แก้ไขไฟล์"
      description={file ? `${formatBytes(file.size)} · อัปโหลด ${stampTH(file.uploaded_at)} โดย ${file.uploaded_by}` : undefined}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onSave({ name, note })}
            disabled={pending || !name.trim()}
            className="w-full sm:w-auto"
          >
            {pending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="ชื่อไฟล์" required hint="เปลี่ยนชื่อที่แสดงและชื่อตอนดาวน์โหลด — ตัวไฟล์ไม่เปลี่ยน">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={DRIVE_NAME_MAX}
            className={MODAL_INPUT}
          />
        </Field>
        <Field label="ข้อความกำกับ" hint="เช่น ใช้กับเครื่องไหน เวอร์ชันอะไร รหัสติดตั้งอยู่ที่ใคร">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={5}
            maxLength={DRIVE_NOTE_MAX}
            className={`${MODAL_INPUT} min-h-[7rem] resize-y leading-6`}
          />
        </Field>
        {file?.sha256 ? (
          <p className="text-[0.7rem] leading-4 text-muted/80 [overflow-wrap:anywhere]">
            SHA-256: <span className="font-num">{file.sha256}</span>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MoveFileModal({
  file,
  options,
  pending,
  error,
  onClose,
  onMove,
}: {
  file: DriveFile | null;
  options: { id: string; label: string }[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const [target, setTarget] = useState(file?.folder_id ?? "");
  const unchanged = (file?.folder_id ?? "") === target;
  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title="ย้ายไฟล์"
      description={file?.name}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onMove(target || null)}
            disabled={pending || unchanged}
            className="w-full sm:w-auto"
          >
            {pending ? "กำลังย้าย..." : "ย้ายไปที่นี่"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        <Field label="ย้ายไปโฟลเดอร์">
          <select value={target} onChange={(event) => setTarget(event.target.value)} className={MODAL_INPUT}>
            <option value="">🗂️ คลังไฟล์ (ชั้นบนสุด)</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                📁 {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

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
        danger ? "hover:border-rose-400/40 hover:text-rose-300" : "hover:border-accent/40 hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
