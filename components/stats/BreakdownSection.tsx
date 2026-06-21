import type { ReactNode } from "react";

export function BreakdownSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="px-4">
      <h2 className="mb-2.5 text-sm font-medium text-rz-text">{title}</h2>
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        {children}
      </div>
    </section>
  );
}

export function ProgressBarRow({
  icon,
  label,
  amount,
  percentage,
  currency = "THB",
  tone = "green",
}: {
  icon?: string;
  label: string;
  amount: string;
  percentage: number;
  currency?: string;
  tone?: "green" | "red" | "amber" | "purple";
}) {
  const barClass =
    tone === "green"
      ? "bg-rz-green"
      : tone === "red"
        ? "bg-rz-red"
        : tone === "amber"
          ? "bg-rz-amber"
          : "bg-rz-purple";
  const amountClass = tone === "red" ? "text-rz-red" : "text-rz-green";

  const pct = Math.min(100, Math.max(0, percentage));

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {icon && (
        <span className="text-xl leading-none" aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium text-rz-text">{label}</span>
          <span className="shrink-0 text-xs text-rz-hint">{pct.toFixed(0)}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-rz-elevated">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className={`shrink-0 text-sm font-medium rz-tabular ${amountClass}`}>{amount}</span>
    </div>
  );
}
