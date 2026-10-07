import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function GameIcon({ name }: { name: "menu" | "filter" | "settings" | "help" | "world" | "search" }) {
  const paths = {
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    filter: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v6M16 9v6M10 15v6" /></>,
    settings: <><path d="m10 3-.6 2.2-2 .9-2.1-.6-2 3.4 1.6 1.6v2.4L3.3 15l2 3.4 2.1-.6 2 .9.6 2.3h4l.6-2.3 2-.9 2.1.6 2-3.4-1.6-1.8v-2.4l1.6-1.6-2-3.4-2.1.6-2-.9L14 3z" /><circle cx="12" cy="12" r="3" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8.5a2.6 2.6 0 0 1 5 1c0 2-2.5 2-2.5 4M12 17h.01" /></>,
    world: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6h14M5 18h14" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  };
  return <svg aria-hidden="true" className="game-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(function Button({ variant = "secondary", className, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} data-game-variant={variant} className={cx(
    "game-button inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 border px-4 text-sm font-bold transition-colors disabled:pointer-events-none",
    className,
  )} {...props} />;
});

export function Field({ label, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return <label className="game-field grid gap-1.5 text-sm font-bold">
    <span>{label}</span>
    <input className={cx("min-h-12 w-full border px-3.5 text-base transition-colors", className)} {...props} />
    {hint && <small className="font-normal leading-5">{hint}</small>}
  </label>;
}
