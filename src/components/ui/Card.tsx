import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass rounded-2xl p-5 ${className}`}>{children}</div>
  );
}

type Tone = "default" | "accent" | "warning" | "danger" | "success";

const TONE: Record<Tone, { value: string; chip: string; bar: string }> = {
  default: {
    value: "text-ink",
    chip: "bg-accent-bg text-accent ring-1 ring-inset ring-cyan-400/25",
    bar: "from-cyan-400/70 to-indigo-400/40",
  },
  accent: {
    value: "text-accent",
    chip: "bg-accent-bg text-accent ring-1 ring-inset ring-cyan-400/30",
    bar: "from-cyan-400 to-indigo-400/50",
  },
  warning: {
    value: "text-amber-300",
    chip: "bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-400/25",
    bar: "from-amber-400/80 to-amber-400/20",
  },
  danger: {
    value: "text-rose-300",
    chip: "bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-400/25",
    bar: "from-rose-500/80 to-rose-500/20",
  },
  success: {
    value: "text-emerald-300",
    chip: "bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/25",
    bar: "from-emerald-400/80 to-emerald-400/20",
  },
};

export function StatCard({
  icon,
  label,
  value,
  tone = "default",
  hint,
  href,
  linkHint,
}: {
  icon: string;
  label: string;
  value: string | number;
  tone?: Tone;
  /** บรรทัดเล็กใต้ตัวเลข เช่น "จาก 251 ชิ้น" — ใส่หรือไม่ใส่ก็ได้ */
  hint?: string;
  /** ใส่แล้วการ์ดจะกลายเป็นลิงก์ไปยังรายการของตัวเลขนั้น (พร้อมตัวกรองที่ตรงกัน)
   *
   *  สำคัญ: ปลายทางต้องกรองให้ได้ "จำนวนเดียวกับที่การ์ดโชว์" เป๊ะๆ
   *  ถ้ากดเลข 7 แล้วไปเจอ 15 แถว ผู้ใช้จะเลิกเชื่อตัวเลขบนแดชบอร์ดทั้งหน้า */
  href?: string;
  /** ข้อความบอกปลายทางตอน hover เช่น "ดูเรื่องที่รอดำเนินการ" — ใช้เป็น aria-label ด้วย */
  linkHint?: string;
}) {
  const t = TONE[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8rem] leading-5 text-muted">{label}</p>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${t.chip}`}
          aria-hidden
        >
          {icon}
        </span>
      </div>

      <p className={`font-num mt-3 text-3xl font-bold tracking-tight ${t.value}`}>
        {value}
      </p>

      <div className="mt-1 flex items-end justify-between gap-2">
        {hint ? <p className="min-w-0 text-xs leading-5 text-muted">{hint}</p> : <span />}
        {href ? (
          // ลูกศรจางๆ ที่ชัดขึ้นตอน hover — บอกว่า "กดได้" โดยไม่ต้องมีปุ่มมาแย่งที่ตัวเลข
          // บนมือถือไม่มี hover จึงให้มันเห็นจางๆ ไว้ตลอด ไม่ซ่อนจนมองไม่ออกว่ากดได้
          //
          // การ์ด 2 คอลัมน์บนมือถือกว้างแค่ ~160px คำว่า "ดูรายการ" จะไปเบียดให้ hint
          // ตัดบรรทัดเป็น 3 บรรทัดสั้นๆ อ่านยาก — จอเล็กจึงเหลือแค่ลูกศร ซึ่งสื่อว่ากดได้อยู่แล้ว
          <span
            className="shrink-0 text-xs text-muted opacity-60 transition group-hover:translate-x-0.5 group-hover:text-accent group-hover:opacity-100"
            aria-hidden
          >
            <span className="hidden sm:inline">ดูรายการ </span>→
          </span>
        ) : null}
      </div>

      {/* เส้นไล่เฉดล่างการ์ด — ตัวบอกโทนแบบเงียบๆ ไม่แย่งความสนใจจากตัวเลข */}
      <span
        className={`mt-3 block h-px w-full bg-gradient-to-r ${t.bar} opacity-70 transition-opacity group-hover:opacity-100`}
      />
    </>
  );

  const shell =
    "edge-glow glass group relative block rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/30 sm:p-5";

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      aria-label={linkHint ? `${label}: ${value} — ${linkHint}` : `${label}: ${value}`}
      className={`${shell} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
    >
      {body}
    </Link>
  );
}

/** หัวข้อหน้าแบบเดียวกันทุกหน้า — ชื่อเรื่อง + คำอธิบาย + ปุ่มด้านขวา */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-gradient text-xl font-bold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
