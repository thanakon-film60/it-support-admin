import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth";
import { TopNav } from "@/components/nav/TopNav";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();

  return (
    <div className="min-h-screen">
      <TopNav displayName={session.displayName} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
