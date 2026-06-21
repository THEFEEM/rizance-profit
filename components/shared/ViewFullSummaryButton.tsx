import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";

const ACCENT_TEXT: Record<"green" | "amber" | "purple" | "rose", string> = {
  green: "text-rz-green",
  amber: "text-rz-amber",
  purple: "text-rz-purple",
  rose: "text-rz-rose",
};

const ACCENT_BORDER: Record<"green" | "amber" | "purple" | "rose", string> = {
  green: "border-rz-green/30",
  amber: "border-rz-amber/30",
  purple: "border-rz-purple/30",
  rose: "border-rz-rose/30",
};

/** Unified "ดูสรุปเต็ม" CTA — same layout across shop/booth/org/personal. */
export function ViewFullSummaryButton({
  href,
  accent = "green",
  className = "",
}: {
  href: string;
  accent?: "green" | "amber" | "purple" | "rose";
  className?: string;
}) {
  return (
    <div className={`px-4 ${className}`}>
      <Link
        href={href}
        className={`tap-target flex items-center justify-center gap-2 rounded-[14px] border-[0.5px] bg-rz-card px-4 py-3.5 text-sm font-medium active:bg-rz-elevated ${ACCENT_BORDER[accent]} ${ACCENT_TEXT[accent]}`}
      >
        <BarChart3 size={18} strokeWidth={2} aria-hidden />
        ดูสรุปเต็ม
        <ChevronRight size={16} strokeWidth={2} className="opacity-70" aria-hidden />
      </Link>
    </div>
  );
}
