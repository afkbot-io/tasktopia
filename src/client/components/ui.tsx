import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "border-signal bg-signal text-[#172023] hover:bg-[#ffda5a]",
  secondary: "border-[#385760] bg-[#152a30] text-[#e5ece8] hover:border-[#5d8a97] hover:bg-[#1a333a]",
  quiet: "border-transparent bg-transparent text-[#9fc6d5] hover:bg-[#193038] hover:text-white",
  danger: "border-[#75494f] bg-[#311e23] text-[#edb0b4] hover:bg-[#43252b]",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }>(function Button({ variant = "secondary", className, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cx(
    "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 text-sm font-extrabold transition-colors disabled:pointer-events-none disabled:opacity-45",
    buttonVariants[variant], className,
  )} {...props} />;
});

export function Field({ label, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-bold text-[#c7d2d1]">
    <span>{label}</span>
    <input className={cx("min-h-12 w-full rounded-xl border border-[#34515a] bg-[#091518] px-3.5 text-base text-[#f0f3e9] outline-none transition focus:border-skyline focus:ring-4 focus:ring-[#73bddc]/10", className)} {...props} />
    {hint && <small className="font-normal leading-5 text-[#789095]">{hint}</small>}
  </label>;
}
