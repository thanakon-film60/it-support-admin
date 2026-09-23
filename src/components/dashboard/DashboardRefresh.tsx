"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

function subscribeConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function DashboardRefresh({ updatedAt, updatedTime }: { updatedAt: string; updatedTime: string }) {
  const router = useRouter();
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const online = useSyncExternalStore(subscribeConnection, () => navigator.onLine, () => true);

  useEffect(() => {
    if (!pending) inFlight.current = false;
  }, [pending]);

  function refresh() {
    if (inFlight.current || !navigator.onLine) return;
    inFlight.current = true;
    startTransition(() => router.refresh());
  }

  const refreshWhenIdle = useEffectEvent(() => {
    // Keep drafts and active edits stable; refresh on the next tick after editing ends.
    if (document.hidden || !navigator.onLine ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.activeElement?.matches('input, textarea, [contenteditable="true"]')) return;
    refresh();
  });

  useEffect(() => {
    if (intervalSeconds === 0) return;
    const timer = window.setInterval(() => refreshWhenIdle(), intervalSeconds * 1000);
    const resume = () => refreshWhenIdle();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [intervalSeconds]);

  return (
    <div className="mb-5 flex flex-wrap items-center justify-end gap-x-3 gap-y-2" data-dashboard-updated-at={updatedAt}>
      <p className="mr-auto text-xs text-muted" role="status" aria-live="polite">
        {!online ? "ออฟไลน์ — แสดงข้อมูลล่าสุดที่โหลดไว้" : pending ? "กำลังอัปเดตข้อมูล…" : (
          <>ข้อมูล ณ <time dateTime={updatedAt}>{updatedTime}</time> น.</>
        )}
      </p>
      <label className="flex items-center gap-2 text-xs text-muted">
        <span>อัตโนมัติ</span>
        <select
          aria-label="ความถี่รีเฟรชอัตโนมัติ"
          value={intervalSeconds}
          onChange={(event) => setIntervalSeconds(Number(event.target.value))}
          className="rounded-lg border border-line bg-surface px-2 py-2 text-ink outline-none focus:border-accent"
          title="พักอัตโนมัติขณะซ่อนแท็บหรือเปิดฟอร์มแก้ไข"
        >
          <option value={0}>ปิด</option>
          <option value={30}>ทุก 30 วินาที</option>
          <option value={60}>ทุก 1 นาที</option>
        </select>
      </label>
      <Button type="button" variant="outline" onClick={refresh} disabled={pending || !online} aria-busy={pending}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          className={pending ? "motion-safe:animate-spin" : ""} aria-hidden="true">
          <path d="M20 7v5h-5M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" strokeLinecap="round" />
        </svg>
        {pending ? "กำลังรีเฟรช…" : "รีเฟรชข้อมูล"}
      </Button>
    </div>
  );
}
