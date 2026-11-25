import { cn } from "@/lib/cn";

/**
 * A letra pequena padrão só entra quando a tela não pede outro tamanho. Juntar as duas
 * classes não funciona: quem vence é a ordem no CSS, e "text-sm" vencia "text-lg".
 */
const letraPadrao = (className?: string) =>
  /(^|\s)text-(xs|sm|base|lg|xl|[2-9]xl)(\s|$)/.test(className ?? "") ? "" : "text-sm";

type ButtonProps =React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonProps) {
  const base = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 h-10 font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    letraPadrao(className),
  );
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary: "bg-primary text-white hover:opacity-90",
    secondary: "border border-line bg-card text-ink hover:bg-panel",
    ghost: "text-ink hover:bg-panel",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-card px-3 text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        letraPadrao(className),
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink">
      <span className="text-subtle">{label}</span>
      {children}
    </label>
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-line bg-card p-5", className)}
      {...props}
    />
  );
}

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "primary" | "success" | "warn" | "danger";
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  const tones: Record<NonNullable<BadgeProps["tone"]>, string> = {
    neutral: "bg-panel text-subtle",
    primary: "bg-primary-soft text-primary",
    success: "bg-success/15 text-success",
    warn: "bg-warn/15 text-warn",
    danger: "bg-danger/15 text-danger",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
