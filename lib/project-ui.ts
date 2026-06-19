/**
 * Project mode UI tokens + per-item icon/color config (spec §1–4).
 * GROUP 1 uses status + type; funding/expense/payment used in later groups.
 */

import type { PaymentStatus, ProjectStatus, ProjectType } from "@/types/project";
import { PAYMENT_STATUS_LABELS, PROJECT_STATUS_LABELS, projectStatusLabel } from "@/lib/project-status";

/** §1 Design tokens — purple accent */
export const PROJECT_UI = {
  accent: "#B69CE8",
  accentBg: "#241B38",
  accentBorder: "#3D2F5C",
  positive: "#4ADE9E",
  negative: "#F87171",
  amber: "#EF9F27",
  purple: "#B69CE8",
  muted: "#9AA6B8",
  mutedDark: "#7A8699",
} as const;

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  short: "ระยะสั้น",
  long: "ระยะยาว",
};

/** Display label for org mode — org_name when set, else project name. */
export function orgDisplayName(project: { orgName: string | null; name: string }): string {
  return project.orgName?.trim() || project.name;
}

/** "องค์กร" for long-term org projects, "โครงการ" for short-term. */
export function projectScopeNoun(projectType: import("@/types/project").ProjectType): string {
  return projectType === "long" ? "องค์กร" : "โครงการ";
}

/** List-card status badges (GROUP 1) */
export const PROJECT_LIST_STATUS_BADGE: Record<
  ProjectStatus,
  { label: string; textClass: string; bgClass: string; borderClass: string }
> = {
  active: {
    label: "กำลังทำ",
    textClass: "text-rz-green",
    bgClass: "bg-rz-logo-bg",
    borderClass: "border-rz-logo-border",
  },
  planning: {
    label: "วางแผน",
    textClass: "text-rz-purple",
    bgClass: "bg-rz-purple-bg",
    borderClass: "border-rz-purple-border",
  },
  closed: {
    label: "ปิดแล้ว",
    textClass: "text-rz-muted",
    bgClass: "bg-rz-elevated",
    borderClass: "border-rz-border",
  },
};

/** §4 Payment status badges */
export const PAYMENT_STATUS_UI: Record<
  PaymentStatus,
  { label: string; textClass: string; bgClass: string; borderClass: string }
> = {
  pending: {
    label: PAYMENT_STATUS_LABELS.pending,
    textClass: "text-rz-amber",
    bgClass: "bg-[#2E2310]",
    borderClass: "border-[#5A3F12]",
  },
  approved: {
    label: PAYMENT_STATUS_LABELS.approved,
    textClass: "text-rz-purple",
    bgClass: "bg-rz-purple-bg",
    borderClass: "border-rz-purple-border",
  },
  paid: {
    label: PAYMENT_STATUS_LABELS.paid,
    textClass: "text-rz-green",
    bgClass: "bg-rz-logo-bg",
    borderClass: "border-rz-logo-border",
  },
  rejected: {
    label: PAYMENT_STATUS_LABELS.rejected,
    textClass: "text-rz-red",
    bgClass: "bg-[#2A1518]",
    borderClass: "border-[#5A2028]",
  },
};

/** §2 Funding source tiles (GROUP 3) */
export const FUNDING_SOURCE_UI = [
  {
    key: "faculty_grant" as const,
    label: "งบจากคณะ",
    icon: "building-bank" as const,
    color: PROJECT_UI.accent,
    bg: "#2A1F45",
    dashed: false,
  },
  {
    key: "sponsor" as const,
    label: "สปอนเซอร์",
    icon: "heart-handshake" as const,
    color: PROJECT_UI.amber,
    bg: "#2E2310",
    dashed: false,
  },
  {
    key: "membership" as const,
    label: "ค่าสมาชิก",
    icon: "users" as const,
    color: PROJECT_UI.positive,
    bg: "#16352A",
    dashed: false,
  },
  {
    key: "other_income" as const,
    label: "กำหนดเอง",
    icon: "pencil" as const,
    color: PROJECT_UI.muted,
    bg: "#1A2236",
    dashed: true,
  },
] as const;

/** §3 Expense category tiles (GROUP 3) */
export const EXPENSE_CATEGORY_UI = [
  { key: "venue" as const, label: "สถานที่", icon: "building" as const, color: PROJECT_UI.purple },
  { key: "food" as const, label: "อาหาร", icon: "soup" as const, color: PROJECT_UI.amber },
  { key: "transport" as const, label: "ขนส่ง", icon: "bus" as const, color: PROJECT_UI.accent },
  { key: "materials" as const, label: "วัสดุ/อุปกรณ์", icon: "tools" as const, color: PROJECT_UI.positive },
  { key: "printing" as const, label: "เอกสาร/ของที่ระลึก", icon: "file-text" as const, color: PROJECT_UI.muted },
  { key: "reward" as const, label: "ของรางวัล", icon: "trophy" as const, color: PROJECT_UI.amber },
  { key: "service" as const, label: "ค่าจ้าง/บริการ", icon: "user-check" as const, color: PROJECT_UI.purple },
  { key: "other_expense" as const, label: "อื่นๆ", icon: "dots" as const, color: PROJECT_UI.mutedDark },
] as const;

/** Project type icon colors (list + create) */
export const PROJECT_TYPE_ICON: Record<ProjectType, { icon: "calendar-event" | "calendar-stats"; color: string; bg: string }> = {
  short: { icon: "calendar-event", color: PROJECT_UI.accent, bg: PROJECT_UI.accentBg },
  long: { icon: "calendar-stats", color: PROJECT_UI.accent, bg: PROJECT_UI.accentBg },
};

export function projectStatusFullLabel(status: ProjectStatus, projectType?: ProjectType): string {
  return projectStatusLabel(status, projectType);
}
