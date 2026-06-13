import type { MemberRole } from "@/types/booth";

/** Role badge + text colors for booth summary page (spec §2). */
export const ROLE_STYLES: Record<
  MemberRole | "pool",
  { text: string; badgeBg: string; badgeBorder: string; dot: string }
> = {
  investor: {
    text: "text-[#6BB6FF]",
    badgeBg: "bg-[#15293F]",
    badgeBorder: "border-[#1E3A52]",
    dot: "bg-rz-blue",
  },
  manager: {
    text: "text-rz-amber",
    badgeBg: "bg-[#2E2310]",
    badgeBorder: "border-[#5A3F12]",
    dot: "bg-rz-amber",
  },
  employee: {
    text: "text-[#B69CE8]",
    badgeBg: "bg-[#241F2E]",
    badgeBorder: "border-[#3D3352]",
    dot: "bg-[#B69CE8]",
  },
  pool: {
    text: "text-rz-blue",
    badgeBg: "bg-[#15293F]",
    badgeBorder: "border-[#1E3A52]",
    dot: "bg-rz-blue",
  },
};

export function RoleBadge({
  role,
  label,
}: {
  role: MemberRole | "pool";
  label: string;
}) {
  const s = ROLE_STYLES[role];
  return (
    <span
      className={`inline-flex items-center rounded-full border-[0.5px] px-2 py-0.5 text-xs font-medium ${s.text} ${s.badgeBg} ${s.badgeBorder}`}
    >
      {label}
    </span>
  );
}
