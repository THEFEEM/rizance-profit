import type { PaymentStatus, ProjectStatus } from "@/types/project";
import { PAYMENT_STATUS_UI, PROJECT_LIST_STATUS_BADGE } from "@/lib/project-ui";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const cfg = PROJECT_LIST_STATUS_BADGE[status];
  return (
    <span
      className={`shrink-0 rounded-full border-[0.5px] px-2.5 py-0.5 text-xs font-medium ${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`}
    >
      {cfg.label}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const cfg = PAYMENT_STATUS_UI[status];
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium ${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`}
    >
      {cfg.label}
    </span>
  );
}
