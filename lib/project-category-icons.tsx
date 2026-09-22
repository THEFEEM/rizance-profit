import type { ReactNode } from "react";
import { ProjectIconBox, type ProjectIconName } from "@/components/project/icons";
import { EXPENSE_CATEGORY_UI, FUNDING_SOURCE_UI, PROJECT_UI } from "@/lib/project-ui";
import type { ProjectFundingKey } from "@/lib/project-categories";

/**
 * icon ของหมวดโมดูล Project สำหรับ summary rows — ใช้ ProjectIconBox ที่มีอยู่แล้ว
 * (ระบบ icon/สีของ Project เอง · ยังไม่ย้ายมา Lucide — รอเฟส unification แยก)
 *
 * แทน FUNDING_EMOJI / EXPENSE_EMOJI เดิมใน lib/project-stats.ts
 * ไม่แตะ picker (ProjectEntryGrids) และไม่ redesign ProjectIconBox
 */

type Tile = { icon: ProjectIconName; color: string; bg: string };

const FUNDING_TILE = Object.fromEntries(
  FUNDING_SOURCE_UI.map((t) => [t.key, { icon: t.icon, color: t.color, bg: t.bg }]),
) as Record<string, Tile>;

// keys ที่มีใน ledger แต่ไม่มี tile ใน FUNDING_SOURCE_UI (สอดคล้องกับ lib/project-breakdown.ts)
const EXTRA_FUNDING_TILE: Partial<Record<ProjectFundingKey, Tile>> = {
  participant_fee: { icon: "calendar-event", color: PROJECT_UI.accent, bg: PROJECT_UI.accentBg },
  donation: { icon: "heart-handshake", color: PROJECT_UI.amber, bg: "#2E2310" },
  activity_income: { icon: "building-store", color: PROJECT_UI.positive, bg: "#16352A" },
};

// expense tiles ไม่มี bg ของตัวเอง — ใช้ tint จากสี icon เหมือน ProjectBreakdownSections (`${color}22`)
const EXPENSE_TILE = Object.fromEntries(
  EXPENSE_CATEGORY_UI.map((t) => [t.key, { icon: t.icon, color: t.color, bg: `${t.color}22` }]),
) as Record<string, Tile>;

const FALLBACK_FUNDING: Tile = { icon: "pencil", color: PROJECT_UI.muted, bg: "#1A2236" };
const FALLBACK_EXPENSE: Tile = { icon: "dots", color: PROJECT_UI.mutedDark, bg: `${PROJECT_UI.mutedDark}22` };
const ACTIVITY_TILE: Tile = { icon: "clipboard-list", color: PROJECT_UI.accent, bg: PROJECT_UI.accentBg };

function box(tile: Tile, size: number): ReactNode {
  return <ProjectIconBox name={tile.icon} color={tile.color} bg={tile.bg} size={size} />;
}

export function renderProjectFundingIcon(key: string, size = 28): ReactNode {
  return box(FUNDING_TILE[key] ?? EXTRA_FUNDING_TILE[key as ProjectFundingKey] ?? FALLBACK_FUNDING, size);
}

export function renderProjectExpenseIcon(key: string, size = 28): ReactNode {
  return box(EXPENSE_TILE[key] ?? FALLBACK_EXPENSE, size);
}

/** แถว "ตามโครงการ" (activity) — ไม่ใช่หมวด แต่อยู่ในรายการเดียวกัน ให้หน้าตาเข้าชุด */
export function renderProjectActivityIcon(size = 28): ReactNode {
  return box(ACTIVITY_TILE, size);
}
