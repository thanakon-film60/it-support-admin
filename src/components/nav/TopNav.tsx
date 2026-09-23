"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

const NAV_ITEMS = [
  { href: "/", icon: "◎", label: "ภาพรวม" },
  { href: "/tickets", icon: "🎫", label: "Tickets" },
  { href: "/assets", icon: "💻", label: "ทรัพย์สิน" },
  { href: "/custodian", icon: "👤", label: "ผู้ครอบครอง" },
  { href: "/branches", icon: "🏢", label: "สาขา" },
  { href: "/resolved", icon: "✅", label: "แก้ไขปัญหาแล้ว" },
  { href: "/repair-history", icon: "🔧", label: "ประวัติซ่อม" },
  { href: "/stock", icon: "📦", label: "สต็อก" },
  { href: "/faq", icon: "🤖", label: "FAQ Bot" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function TopNav({
  displayName,
  showLogout = true,
}: {
  displayName: string;
  /** ปิดล็อกอินอยู่ -> ไม่ต้องมีปุ่มออกจากระบบ เพราะกดแล้วก็ไม่มีอะไรให้ออก */
  showLogout?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/70 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-3 sm:px-4">
        {/* แถวบน: โลโก้ + ชื่อผู้ใช้ — เมนูแยกลงแถวล่างบนจอเล็ก เพื่อให้ปุ่มกดได้เต็มนิ้ว */}
        <div className="flex h-14 items-center justify-between gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/25 to-indigo-400/20 text-sm ring-1 ring-inset ring-cyan-400/30">
              <span className="absolute inset-0 rounded-xl bg-cyan-400/10 blur-md" aria-hidden />
              <span className="relative">🖥️</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight text-ink">
                IT Admin
              </span>
              <span className="hidden text-[0.65rem] uppercase tracking-[0.18em] text-muted sm:block">
                support console
              </span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-[12rem] truncate rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-xs text-muted sm:inline-block">
              {displayName}
            </span>
            {showLogout ? (
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-rose-400/40 hover:text-rose-300"
                >
                  ออกจากระบบ
                </button>
              </form>
            ) : null}
          </div>
        </div>

        {/* แถวเมนู — ปัดซ้ายขวาได้บนมือถือ (7 เมนูใส่บรรทัดเดียวไม่พอบนจอ 390px) */}
        <nav className="no-scrollbar -mx-3 flex items-center gap-1 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-accent-bg text-accent ring-1 ring-inset ring-cyan-400/30"
                    : "text-muted hover:bg-white/[0.04] hover:text-ink"
                }`}
              >
                <span aria-hidden>{item.icon}</span>
                <span>{item.label}</span>
                {active ? (
                  <span
                    className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                    aria-hidden
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
