import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { PAGES } from "@/lib/access";
import { PageHeader } from "@/components/ui/Card";
import { RefreshOnMount } from "@/components/nav/RefreshOnMount";

/** ปลายทางเมื่อเปิดหน้าที่บัญชีนี้ไม่มีสิทธิ์ (requireSession(page) เด้งมาที่นี่)
 *
 *  อยู่ในกลุ่ม dashboard โดยตั้งใจ — ยังเห็นเมนูของหน้าที่เข้าได้ กดไปต่อได้ทันที
 *  ไม่ระบุว่าถูกกันจากหน้าไหน: คนกดเพิ่งเลือกหน้านั้นเองจึงรู้อยู่แล้ว และไม่ต้องส่งชื่อหน้าผ่าน URL ให้ใครแต่งได้ */
export default async function NoAccessPage() {
  const session = await requireSession();
  const allowed = PAGES.filter((page) => session.pages.includes(page.key));

  return (
    <div className="flex flex-col gap-5">
      <RefreshOnMount />
      <PageHeader
        title="ไม่มีสิทธิ์เข้าหน้านี้"
        description="บัญชีของคุณยังไม่ได้รับสิทธิ์ใช้หน้านี้ — ถ้าจำเป็นต้องใช้ ติดต่อผู้ดูแลระบบ IT ให้เพิ่มสิทธิ์ให้"
      />
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        {allowed.length > 0 ? (
          <>
            <h2 className="text-sm font-semibold text-ink">หน้าที่คุณเข้าได้</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allowed.map((page) => (
                <li key={page.key}>
                  <Link
                    href={page.href}
                    className="flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-ink transition hover:border-accent/40 hover:text-accent"
                  >
                    <span aria-hidden>{page.icon}</span>
                    <span>{page.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">
            บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าหน้าไหนเลย — ติดต่อผู้ดูแลระบบ IT ให้เลือกหน้าที่ใช้งานให้
          </p>
        )}
      </section>
    </div>
  );
}
