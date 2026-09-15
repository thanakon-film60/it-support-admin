"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

const NAV_ITEMS = [
  { href: "/", icon: "📊", label: "ภาพรวม" },
  { href: "/tickets", icon: "🎫", label: "Tickets" },
  { href: "/assets", icon: "💻", label: "ทรัพย์สิน" },
  { href: "/custodian", icon: "👤", label: "ผู้ครอบครอง" },
  { href: "/repair-history", icon: "🔧", label: "ประวัติซ่อม" },
  { href: "/stock", icon: "📦", label: "สต็อก" },
  { href: "/faq", icon: "🤖", label: "FAQ Bot" },
];

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
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3">
        <div className="mr-2 flex shrink-0 items-center gap-2">
          <span className="text-xl">🖥️</span>
          <span className="font-mono text-sm font-bold text-ink">IT Admin</span>
        </div>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-accent-bg text-accent"
                    : "text-muted hover:bg-accent-bg/50 hover:text-ink"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3 pl-2">
          <span className="hidden text-sm text-muted sm:inline">{displayName}</span>
          {showLogout && (
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-2 text-sm text-muted transition hover:border-red-500/50 hover:text-red-400"
              >
                ออกจากระบบ
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
