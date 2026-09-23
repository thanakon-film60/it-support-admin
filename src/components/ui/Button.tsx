import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger" | "outline";

const VARIANT_CLASS: Record<Variant, string> = {
  // ปุ่มหลัก — ไล่เฉด cyan→indigo + เงาเรืองใต้ปุ่ม ให้เด่นชัดว่าคือปุ่มที่ควรกด
  primary:
    "bg-gradient-to-r from-cyan-400 to-indigo-400 text-slate-950 shadow-[0_8px_24px_-12px_rgba(34,211,238,0.9)] hover:brightness-110 active:brightness-95",
  ghost:
    "bg-accent-bg text-accent ring-1 ring-inset ring-cyan-400/25 hover:bg-cyan-400/15 hover:ring-cyan-400/40",
  danger:
    "bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-400/25 hover:bg-rose-500/20 hover:ring-rose-400/40",
  outline:
    "border border-line bg-white/[0.02] text-ink hover:border-cyan-400/45 hover:text-accent",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
