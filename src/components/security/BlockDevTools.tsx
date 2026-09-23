"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** สกัดการเปิดเครื่องมือนักพัฒนา (Inspect / View Source) บนหน้าแอดมิน
 *
 *  ⚠️ อ่านก่อนใช้ — ขีดจำกัดที่ต้องรู้ ไม่ใช่ข้อบกพร่องของโค้ดนี้:
 *  วิธีนี้กันได้แค่ "การกดด้วยความอยากรู้" เท่านั้น กันคนที่ตั้งใจจะดูข้อมูลไม่ได้เลย
 *  เพราะ HTML/JS ทั้งหมดถูกส่งไปที่เครื่องผู้ใช้แล้วก่อนที่โค้ดนี้จะได้ทำงาน
 *  ทางที่ยังเปิดอยู่เสมอและปิดไม่ได้จากฝั่งเว็บ:
 *    • เปิด DevTools ไว้ก่อนแล้วค่อยเปิดหน้าเว็บ
 *    • เมนูเบราว์เซอร์ → เครื่องมือเพิ่มเติม → เครื่องมือสำหรับนักพัฒนาเว็บ
 *    • ปิด JavaScript แล้วโหลดหน้าใหม่ (โค้ดนี้ไม่ทำงานเลย)
 *    • `curl` / Postman / บันทึกหน้าเว็บ — ไม่ผ่านเบราว์เซอร์ จึงไม่เจอโค้ดนี้
 *  ถ้าเป้าหมายคือ "ห้ามคนนอกเห็นข้อมูล" ต้องแก้ที่ชั้นสิทธิ์ (AUTH_DISABLED=false) เท่านั้น
 *
 *  ประสิทธิผลจริงของแต่ละกลไก (ทดสอบแล้ว ไม่ได้เดา):
 *    • คลิกขวา → Inspect  = กันได้จริงทุกเบราว์เซอร์     ← ทางที่คนใช้บ่อยที่สุด
 *    • Ctrl+U (ดูซอร์ส)   = กันได้ใน Chrome/Edge
 *    • F12 / Ctrl+Shift+I = แล้วแต่เบราว์เซอร์ บางตัวจองคีย์ไว้เองและเว็บยกเลิกไม่ได้
 *  จึงใส่ไว้ทั้งชุด ตัวไหนกันได้ก็กัน ตัวไหนกันไม่ได้ก็ไม่พังอะไร
 *
 *  สิ่งที่จงใจ "ไม่" ทำ:
 *    • ไม่ใช้ลูป `debugger;` — เทคนิคยอดฮิตที่ทำให้แท็บค้างจนต้องปิดทิ้ง และกวนทีม IT
 *      ซึ่งเป็นคนที่ต้องเปิด DevTools จริงๆ เวลาหน้าเว็บมีปัญหา
 *    • ไม่ห้ามลากเลือกข้อความ/ก็อปปี้ — แอดมินต้องก็อปรหัสทรัพย์สินไปวางทุกวัน
 *      ห้ามแล้วเสียประโยชน์มากกว่าที่ได้
 */

type Props = {
  /** ห้ามคลิกขวาทั้งหน้า (ยังคลิกขวาในช่องกรอกและบนข้อความที่เลือกไว้ได้) */
  blockContextMenu?: boolean;
  /** เบลอหน้าจอเมื่อ "เดา" ว่า DevTools ถูกเปิดอยู่ — ดูหมายเหตุที่ useDevToolsWatcher */
  detectOpen?: boolean;
};

const TOAST_MS = 2200;

/** คีย์ลัดที่ต้องสกัด — แยกฟังก์ชันไว้เพื่อให้เทสต์ยิงเข้ามาตรงๆ ได้ */
function isBlockedCombo(e: KeyboardEvent): boolean {
  const key = e.key;
  // macOS ใช้ Cmd+Option+I แทน Ctrl+Shift+I จึงต้องนับ metaKey ด้วย
  const mod = e.ctrlKey || e.metaKey;
  const alt = e.shiftKey || e.altKey;

  if (key === "F12") return true;
  if (mod && alt && ["I", "J", "C"].includes(key.toUpperCase())) return true;
  if (mod && !e.shiftKey && key.toUpperCase() === "U") return true; // ดูซอร์สโค้ด
  return false;
}

