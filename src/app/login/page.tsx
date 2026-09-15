import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { AUTH_DISABLED } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  // ปิดล็อกอินอยู่ -> ไม่ต้องมีหน้านี้ ใครเปิด /login ตรงๆ ให้เด้งเข้าหน้าแรกเลย
  if (AUTH_DISABLED) redirect("/");

  const { from } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="text-2xl">🖥️</span>
          <div>
            <h1 className="font-mono text-lg font-bold text-ink">IT Admin</h1>
            <p className="text-xs text-muted">เข้าสู่ระบบสำหรับทีม IT</p>
          </div>
        </div>
        <LoginForm redirectTo={from ?? "/"} />
        <p className="mt-6 text-center text-xs text-muted">
          บัญชีทดสอบ: admin / ITadmin@2026 (ดูใน README.md)
        </p>
      </div>
    </div>
  );
}
