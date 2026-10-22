"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ACCENTS,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  THEMES,
  THEME_PAGE_COLOR,
  THEME_STORAGE_KEY,
  isAccentId,
  isThemeMode,
  type AccentId,
  type ThemeMode,
} from "@/lib/theme";

type Prefs = { theme: ThemeMode; accent: AccentId };

const SERVER_SNAPSHOT = `${DEFAULT_THEME}|${DEFAULT_ACCENT}`;

function readStored(): Prefs {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    const accent = localStorage.getItem(ACCENT_STORAGE_KEY);
    return {
      theme: isThemeMode(theme) ? theme : DEFAULT_THEME,
      accent: isAccentId(accent) ? accent : DEFAULT_ACCENT,
    };
  } catch {
    return { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT };
  }
}

function applyPrefs(prefs: Prefs) {
  const root = document.documentElement;
  root.setAttribute("data-theme", prefs.theme);
  root.setAttribute("data-accent", prefs.accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_PAGE_COLOR[prefs.theme]);
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, prefs.theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, prefs.accent);
  } catch {
    // โหมดส่วนตัว/ปิดคุกกี้ — ยังเปลี่ยนสีได้ในแท็บนี้ แค่ไม่จำไว้ครั้งหน้า
  }
  applyPrefs(prefs);
}

// ค่าที่ "ใช้อยู่จริง" อ่านจาก attribute บน <html> ไม่ใช่ state ของคอมโพเนนต์
// เพราะสคริปต์ใน <head> ตั้งไว้ก่อน React จะเริ่ม และแท็บอื่นเปลี่ยนได้ (storage event ข้างล่าง)
function readApplied(): string {
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme");
  const accent = root.getAttribute("data-accent");
  return `${isThemeMode(theme) ? theme : DEFAULT_THEME}|${isAccentId(accent) ? accent : DEFAULT_ACCENT}`;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  // เปิดหลายแท็บอยู่ เปลี่ยนสีแท็บหนึ่งแล้วแท็บอื่นตามทันที — ไม่งั้นสลับแท็บแล้วเจอคนละธีมจนงงว่ากดไม่ติด
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === ACCENT_STORAGE_KEY) applyPrefs(readStored());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStorage);
  };
}

/** ปุ่มลอยมุมขวาล่าง (แบบ Chat Launcher) — เปิดหน้าต่างเลือกธีมสว่าง/มืด + สีหลัก
 *
 *  ไม่ใช่ modal: ไม่ล็อกหน้า ไม่ดักโฟกัส — กดเลือกสีแล้วเห็นผลทั้งหน้าทันทีโดยหน้าต่างยังเปิดอยู่
 *  ให้เทียบได้หลายสีก่อนตัดสินใจ · ปิดด้วยปุ่ม X / Esc / คลิกนอกหน้าต่าง */
export function ThemeLauncher() {
  const [open, setOpen] = useState(false);
  const applied = useSyncExternalStore(subscribe, readApplied, () => SERVER_SNAPSHOT);
  const [theme, accent] = applied.split("|") as [ThemeMode, AccentId];
  const rootRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const themeLabelId = useId();
  const accentLabelId = useId();

  // ตอน dev (Strict Mode) React remount แล้วล้าง attribute ที่สคริปต์ใน <head> ตั้งไว้บน <html>
  // ตั้งกลับก่อนจอวาด (production ไม่เกิด — บรรทัดนี้แค่ตั้งค่าเดิมซ้ำ) และอัปเดต meta theme-color
  // ซึ่งสคริปต์ใน <head> แตะไม่ได้ เพราะ meta อาจอยู่ถัดลงไปใน HTML ยังไม่ถูกอ่านตอนสคริปต์รัน
  useLayoutEffect(() => {
    applyPrefs(readStored());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      launcherRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  return (
    // print:hidden — ปุ่มลอยไม่ควรไปโผล่บนกระดาษรายงาน · z-30 = ใต้ลิ้นชักรายละเอียด (z-40) และ Modal (z-50)
    <div
      ref={rootRef}
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-30 flex flex-col items-end print:hidden sm:right-6"
    >
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? "ปิดหน้าต่างตั้งค่าการแสดงผล" : "เปิดหน้าต่างตั้งค่าการแสดงผล"}
        title="ตั้งค่าการแสดงผล"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_12px_28px_-12px_var(--color-accent)] transition hover:brightness-110 active:scale-95"
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z" />
            <path d="M8.5 9.5h7M8.5 12.5h4" />
          </svg>
        )}
      </button>

      {/* อยู่หลังปุ่มใน DOM (แต่วาดลอยอยู่เหนือปุ่ม) — กด Tab จากปุ่มแล้วเข้าหน้าต่างต่อได้เลย */}
      {open && (
        <section
          id={panelId}
          aria-label="ตั้งค่าการแสดงผล"
          className="absolute bottom-[calc(100%+0.75rem)] right-0 w-[19rem] max-w-[calc(100vw-2rem)] origin-bottom-right overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-panel)] motion-safe:animate-[launcher-pop_180ms_ease-out]"
        >
          <div className="flex items-center justify-between gap-2 bg-accent py-2 pl-4 pr-1.5 text-on-accent">
            <div className="min-w-0">
              <p className="text-[0.95rem] font-bold">ตั้งค่าการแสดงผล</p>
              <p className="text-xs opacity-85">จำไว้เฉพาะเครื่องนี้</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="ปิดหน้าต่างตั้งค่า"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition hover:bg-black/10"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <p id={themeLabelId} className="text-xs font-semibold text-muted">ธีม</p>
              <div role="group" aria-labelledby={themeLabelId} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1">
                {THEMES.map((option) => {
                  const active = theme === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => savePrefs({ theme: option.id, accent })}
                      className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition ${
                        active ? "bg-accent text-on-accent" : "text-ink hover:bg-ink/[0.05]"
                      }`}
                    >
                      {option.id === "light" ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
                        </svg>
                      )}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p id={accentLabelId} className="text-xs font-semibold text-muted">สีหลัก</p>
              <div role="group" aria-labelledby={accentLabelId} className="grid grid-cols-4 gap-2">
                {ACCENTS.map((option) => {
                  const active = accent === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => savePrefs({ theme, accent: option.id })}
                      className={`flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border bg-surface-2 text-xs font-medium text-ink transition ${
                        active ? "border-accent" : "border-line hover:border-accent/45"
                      }`}
                    >
                      {/* โชว์เฉดของธีมที่ใช้อยู่ — กดแล้วทั้งหน้าได้สีเดียวกับวงกลมนี้เป๊ะ */}
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: theme === "light" ? option.light : option.dark,
                          color: theme === "light" ? "#ffffff" : "#050b14",
                        }}
                      >
                        {active && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M5 12.5l4.2 4.2L19 7" />
                          </svg>
                        )}
                      </span>
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