/** คลิกขวาตรงไหนที่ยัง "ต้อง" ใช้ได้ — ไม่งั้นแอดมินวางข้อความในฟอร์มไม่ได้เลย */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest("input, textarea, select, [contenteditable=true]") !== null;
}

function hasSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

export function BlockDevTools({ blockContextMenu = true, detectOpen = false }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** บอกผู้ใช้ว่า "ถูกปิดไว้" ไม่ใช่ปล่อยให้เงียบจนคิดว่าคีย์บอร์ดเสีย
   *  — ความต่างระหว่าง "ระบบห้าม" กับ "ระบบพัง" อยู่ตรงข้อความบรรทัดเดียวนี้ */
  const notify = useCallback((message: string) => {
    setToast(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => {
    // capture: true — ดักก่อนที่ handler ของหน้าอื่นจะได้เห็น event
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isBlockedCombo(e)) return;
      e.preventDefault();
      e.stopPropagation();
      notify("ปิดการใช้งานเครื่องมือนักพัฒนาไว้ในระบบนี้");
    };

    const onContextMenu = (e: MouseEvent) => {
      if (!blockContextMenu) return;
      if (isEditableTarget(e.target) || hasSelection()) return;
      e.preventDefault();
      notify("ปิดการคลิกขวาไว้ในระบบนี้");
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("contextmenu", onContextMenu, { capture: true });
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [blockContextMenu, notify]);

  const devToolsOpen = useDevToolsWatcher(detectOpen);

  return (
    <>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[9999] flex justify-center px-4"
        >
          <span className="rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-900 shadow-xl ring-1 ring-black/10">
            🔒 {toast}
          </span>
        </div>
      )}

      {devToolsOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-md">
          <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            <p className="text-3xl">🔒</p>
            <p className="mt-3 text-base font-semibold text-slate-900">
              ระบบนี้ไม่อนุญาตให้เปิดเครื่องมือนักพัฒนา
            </p>
            <p className="mt-2 text-sm text-slate-500">
              ปิดเครื่องมือนักพัฒนาแล้วหน้าจอจะกลับมาเองทันที
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** เดาว่า DevTools เปิดอยู่จาก "ช่องว่างระหว่างขนาดหน้าต่างกับพื้นที่แสดงผล"
 *
 *  ⚠️ เป็นการเดา ไม่ใช่การตรวจจับที่เชื่อถือได้ และพลาดได้ 2 ทาง:
 *    • ไม่เจอ: ถ้าผู้ใช้แยก DevTools ออกเป็นหน้าต่างต่างหาก ขนาดหน้าเว็บไม่เปลี่ยนเลย
 *    • เจอผิด: แถบเครื่องมือเสริมบางตัว หรือการซูมแรงๆ ทำให้ค่าต่างเกินเกณฑ์ได้
 *  เพราะพลาดได้ทั้งสองทาง ค่าตั้งต้นจึงเป็น "ปิด" และผลของมันคือแค่เบลอจอชั่วคราว
 *  (กลับมาเองเมื่อปิด DevTools) ไม่ลบข้อมูล ไม่เด้งออกจากระบบ ไม่ล็อกบัญชี
 */
function useDevToolsWatcher(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    // 160px มาจากความสูงขั้นต่ำที่ DevTools แบบ dock ใช้จริง ตั้งต่ำกว่านี้จะเจอผิดบ่อย
    const THRESHOLD = 160;
    const check = () => {
      const wide = window.outerWidth - window.innerWidth > THRESHOLD;
      const tall = window.outerHeight - window.innerHeight > THRESHOLD;
      setOpen(wide || tall);
    };
    check();
    const id = setInterval(check, 1000);
    window.addEventListener("resize", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", check);
    };
  }, [enabled]);

  return open;
}

export { isBlockedCombo, isEditableTarget };
