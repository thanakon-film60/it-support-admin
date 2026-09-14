import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger" | "outline";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-accent text-slate-900 hover:opacity-90",
  ghost: "bg-accent-bg text-accent hover:opacity-80",
  danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20",
  outline: "border border-line text-ink hover:border-accent hover:text-accent",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
